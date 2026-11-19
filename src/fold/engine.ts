import {area,clip,reflect,signedArea,type Point,type Polygon} from './geometry';
import {dart,type FoldStep,type FoldOperation,type FoldBoundary,type FoldPoint} from './planes/dart';
import type {Point3} from './geometry3d';
import {deploySlopedWings} from './deploy';
// Increment when the same fold program can produce different geometry.
export const FOLD_ENGINE_VERSION=5;
export type Sheet = {width:number;height:number};
export type FoldState = {layers:Polygon[];layerGroups?:number[];step:number;flightLayers?:Polygon[];wingLayers?:Polygon[];bodySideLayers?:Polygon[];bodyLayerIndices?:number[];bodyAxisX?:number;massFaces3d?:Point3[][]};
export function line(step:FoldBoundary & {diagonal?:boolean},s:Sheet):[Point,Point] {
 const point=(p:FoldPoint):Point=>{
  if(Array.isArray(p))return {x:p[0]*s.width,y:step.diagonal && p[1]>0 ? s.width/2 : p[1]*s.height};
  if('bisector' in p){
   const {vertex,through,other,atY}=p.bisector,v=point(vertex),a=point(through),b=point(other);
   const la=Math.hypot(a.x-v.x,a.y-v.y),lb=Math.hypot(b.x-v.x,b.y-v.y);
   if(la<1e-12||lb<1e-12)throw new Error('角平分线的射线长度不能为零');
   const dx=(a.x-v.x)/la+(b.x-v.x)/lb,dy=(a.y-v.y)/la+(b.y-v.y)/lb;
   if(Math.abs(dy)<1e-12)throw new Error('角平分线无法与目标水平线相交');
   const y=atY*s.height;
   return {x:v.x+dx*(y-v.y)/dy,y};
  }
  return {x:p.x[0]*s.width+p.x[1]*s.height+(p.offset?.[0] ?? 0),y:p.y[0]*s.width+p.y[1]*s.height+(p.offset?.[1] ?? 0)};
 };
 return [point(step.a),point(step.b)];
}
export function initial(s:Sheet):FoldState {return {layers:[[{x:0,y:0},{x:s.width,y:0},{x:s.width,y:s.height},{x:0,y:s.height}]],layerGroups:[0],step:0}}
type FoldPart={polygon:Polygon;group:number};
/** Find the insertion point beneath the requested number of top layer groups. */
export function tuckIndex(groups:readonly number[],count:number):number {
 if(!Number.isInteger(count)||count<1)throw new Error('塞入层数必须为正整数');
 const top=new Set<number>();
 for(let i=groups.length-1;i>=0;i--){
  top.add(groups[i]);
  if(top.size===count){
   // A group split into fragments must stay together in stack order.
   const index=groups.findIndex(group=>top.has(group));
   if(groups.slice(index).some(group=>!top.has(group)))throw new Error('塞入目标的纸层顺序不连续');
   return index;
  }
 }
 throw new Error('塞入层数超出可用纸层');
}
/** Split exactly the paper selected by an operation, before reflecting it. */
export function splitFold(layers:Polygon[],groups:number[],s:Sheet,op:FoldOperation):{still:FoldPart[];moving:FoldPart[]} {
 const boundaries=[op,...(op.region ?? [])];
 const still:FoldPart[]=[],moving:FoldPart[]=[];
 const valid=(p:Polygon)=>p.length>=3 && area(p)>1e-12;
 const lines=boundaries.map(boundary=>{
  const [a,b]=line(boundary,s);
  if(Math.hypot(b.x-a.x,b.y-a.y)<1e-12)throw new Error('折痕两端不能重合');
  return {a,b,sign:boundary.sign};
 });
 for(let index=0;index<layers.length;index++){
  const polygon=layers[index];
  const group=groups[index];
  let selected=polygon;
  for(const boundary of lines){
   const {a,b}=boundary;
   const outside=clip(selected,a,b,-boundary.sign);
   if(valid(outside))still.push({polygon:outside,group});
   selected=clip(selected,a,b,boundary.sign);
   if(!valid(selected))break;
  }
  if(!valid(selected))continue;
  let visible=[selected];
  if(op.layer==='top')for(let above=index+1;above<layers.length;above++){
   if(groups[above]===group)continue;
   const cover=layers[above],orientation=Math.sign(signedArea(cover));
   if(!orientation)continue;
   // Fold fragments start convex and half-plane clipping preserves convexity.
   // Subtract each covering fragment by partitioning along its edges; this
   // represents even an enclosed hole as separate convex pieces.
   const exposed:Polygon[]=[];
   for(const fragment of visible){
    let inside=fragment;
    for(let edge=0;edge<cover.length && valid(inside);edge++){
     const a=cover[edge],b=cover[(edge+1)%cover.length];
     if(Math.hypot(b.x-a.x,b.y-a.y)<1e-12)continue;
     const outside=clip(inside,a,b,-orientation);
     if(valid(outside))exposed.push(outside);
     inside=clip(inside,a,b,orientation);
    }
    if(valid(inside))still.push({polygon:inside,group});
   }
   visible=exposed;
  }
  moving.push(...visible.map(polygon=>({polygon,group})));
 }
 return {still,moving};
}
function foldLayers(layers:Polygon[],groups:number[],s:Sheet,op:FoldOperation):{layers:Polygon[];layerGroups:number[]} {
 if(op.flip) return {layers:[...layers].reverse().map(p=>p.map(v=>({x:s.width-v.x,y:v.y}))),layerGroups:[...groups].reverse()};
 const {still,moving}=splitFold(layers,groups,s,op), movedGroups=new Map<number,number>();
 let nextGroup=Math.max(-1,...groups)+1;
 const [a,b]=line(op,s);
 for(const part of moving){
  if(!movedGroups.has(part.group))movedGroups.set(part.group,nextGroup++);
  part.group=movedGroups.get(part.group)!;
  part.polygon=part.polygon.map(v=>reflect(v,a,b));
 }
 const turned=moving.reverse();
 const index=op.tuckUnder===undefined?(op.kind==='mountain'?0:still.length):tuckIndex(still.map(part=>part.group),op.tuckUnder);
 const result=[...still.slice(0,index),...turned,...still.slice(index)];
 return {layers:result.map(part=>part.polygon),layerGroups:result.map(part=>part.group)};
}
export function apply(state:FoldState,s:Sheet,step:FoldStep):FoldState {
 if(step.unfold) return {...initial(s),step:state.step+1};
 let layers=state.layers, layerGroups=state.layerGroups ?? layers.map((_,i)=>i);
 if(layerGroups.length!==layers.length)throw new Error('纸层分组与几何片段数量不一致');
 for(const op of step.operations ?? [step])({layers,layerGroups}=foldLayers(layers,layerGroups,s,op));
 return {layers,layerGroups,step:state.step+1};
}
export function replay(s:Sheet,count:number,program:readonly FoldStep[]=dart):FoldState {
 const steps=program.slice(0,Math.max(0,Math.min(count,program.length)));
 const states:FoldState[]=[initial(s)];
 for(const operation of steps) {
  if(operation.unfoldToStep!==undefined) {
   if(!Number.isInteger(operation.unfoldToStep) || operation.unfoldToStep<0 || operation.unfoldToStep>=states.length-1) throw new Error('无效的展开步骤');
   states.push({...states[operation.unfoldToStep],step:states.length});
  } else states.push(apply(states[states.length-1],s,operation));
 }
 const state=states[states.length-1], opening=steps.at(-1), openToStep=opening?.openToStep;
 // Opening both wings restores their plan-view projection; the folded layers remain
 // available for replay and instruction, while this projection preserves all paper.
 if(openToStep===undefined) return state;
 if(!Number.isInteger(openToStep)||openToStep<0||openToStep>=states.length-1)throw new Error('无效的展翼基准步骤');
 // Horizontal, full-stack folds commute with the centre fold. Replay those on
 // the unfolded source so later nose folds survive wing opening. Other folds
 // need per-face provenance, and must not silently disappear.
 const afterBody=states[openToStep+1],beforeOpening=states[states.length-2];
 let projectedSource=states[openToStep];
 if(JSON.stringify([afterBody.layers,afterBody.layerGroups])!==JSON.stringify([beforeOpening.layers,beforeOpening.layerGroups])){
  const bodyOps=steps[openToStep].operations ?? [steps[openToStep]];
  const body=bodyOps.at(-1)!;
  const [bodyA,bodyB]=line(body,s);
  if(body.flip||body.region||body.layer==='top'||body.tuckUnder!==undefined||Math.abs(bodyA.x-s.width/2)>1e-10||Math.abs(bodyB.x-s.width/2)>1e-10||bodyOps.slice(0,-1).some(op=>!op.flip))
   throw new Error('展翼投影尚不支持此机身折序');
  if(bodyOps.slice(0,-1).length)projectedSource=apply(projectedSource,s,{...steps[openToStep],operations:bodyOps.slice(0,-1)});
  // First discard folds that were later unfolded. A temporary diagonal crease
  // must not prevent a subsequent permanent horizontal fold from projecting.
  const histories=new Map<number,number[]>([[openToStep+1,[]]]);
  for(let i=openToStep+1;i<steps.length-1;i++){
   const step=steps[i];
   if(step.unfoldToStep!==undefined){
    const restored=histories.get(step.unfoldToStep);
    if(!restored)throw new Error('展翼投影尚不支持此展开步骤');
    histories.set(i+1,restored);
   }else histories.set(i+1,[...histories.get(i)!,i]);
  }
  for(const i of histories.get(steps.length-1)!){
    const step=steps[i];
    for(const op of step.operations ?? [step]){
     const [a,b]=line(op,s);
     if(op.flip||op.region||op.layer==='top'||op.tuckUnder!==undefined||Math.abs(a.y-b.y)>1e-10)
      throw new Error('展翼投影尚不支持机身对折后的局部或非横向折叠');
    }
    projectedSource=apply(projectedSource,s,step);
  }
 }
 const sourceLayers=projectedSource.layers,center=s.width/2;
 const [rootA,rootB]=line(opening!,s);
 if(Math.abs(rootA.y-rootB.y)<1e-12)throw new Error('展翼折痕必须有纵向长度');
 if(Math.abs(rootA.x-rootB.x)>1e-10){
  if(rootA.x>s.width+1e-10||rootB.x>s.width+1e-10)throw new Error('翼根必须位于纸张内');
  return {...state,...deploySlopedWings(sourceLayers,center,rootA,rootB)};
 }
 const offset=Math.abs(rootA.x-center);
 if(offset>=center)throw new Error('展翼折痕必须位于纸张内');
 const flightLayers:Polygon[]=[],wingLayers:Polygon[]=[],bodySideLayers:Polygon[]=[],bodyLayerIndices:number[]=[];
 for(const poly of sourceLayers){
  const left=clip(poly,{x:center-offset,y:0},{x:center-offset,y:s.height},1);
  const right=clip(poly,{x:center+offset,y:0},{x:center+offset,y:s.height},-1);
  const middle=clip(clip(poly,{x:center-offset,y:0},{x:center-offset,y:s.height},-1),{x:center+offset,y:0},{x:center+offset,y:s.height},1);
  const wings=[left.map(v=>({x:v.x+offset,y:v.y})),right.map(v=>({x:v.x-offset,y:v.y}))].filter(p=>p.length>=3 && area(p)>1e-12);
  wingLayers.push(...wings);flightLayers.push(...wings);
  if(middle.length>=3 && area(middle)>1e-12){
   bodyLayerIndices.push(flightLayers.length);
   flightLayers.push(middle);
   // Each half of the central paper stands vertically after folding the
   // body; x in this projection is height away from the center crease.
   const axisA={x:center,y:0},axisB={x:center,y:s.height};
   const halves=[clip(middle,axisA,axisB,1),clip(middle,axisA,axisB,-1)];
   for(const half of halves){
    const projected=half.map(v=>({x:Math.abs(v.x-center),y:v.y}));
    if(projected.length>=3 && area(projected)>1e-12)bodySideLayers.push(projected);
   }
  }
 }
 return {...state,flightLayers,wingLayers,bodySideLayers,bodyLayerIndices,bodyAxisX:center};
}
