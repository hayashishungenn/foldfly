import {describe,expect,it} from 'vitest';
import {extract} from '../src/aero/extract';
import type {Polygon} from '../src/fold/geometry';
import {replay} from '../src/fold/engine';
import {papers} from '../src/paper/papers';
const rectangle:Polygon=[{x:0,y:0},{x:2,y:0},{x:2,y:4},{x:0,y:4}];
describe('几何与俯仰属性',()=>{
 it('竖直机身纸层的横向质量落在中线，而非其展开图形质心',()=>{
  const wing:Polygon=[{x:.6,y:0},{x:.9,y:0},{x:.9,y:1},{x:.6,y:1}];
  const body:Polygon=[{x:.5,y:0},{x:.6,y:0},{x:.6,y:1},{x:.5,y:1}];
  const a=extract({layers:[wing,body],flightLayers:[wing,body],wingLayers:[wing],bodyLayerIndices:[1],bodyAxisX:.5,step:0},80);
  expect(a.mass).toBeCloseTo(.032,10);
  expect(a.cg.x).toBeCloseTo(.6875,10);
  expect(a.cg.y).toBeCloseTo(.5,10);
 });
 it('竖直机身的高度分布计入绕整体重心的俯仰转动惯量',()=>{
  const wing:Polygon=[{x:.6,y:0},{x:.9,y:0},{x:.9,y:1},{x:.6,y:1}];
  const body:Polygon=[{x:.5,y:0},{x:.6,y:0},{x:.6,y:1},{x:.5,y:1}];
  const side:Polygon=[{x:0,y:0},{x:.1,y:0},{x:.1,y:1},{x:0,y:1}];
  const a=extract({layers:[wing,body],flightLayers:[wing,body],wingLayers:[wing],bodyLayerIndices:[1],bodyAxisX:.5,bodySideLayers:[side],step:0},80);
  const vertical=(.1*.1**2/3-.4*.0125**2)*.08;
  expect(a.pitchInertia).toBeCloseTo(a.mass/12+vertical,10);
  expect(a.cgDepth).toBeCloseTo(.0125,10);
 });
 it('矩形纸的四分之一弦焦点及绕重心的俯仰转动惯量',()=>{
  const a=extract({layers:[rectangle],step:0},80);
  expect(a.aerodynamicCenter.y).toBeCloseTo(1,5);
  expect(a.wingCentroid.y).toBeCloseTo(2,5);
  expect(a.pitchInertia).toBeCloseTo(a.mass*4*4/12,7);
  expect(a.wingPitchSecondMoment).toBeCloseTo(4*4/12,7);
  expect(a.frictionChord).toBeCloseTo(4,8);
 });
 it('几何平移不改变焦点相对位置及转动惯量',()=>{
  const a=extract({layers:[rectangle],step:0},80);
  const translated=rectangle.map(({x,y})=>({x:x+8,y:y+10}));
  const b=extract({layers:[translated],step:0},80);
  expect(b.aerodynamicCenter.y-b.cg.y).toBeCloseTo(a.aerodynamicCenter.y-a.cg.y,7);
  expect(b.pitchInertia).toBeCloseTo(a.pitchInertia,7);
  expect(b.wingPitchSecondMoment).toBeCloseTo(a.wingPitchSecondMoment,7);
  expect(b.frictionChord).toBeCloseTo(a.frictionChord,7);
 });
});
it('三角翼摩擦等效弦长等于解析结果',()=>{
 const triangle=[{x:0,y:0},{x:1,y:0},{x:1,y:1}];
 const a=extract({layers:[triangle],step:0},80);
 // Integral of sqrt(x) is 2/3.
 expect(a.frictionChord).toBeCloseTo(9/16,8);
 expect(a.frictionChord).toBeLessThan(a.chord);
});

