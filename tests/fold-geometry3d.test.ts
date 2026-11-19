import {describe,it,expect} from 'vitest';
import {deployWing,rotateAroundAxis,type Point3} from '../src/fold/geometry3d';
import {area} from '../src/fold/geometry';
const distance=(a:Point3,b:Point3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const close=(a:Point3,b:Point3)=>{expect(a.x).toBeCloseTo(b.x,12);expect(a.y).toBeCloseTo(b.y,12);expect(a.z).toBeCloseTo(b.z,12)};
describe('空间折痕旋转',()=>{
 it('倾斜折线上的点固定，纸片边长保持，逆转后恢复',()=>{
  const a={x:.1,y:.2,z:.3},b={x:.3,y:.8,z:.5},p={x:.5,y:.4,z:.1},q={x:-.2,y:.6,z:.8};
  const angle=1.2,r=rotateAroundAxis(p,a,b,angle),s=rotateAroundAxis(q,a,b,angle);
  close(rotateAroundAxis(a,a,b,angle),a);close(rotateAroundAxis(b,a,b,angle),b);
  expect(distance(r,s)).toBeCloseTo(distance(p,q),12);
  close(rotateAroundAxis(r,a,b,-angle),p);
 });
 it('平行翼根旋转 90 度时机身折向翼面',()=>{
  const axisA={x:0,y:0,z:0},axisB={x:0,y:1,z:0};
  close(rotateAroundAxis({x:0,y:.4,z:-.1},axisA,axisB,-Math.PI/2),{x:.1,y:.4,z:0});
 });
 it('拒绝零长度折痕及无效角度',()=>{
  const a={x:0,y:0,z:0};
  expect(()=>rotateAroundAxis(a,a,a,1)).toThrow();
  expect(()=>rotateAroundAxis(a,a,{x:1,y:0,z:0},NaN)).toThrow();
 });
 it('倾斜翼根展开保持纸面边长，左右对称且俯视面积体现翼面倾斜',()=>{
  const rootA={x:.5,y:0},rootB={x:.7,y:1};
  const right=[rootA,rootB,{x:1,y:1}],left=right.map(p=>({x:1-p.x,y:p.y}));
  const r=deployWing(right,.5,rootA,rootB,'right'),l=deployWing(left,.5,rootA,rootB,'left');
  for(let i=0;i<r.length;i++){
   expect(r[i].x+l[i].x).toBeCloseTo(1,12);
   expect(r[i].y).toBeCloseTo(l[i].y,12);
   expect(r[i].z).toBeCloseTo(l[i].z,12);
   expect(distance(r[i],r[(i+1)%r.length])).toBeCloseTo(Math.hypot(right[i].x-right[(i+1)%right.length].x,right[i].y-right[(i+1)%right.length].y),12);
  }
  expect(area(r.map(({x,y})=>({x,y})))).toBeLessThan(area(right));
  expect(r[1].z).toBeCloseTo(-.2,12);
 });
});
