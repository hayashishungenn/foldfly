import {describe,it,expect} from 'vitest';
import {area,centroid,reflect} from '../src/fold/geometry';
import {initial,line,replay} from '../src/fold/engine';
import {papers} from '../src/paper/papers';
import {extract} from '../src/aero/extract';
import {simulate} from '../src/aero/integrator';
import {dart} from '../src/fold/planes/dart';
describe('折叠与气动',()=>{it.each(papers)('保持 $name 纸张面积并可重放',p=>{for(let i=0;i<=6;i++){const s=replay(p,i);expect(s.step).toBe(i);expect(s.layers.reduce((n,x)=>n+area(x),0)).toBeCloseTo(p.width*p.height,8)}expect(replay(p,0)).toEqual(initial(p))});it('计算多边形质心',()=>{expect(centroid([{x:0,y:0},{x:2,y:0},{x:2,y:4},{x:0,y:4}])).toEqual({x:1,y:2})});it('质量由纸面积与克重决定',()=>{const p=papers[0],s=replay(p,6);expect(extract(s,80).mass).toBeCloseTo(.0049896);expect(extract(s,100).mass/extract(s,80).mass).toBeCloseTo(1.25)});it('纸张和风影响飞行且落地',()=>{const a=extract(replay(papers[0],6),80),b=extract(replay(papers[2],6),80),settings={angle:20,speed:15,wind:0};const f=simulate(a,settings),wind=simulate(a,{...settings,wind:4}),square=simulate(b,settings),heavy=simulate(extract(replay(papers[0],6),100),settings);expect(f.samples.at(-1)?.y).toBe(0);expect(Number.isFinite(f.distance)).toBe(true);expect(wind.distance).not.toBeCloseTo(f.distance,2);expect(square.distance).not.toBeCloseTo(f.distance,2);expect(heavy.distance).not.toBeCloseTo(f.distance,2)})});

