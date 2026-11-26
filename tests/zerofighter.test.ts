import {describe,it,expect} from 'vitest';
import {zeroFighter} from '../src/fold/planes/zerofighter';
import {skyKing} from '../src/fold/planes/skyking';
import {replay} from '../src/fold/engine';
import {area} from '../src/fold/geometry';
import {papers} from '../src/paper/papers';
import {extract,aeroMetrics} from '../src/aero/extract';
import {simulate} from '../src/aero/integrator';
import {calibrationReport} from '../src/aero/calibrate';

describe('Zero Fighter 工程近似折序(户田拓夫 2010 · 29.2 s 历史里程碑)',()=>{
 it.each(papers)('$name 每一步保留纸张面积且可重放、确定性一致',sheet=>{
  for(let n=0;n<=zeroFighter.length;n++){
   const state=replay(sheet,n,zeroFighter);
   expect(state.layers.reduce((sum,p)=>sum+area(p),0)).toBeCloseTo(sheet.width*sheet.height,8);
   expect(state.step).toBe(n);
   expect(replay(sheet,n,zeroFighter)).toEqual(state);
  }
 });

 it('展开双翼后展翼投影面积守恒并恢复整纸',()=>{
  const sheet=papers[0],state=replay(sheet,zeroFighter.length,zeroFighter);
  expect(state.flightLayers).toBeDefined();
  const total=state.flightLayers!.reduce((sum,p)=>sum+area(p),0);
  expect(total).toBeCloseTo(sheet.width*sheet.height,8);
 });

 it('气动特征落在滞空机型区间:大展弦比、低静稳定余量、轻翼载',()=>{
  const aero=extract(replay(papers[0],zeroFighter.length,zeroFighter),80);
  const m=aeroMetrics(aero);
  expect(aero.aspectRatio).toBeGreaterThan(1.45);
  expect(aero.aspectRatio).toBeLessThan(1.72);
  expect(m.staticMargin).toBeGreaterThan(0);
  expect(m.staticMargin).toBeLessThan(0.05);
  expect(aero.mass).toBeCloseTo(papers[0].width*papers[0].height*.08,8);
 });

 it('轻柔抛投滞空落在 29.2 s 历史里程碑的校准区间且与 Sky King 有区分度',()=>{
  const aero=extract(replay(papers[0],zeroFighter.length,zeroFighter),80);
  const f=simulate(aero,{angle:20,speed:8,wind:0});
  expect(f.landed).toBe(true);
  expect(f.duration).toBeGreaterThan(25);
  expect(f.duration).toBeLessThan(33);
  // 区分度:机翼面积、静稳定余量与滞空时间与 Sky King 不同(同门不同机)
  const skyAero=extract(replay(papers[0],skyKing.length,skyKing),80);
  expect(aero.wingArea).not.toBeCloseTo(skyAero.wingArea,3);
  expect(aero.aerodynamicCenter.y).not.toBeCloseTo(skyAero.aerodynamicCenter.y,3);
  expect(f.duration).not.toBeCloseTo(simulate(skyAero,{angle:20,speed:8,wind:0}).duration,1);
 });

 it('校准报告包含 Zero Fighter 行并接近 29.2 s 目标',()=>{
  const row=calibrationReport().find(r=>r.id==='zerofighter')!;
  expect(row.result).not.toBeNull();
  expect(row.target).toBe(29.2);
  expect(row.result!.landed).toBe(true);
  expect(row.result!.duration).toBeGreaterThan(25);
  expect(row.result!.duration).toBeLessThan(33);
 });
});
