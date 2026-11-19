import {describe,it,expect} from 'vitest';
import {planes} from '../src/fold/planes';
import {papers} from '../src/paper/papers';
import {replay,type FoldState} from '../src/fold/engine';
import {extract} from '../src/aero/extract';
function transform(state:FoldState,scale:number,dx:number,dy:number):FoldState {
 const map=(layers:FoldState['layers'])=>layers.map(p=>p.map(v=>({x:v.x*scale+dx,y:v.y*scale+dy})));
 return {...state,layers:map(state.layers),flightLayers:state.flightLayers && map(state.flightLayers),wingLayers:state.wingLayers && map(state.wingLayers),bodySideLayers:state.bodySideLayers?.map(p=>p.map(v=>({x:v.x*scale,y:v.y*scale+dy}))),bodyAxisX:state.bodyAxisX===undefined?undefined:state.bodyAxisX*scale+dx};
}
describe('机型几何不变量',()=>{
 for(const plane of Object.values(planes))for(const paper of papers)it(`${plane.name} · ${paper.name} 平移与等比放大`,()=>{
  const state=replay(paper,plane.steps.length,plane.steps),a=extract(state,80),b=extract(transform(state,1,.23,-.137),80),c=extract(transform(state,2,0,0),80);
  expect(b.mass).toBeCloseTo(a.mass,8);expect(b.wingArea).toBeCloseTo(a.wingArea,8);
  expect(b.wettedArea).toBeCloseTo(a.wettedArea,8);expect(b.cg.x-a.cg.x).toBeCloseTo(.23,8);expect(b.cg.y-a.cg.y).toBeCloseTo(-.137,8);
  expect(b.pitchInertia).toBeCloseTo(a.pitchInertia,8);
  expect(b.bodySideArea).toBeCloseTo(a.bodySideArea,8);
  expect(b.wingCentroid.x-a.wingCentroid.x).toBeCloseTo(.23,7);expect(b.wingCentroid.y-a.wingCentroid.y).toBeCloseTo(-.137,7);
  expect(c.mass/a.mass).toBeCloseTo(4,6);expect(c.span/a.span).toBeCloseTo(2,6);
  expect(c.wingArea/a.wingArea).toBeCloseTo(4,6);expect(c.wettedArea/a.wettedArea).toBeCloseTo(4,6);
  expect(c.bodySideArea/a.bodySideArea).toBeCloseTo(4,6);
  expect(c.wingCentroid.y).toBeCloseTo(a.wingCentroid.y*2,7);expect(c.aspectRatio).toBeCloseTo(a.aspectRatio,6);expect(c.pitchInertia/a.pitchInertia).toBeCloseTo(16,6);
 });
});
it('已提供的各机型在常见坐标平移下可稳定提取',()=>{
 for(const plane of Object.values(planes))for(const paper of papers){
  const state=replay(paper,plane.steps.length,plane.steps),base=extract(state,80);
  for(let i=0;i<12;i++){
   const moved=extract(transform(state,1,(i-6)*.037,(i-3)*.023),80);
   expect(moved.wingArea).toBeCloseTo(base.wingArea,7);
   expect(moved.wettedArea).toBeCloseTo(base.wettedArea,7);
  }
 }
});
