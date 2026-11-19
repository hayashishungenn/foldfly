import {describe,it,expect} from 'vitest';
import {coefficients,skinFrictionCoefficient} from '../src/aero/model';
import {extract} from '../src/aero/extract';
import {replay} from '../src/fold/engine';
import {papers} from '../src/paper/papers';
const a=extract(replay(papers[0],6),80),radians=(degrees:number)=>degrees*Math.PI/180;
describe('全攻角升阻系数',()=>{
 it('小攻角升力随展弦比决定的斜率变化',()=>{
  const epsilon=1e-5,slope=2*Math.PI*a.aspectRatio/(a.aspectRatio+2);
  expect(coefficients(epsilon,a).cl/epsilon).toBeCloseTo(slope,2);
 });
 it('平板正面迎风产生显著阻力且接近零升力',()=>{
  const c=coefficients(Math.PI/2,a);
  expect(c.cd).toBeGreaterThan(1);expect(Math.abs(c.cl)).toBeLessThan(.01);
 });
 it('正负攻角的升力反向、阻力相同，背向来流符合平板对称性',()=>{
  for(const degree of [5,20,60,120,175]){
   const positive=coefficients(radians(degree),a),negative=coefficients(-radians(degree),a);
   expect(positive.cl).toBeCloseTo(-negative.cl,8);expect(positive.cd).toBeCloseTo(negative.cd,8);
  }
  expect(coefficients(radians(175),a).cl).toBeLessThan(0);
 });
 it('失速后升力随角度增加下降',()=>{
  expect(coefficients(radians(20),a).cl).toBeLessThan(coefficients(radians(14),a).cl);
 });
});
it('零升摩擦阻力随浸润面积和雷诺数变化',()=>{
 const slow=skinFrictionCoefficient(a,4),fast=skinFrictionCoefficient(a,16);
 expect(slow/fast).toBeCloseTo(2,5);
 const doubled={...a,wettedArea:a.wettedArea*2,bodySideArea:a.bodySideArea*2};
 expect(skinFrictionCoefficient(doubled,16)).toBeCloseTo(fast*2,7);
 expect(coefficients(0,a,16,'skin-friction').cd).toBeCloseTo(fast,10);
 expect(coefficients(0,doubled,16,'skin-friction').cd).toBeCloseTo(fast*2,10);
});
