import {describe,it,expect} from 'vitest';
import {apply,initial,replay,splitFold,tuckIndex} from '../src/fold/engine';
import {foldFrame} from '../src/fold/animate';
import {extract} from '../src/aero/extract';
import {area,centroid} from '../src/fold/geometry';
import type {FoldStep} from '../src/fold/planes/dart';
const sheet={width:1,height:1};
const total=(polys:ReturnType<typeof initial>['layers'])=>polys.reduce((n,p)=>n+area(p),0);
describe('折叠原语',()=>{
 it('部分折仅移动选定区域，保留未折区域并守恒',()=>{
  const op:FoldStep={title:'部分折',description:'',kind:'valley',a:[.5,0],b:[.5,1],sign:-1,region:[{a:[0,.5],b:[1,.5],sign:-1}]};
  const state=apply(initial(sheet),sheet,op);
  expect(total(state.layers)).toBeCloseTo(1,10);
  expect(state.layers.some(p=>centroid(p).x>.5 && centroid(p).y>.5)).toBe(true);
  expect(state.layers.some(p=>centroid(p).x>.5 && centroid(p).y<.5)).toBe(false);
 });
 it('指定纸层时不移动其余纸层',()=>{
  const lower=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],upper=lower.map(p=>({...p}));
  const op:FoldStep={title:'上层',description:'',kind:'valley',a:[.5,0],b:[.5,1],sign:1,layer:'top'};
  const state=apply({layers:[lower,upper],step:0},sheet,op);
  expect(total(splitFold([lower,upper],[0,1],sheet,op).still.filter(p=>p.group===0).map(p=>p.polygon))).toBeCloseTo(1,10);
  expect(total(state.layers)).toBeCloseTo(2,10);
 });
 it('一步的多条折线与顺序执行等价，单步计数',()=>{
  const one:FoldStep={title:'左',description:'',kind:'valley',a:[.25,0],b:[.25,1],sign:1};
  const two:FoldStep={title:'右',description:'',kind:'valley',a:[.75,0],b:[.75,1],sign:-1};
  const together:FoldStep={...one,operations:[one,two]};
  const single=replay(sheet,1,[together]);
  const sequential=replay(sheet,2,[one,two]);
  expect(single.layers).toEqual(sequential.layers);expect(single.step).toBe(1);
  expect(total(single.layers)).toBeCloseTo(1,10);
 });
 it('翻面两次恢复原形并逆转层序',()=>{
  const a=[{x:0,y:0},{x:.25,y:0},{x:.25,y:1},{x:0,y:1}],b=[{x:.5,y:0},{x:1,y:0},{x:1,y:1},{x:.5,y:1}];
  const op:FoldStep={title:'翻面',description:'',kind:'valley',a:[.5,0],b:[.5,1],sign:1,flip:true};
  const first=apply({layers:[a,b],step:0},sheet,op),again=apply(first,sheet,op);
  expect(first.layers[0].map(p=>p.x)).toEqual(b.map(p=>1-p.x));
  expect(again.layers).toEqual([a,b]);
 });
});
it('折痕端点可由纸张宽高组合表达，适配不同长宽比',()=>{
 const op:FoldStep={title:'45度',description:'',kind:'valley',a:[0,0],b:{x:[1,0],y:[1,0]},sign:-1};
 const state=apply(initial({width:2,height:3}),{width:2,height:3},op);
 expect(total(state.layers)).toBeCloseTo(6,10);
 expect(state.layers.some(p=>p.some(v=>Math.abs(v.x)<1e-10 && Math.abs(v.y-2)<1e-10))).toBe(true);
});
it('拒绝长度为零的折痕',()=>{
 const op:FoldStep={title:'无效',description:'',kind:'valley',a:[0,0],b:[0,0],sign:1};
 expect(()=>apply(initial(sheet),sheet,op)).toThrow('折痕两端不能重合');
});
it('山折移动层位于固定纸层之下，谷折则在上方',()=>{
 const base={title:'折',description:'',a:[.5,0] as [number,number],b:[.5,1] as [number,number],sign:1 as const};
 const valley=apply(initial(sheet),sheet,{...base,kind:'valley'});
 const mountain=apply(initial(sheet),sheet,{...base,kind:'mountain'});
 expect(valley.layers).toEqual([...mountain.layers].reverse());
});
it('只折最上层时移动属于同一层的所有分片',()=>{
 const left=[{x:0,y:0},{x:.4,y:0},{x:.4,y:.4},{x:0,y:.4}];
 const right=[{x:.6,y:0},{x:1,y:0},{x:1,y:.4},{x:.6,y:.4}];
 const base=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
 const state={layers:[base,left,right],layerGroups:[0,1,1],step:0};
 const op:FoldStep={title:'折顶层',description:'',kind:'valley',a:[0,.5],b:[1,.5],sign:-1,layer:'top'};
 const folded=apply(state,sheet,op);
 const moving=splitFold(state.layers,state.layerGroups,sheet,op).moving;
 expect(total(moving.filter(p=>p.group===1).map(p=>p.polygon))).toBeCloseTo(.32,10);
 expect(total(moving.filter(p=>p.group===0).map(p=>p.polygon))).toBeCloseTo(.18,10);
 expect(total(folded.layers)).toBeCloseTo(total(state.layers),10);
});
it('局部覆盖时只移动每一点可见的纸层，重叠下方保持不动',()=>{
 const base=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
 const cover=[{x:.2,y:.2},{x:.4,y:.2},{x:.4,y:.4},{x:.2,y:.4}];
 const op:FoldStep={title:'折',description:'',kind:'valley',a:[.5,0],b:[.5,1],sign:1,layer:'top'};
 const parts=splitFold([base,cover],[0,1],sheet,op);
 expect(total(parts.moving.filter(p=>p.group===0).map(p=>p.polygon))).toBeCloseTo(.46,10);
 expect(total(parts.moving.filter(p=>p.group===1).map(p=>p.polygon))).toBeCloseTo(.04,10);
 expect(total(parts.still.filter(p=>p.group===0).map(p=>p.polygon))).toBeCloseTo(.54,10);
 expect(total(apply({layers:[base,cover],layerGroups:[0,1],step:0},sheet,op).layers)).toBeCloseTo(1.04,10);
});
it('全局最高层不在折叠区域时，选择区域内最高的纸层',()=>{
 const base=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
 const upper=[{x:.6,y:0},{x:1,y:0},{x:1,y:1},{x:.6,y:1}];
 const op:FoldStep={title:'左侧上层',description:'',kind:'valley',a:[.25,0],b:[.25,1],sign:1,layer:'top'};
 const parts=splitFold([base,upper],[0,1],sheet,op);
 expect(parts.moving).toHaveLength(1);
 expect(parts.moving[0].group).toBe(0);
 const result=apply({layers:[base,upper],layerGroups:[0,1],step:0},sheet,op);
 expect(total(result.layers)).toBeCloseTo(2-.6,10);
});
it('部分折叠的区域限制参与上层选择',()=>{
 const base=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
 const upper=[{x:0,y:.6},{x:1,y:.6},{x:1,y:1},{x:0,y:1}];
 const op:FoldStep={title:'局部上层',description:'',kind:'valley',a:[.5,0],b:[.5,1],sign:1,layer:'top',region:[{a:[0,.5],b:[1,.5],sign:-1}]};
 const parts=splitFold([base,upper],[0,1],sheet,op);
 expect(parts.moving).toHaveLength(1);
 expect(parts.moving[0].group).toBe(0);
 expect(total(apply({layers:[base,upper],layerGroups:[0,1],step:0},sheet,op).layers)).toBeCloseTo(1.4,10);
});
it('塞入折可将移动纸片放在已有两层之间，且动画终点一致',()=>{
 const bottom=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
 const pocket=[{x:.5,y:0},{x:1,y:0},{x:1,y:1},{x:.5,y:1}];
 const flap=[{x:0,y:0},{x:.5,y:0},{x:.5,y:1},{x:0,y:1}];
 const state={layers:[bottom,pocket,flap],layerGroups:[0,1,2],step:0};
 const op:FoldStep={title:'塞入',description:'',kind:'valley',a:[.5,0],b:[.5,1],sign:1,layer:'top',tuckUnder:1};
 const result=apply(state,sheet,op);
 expect(result.layerGroups).toEqual([0,0,3,1]);
 expect(total(result.layers)).toBeCloseTo(2,10);
 const start=foldFrame(state,sheet,op,0).map(p=>p.polygon);
 expect(start.at(-1)).toEqual(flap);
 expect(start.at(-2)).toEqual(pocket);
 const frame=foldFrame(state,sheet,op,1).map(p=>p.polygon);
 expect(frame.map(p=>p.length)).toEqual(result.layers.map(p=>p.length));
 frame.forEach((poly,i)=>poly.forEach((v,j)=>{
  expect(v.x).toBeCloseTo(result.layers[i][j].x,12);
  expect(v.y).toBeCloseTo(result.layers[i][j].y,12);
 }));
});
it('塞入时拒绝无效层数和不连续的目标层序',()=>{
 expect(()=>tuckIndex([0,1],0)).toThrow();
 expect(()=>tuckIndex([0,1],3)).toThrow();
 expect(()=>tuckIndex([1,0,1],1)).toThrow();
});
it('展翼保留机身对折后的横向永久折叠',()=>{
 const body:FoldStep={title:'机身',description:'',kind:'mountain',a:[.5,0],b:[.5,1],sign:1};
 const nose:FoldStep={title:'机头',description:'',kind:'valley',a:[0,.2],b:[1,.2],sign:-1};
 const wings:FoldStep={title:'展翼',description:'',kind:'valley',a:[.6,0],b:[.6,1],sign:-1,openToStep:0};
 const plain=replay(sheet,2,[body,wings]),folded=replay(sheet,3,[body,nose,wings]);
 expect(total(folded.flightLayers!)).toBeCloseTo(1,10);
 expect(folded.flightLayers).not.toEqual(plain.flightLayers);
 const before=extract(plain,80),after=extract(folded,80);
 expect(after.mass).toBeCloseTo(before.mass,10);
 expect(after.cg.y).toBeCloseTo(.54,10);
 expect(after.wingArea).toBeCloseTo(.64,8);
 expect(after.wingArea).toBeLessThan(before.wingArea);
 const noseFirst=replay(sheet,3,[nose,body,{...wings,openToStep:1}]);
 expect(folded.flightLayers).toEqual(noseFirst.flightLayers);
 const undo:FoldStep={...nose,title:'展开',unfold:true,unfoldToStep:1};
 expect(replay(sheet,4,[body,nose,undo,wings]).wingLayers?.length).toBeGreaterThan(0);
});
it('展翼明确拒绝尚无法映射的局部或斜向永久折叠',()=>{
 const body:FoldStep={title:'机身',description:'',kind:'mountain',a:[.5,0],b:[.5,1],sign:1};
 const diagonal:FoldStep={title:'斜折',description:'',kind:'valley',a:[.5,.2],b:[1,0],sign:-1};
 const wings:FoldStep={title:'展翼',description:'',kind:'valley',a:[.6,0],b:[.6,1],sign:-1,openToStep:0};
 expect(()=>replay(sheet,3,[body,diagonal,wings])).toThrow('展翼投影尚不支持机身对折后的局部或非横向折叠');
});
it('临时斜折展开后，展翼仍保留后续横向永久折叠',()=>{
 const body:FoldStep={title:'机身',description:'',kind:'mountain',a:[.5,0],b:[.5,1],sign:1};
 const diagonal:FoldStep={title:'预折',description:'',kind:'valley',a:[.5,.2],b:[1,0],sign:-1};
 const undo:FoldStep={...diagonal,title:'展开',unfold:true,unfoldToStep:1};
 const nose:FoldStep={title:'机头',description:'',kind:'valley',a:[0,.2],b:[1,.2],sign:-1};
 const wings:FoldStep={title:'展翼',description:'',kind:'valley',a:[.6,0],b:[.6,1],sign:-1,openToStep:0};
 const withCrease=replay(sheet,5,[body,diagonal,undo,nose,wings]);
 const direct=replay(sheet,3,[body,nose,wings]);
 expect(withCrease.flightLayers).toEqual(direct.flightLayers);
});
