import {it,expect} from 'vitest';
import {spatialMass} from '../src/aero/mass3d';
import {extract} from '../src/aero/extract';
import {rotateAroundAxis} from '../src/fold/geometry3d';
const face=[{x:0,y:0,z:0},{x:1,y:0,z:1},{x:1,y:2,z:1},{x:0,y:2,z:0}];
it('倾斜矩形纸面按真实面积而非俯视面积计算质量和俯仰惯量',()=>{
 const a=spatialMass([face],80);
 expect(a.area).toBeCloseTo(2*Math.SQRT2,10);
 expect(a.mass).toBeCloseTo(a.area*.08,10);
 expect(a.centroid).toEqual({x:.5,y:1,z:.5});
 expect(a.pitchInertia).toBeCloseTo(a.mass*(4+1)/12,10);
});
it('重叠纸层质量相加，空间平移不改变惯量',()=>{
 const a=spatialMass([face],80),moved=face.map(p=>({x:p.x+5,y:p.y-8,z:p.z+3}));
 const b=spatialMass([moved,moved],80);
 expect(b.mass).toBeCloseTo(a.mass*2,10);expect(b.pitchInertia).toBeCloseTo(a.pitchInertia*2,10);
 expect(b.centroid.y).toBeCloseTo(a.centroid.y-8,10);
});
it('绕俯仰轴旋转不改变质量与俯仰惯量',()=>{
 const a=spatialMass([face],80),axisA={x:0,y:0,z:0},axisB={x:1,y:0,z:0};
 const rotated=face.map(p=>rotateAroundAxis(p,axisA,axisB,.7)),b=spatialMass([rotated],80);
 expect(b.mass).toBeCloseTo(a.mass,10);expect(b.pitchInertia).toBeCloseTo(a.pitchInertia,10);
});
it('气动提取使用三维纸面质量，翼面积仍使用俯视投影',()=>{
 const projection=face.map(({x,y})=>({x,y}));
 const a=extract({layers:[projection],flightLayers:[projection],wingLayers:[projection],massFaces3d:[face],step:0},80);
 expect(a.mass).toBeCloseTo(2*Math.SQRT2*.08,10);
 expect(a.wingArea).toBeCloseTo(2,10);
 expect(a.cg).toEqual({x:.5,y:1});
 expect(a.cgDepth).toBeCloseTo(-.5,10);
 expect(a.pitchInertia).toBeCloseTo(a.mass*5/12,10);
});
