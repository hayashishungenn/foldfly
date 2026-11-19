import {it,expect} from 'vitest';
import {simulate} from '../src/aero/integrator';
import {extract} from '../src/aero/extract';
import {replay} from '../src/fold/engine';
import {papers} from '../src/paper/papers';
it('默认试玩使用几何力矩，旧经验模型仅供比较',()=>{
 const aero=extract(replay(papers[0],6),80),input={angle:20,speed:15,wind:0};
 const standard=simulate(aero,input),explicit=simulate(aero,input,{pitchModel:'empirical'}),geometry=simulate(aero,input,{pitchModel:'geometry'});
 expect(geometry.distance).toBe(standard.distance);
 expect(geometry.landed).toBe(true);
 expect(geometry.samples.every(p=>[p.x,p.y,p.pitch,p.t].every(Number.isFinite))).toBe(true);
 expect(explicit.distance).not.toBeCloseTo(standard.distance,3);
});
it('几何力矩试验在投掷控件边界保持有限',()=>{
 const aero=extract(replay(papers[0],6),80);
 for(const angle of [0,75])for(const speed of [6,28])for(const wind of [-4,4]){
  const f=simulate(aero,{angle,speed,wind},{pitchModel:'geometry'});
  expect(f.landed).toBe(true);
  expect([f.distance,f.duration,f.height,...f.samples.flatMap(p=>[p.x,p.y,p.pitch,p.t])].every(Number.isFinite)).toBe(true);
 }
});
it('表面摩擦下界可独立对照，且飞行结果可重复',()=>{
 const aero=extract(replay(papers[0],6),80),input={angle:0,speed:20,wind:0};
 const baseline=simulate(aero,input),friction=simulate(aero,input,{dragModel:'skin-friction'});
 expect(friction.landed).toBe(true);
 expect(friction.distance).toBeGreaterThan(baseline.distance);
 expect(simulate(aero,input,{dragModel:'skin-friction'})).toEqual(friction);
});
