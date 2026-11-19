import type {Point,Polygon} from './geometry';
import {apply,line,splitFold,tuckIndex,type FoldState,type Sheet} from './engine';
import type {FoldStep} from './planes/dart';
/** Project a face rotating around a crease, with a small isometric depth cue. */
export function projectFold(point:Point,a:Point,b:Point,progress:number,kind:'valley'|'mountain',unfold=false):Point {
 const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
 if(length<=1e-12)throw new Error('折痕两端不能重合');
 const ux=dx/length,uy=dy/length;
 const clamped=Math.max(0,Math.min(1,progress));
 const eased=clamped<.5?2*clamped*clamped:1-Math.pow(-2*clamped+2,2)/2;
 const theta=Math.PI*(unfold?1-eased:eased),direction=kind==='valley'?1:-1;
 const t=(point.x-a.x)*ux+(point.y-a.y)*uy;
 const n=-(point.x-a.x)*uy+(point.y-a.y)*ux,z=n*Math.sin(theta)*direction;
 return {x:a.x+t*ux-n*uy*Math.cos(theta)+z*.32,y:a.y+t*uy+n*ux*Math.cos(theta)-z*.18};
}

/** Geometry for one animation frame; sequential operations share the step's duration. */
export function foldFrame(state:FoldState,sheet:Sheet,step:FoldStep,progress:number):{polygon:Polygon;back:boolean}[] {
 const operations=step.operations ?? [step];
 const position=Math.max(0,Math.min(1,progress))*operations.length;
 const index=Math.min(operations.length-1,Math.floor(position));
 const local=position-index;
 let current=state;
 for(let i=0;i<index;i++)current=apply(current,sheet,{...step,...operations[i],operations:undefined});
 const op=operations[index];
 if(op.flip){
  const factor=Math.cos(Math.PI*local);
  const layers=local<.5?current.layers:[...current.layers].reverse();
  return layers.map(p=>({polygon:p.map(v=>({x:sheet.width/2+(v.x-sheet.width/2)*factor,y:v.y})),back:local>=.5}));
 }
 const groups=current.layerGroups ?? current.layers.map((_,i)=>i);
 const {still,moving}=splitFold(current.layers,groups,sheet,op),[a,b]=line(op,sheet);
 const fixed=still.map(part=>({polygon:part.polygon,back:false}));
 const turned=[...moving].reverse().map(part=>({polygon:part.polygon.map(p=>projectFold(p,a,b,local,op.kind)),back:local>=.5}));
 const insertion=op.tuckUnder===undefined?(op.kind==='mountain'?0:fixed.length):tuckIndex(still.map(part=>part.group),op.tuckUnder);
 // Until the flap passes the crease, preserve the original stack. Otherwise
 // a tuck would disappear under its destination before it starts moving.
 if(op.tuckUnder!==undefined && local<.5){
  const order=new Map<number,number>();
  groups.forEach((group,i)=>{if(!order.has(group))order.set(group,i)});
  return [
   ...still.map((part,i)=>({group:part.group,frame:fixed[i]})),
   ...moving.map(part=>({group:part.group,frame:{polygon:part.polygon.map(p=>projectFold(p,a,b,local,op.kind)),back:false}})),
  ].sort((a,b)=>(order.get(a.group) ?? 0)-(order.get(b.group) ?? 0)).map(item=>item.frame);
 }
 return [...fixed.slice(0,insertion),...turned,...fixed.slice(insertion)];
}

/** Reverse the actual preceding fold, preserving its selected layers and regions. */
export function unfoldFrame(beforeFold:FoldState,sheet:Sheet,fold:FoldStep,progress:number):{polygon:Polygon;back:boolean}[] {
 return foldFrame(beforeFold,sheet,fold,1-Math.max(0,Math.min(1,progress)));
}

/** The final 2D projection has no vertex correspondence with the folded
 * stack. Fade between the two representations after the crease animation. */
export function wingOpeningFrame(state:FoldState,sheet:Sheet,step:FoldStep,opened:readonly Polygon[],progress:number):{polygon:Polygon;back:boolean;opacity:number}[] {
 const p=Math.max(0,Math.min(1,progress)), foldEnd=.65;
 if(p<=foldEnd)return foldFrame(state,sheet,step,p/foldEnd).map(part=>({...part,opacity:1}));
 const t=(p-foldEnd)/(1-foldEnd),ease=t*t*(3-2*t);
 const folded=foldFrame(state,sheet,step,1).map(part=>({...part,opacity:1-ease}));
 const wings=opened.map((polygon,i)=>({polygon,back:i%2===1,opacity:ease}));
 return [...folded,...wings].filter(part=>part.opacity>0);
}
