import {describe,it,expect} from 'vitest';
import {suzanne} from '../src/fold/planes/suzanne';
import {apply,replay} from '../src/fold/engine';
import {area} from '../src/fold/geometry';
import {papers} from '../src/paper/papers';
import {extract} from '../src/aero/extract';
describe('Suzanne 折序',()=>{
 it.each(papers)('$name 每一步均守恒且可重放',sheet=>{
  for(let n=0;n<=suzanne.length;n++){
   const state=replay(sheet,n,suzanne);
   expect(state.layers.reduce((sum,p)=>sum+area(p),0)).toBeCloseTo(sheet.width*sheet.height,8);
   expect(state.step).toBe(n);expect(replay(sheet,n,suzanne)).toEqual(state);
  }
 });
 it('折后翼面与质量有效',()=>{
  const a=extract(replay(papers[0],suzanne.length,suzanne),80);
  expect(a.mass).toBeCloseTo(.0049896,8);expect(a.span).toBeGreaterThan(0);
  expect(a.wingArea).toBeGreaterThan(0);expect(a.cg.x).toBeCloseTo(papers[0].width/2,6);
 });
 it('机身对折前翻面，保留设计者所描述的纸层顺序',()=>{
  const sheet=papers[0], before=replay(sheet,9,suzanne), step=suzanne[9];
  expect(step.operations).toHaveLength(2);
  expect(step.operations![0].flip).toBe(true);
  const flipped=apply(before,sheet,{...step,...step.operations![0],operations:undefined});
  const folded=apply(flipped,sheet,{...step,...step.operations![1],operations:undefined});
  expect(replay(sheet,10,suzanne).layers).toEqual(folded.layers);
  expect(replay(sheet,10,suzanne).layerGroups).toEqual(folded.layerGroups);
 });
});
