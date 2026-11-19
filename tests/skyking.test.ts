import {describe,it,expect} from 'vitest';
import {skyKing} from '../src/fold/planes/skyking';
import {line,replay} from '../src/fold/engine';
import {area,reflect,side} from '../src/fold/geometry';
import {papers} from '../src/paper/papers';
import {extract} from '../src/aero/extract';
describe('Sky King 简化折序',()=>{
 it.each(papers)('$name 每一步保留纸张面积且可重放',sheet=>{
  for(let n=0;n<=skyKing.length;n++){
   const state=replay(sheet,n,skyKing);
   expect(state.layers.reduce((sum,p)=>sum+area(p),0)).toBeCloseTo(sheet.width*sheet.height,8);
   expect(state.step).toBe(n);expect(replay(sheet,n,skyKing)).toEqual(state);
  }
  const aero=extract(replay(sheet,skyKing.length,skyKing),80);
  expect(aero.mass).toBeCloseTo(sheet.width*sheet.height*.08,8);
  expect(aero.wingArea).toBeGreaterThan(0);
 });
 it('下折机头的尖端距纸张底边约 2.5 厘米',()=>{
  const sheet=papers[0],state=replay(sheet,5,skyKing);
  expect(state.layers.flat().some(p=>Math.abs(p.x-sheet.width/2)<1e-7 && Math.abs(p.y-(sheet.height-.025))<1e-7)).toBe(true);
 });
 it('预折后展开恢复几何，并沿辅助线形成对称折角',()=>{
  const sheet=papers[0],base=replay(sheet,5,skyKing);
  expect(replay(sheet,7,skyKing).layers).toEqual(base.layers);
  expect(replay(sheet,9,skyKing).layers).toEqual(base.layers);
  const left=replay(sheet,10,skyKing),both=replay(sheet,11,skyKing);
  expect(left.layers).not.toEqual(base.layers);
  const massCenter=extract(both,80).cg;
  expect(massCenter.x).toBeCloseTo(sheet.width/2,8);
 });
 it.each(papers)('$name 锁头辅助折把尖端对准两侧相接处，展开后恢复',sheet=>{
  const h=(sheet.height-.025)/2;
  const [a,b]=line(skyKing[13],sheet);
  const tip=reflect({x:sheet.width/2,y:h},a,b);
  const expected=h+(1-(Math.SQRT2-1))*sheet.width/2;
  expect(tip.y).toBeCloseTo(expected,10);
  expect(replay(sheet,13,skyKing).layers.flat().some(p=>Math.hypot(p.x-tip.x,p.y-tip.y)<1e-9)).toBe(true);
  expect(replay(sheet,15,skyKing).layers).toEqual(replay(sheet,13,skyKing).layers);
 });
 it.each(papers)('$name 两侧折角的上边沿辅助折痕对齐',sheet=>{
  const h=(sheet.height-.025)/2;
  for(const [creaseIndex,foldIndex,x] of [[5,9,0],[7,10,sheet.width]] as const){
   const [a,b]=line(skyKing[creaseIndex],sheet),[c,d]=line(skyKing[foldIndex],sheet);
   const corner=reflect({x,y:h},c,d);
   expect(Math.abs(side(corner,a,b))).toBeLessThan(1e-10);
  }
 });
 it.each(papers)('$name 第五步折线经过图示的顶边和侧边交点',sheet=>{
  const h=(sheet.height-.025)/2;
  const [a,b]=line(skyKing[9],sheet);
  expect(a.x).toBeCloseTo(0,10);expect(a.y).toBeCloseTo(h+sheet.width/2,10);
  expect(b.x).toBeCloseTo((Math.SQRT2-1)*sheet.width/2,10);expect(b.y).toBeCloseTo(h,10);
 });
 it.each(papers)('$name 对折后预折尖端落到横向辅助线上，再展开恢复',sheet=>{
  const h=(sheet.height-.025)/2;
  const [a,b]=line(skyKing[16],sheet),[c,d]=line(skyKing[13],sheet);
  const tip=reflect({x:sheet.width/2,y:h},a,b);
  expect(Math.abs(side(tip,c,d))).toBeLessThan(1e-10);
  expect(tip.x).toBeGreaterThan(sheet.width/2);
  expect(replay(sheet,18,skyKing).layers).toEqual(replay(sheet,16,skyKing).layers);
 });
});
