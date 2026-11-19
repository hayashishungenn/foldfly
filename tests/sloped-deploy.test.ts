import {it,expect} from 'vitest';
import {deploySlopedWings} from '../src/fold/deploy';
import {area} from '../src/fold/geometry';
import {spatialMass} from '../src/aero/mass3d';
import {extract} from '../src/aero/extract';
import {line,replay} from '../src/fold/engine';
import {dartSloped} from '../src/fold/planes/dart';
import {papers} from '../src/paper/papers';
import {reflect} from '../src/fold/geometry';
import type {FoldStep} from '../src/fold/planes/dart';
const sheet=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
it('倾斜翼根展开保持真实质量，对称翼展由三维投影求得',()=>{
 const output=deploySlopedWings([sheet],.5,{x:.5,y:0},{x:.7,y:1});
 const mass=spatialMass(output.massFaces3d,80);
 expect(mass.area).toBeCloseTo(1,10);expect(mass.mass).toBeCloseTo(.08,10);
 expect(mass.centroid.x).toBeCloseTo(.5,10);
 expect(output.wingLayers).toHaveLength(2);
 const wings=output.wingLayers.flat();
 expect(Math.min(...wings.map(p=>p.x))+Math.max(...wings.map(p=>p.x))).toBeCloseTo(1,10);
 const aero=extract({layers:[sheet],...output,step:0},80);
 expect(aero.mass).toBeCloseTo(.08,10);
 expect(aero.wingArea).toBeCloseTo(output.wingLayers.reduce((s,p)=>s+area(p),0),8);
 expect(aero.cg.x).toBeCloseTo(.5,10);
});
it.each(papers)('$name 的实验尖头机翼角对齐中线且三维纸张质量守恒',paper=>{
 const [a,b]=line(dartSloped.at(-1)!,paper);
 expect(reflect({x:paper.width,y:paper.height},a,b).x).toBeCloseTo(paper.width/2,10);
 const state=replay(paper,dartSloped.length,dartSloped);
 expect(spatialMass(state.massFaces3d!,80).area).toBeCloseTo(paper.width*paper.height,9);
 expect(extract(state,80).cg.x).toBeCloseTo(paper.width/2,9);
});
it('折序重放可生成倾斜翼根的三维纸面并送入气动提取',()=>{
 const body:FoldStep={title:'机身',description:'',kind:'mountain',a:[.5,0],b:[.5,1],sign:1};
 const opening:FoldStep={title:'机翼',description:'',kind:'valley',a:[.5,0],b:[.7,1],sign:-1,openToStep:0};
 const state=replay({width:1,height:1},2,[body,opening]);
 expect(state.massFaces3d?.length).toBeGreaterThan(0);
 expect(extract(state,80).mass).toBeCloseTo(.08,10);
 expect(extract(state,80).wingArea).toBeGreaterThan(0);
});