import {coefficients,pitchAcceleration} from '../src/aero/model';
it('可选重心高度力矩按翼面假设计算，默认模型不启用',()=>{
 const a=extract({layers:[rectangle],step:0},80),raised={...a,cgDepth:.2},speed=10;
 const q=.5*1.225*speed**2*a.wingArea;
 expect(pitchAcceleration(0,0,speed,raised)).toBeCloseTo(0,10);
 expect(pitchAcceleration(0,0,speed,raised,'empirical',true)).toBeCloseTo(q*coefficients(0,a,speed).cd*.2/a.pitchInertia,10);
});
it('焦点在重心之后时，正攻角产生低头力矩；前移时则失稳',()=>{
 const a=extract({layers:[rectangle],step:0},80);
 const stable={...a,aerodynamicCenter:{...a.aerodynamicCenter,y:a.cg.y+.5}};
 const unstable={...a,aerodynamicCenter:{...a.aerodynamicCenter,y:a.cg.y-.5}};
 expect(pitchAcceleration(.1,0,10,stable)).toBeLessThan(0);
 expect(pitchAcceleration(.1,0,10,unstable)).toBeGreaterThan(0);
 expect(pitchAcceleration(0,.1,10,stable)).toBeLessThan(0);
});
it('尖头机补齐第二轮折边后，当前翼面投影呈静态稳定',()=>{
 const a=extract(replay(papers[0],6),80);
 expect(a.aerodynamicCenter.y).toBeGreaterThan(a.cg.y);
 expect(pitchAcceleration(.01,0,10,a)).toBeLessThan(0);
});

it('分层纸片平移后俯仰惯量不变',()=>{
 const layers=[rectangle,[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]];
 const a=extract({layers,step:0},80);
 const moved=layers.map(p=>p.map(({x,y})=>({x:x+4,y:y+7})));
 const b=extract({layers:moved,step:0},80);
 expect(b.pitchInertia).toBeCloseTo(a.pitchInertia,7);
});
it('梯形翼的焦点按每条翼弦面积加权',()=>{
 const wing=[{x:0,y:0},{x:1,y:0},{x:1,y:2},{x:0,y:1}];
 const a=extract({layers:[wing],step:0},80);
 expect(a.aerodynamicCenter.y).toBeCloseTo(7/18,5);
});
it('分离的窄翼不会被固定间距采样漏掉',()=>{
 const w=.0001;
 const strips=[0,1].map(x=>[{x,y:0},{x:x+w,y:0},{x:x+w,y:1},{x,y:1}]);
 const a=extract({layers:strips,step:0},80);
 expect(a.wingArea).toBeCloseTo(2*w,9);
 expect(a.wingCentroid.x).toBeCloseTo(.5+w/2,8);
 expect(a.wingCentroid.y).toBeCloseTo(.5,8);
 expect(a.aerodynamicCenter.y).toBeCloseTo(.25,8);
 expect(a.wingPitchSecondMoment).toBeCloseTo(1/12,8);
});
it('翼面阻尼力臂按实际翼面到质量中心的平方距离计算',()=>{
 const mass=[{x:0,y:0},{x:2,y:0},{x:2,y:2},{x:0,y:2}];
 const wing=[{x:0,y:2},{x:2,y:2},{x:2,y:4},{x:0,y:4}];
 const a=extract({layers:[mass],wingLayers:[wing],step:0},80);
 // Wing centre is 2 m behind CG; its chord is 2 m.
 expect(a.wingPitchSecondMoment).toBeCloseTo(4+4/12,7);
});
it('浸润面积由外轮廓两面估计，重叠纸层不重复计入',()=>{
 const one=extract({layers:[rectangle],step:0},80);
 const doubled=extract({layers:[rectangle,rectangle],step:0},80);
 expect(one.wettedArea).toBeCloseTo(16);
 expect(doubled.wettedArea).toBeCloseTo(one.wettedArea);
 expect(doubled.mass).toBeCloseTo(2*one.mass);
});
it('纸面正对来流时，阻力仍会通过焦点与重心的力臂产生俯仰力矩',()=>{
 const a=extract({layers:[rectangle],step:0},80);
 const tailward={...a,cg:{...a.cg,y:a.cg.y-.5}};
 expect(Math.abs(pitchAcceleration(Math.PI/2,0,10,a))).toBeLessThan(1e-6);
 expect(pitchAcceleration(Math.PI/2,0,10,tailward)).toBeLessThan(-1);
 expect(pitchAcceleration(-Math.PI/2,0,10,tailward)).toBeGreaterThan(1);
});
