import {extract} from '../src/aero/extract';
import {replay} from '../src/fold/engine';
import {papers} from '../src/paper/papers';
import {planes} from '../src/fold/planes';
import {simulate, type Throw} from '../src/aero/integrator';

/** 数值积分收敛报告(Phase 02 / 2.13):RK2 基准与更高频率参考对照。 */
const rates = [120, 240, 480, 960] as const;
const scenarios: {id: keyof typeof planes; paper: typeof papers[number]['id']; gsm: number; input: Throw}[] = [
  {id: 'dart', paper: 'a4', gsm: 80, input: {angle: 20, speed: 15, wind: 0}},
  {id: 'suzanne', paper: 'a4', gsm: 100, input: {angle: 0, speed: 28, wind: 0}},
  {id: 'mach5', paper: 'a4', gsm: 100, input: {angle: 40, speed: 28, wind: 0}},
  {id: 'skyking', paper: 'a4', gsm: 80, input: {angle: 20, speed: 8, wind: 0}},
  {id: 'zerofighter', paper: 'a4', gsm: 80, input: {angle: 20, speed: 8, wind: 0}},
  {id: 'suzanne', paper: 'b5', gsm: 70, input: {angle: 75, speed: 28, wind: 4}},
  {id: 'skyking', paper: 'square', gsm: 100, input: {angle: 45, speed: 6, wind: -4}},
];

let worstPos = 0;
let worstTime = 0;
let worstHeight = 0;
let worstAttitude = 0;
let worstCase = '';
for (const s of scenarios) {
  const aero = extract(replay(papers.find(p => p.id === s.paper)!, planes[s.id].steps.length, planes[s.id].steps), s.gsm);
  const runs = rates.map(hz => simulate(aero, s.input, {stepsPerSecond: hz}));
  const ref = runs[runs.length - 1];
  const last = (f: typeof ref) => f.samples[f.samples.length - 1];
  // 位置:取同一归一化时间的采样点对照(30 Hz 采样公共网格)
  let pos = 0;
  let att = 0;
  for (const f of runs) {
    for (const sample of f.samples) {
      const near = ref.samples.reduce((best, p) => Math.abs(p.t - sample.t) < Math.abs(best.t - sample.t) ? p : best, ref.samples[0]);
      pos = Math.max(pos, Math.hypot(sample.x - near.x, sample.y - near.y, (sample.z ?? 0) - (near.z ?? 0)));
      att = Math.max(att, Math.abs(sample.pitch - near.pitch));
    }
  }
  const dDist = Math.max(...runs.map(f => Math.abs(f.distance - ref.distance)));
  const dTime = Math.max(...runs.map(f => Math.abs(f.duration - ref.duration)));
  const dHeight = Math.max(...runs.map(f => Math.abs(f.height - ref.height)));
  worstPos = Math.max(worstPos, dDist);
  worstTime = Math.max(worstTime, dTime);
  worstHeight = Math.max(worstHeight, dHeight);
  worstAttitude = Math.max(worstAttitude, att);
  if (dDist > worstPos - 1e-9) worstCase = `${s.id}/${s.paper}/${s.gsm}`;
  console.log(`${s.id.padEnd(12)} ${s.paper.padEnd(7)} speed=${s.input.speed} gain: Δdistance=${dDist.toFixed(4)}m Δt=${dTime.toFixed(4)}s Δh=${dHeight.toFixed(4)}m Δpitch=${att.toFixed(4)}rad Δpos(t)=${pos.toFixed(4)}m landed=${runs.every(f => f.landed)}`);
  void last;
}
console.log(`\n汇总(120/240/480 vs 960 Hz 参考): 最大落点差 ${worstPos.toFixed(4)} m (${worstCase}), 最大时间差 ${worstTime.toFixed(4)} s, 最大峰高差 ${worstHeight.toFixed(4)} m, 最大姿态差 ${worstAttitude.toFixed(4)} rad`);

// 计算成本:240 Hz 与 960 Hz 的墙上时间比(单场景 20 次重复取均值)
const aero = extract(replay(papers[0], planes.suzanne.steps.length, planes.suzanne.steps), 100);
const bench = (hz: 240 | 960) => {
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) simulate(aero, {angle: 0, speed: 28, wind: 0}, {stepsPerSecond: hz});
  return (performance.now() - t0) / 20;
};
const t240 = bench(240);
const t960 = bench(960);
console.log(`计算成本(20 次均值): 240 Hz ${t240.toFixed(2)} ms/次, 960 Hz ${t960.toFixed(2)} ms/次, 倍率 ${(t960 / t240).toFixed(2)}×`);
