import {planes} from '../src/fold/planes';
import {papers} from '../src/paper/papers';
import {replay} from '../src/fold/engine';
import {extract} from '../src/aero/extract';
import {simulate,type Throw} from '../src/aero/integrator';

let worst:{plane:string;paper:string;gsm:number;input:Throw;difference:number}|undefined;
let finerWorst=0;
for(const plane of Object.values(planes))for(const paper of papers)for(const gsm of [70,100]){
 const aero=extract(replay(paper,plane.steps.length,plane.steps),gsm);
 for(const angle of [0,20,45,75])for(const speed of [6,15,28])for(const wind of [-4,4]){
  const input={angle,speed,wind};
  const run=(stepsPerSecond:number)=>simulate(aero,input,{stepsPerSecond,experimentalHeightMoment:true});
  const difference=Math.abs(run(240).distance-run(960).distance);
  finerWorst=Math.max(finerWorst,Math.abs(run(480).distance-run(1920).distance));
  if(!worst||difference>worst.difference)worst={plane:plane.id,paper:paper.id,gsm,input,difference};
 }
}
if(!worst)throw new Error('没有扫描结果');
const plane=planes[worst.plane as keyof typeof planes],paper=papers.find(p=>p.id===worst!.paper)!;
const aero=extract(replay(paper,plane.steps.length,plane.steps),worst.gsm);
console.log('实验模型最大步长差:',worst);
console.log(`480/1920 Hz 最大距离差: ${finerWorst.toFixed(4)} m`);
for(const stepsPerSecond of [120,240,480,960,1920]){
 const f=simulate(aero,worst.input,{stepsPerSecond,experimentalHeightMoment:true});
 console.log(`${stepsPerSecond} Hz: ${f.distance.toFixed(4)} m, ${f.duration.toFixed(4)} s, landed=${f.landed}`);
}
