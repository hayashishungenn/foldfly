import {replay} from '../src/fold/engine';
import {planes} from '../src/fold/planes';
import {papers} from '../src/paper/papers';
import {materialProfile} from '../src/paper/material';
import {extract, aeroMetrics} from '../src/aero/extract';
import {simulate} from '../src/aero/integrator';
import {computeAeroPolar, analyzeTrajectoryPhases, sweepLaunchAngles} from '../src/aero/polar';
import {analyzeFlight} from '../src/aero/diagnostics';

const a4 = papers[0];
const configs = [
  {id: 'dart' as const, gsm: 80, angle: 20, speed: 15},
  {id: 'suzanne' as const, gsm: 100, angle: 0, speed: 28},
  {id: 'mach5' as const, gsm: 100, angle: 40, speed: 28},
  {id: 'skyking' as const, gsm: 80, angle: 20, speed: 8},
  {id: 'nakamura' as const, gsm: 80, angle: 15, speed: 12},
  {id: 'blackburn' as const, gsm: 80, angle: 25, speed: 18},
];

for (const cfg of configs) {
  const p = planes[cfg.id];
  const state = replay(a4, p.steps.length, p.steps);
  const aero = extract(state, cfg.gsm);
  const metrics = aeroMetrics(aero);
  const polar = computeAeroPolar(aero, 0);
  const flight = simulate(aero, {angle: cfg.angle, speed: cfg.speed, wind: 0});
  const diag = analyzeFlight(flight, aero, {angle: cfg.angle, speed: cfg.speed, wind: 0});
  const breakdown = analyzeTrajectoryPhases(flight, aero, {angle: cfg.angle, speed: cfg.speed, wind: 0});
  const sweep = sweepLaunchAngles(aero, cfg.speed, 0);

  console.log(`\n=== ${p.name} (${cfg.id} · A4 ${cfg.gsm} gsm · 投掷 ${cfg.angle}° @ ${cfg.speed} m/s) ===`);
  const mat = materialProfile('copy', cfg.gsm);
  console.log(
    `材料: ${mat.grade.name} | 厚度=${(mat.thickness * 1e6).toFixed(0)}µm | 挺度MD=${(mat.bendingStiffnessMD * 1e3).toFixed(3)}mN·m | CD=${(mat.bendingStiffnessCD * 1e3).toFixed(3)}mN·m | 折痕利落度=${(mat.creaseCrispness * 100).toFixed(0)}%（经验估算，未耦合物理）`,
  );
  console.log(
    `几何: 质量=${(aero.mass * 1000).toFixed(2)}g | 翼展=${(aero.span * 100).toFixed(1)}cm | 弦长=${(aero.chord * 100).toFixed(1)}cm | 翼面积=${(aero.wingArea * 1e4).toFixed(1)}cm² | AR=${aero.aspectRatio.toFixed(2)} | 饱满度=${metrics.fullness.toFixed(3)} | SM=${(metrics.staticMargin * 100).toFixed(1)}% | 龙骨侧面积=${(aero.bodySideArea * 1e4).toFixed(1)}cm²`,
  );
  console.log(
    `极曲线: 最大滑翔比 (L/D)_max=${polar.bestGlide.ld.toFixed(2)} @ α=${polar.bestGlide.alphaDeg.toFixed(1)}°, V_eq=${polar.bestGlide.speed.toFixed(2)}m/s, 沉降率=${polar.bestGlide.sinkRate.toFixed(2)}m/s`,
  );
  console.log(
    `滞空极值: 最小沉降率 w_min=${polar.minSink.sinkRate.toFixed(2)}m/s @ α=${polar.minSink.alphaDeg.toFixed(1)}°, V_ms=${polar.minSink.speed.toFixed(2)}m/s, L/D=${polar.minSink.ld.toFixed(2)} | 失速角=${polar.stallAngleDeg.toFixed(1)}° (CL_max=${polar.clMax.toFixed(2)})`,
  );
  console.log(
    `动态模态: 短周期俯仰 T_sp=${polar.stability.shortPeriodPeriod.toFixed(2)}s (ζ_sp=${polar.stability.shortPeriodDamping.toFixed(2)}) | 长周期 Phugoid T_ph=${polar.stability.phugoidPeriod.toFixed(2)}s (ζ_ph=${polar.stability.phugoidDamping.toFixed(3)})`,
  );
  console.log(
    `轨迹表现: 距离=${flight.distance.toFixed(2)}m | 滞空=${flight.duration.toFixed(2)}s | 最高=${flight.height.toFixed(2)}m | 模态=${diag.regimeLabel}`,
  );
  console.log(
    `角度扫描 (@${cfg.speed}m/s): 最佳距离角=${sweep.bestDistance.angle}° (${sweep.bestDistance.distance.toFixed(2)}m) | 最佳滞空角=${sweep.bestDuration.angle}° (${sweep.bestDuration.duration.toFixed(2)}s)`,
  );
  for (const ph of breakdown.phases) {
    console.log(`  - ${ph.label} [${ph.startTime.toFixed(2)}s→${ph.endTime.toFixed(2)}s, ${ph.startX.toFixed(1)}m→${ph.endX.toFixed(1)}m]: ${ph.summary}`);
  }
}
