import {describe,expect,it} from 'vitest';
import {line,replay} from '../src/fold/engine';
import {area,reflect} from '../src/fold/geometry';
import {papers} from '../src/paper/papers';
import type {FoldStep} from '../src/fold/planes/dart';
const paper={width:.21,height:.297};
const program:FoldStep[]=[
 {title:'角',description:'',kind:'valley',a:[0,.35],b:[.5,0],sign:-1,diagonal:true},
 {title:'中线',description:'',kind:'valley',a:[.5,0],b:[.5,1],sign:1},
 {title:'展开中线',description:'',kind:'mountain',a:[.5,0],b:[.5,1],sign:-1,unfoldToStep:1},
];
describe('机型折序',()=>{
 it('重放传入机型，展开只回退指定的折叠',()=>{
  const first=replay(paper,1,program),restored=replay(paper,3,program);
  expect(restored.layers).toEqual(first.layers);expect(restored.step).toBe(3);
  expect(restored.layers.reduce((sum,p)=>sum+area(p),0)).toBeCloseTo(paper.width*paper.height,8);
 });
 it('拒绝指向未来或不存在的展开状态',()=>{
  const bad=[{...program[0],unfoldToStep:1}];
  expect(()=>replay(paper,1,bad)).toThrow();
 });
 it.each(papers)('$name 的角平分线把翼角折到机身中线',sheet=>{
  const crease={a:[.5,0] as [number,number],b:{bisector:{vertex:[.5,0] as [number,number],through:[1,1] as [number,number],other:[.5,1] as [number,number],atY:1}},sign:-1 as const};
  const [a,b]=line(crease,sheet),corner={x:sheet.width,y:sheet.height};
  const folded=reflect(corner,a,b);
  expect(folded.x).toBeCloseTo(sheet.width/2,10);
  expect(Math.hypot(folded.x-a.x,folded.y-a.y)).toBeCloseTo(Math.hypot(corner.x-a.x,corner.y-a.y),10);
 });
 it('退化的角平分线明确报错',()=>{
  const bad={a:[.5,0] as [number,number],b:{bisector:{vertex:[.5,0] as [number,number],through:[.5,0] as [number,number],other:[.5,1] as [number,number],atY:1}},sign:1 as const};
  expect(()=>line(bad,paper)).toThrow('射线长度不能为零');
 });
});
