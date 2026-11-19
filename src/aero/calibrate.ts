import {planes,type PlaneId} from '../fold/planes';
import {replay} from '../fold/engine';
import {papers} from '../paper/papers';
import {extract} from './extract';
import {simulate,type Flight,type Throw} from './integrator';

export type CalibrationRow={
 id:PlaneId|'mach5'|'zerofighter'; metric:'distance'|'duration'; target:number;
 settings:Throw; gsm:number; result:Pick<Flight,'distance'|'duration'|'landed'>|null; empiricalResult:Pick<Flight,'distance'|'duration'|'landed'>|null;
 note:string;
};

/** Fixed scenarios for tracking calibration progress, not reconstructions of record throws. */
export function calibrationReport():CalibrationRow[] {
 const scenarios:Omit<CalibrationRow,'result'|'empiricalResult'>[]=[
  {id:'dart',metric:'distance',target:15,settings:{angle:0,speed:20,wind:0},gsm:80,note:'水平投掷 20 m/s；任务书中等力度约 10–20 m 的中点'},
  {id:'suzanne',metric:'distance',target:69.14,settings:{angle:0,speed:28,wind:0},gsm:100,note:'A4 100 gsm 水平高速滑翔；几何驱动气动校准锚点'},
  {id:'suzanne',metric:'duration',target:9,settings:{angle:0,speed:28,wind:0},gsm:100,note:'设计者报告纪录飞行约 9 秒；与距离锚点同次投掷'},
  {id:'mach5',metric:'distance',target:88,settings:{angle:40,speed:28,wind:0},gsm:100,note:'纪录用 A4 100 gsm、40° 投掷角；X-43A 风格工程复刻折序'},
  {id:'skyking',metric:'duration',target:27.9,settings:{angle:20,speed:8,wind:0},gsm:80,note:'A4 80 gsm 轻柔抛投；大展弦比滞空校准锚点'},
  {id:'zerofighter',metric:'duration',target:29.2,settings:{angle:20,speed:8,wind:0},gsm:80,note:'户田拓夫 29.2 s 纪录机型，暂无几何'},
 ];
 return scenarios.map(s=>{
  if(!Object.hasOwn(planes,s.id))return {...s,result:null,empiricalResult:null};
  const plane=planes[s.id as PlaneId],state=replay(papers[0],plane.steps.length,plane.steps);
  const aero=extract(state,s.gsm),flight=simulate(aero,s.settings),empirical=simulate(aero,s.settings,{pitchModel:'empirical'});
  return {...s,result:{distance:flight.distance,duration:flight.duration,landed:flight.landed},empiricalResult:{distance:empirical.distance,duration:empirical.duration,landed:empirical.landed}};
 });
}

export type SweepWinner={input:Throw;value:number};
/** Deterministic grid search over the UI range; reports only actually landed flights. */
export function sweepLaunches(id:PlaneId,gsm:number,pitchModel:'empirical'|'geometry',inputs?:readonly Throw[]):{distance:SweepWinner;duration:SweepWinner} {
 const grid=inputs ?? Array.from({length:16},(_,i)=>i*5).flatMap(angle=>
  Array.from({length:12},(_,i)=>({angle,speed:6+i*2,wind:0})));
 if(grid.length===0)throw new Error('投掷参数列表不能为空');
 const plane=planes[id],aero=extract(replay(papers[0],plane.steps.length,plane.steps),gsm);
 let distance:SweepWinner|undefined,duration:SweepWinner|undefined;
 for(const input of grid){
  const flight=simulate(aero,input,{pitchModel});
  if(!flight.landed)continue;
  if(!distance || flight.distance>distance.value)distance={input,value:flight.distance};
  if(!duration || flight.duration>duration.value)duration={input,value:flight.duration};
 }
 if(!distance||!duration)throw new Error('扫描中没有落地结果');
 return {distance,duration};
}

export type ConvergenceRow={id:PlaneId;metric:'distance'|'duration';model:'empirical'|'geometry';values:number[];allLanded:boolean};
/** Compare fixed physical scenarios at 120, 240 and 960 integration steps/s. */
export function convergenceReport():ConvergenceRow[] {
 return calibrationReport().filter(row=>Object.hasOwn(planes,row.id)).flatMap(row=>{
  const id=row.id as PlaneId,plane=planes[id],aero=extract(replay(papers[0],plane.steps.length,plane.steps),row.gsm);
  return (['empirical','geometry'] as const).map(model=>{
   const flights=[120,240,960].map(stepsPerSecond=>simulate(aero,row.settings,{pitchModel:model,stepsPerSecond}));
   return {id,metric:row.metric,model,values:flights.map(f=>f[row.metric]),allLanded:flights.every(f=>f.landed)};
  });
 });
}

export type ConvergenceCase={id:PlaneId;paper:typeof papers[number]['id'];gsm:number;input:Throw;standard:Flight;reference:Flight;distanceDifference:number};
/** Explore numerical sensitivity across paper sizes and launch settings. */
export function convergenceGrid(inputs:readonly Throw[]=[0,20,45,75].flatMap(angle=>[6,15,28].map(speed=>({angle,speed,wind:0}))),weights:readonly number[]=[80]):ConvergenceCase[] {
 const result:ConvergenceCase[]=[];
 for(const plane of Object.values(planes))for(const paper of papers)for(const gsm of weights){
  const aero=extract(replay(paper,plane.steps.length,plane.steps),gsm);
  for(const input of inputs){
   const standard=simulate(aero,input,{pitchModel:'geometry',stepsPerSecond:240});
   const reference=simulate(aero,input,{pitchModel:'geometry',stepsPerSecond:960});
   result.push({id:plane.id,paper:paper.id,gsm,input,standard,reference,distanceDifference:Math.abs(standard.distance-reference.distance)});
  }
 }
 return result.sort((a,b)=>b.distanceDifference-a.distanceDifference);
}
