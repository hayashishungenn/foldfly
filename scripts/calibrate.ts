import {calibrationReport} from '../src/aero/calibrate';
import {planes} from '../src/fold/planes';
import {replay} from '../src/fold/engine';
import {papers} from '../src/paper/papers';
import {extract} from '../src/aero/extract';
import {simulate} from '../src/aero/integrator';
console.log('FoldFly 校准对照（固定示例投掷，非世界纪录投掷复现）');
for(const row of calibrationReport()){
 const unit=row.metric==='distance'?'m':'s';
 const value=row.result ? `${row.result[row.metric].toFixed(2)} ${unit}${row.result.landed?'':'（未落地）'}` : '暂无几何';
 const experimental=row.empiricalResult ? `${row.empiricalResult[row.metric].toFixed(2)} ${unit}${row.empiricalResult.landed?'':'（未落地）'}` : '暂无几何';
 console.log(`${row.id.padEnd(12)} 试玩 ${value.padEnd(15)} 旧经验模型 ${experimental.padEnd(15)} 目标 ${row.target} ${unit}；${row.note}`);
}
const dart=extract(replay(papers[0],planes.dart.steps.length,planes.dart.steps),80);
console.log('\n几何稳定性估计（A4、80 gsm；焦点采用四分之一翼弦近似）');
for(const plane of Object.values(planes)){
 const a=extract(replay(papers[0],plane.steps.length,plane.steps),80);
 const margin=(a.aerodynamicCenter.y-a.cg.y)/a.chord;
 console.log(`${plane.id.padEnd(10)} 重心 ${(a.cg.y*100).toFixed(2)} cm 焦点 ${(a.aerodynamicCenter.y*100).toFixed(2)} cm 静稳定余量 ${(margin*100).toFixed(1)}%（${margin>0?'估计稳定':'估计不稳定'}） 机身侧视 ${(a.bodySideArea*10000).toFixed(1)} cm²`);
}
const angled=simulate(dart,{angle:20,speed:20,wind:0});
console.log(`尖头机角度对照：20°、20 m/s 试玩 ${angled.distance.toFixed(2)} m；与水平投掷使用同一张纸和同一模型`);
const frictionOnly=simulate(dart,{angle:0,speed:20,wind:0},{dragModel:'skin-friction'});
console.log(`阻力下界对照：仅计表面摩擦时 ${frictionOnly.distance.toFixed(2)} m；未包含零攻角形状及干扰阻力`);
console.log('\n纸张对照（经典尖头机，水平 20 m/s，无风；用于发现趋势，不是实测校准）');
for(const paper of papers){
 const state=replay(paper,planes.dart.steps.length,planes.dart.steps);
 for(const gsm of [80,100]){
  const properties=extract(state,gsm),flight=simulate(properties,{angle:0,speed:20,wind:0});
  console.log(`${paper.name.padEnd(10)} ${gsm} gsm 质量 ${(properties.mass*1000).toFixed(2)} g 翼载 ${(properties.mass/properties.wingArea).toFixed(3)} kg/m² 距离 ${flight.distance.toFixed(2)} m 滞空 ${flight.duration.toFixed(2)} s${flight.landed?'':'（未落地）'}`);
 }
}
if(process.argv.includes('--sweep')){
 const {sweepLaunches}=await import('../src/aero/calibrate');
 console.log('\n无风参数扫描（角度 0–75° 每 5°；速度 6–28 m/s 每 2 m/s）');
 for(const id of ['dart','suzanne','skyking'] as const)for(const model of ['empirical','geometry'] as const){
  const r=sweepLaunches(id,80,model);
  const fmt=(w:typeof r.distance,unit:string)=>`${w.value.toFixed(2)} ${unit} (${w.input.angle}°, ${w.input.speed} m/s)`;
  console.log(`${id.padEnd(10)} ${model.padEnd(9)} 距离 ${fmt(r.distance,'m')}，滞空 ${fmt(r.duration,'s')}`);
 }
}
if(process.argv.includes('--convergence')){
 const {convergenceReport}=await import('../src/aero/calibrate');
 console.log('\n积分步长对照（120 / 240 / 960 Hz；960 Hz 为数值参考，并非实测值）');
 for(const row of convergenceReport()){
  const unit=row.metric==='distance'?'m':'s',delta=Math.abs(row.values[1]-row.values[2]);
  console.log(`${row.id.padEnd(10)} ${row.model.padEnd(9)} ${row.values.map(v=>v.toFixed(3)).join(' / ')} ${unit}；240 Hz 差 ${delta.toFixed(3)} ${unit}${row.allLanded?'':'；未全部落地'}`);
 }
}
if(process.argv.includes('--convergence-grid')){
 const {convergenceGrid}=await import('../src/aero/calibrate');
 const inputs=[0,20,45,75].flatMap(angle=>[6,15,28].flatMap(speed=>[-4,0,4].map(wind=>({angle,speed,wind}))));
 const rows=convergenceGrid(inputs,[70,80,100]);
 console.log(`\n几何力矩模型步长敏感性：${rows.length} 组纸张、风与投掷条件，显示差异最大的 5 组（240 / 960 Hz）`);
 for(const row of rows.slice(0,5))console.log(`${row.id} ${row.paper} ${row.gsm} gsm ${row.input.angle}° ${row.input.speed} m/s 风 ${row.input.wind} m/s：${row.standard.distance.toFixed(2)} / ${row.reference.distance.toFixed(2)} m，差 ${row.distanceDifference.toFixed(2)} m${row.standard.landed&&row.reference.landed?'':'；未全部落地'}`);
}