describe('气动与数值边界',()=>{
 it('翼面积是纸层轮廓并集，重叠不重复计入',()=>{
  const p=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
  const a=extract({layers:[p,p],step:6},80);
  expect(a.mass).toBeCloseTo(.16);expect(a.wingArea).toBeCloseTo(1);expect(a.span).toBeCloseTo(1);expect(a.aspectRatio).toBeCloseTo(1);
 });
 it('落点插值使末采样与汇总一致',()=>{
  const a=extract(replay(papers[0],6),80),f=simulate(a,{angle:35,speed:16,wind:0}),last=f.samples.at(-1)!;
  expect(f.landed).toBe(true);expect(last.y).toBe(0);expect(last.x).toBe(f.distance);expect(last.t).toBe(f.duration);
 });
 it('各控件极值保持有限并落地',()=>{
  const a=extract(replay(papers[0],6),80);
  for(const angle of [0,75])for(const speed of [6,28])for(const wind of [-4,4]){
   const f=simulate(a,{angle,speed,wind});expect(f.landed).toBe(true);expect([f.distance,f.duration,f.height].every(Number.isFinite)).toBe(true);
  }
 });
});

 it('平移折叠几何不改变飞行结果',()=>{
  const state=replay(papers[0],6), shifted={...state,layers:state.layers.map(p=>p.map(v=>({x:v.x+2,y:v.y+3}))),flightLayers:state.flightLayers?.map(p=>p.map(v=>({x:v.x+2,y:v.y+3}))),wingLayers:state.wingLayers?.map(p=>p.map(v=>({x:v.x+2,y:v.y+3}))),bodyAxisX:state.bodyAxisX===undefined?undefined:state.bodyAxisX+2};
  const settings={angle:20,speed:15,wind:0};
  expect(simulate(extract(shifted,80),settings).distance).toBeCloseTo(simulate(extract(state,80),settings).distance,6);
 });

 it.each(papers)('$name 展开双翼保留纸张面积且对称',p=>{
  const state=replay(p,6), layers=state.flightLayers!;
  expect(layers.reduce((sum,poly)=>sum+area(poly),0)).toBeCloseTo(p.width*p.height,8);
  const aero=extract(state,80);
  expect(aero.cg.x).toBeCloseTo(p.width/2,8);
  expect(aero.span).toBeGreaterThan(0);
  expect(aero.span).toBeLessThanOrEqual(p.width*.76+1e-9);
  expect(aero.wingArea).toBeLessThanOrEqual(p.width*p.height);
  // The mass projection and wing silhouette share the same translated faces.
  for(const wing of state.wingLayers!)expect(layers).toContainEqual(wing);
  expect(aero.wettedArea).toBeGreaterThanOrEqual(aero.wingArea*2-1e-9);
 });

 it('中等投掷、纸张克重与规格产生合理量级和可见差异',()=>{
  const input={angle:0,speed:20,wind:0};
  const distance=(paper:typeof papers[number],gsm:number)=>simulate(extract(replay(paper,6),gsm),input).distance;
  const a=distance(papers[0],80),heavy=distance(papers[0],100),square=distance(papers[2],80);
  expect(a).toBeGreaterThan(10);expect(a).toBeLessThan(20);
  expect(Math.abs(heavy-a)).toBeGreaterThan(.3);expect(Math.abs(square-a)).toBeGreaterThan(.1);
  const lightFlight=simulate(extract(replay(papers[0],6),80),input),heavyFlight=simulate(extract(replay(papers[0],6),100),input);
  expect(heavyFlight.distance).toBeGreaterThan(lightFlight.distance);
  expect(lightFlight.duration).toBeGreaterThan(heavyFlight.duration);
 });
 it('同一折形增加克重只改变质量与惯量，不改变翼面或重心',()=>{
  const state=replay(papers[0],6),light=extract(state,80),heavy=extract(state,100);
  expect(heavy.mass/light.mass).toBeCloseTo(1.25,10);
  expect(heavy.pitchInertia/light.pitchInertia).toBeCloseTo(1.25,10);
  expect(heavy.wingArea).toBe(light.wingArea);
  expect(heavy.cg).toEqual(light.cg);
  expect(heavy.aspectRatio).toBe(light.aspectRatio);
 });
 it('拒绝无效的纸张克重',()=>{
  const state=replay(papers[0],6);
  for(const gsm of [0,-1,NaN,Infinity]) expect(()=>extract(state,gsm)).toThrow();
 });
 it('翼展随最终翼根折线变化，纸张总质量保持不变',()=>{
  const sheet=papers[0],original=extract(replay(sheet,6,dart),80);
  const widerRoot=[...dart.slice(0,5),{...dart[5],a:[.7,0] as [number,number],b:[.7,1] as [number,number]}];
  const changed=extract(replay(sheet,6,widerRoot),80);
  expect(changed.span).toBeCloseTo(sheet.width*.6,8);
  expect(changed.span).toBeLessThan(original.span);
  expect(changed.mass).toBeCloseTo(original.mass,10);
 });
 it('机身中央双层侧视投影取并集，避免把重叠层算两次',()=>{
  const sheet={width:1,height:1};
  const program=[
   {title:'中折',description:'',kind:'valley' as const,a:[.5,0] as [number,number],b:[.5,1] as [number,number],sign:1 as const},
   {title:'展翼',description:'',kind:'valley' as const,a:[.7,0] as [number,number],b:[.7,1] as [number,number],sign:-1 as const,openToStep:0},
  ];
  const state=replay(sheet,2,program),aero=extract(state,80);
  expect(state.bodySideLayers).toHaveLength(2);
  expect(aero.bodySideArea).toBeCloseTo(.2,9);
  expect(aero.bodyFrictionChord).toBeCloseTo(1,9);
  expect(aero.wingArea).toBeCloseTo(.6,9);
  expect(aero.wettedArea).toBeCloseTo(2*(.6+.2),9);
  expect(aero.mass).toBeCloseTo(.08,9);
 });
 it.each(papers)('$name 第二轮折边将左右斜边对齐中线',sheet=>{
  const operations=dart[3].operations!;
  for(const [i,x] of [[0,0],[1,sheet.width]] as const){
   const [a,b]=line(operations[i],sheet);
   const folded=reflect({x,y:sheet.width/2},a,b);
   expect(folded.x).toBeCloseTo(sheet.width/2,9);
  }
 });
