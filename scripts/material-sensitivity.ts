/** 材料敏感性对照(Phase 04 / 4.12):单变量扫描质量/克重/材质/调校。 */
import {extract} from '../src/aero/extract';
import {replay} from '../src/fold/engine';
import {papers} from '../src/paper/papers';
import {planes} from '../src/fold/planes';
import {simulate} from '../src/aero/integrator';
import {materialProfile, grades} from '../src/paper/material';
import {trimAero, applyTrim, DEFAULT_TRIM} from '../src/paper/trim';

const sheet = papers[0];
console.log('克重扫描(A4 dart 20°/15):质量严格线性');
for (const gsm of [70, 80, 100]) {
  const a = extract(replay(sheet, 6), gsm);
  const f = simulate(a, {angle: 20, speed: 15, wind: 0});
  console.log(`  ${gsm} gsm 质量 ${(a.mass * 1000).toFixed(3)} g 距离 ${f.distance.toFixed(2)} m 滞空 ${f.duration.toFixed(2)} s`);
}
console.log('\n材质扫描(A4 80 suzanne 0°/28,定形通道生效机型;dart 无拱度通道,材质不影响其飞行):');
const suz = extract(replay(sheet, planes.suzanne.steps.length, planes.suzanne.steps), 80);
for (const g of grades) {
  const f = simulate(suz, {angle: 0, speed: 28, wind: 0}, {material: materialProfile(g.id, 80)});
  console.log(`  ${g.name.padEnd(6)} 距离 ${f.distance.toFixed(2)} m 滞空 ${f.duration.toFixed(2)} s 可信度 ${g.confidence}`);
}
console.log('\n调校扫描(suzanne A4 100 0°/28):');
const suzanne = extract(replay(sheet, planes.suzanne.steps.length, planes.suzanne.steps), 100);
for (const [label, trim] of [['默认', DEFAULT_TRIM], ['10° 上反', {...DEFAULT_TRIM, dihedralLeft: 10, dihedralRight: 10}], ['不对称 0/10°', {...DEFAULT_TRIM, dihedralRight: 10}]] as const) {
  const a = trimAero(suzanne, trim);
  const f = simulate(a, {angle: 0, speed: 28, wind: 0});
  const eff = applyTrim(suzanne, trim);
  console.log(`  ${label.padEnd(10)} 有效展长 ${(eff.span * 100).toFixed(2)} cm 不对称度 ${eff.asymmetry.toFixed(3)} 距离 ${f.distance.toFixed(2)} m`);
}
