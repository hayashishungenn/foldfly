import {describe,it,expect} from 'vitest';
import {challengeResult} from '../src/game/challenge';
describe('挑战赛',()=>{
 it('距离和滞空分别与历史目标比较',()=>{
  expect(challengeResult('distance',{distance:88,duration:3}).beaten).toBe(true);
  expect(challengeResult('duration',{distance:100,duration:29.1}).beaten).toBe(false);
  expect(challengeResult('duration',{distance:10,duration:30}).target).toBe(29.2);
 });
});
