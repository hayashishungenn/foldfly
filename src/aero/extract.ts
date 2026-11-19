import polygonClipping from 'polygon-clipping';
import {area,centroid,type Polygon} from '../fold/geometry';
import type {FoldState} from '../fold/engine';
import {spatialMass} from './mass3d';

export type Aero = {
 mass:number; cg:{x:number;y:number}; span:number; wingArea:number;
 aspectRatio:number; chord:number; noseY:number; wettedArea:number;
 aerodynamicCenter:{x:number;y:number}; wingCentroid:{x:number;y:number}; cgDepth:number; pitchInertia:number; wingPitchSecondMoment:number; frictionChord:number; bodySideArea:number; bodyFrictionChord:number;
};

/** Area integral of squared longitudinal distance from the mass centre. */
function longitudinalSecondMoment(p:Polygon, cgY:number):number {
 let sum=0;
 for(let i=0;i<p.length;i++){
  const a=p[i],b=p[(i+1)%p.length],ay=a.y-cgY,by=b.y-cgY;
  sum+=((a.x-p[0].x)*by-(b.x-p[0].x)*ay)*(ay*ay+ay*by+by*by);
 }
 return Math.abs(sum)/12;
}

/** Extract properties from the deployed, plan-view paper layers. */
export function extract(state:FoldState,gsm:number):Aero {
 const layers=state.flightLayers ?? state.layers;
 const total=layers.reduce((s,p)=>s+area(p),0);
 if(!Number.isFinite(total)||!Number.isFinite(gsm)||total<=0||gsm<=0) throw new Error('纸张面积和克重必须大于零');
 const vertical=new Set(state.flightLayers ? state.bodyLayerIndices ?? [] : []);
 if(vertical.size && !Number.isFinite(state.bodyAxisX))throw new Error('机身中心线无效');
 const spatial=state.massFaces3d ? spatialMass(state.massFaces3d,gsm) : undefined;
 const cg=spatial ? {x:spatial.centroid.x,y:spatial.centroid.y} : layers.reduce((s,p,i)=>{const a=area(p),c=centroid(p);return {x:s.x+(vertical.has(i)?state.bodyAxisX!:c.x)*a/total,y:s.y+c.y*a/total}},{x:0,y:0});
 const wings=state.wingLayers ?? layers;
 const pts=wings.flat();
 if(pts.length<3)throw new Error('折叠几何无有效翼面');
 const minX=Math.min(...pts.map(p=>p.x)),maxX=Math.max(...pts.map(p=>p.x));
 const width=maxX-minX, chord=Math.max(...pts.map(p=>p.y))-Math.min(...pts.map(p=>p.y));
 // Work in a local coordinate frame before snapping. This prevents floating
 // point cancellation from changing topology when the whole model is moved.
 const merge=(polys:Polygon[])=>{
  const vertices=polys.flat();
  if(!vertices.length)throw new Error('折叠几何无有效翼面');
  const ox=Math.min(...vertices.map(v=>v.x)),oy=Math.min(...vertices.map(v=>v.y));
  let failure:unknown;
  // Near-coincident fold edges can defeat the sweep-line ordering even after
  // snapping. Retry at progressively coarser sub-micrometre grids.
  for(const scale of [1e9,1e8,1e7])try{
  const snap=(n:number)=>Math.round(n*scale)/scale;
  const rings=polys.map(p=>{
   const ring:[number,number][]=[];
   for(const v of p){const point:[number,number]=[snap(v.x-ox),snap(v.y-oy)],last=ring.at(-1);if(!last||last[0]!==point[0]||last[1]!==point[1])ring.push(point);}
   if(ring.length>1&&ring[0][0]===ring.at(-1)![0]&&ring[0][1]===ring.at(-1)![1])ring.pop();
   return ring;
  }).filter(r=>r.length>=3&&area(r.map(([x,y])=>({x,y})))>1e-12).map(r=>[r]);
  if(!rings.length)throw new Error('折叠几何无有效翼面');
  let shape:ReturnType<typeof polygonClipping.union>;
  try{shape=polygonClipping.union(rings[0],...rings.slice(1));}
  catch{shape=polygonClipping.union(rings[0]);for(const ring of rings.slice(1))shape=polygonClipping.union(shape,ring);}
  return shape.map(poly=>poly.map(ring=>ring.map(([x,y]):[number,number]=>[x+ox,y+oy])));
  }catch(error){failure=error}
  throw failure;
 };
 const merged=merge(wings);
 const unionArea=(shape:typeof merged)=>shape.reduce((sum,poly)=>sum+poly.reduce((a,ring,i)=>a+(i===0?1:-1)*area(ring.map(([x,y])=>({x,y}))),0),0);
 const silhouette=unionArea(merged);
 const bodyOutline=state.bodySideLayers?.length ? merge(state.bodySideLayers) : null;
 const bodySideArea=bodyOutline ? unionArea(bodyOutline) : 0;
 // Wings and the central body occupy perpendicular planes. Count both sides
 // of each silhouette; folds, intersections and thickness remain approximate.
 const wettedArea=state.bodySideLayers ? 2*(silhouette+bodySideArea) : 2*unionArea(wings===layers?merged:merge(layers));
 const span=width,wingArea=silhouette;
 if(!Number.isFinite(wingArea)||wingArea<=0||span<=0||chord<=0)throw new Error('折叠几何无有效翼面');
 // Between consecutive vertex x-coordinates every chord boundary is linear.
 // Two-point Gauss integration is exact through cubic order on each interval,
 // including the second moment; even/odd crossings exclude holes.
 let weightedX=0,weightedY=0,weightedMidY=0,wingSecondMoment=0,rootChordIntegral=0,stripArea=0;
 const breaks=[...new Set(merged.flatMap(poly=>poly.flatMap(ring=>ring.map(([x])=>x))))].sort((a,b)=>a-b);
 for(let i=0;i<breaks.length-1;i++){
  const mid=(breaks[i]+breaks[i+1])/2,half=(breaks[i+1]-breaks[i])/2;
  if(half<=0)continue;
  for(const poly of merged){
  const chords:number[][]=[];
  for(const x of [mid-half/Math.sqrt(3),mid+half/Math.sqrt(3)]){
   const crossings:number[]=[];
   for(const ring of poly)for(let j=0;j<ring.length-1;j++){
    const [x0,y0]=ring[j],[x1,y1]=ring[j+1];
    if((x0<=x && x1>x)||(x1<=x && x0>x))crossings.push(y0+(y1-y0)*(x-x0)/(x1-x0));
   }
   crossings.sort((a,b)=>a-b);
   const lengths:number[]=[];
   for(let j=0;j+1<crossings.length;j+=2){
    const leading=crossings[j],length=crossings[j+1]-leading,weight=length*half;
    lengths.push(length);
    stripArea+=weight;weightedX+=x*weight;weightedY+=(leading+length/4)*weight;weightedMidY+=(leading+length/2)*weight;
    const near=leading-cg.y,far=leading+length-cg.y;
    wingSecondMoment+=(far*far*far-near*near*near)*half/3;
   }
   chords.push(lengths);
  }
  // Each paired chord changes linearly within this vertex interval. Integrate
  // its square root analytically, including a zero-width wingtip.
  for(let j=0;j<chords[0].length;j++){
   const a=chords[0][j],b=chords[1][j],center=(a+b)/2,slope=(b-a)*Math.sqrt(3)/2;
   const start=Math.max(0,center-slope),end=Math.max(0,center+slope);
   const u=Math.sqrt(start),v=Math.sqrt(end);
   if(u+v>0)rootChordIntegral+=2*half*(2/3)*(start+u*v+end)/(u+v);
  }
  }
 }
 if(stripArea<=0)throw new Error('无法计算翼面焦点');
 const aerodynamicCenter={x:weightedX/stripArea,y:weightedY/stripArea};
 const wingCentroid={x:weightedX/stripArea,y:weightedMidY/stripArea};
 // The vertical body contributes distance from the pitch axis as well as
 // longitudinal distance. Side-view x is height from the wing plane; wings
 // themselves lie at height zero. Preserve every layer's mass (not union area).
 const body=state.bodySideLayers ?? [];
 const bodyMassArea=body.reduce((sum,p)=>sum+area(p),0);
 const centerHeight=spatial ? -spatial.centroid.z : body.reduce((sum,p)=>sum+area(p)*centroid(p).x,0)/total;
 const verticalMoment=spatial ? 0 : Math.max(0,total-bodyMassArea)*centerHeight**2+body.reduce((sum,p)=>sum+longitudinalSecondMoment(p.map(v=>({x:v.y,y:v.x})),centerHeight),0);
 const pitchInertia=spatial?.pitchInertia ?? (layers.reduce((sum,p)=>sum+longitudinalSecondMoment(p,cg.y),0)+verticalMoment)*gsm/1000;
 if(!Number.isFinite(pitchInertia)||pitchInertia<=0)throw new Error('无法计算俯仰转动惯量');
 // A laminar strip contributes friction proportional to sqrt(local chord).
 // The equivalent chord reproduces the integral with one Reynolds number.
 const frictionChord=(stripArea/rootChordIntegral)**2;
 let bodyRootIntegral=0;
 if(bodyOutline){
  const xs=[...new Set(bodyOutline.flatMap(poly=>poly.flatMap(ring=>ring.map(([x])=>x))))].sort((a,b)=>a-b);
  for(let i=0;i<xs.length-1;i++){
   const mid=(xs[i]+xs[i+1])/2,half=(xs[i+1]-xs[i])/2;
   if(half<=0)continue;
   for(const poly of bodyOutline){
    const chords=[mid-half/Math.sqrt(3),mid+half/Math.sqrt(3)].map(x=>{
     const crossings:number[]=[];
     for(const ring of poly)for(let j=0;j<ring.length-1;j++){
      const [x0,y0]=ring[j],[x1,y1]=ring[j+1];
      if((x0<=x && x1>x)||(x1<=x && x0>x))crossings.push(y0+(y1-y0)*(x-x0)/(x1-x0));
     }
     crossings.sort((a,b)=>a-b);
     return Array.from({length:Math.floor(crossings.length/2)},(_,j)=>crossings[2*j+1]-crossings[2*j]);
    });
    for(let j=0;j<chords[0].length;j++){
     const center=(chords[0][j]+chords[1][j])/2,slope=(chords[1][j]-chords[0][j])*Math.sqrt(3)/2;
     const start=Math.max(0,center-slope),end=Math.max(0,center+slope),u=Math.sqrt(start),v=Math.sqrt(end);
     if(u+v>0)bodyRootIntegral+=2*half*(2/3)*(start+u*v+end)/(u+v);
    }
   }
  }
 }
 const bodyFrictionChord=bodyRootIntegral>0?(bodySideArea/bodyRootIntegral)**2:0;
 return {mass:spatial?.mass ?? total*gsm/1000,cg,span,wingArea,aspectRatio:span*span/wingArea,chord,wettedArea,noseY:Math.min(...pts.map(p=>p.y)),aerodynamicCenter,wingCentroid,cgDepth:centerHeight,pitchInertia,wingPitchSecondMoment:wingSecondMoment/stripArea,frictionChord,bodySideArea,bodyFrictionChord};
}

export type AeroMetrics = {
 staticMargin: number;
 wingLoading: number;
 fullness: number;
 slenderness: number;
 keelRatio: number;
 keelDepth: number;
 nominalGlideSpeed: number;
};

/** Compute dimensionless geometric ratios and characteristic flight metrics from extracted Aero. */
export function aeroMetrics(a: Aero): AeroMetrics {
 const staticMargin = (a.aerodynamicCenter.y - a.cg.y) / Math.max(1e-6, a.chord);
 const wingLoading = (a.mass * 9.81) / Math.max(1e-6, a.wingArea);
 const fullness = a.wingArea / Math.max(1e-6, a.span * a.chord);
 const slenderness = a.chord / Math.max(1e-6, a.span);
 const keelRatio = (a.bodySideArea ?? 0) / Math.max(1e-6, a.wingArea);
 const keelDepth = a.bodySideArea > 0 ? (2 * a.bodySideArea) / Math.max(1e-6, a.chord) : Math.max(0.015, a.cgDepth * 2.5);
 const nominalGlideSpeed = Math.sqrt((2 * wingLoading) / (1.225 * 0.6));
 return {staticMargin, wingLoading, fullness, slenderness, keelRatio, keelDepth, nominalGlideSpeed};
}
