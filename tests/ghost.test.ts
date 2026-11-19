import {describe,it,expect} from 'vitest';
import {bestFlight,decodeGhost,encodeGhost,ghostStorageKey} from '../src/game/ghost';
import type {Flight} from '../src/aero/integrator';
const flight=(distance:number,duration:number):Flight=>({samples:[{t:0,x:0,y:1.5,pitch:0},{t:duration,x:distance,y:0,pitch:0}],distance,duration,height:1.5,landed:true});
describe('个人纪录幽灵',()=>{
 it('距离和滞空各自保留对应的最佳落地轨迹',()=>{
  const a=flight(10,4),b=flight(8,6);
  expect(bestFlight('distance',a,b)).toBe(a);
  expect(bestFlight('duration',a,b)).toBe(b);
  expect(bestFlight('distance',a,{...b,distance:20,landed:false})).toBe(a);
 });
 it('拒绝损坏、非有限或时间倒退的保存数据',()=>{
  const a=flight(10,4),serialized=encodeGhost('distance',a);
  expect(decodeGhost(serialized,'distance')).toEqual(a);
  expect(decodeGhost(serialized,'duration')).toBeNull();
  expect(decodeGhost('{','distance')).toBeNull();
  expect(decodeGhost(encodeGhost('distance',{...a,samples:[a.samples[1],a.samples[0]]}),'distance')).toBeNull();
  expect(decodeGhost(encodeGhost('distance',{...a,samples:[a.samples[0],{...a.samples[1],x:NaN}]}),'distance')).toBeNull();
 });
});
it('旧飞行模型的个人纪录不能混入新模型比较',()=>{
 const serialized=encodeGhost('distance',flight(10,4));
 const old=JSON.parse(serialized);old.version=1;
 expect(decodeGhost(JSON.stringify(old),'distance')).toBeNull();
});
it('不同机型和赛制使用各自的纪录，并记录折序与引擎版本',()=>{
 const key=ghostStorageKey('dart','distance');
 expect(key).not.toBe(ghostStorageKey('suzanne','distance'));
 expect(key).not.toBe(ghostStorageKey('dart','duration'));
 expect(key).toMatch(/-f\d+-a\d+$/);
 expect(ghostStorageKey('dart','distance')).toBe(key);
});
