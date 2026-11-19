import {area,clip,type Point,type Polygon} from './geometry';
import {deployWing,type Point3} from './geometry3d';

/** Split unfolded convex paper layers into a vertical body and two opened wings. */
export function deploySlopedWings(layers:readonly Polygon[],center:number,rootA:Point,rootB:Point) {
 if(rootA.y>rootB.y)[rootA,rootB]=[rootB,rootA];
 if(rootA.x<center-1e-10||rootB.x<center-1e-10||rootB.y-rootA.y<1e-12)throw new Error('无效的倾斜翼根');
 const mirror=(p:Point):Point=>({x:2*center-p.x,y:p.y});
 const leftA=mirror(rootA),leftB=mirror(rootB);
 const massFaces3d:Point3[][]=[],wingLayers:Polygon[]=[],flightLayers:Polygon[]=[],bodySideLayers:Polygon[]=[],bodyLayerIndices:number[]=[];
 const valid=(p:Polygon)=>p.length>=3&&area(p)>1e-12;
 for(const poly of layers){
  const left=clip(poly,leftA,leftB,1),right=clip(poly,rootA,rootB,-1);
  for(const [part,side] of [[left,'left'],[right,'right']] as const){
   if(!valid(part))continue;
   const face=deployWing(part,center,rootA,rootB,side);
   massFaces3d.push(face);
   const projected=face.map(({x,y})=>({x,y}));
   wingLayers.push(projected);flightLayers.push(projected);
  }
  const middle=clip(clip(poly,leftA,leftB,-1),rootA,rootB,1);
  const axisA={x:center,y:0},axisB={x:center,y:1};
  for(const sign of [1,-1]){
   const half=clip(middle,axisA,axisB,sign);
   if(!valid(half))continue;
   bodyLayerIndices.push(flightLayers.length);flightLayers.push(half);
   const side=half.map(v=>({x:Math.abs(v.x-center),y:v.y}));
   bodySideLayers.push(side);
   massFaces3d.push(side.map(v=>({x:center,y:v.y,z:-v.x})));
  }
 }
 return {massFaces3d,wingLayers,flightLayers,bodySideLayers,bodyLayerIndices,bodyAxisX:center};
}
