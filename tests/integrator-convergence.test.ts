import {describe,it,expect} from 'vitest';
import {simulate} from '../src/aero/integrator';
import {extract} from '../src/aero/extract';
import {replay} from '../src/fold/engine';
import {papers} from '../src/paper/papers';
import {planes} from '../src/fold/planes';
import {convergenceGrid} from '../src/aero/calibrate';
const a=extract(replay(papers[0],6),80),input={angle:20,speed:15,wind:0};
describe('积分步长验证',()=>{
 it.each(['empirical','geometry'] as const)('%s 模型细化步长时接近高分辨率结果',model=>{
  const coarse=simulate(a,input,{pitchModel:model,stepsPerSecond:120});
  const standard=simulate(a,input,{pitchModel:model,stepsPerSecond:240});
  const reference=simulate(a,input,{pitchModel:model,stepsPerSecond:960});
  expect([coarse,standard,reference].every(f=>f.landed)).toBe(true);
  expect(Math.abs(standard.distance-reference.distance)).toBeLessThan(Math.abs(coarse.distance-reference.distance));
 });
 it('拒绝不合适的积分频率',()=>{
  for(const stepsPerSecond of [0,NaN,61,1e9])expect(()=>simulate(a,input,{stepsPerSecond})).toThrow();
 });
 it('几何力矩模型在机型、纸张和投掷参数网格内保持步长收敛',()=>{
  const grid=convergenceGrid();
  expect(grid.every(row=>row.standard.landed&&row.reference.landed)).toBe(true);
  expect(grid[0].distanceDifference).toBeLessThan(.1);
 });
 it('克重与风速边界下的落点也能收敛',{timeout: 30000},()=>{
  const inputs=[0,20,45,75].flatMap(angle=>[6,15,28].flatMap(speed=>[-4,4].map(wind=>({angle,speed,wind}))));
  const grid=convergenceGrid(inputs,[70,100]);
  expect(grid).toHaveLength(Object.keys(planes).length*papers.length*2*inputs.length);
  expect(grid.every(row=>row.standard.landed&&row.reference.landed)).toBe(true);
  expect(grid[0].distanceDifference).toBeLessThan(.1);
 });
 it('实验高度力矩在已知敏感案例采用更细的默认步长',()=>{
  const plane=planes.suzanne,paper=papers.find(p=>p.id==='a5')!;
  const aero=extract(replay(paper,plane.steps.length,plane.steps),70),throwing={angle:75,speed:28,wind:4};
  const standard=simulate(aero,throwing,{experimentalHeightMoment:true});
  const reference=simulate(aero,throwing,{experimentalHeightMoment:true,stepsPerSecond:1920});
  expect(standard.landed&&reference.landed).toBe(true);
  expect(Math.abs(standard.distance-reference.distance)).toBeLessThan(.1);
 });
});
