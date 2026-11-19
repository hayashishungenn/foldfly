import {it,expect} from 'vitest';
import {playback} from '../src/game/playback';
import {simulate} from '../src/aero/integrator';
import {extract} from '../src/aero/extract';
import {replay} from '../src/fold/engine';
import {papers} from '../src/paper/papers';
const f={samples:[{t:0,x:0,y:1,pitch:0},{t:1,x:10,y:3,pitch:1},{t:2,x:20,y:0,pitch:0}],distance:20,duration:2,height:3,landed:true};
it('实时插值且落地前不结算',()=>{expect(playback(f,.5)).toEqual({sample:{t:.5,x:5,y:2,pitch:.5},finished:false,height:2});expect(playback(f,3).finished).toBe(true);expect(playback(f,3).sample.x).toBe(20)});
it('落地结算使用积分器的精确最高点，而不是稀疏采样中的近似',()=>{
 const high={...f,height:3.12};
 expect(playback(high,1).height).toBe(3);
 expect(playback(high,2).height).toBe(3.12);
});
it('积分轨迹保存最高点，播放到峰值时高度与最终结算一致',()=>{
 const a=extract(replay(papers[0],6),80);
 for(const angle of [0,20,45,75]){
  const flight=simulate(a,{angle,speed:20,wind:0});
  const peak=flight.samples.reduce((highest,p)=>p.y>highest.y?p:highest);
  expect(peak.y).toBe(flight.height);
  expect(playback(flight,peak.t).height).toBe(flight.height);
  expect(flight.samples.every((p,i)=>i===0||p.t>flight.samples[i-1].t)).toBe(true);
 }
});
