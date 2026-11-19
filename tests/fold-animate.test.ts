import {it,expect} from 'vitest';
import {foldFrame,unfoldFrame,projectFold,wingOpeningFrame} from '../src/fold/animate';
import {apply,initial,replay} from '../src/fold/engine';
import {dart} from '../src/fold/planes/dart';
import {planes} from '../src/fold/planes';
import {papers} from '../src/paper/papers';
import {area,centroid} from '../src/fold/geometry';
import type {FoldStep} from '../src/fold/planes/dart';
const a={x:0,y:0},b={x:0,y:1},p={x:1,y:.4};
it('各机型展开动画从实际折叠结果开始并回到原纸层面积和重心',()=>{
 const sheet=papers[0];
 for(const plane of Object.values(planes))for(let i=1;i<plane.steps.length;i++){
  if(!plane.steps[i].unfold)continue;
  const before=replay(sheet,i-1,plane.steps),folded=replay(sheet,i,plane.steps);
  const start=unfoldFrame(before,sheet,plane.steps[i-1],0).map(p=>p.polygon);
  expect(start.map(p=>p.length)).toEqual(folded.layers.map(p=>p.length));
  start.forEach((poly,j)=>poly.forEach((point,k)=>{
   expect(point.x).toBeCloseTo(folded.layers[j][k].x,10);
   expect(point.y).toBeCloseTo(folded.layers[j][k].y,10);
  }));
  const end=unfoldFrame(before,sheet,plane.steps[i-1],1).map(p=>p.polygon);
  const moment=(polys:typeof end)=>polys.reduce((s,p)=>({area:s.area+area(p),x:s.x+area(p)*centroid(p).x,y:s.y+area(p)*centroid(p).y}),{area:0,x:0,y:0});
  const actual=moment(end),expected=moment(replay(sheet,i+1,plane.steps).layers);
  expect(actual.area).toBeCloseTo(expected.area,10);
  expect(actual.x).toBeCloseTo(expected.x,10);expect(actual.y).toBeCloseTo(expected.y,10);
 }
});
it('折叠从原点到镜像，展开沿相同路径返回',()=>{
 const foldStart=projectFold(p,a,b,0,'valley'),foldEnd=projectFold(p,a,b,1,'valley');
 const openStart=projectFold(p,a,b,0,'mountain',true),openEnd=projectFold(p,a,b,1,'mountain',true);
 expect(foldStart.x).toBeCloseTo(1);expect(foldEnd.x).toBeCloseTo(-1);
 expect(openStart.x).toBeCloseTo(foldEnd.x);expect(openEnd.x).toBeCloseTo(foldStart.x);
 expect(openStart.y).toBeCloseTo(foldEnd.y);expect(openEnd.y).toBeCloseTo(foldStart.y);
});
it.each(papers)('$name 最后一步平滑过渡到用于飞行的翼面',sheet=>{
 const before=replay(sheet,5,dart),opened=replay(sheet,6,dart).wingLayers!;
 const start=wingOpeningFrame(before,sheet,dart[5],opened,0);
 const middle=wingOpeningFrame(before,sheet,dart[5],opened,.825);
 const end=wingOpeningFrame(before,sheet,dart[5],opened,1);
 expect(start.every(part=>part.opacity===1)).toBe(true);
 expect(middle.some(part=>part.opacity>0&&part.opacity<1)).toBe(true);
 expect(end.map(part=>part.polygon)).toEqual(opened);
 expect(end.every(part=>part.opacity===1)).toBe(true);
});
it('局部折叠动画结束时与引擎几何一致，未选中纸层保持不动',()=>{
 const sheet={width:1,height:1};
 const base=initial(sheet).layers[0], upper=base.map(p=>({...p}));
 const state={layers:[base,upper],layerGroups:[0,1],step:0};
 const step:FoldStep={title:'局部折',description:'',kind:'valley',a:[.5,0],b:[.5,1],sign:1,layer:'top',region:[{a:[0,.5],b:[1,.5],sign:1}]};
 const frame=foldFrame(state,sheet,step,1).map(p=>p.polygon);
 expect(frame).toEqual(apply(state,sheet,step).layers);
});
it('连续折线和翻面的动画终点与引擎一致',()=>{
 const sheet={width:1,height:1}, state=initial(sheet);
 const first={kind:'valley' as const,a:[.25,0] as [number,number],b:[.25,1] as [number,number],sign:1 as const};
 const second={kind:'valley' as const,a:[.75,0] as [number,number],b:[.75,1] as [number,number],sign:-1 as const};
 const step:FoldStep={title:'两折',description:'',...first,operations:[first,second]};
 const actual=foldFrame(state,sheet,step,1).map(p=>p.polygon), expected=apply(state,sheet,step).layers;
 expect(actual.map(p=>p.length)).toEqual(expected.map(p=>p.length));
 actual.forEach((poly,i)=>poly.forEach((point,j)=>{expect(point.x).toBeCloseTo(expected[i][j].x,12);expect(point.y).toBeCloseTo(expected[i][j].y,12)}));
 const flip:FoldStep={title:'翻面',description:'',...first,flip:true};
 const folded=apply(state,sheet,step);
 expect(foldFrame(folded,sheet,flip,1).map(p=>p.polygon)).toEqual(apply(folded,sheet,flip).layers);
});
it.each(papers)('$name 两轮对称折角的动画结束后面积守恒且重心居中',sheet=>{
 for(const n of [2,3]){
  const frame=foldFrame(replay(sheet,n,dart),sheet,dart[n],1).map(part=>part.polygon);
  const total=frame.reduce((sum,p)=>sum+area(p),0);
  const center=frame.reduce((sum,p)=>sum+area(p)*centroid(p).x,0)/total;
  expect(total).toBeCloseTo(sheet.width*sheet.height,9);
  expect(center).toBeCloseTo(sheet.width/2,9);
 }
});
