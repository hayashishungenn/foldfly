import {describe, it, expect} from 'vitest';
import {
  analyzeCreaseTopology,
  clipLineToPolygon,
  extractCreasePattern,
  foldStackStats,
} from '../src/fold/crease-pattern';
import {telemetryAt, analyzeFlight} from '../src/aero/diagnostics';
import {
  analyzeTrajectoryPhases,
  computeAeroPolar,
  computePolhamusBreakdown,
  computeReynoldsNumber,
  groundEffectDragFactor,
  sweepLaunchAngles,
} from '../src/aero/polar';
import {replay} from '../src/fold/engine';
import {extract} from '../src/aero/extract';
import {simulate} from '../src/aero/integrator';
import {papers} from '../src/paper/papers';
import {planes} from '../src/fold/planes';

describe('折痕图提取与叠层统计 (crease-pattern)', () => {
  it('将折痕直线裁剪至纸张凸多边形边界内', () => {
    const rect = [
      {x: 0, y: 0},
      {x: 0.21, y: 0},
      {x: 0.21, y: 0.297},
      {x: 0, y: 0.297},
    ];
    const seg = clipLineToPolygon({x: 0.105, y: -1}, {x: 0.105, y: 2}, rect);
    expect(seg).not.toBeNull();
    expect(seg![0].x).toBeCloseTo(0.105, 8);
    expect(seg![1].x).toBeCloseTo(0.105, 8);
    expect(Math.hypot(seg![1].x - seg![0].x, seg![1].y - seg![0].y)).toBeCloseTo(0.297, 8);
  });

  it('提取各机型折痕图并区分预折辅助线与永久折痕', () => {
    const sheet = papers[0];
    const dartCp = extractCreasePattern(sheet, planes.dart.steps);
    expect(dartCp.length).toBeGreaterThanOrEqual(6);
    expect(dartCp.some(c => c.precrease)).toBe(true);
    expect(dartCp.some(c => !c.precrease && c.kind === 'valley')).toBe(true);
    expect(dartCp.some(c => !c.precrease && c.kind === 'mountain')).toBe(true);

    const skyCp = extractCreasePattern(sheet, planes.skyking.steps);
    expect(skyCp.filter(c => c.precrease).length).toBeGreaterThanOrEqual(3);
  });

  it('统计各步骤叠层峰值与机头层数，Mach 5 机头层数高于经典尖头机', () => {
    const sheet = papers[0];
    const dartStats = foldStackStats(sheet, planes.dart.steps, planes.dart.steps.length);
    const machStats = foldStackStats(sheet, planes.mach5.steps, planes.mach5.steps.length);
    expect(dartStats.maxStackLayers).toBeGreaterThanOrEqual(4);
    expect(machStats.maxStackLayers).toBeGreaterThanOrEqual(dartStats.maxStackLayers);
    expect(machStats.creaseCount).toBeGreaterThan(dartStats.creaseCount);
  });
});

describe('飞行实时受力遥测与模态诊断 (diagnostics)', () => {
  it('实时计算任意时刻的升力、阻力、重力、速度矢量与攻角', () => {
    const sheet = papers[0];
    const aero = extract(replay(sheet, planes.suzanne.steps.length, planes.suzanne.steps), 100);
    const launch = {angle: 0, speed: 28, wind: 0};
    const flight = simulate(aero, launch);

    const t0 = telemetryAt(flight, aero, launch, 0);
    expect(t0.airSpeed).toBeCloseTo(28, 3);
    expect(t0.forces.weight).toBeCloseTo(aero.mass * 9.81, 6);
    expect(t0.forces.drag).toBeGreaterThan(0);
    expect(Math.hypot(t0.forces.liftDir.x, t0.forces.liftDir.y)).toBeCloseTo(1, 6);
    expect(Math.hypot(t0.forces.dragDir.x, t0.forces.dragDir.y)).toBeCloseTo(1, 6);

    const tMid = telemetryAt(flight, aero, launch, flight.duration * 0.5);
    expect(tMid.y).toBeGreaterThan(0);
    expect(tMid.liftToDrag).toBeGreaterThan(2);
  });

  it('识别平稳滑翔、爬升转滑翔与波状振荡模态并生成前后对比', () => {
    const sheet = papers[0];
    const suzanneAero = extract(replay(sheet, planes.suzanne.steps.length, planes.suzanne.steps), 100);
    const machAero = extract(replay(sheet, planes.mach5.steps.length, planes.mach5.steps), 100);

    const suzanneFlight = simulate(suzanneAero, {angle: 0, speed: 28, wind: 0});
    const suzanneDiag = analyzeFlight(suzanneFlight, suzanneAero, {angle: 0, speed: 28, wind: 0});
    expect(suzanneDiag.regime).toBe('steady-glide');
    expect(suzanneDiag.verdict).toContain('L/D');

    const machFlight = simulate(machAero, {angle: 40, speed: 28, wind: 0});
    const machDiag = analyzeFlight(machFlight, machAero, {angle: 40, speed: 28, wind: 0}, suzanneFlight);
    expect(machDiag.regime).toBe('climb-glide');
    expect(machDiag.comparison).not.toBeNull();
    expect(machDiag.comparison!.distanceDelta).toBeGreaterThan(15);
    expect(machDiag.comparison!.summary).toContain('与上一投相比');
  });
});

describe('气动升阻极曲线、动态模态与轨迹三阶段分解 (polar)', () => {
  it('提取各机型极曲线：Sky King 沉降率最低且滑翔比最高，Suzanne 滑翔比优于经典尖头机', () => {
    const sheet = papers[0];
    const dartAero = extract(replay(sheet, planes.dart.steps.length, planes.dart.steps), 80);
    const suzanneAero = extract(replay(sheet, planes.suzanne.steps.length, planes.suzanne.steps), 100);
    const machAero = extract(replay(sheet, planes.mach5.steps.length, planes.mach5.steps), 100);
    const skyAero = extract(replay(sheet, planes.skyking.steps.length, planes.skyking.steps), 80);

    const dartPolar = computeAeroPolar(dartAero);
    const suzannePolar = computeAeroPolar(suzanneAero);
    const machPolar = computeAeroPolar(machAero);
    const skyPolar = computeAeroPolar(skyAero);

    expect(suzannePolar.bestGlide.ld).toBeGreaterThan(dartPolar.bestGlide.ld);
    expect(skyPolar.bestGlide.ld).toBeGreaterThan(suzannePolar.bestGlide.ld);
    expect(skyPolar.minSink.sinkRate).toBeLessThan(suzannePolar.minSink.sinkRate);
    expect(machPolar.stability.pitchStiffness).toBeGreaterThan(dartPolar.stability.pitchStiffness);
    expect(suzannePolar.stability.phugoidPeriod).toBeGreaterThan(1.5);
  });

  it('将轨迹分解为三阶段并区分 Suzanne 平射穿刺与 Mach 5 高仰角爬升转滑翔', () => {
    const sheet = papers[0];
    const suzanneAero = extract(replay(sheet, planes.suzanne.steps.length, planes.suzanne.steps), 100);
    const machAero = extract(replay(sheet, planes.mach5.steps.length, planes.mach5.steps), 100);

    const suzanneLaunch = {angle: 0, speed: 28, wind: 0};
    const suzanneFlight = simulate(suzanneAero, suzanneLaunch);
    const suzannePhases = analyzeTrajectoryPhases(suzanneFlight, suzanneAero, suzanneLaunch);
    expect(suzannePhases.phases.length).toBe(3);
    expect(suzannePhases.phases[0].label).toContain('高速平射穿刺段');

    const machLaunch = {angle: 40, speed: 28, wind: 0};
    const machFlight = simulate(machAero, machLaunch);
    const machPhases = analyzeTrajectoryPhases(machFlight, machAero, machLaunch);
    expect(machPhases.phases.length).toBe(3);
    expect(machPhases.phases[0].label).toContain('高速爬升转换段');
    expect(machPhases.apogeePotentialConversionPct).toBeGreaterThan(20);
  });

  it('仰角扫描验证各机型最佳投掷角与实测纪录物理一致', () => {
    const sheet = papers[0];
    const suzanneAero = extract(replay(sheet, planes.suzanne.steps.length, planes.suzanne.steps), 100);
    const machAero = extract(replay(sheet, planes.mach5.steps.length, planes.mach5.steps), 100);
    const skyAero = extract(replay(sheet, planes.skyking.steps.length, planes.skyking.steps), 80);

    const suzanneSweep = sweepLaunchAngles(suzanneAero, 28, 0);
    const machSweep = sweepLaunchAngles(machAero, 28, 0);
    const skySweep = sweepLaunchAngles(skyAero, 8, 0);

    // Suzanne 最佳距离仰角位于低平抛区 (0°..10°)
    expect(suzanneSweep.bestDistance.angle).toBeLessThanOrEqual(10);
    // Mach 5 最佳距离仰角位于高仰角爬升区 (35°..45°)
    expect(machSweep.bestDistance.angle).toBeGreaterThanOrEqual(35);
    expect(machSweep.bestDistance.angle).toBeLessThanOrEqual(45);
    // Sky King 最佳滞空仰角位于中等微抛仰角区 (15°..25°)
    expect(skySweep.bestDuration.angle).toBeGreaterThanOrEqual(15);
    expect(skySweep.bestDuration.angle).toBeLessThanOrEqual(25);
  });

  it('计算低雷诺数 Re、Polhamus 前缘涡升占比、McCormick 地效因子与折痕拓扑对称性', () => {
    const sheet = papers[0];
    for (const key of ['dart', 'suzanne', 'mach5', 'skyking', 'nakamura', 'blackburn'] as const) {
      const topo = analyzeCreaseTopology(sheet, planes[key].steps);
      expect(topo.mirrorSymmetric).toBe(true);
      expect(topo.totalLengthM).toBeGreaterThan(1.0);
      expect(topo.interiorVertexCount).toBeGreaterThanOrEqual(1);
    }

    const dartAero = extract(replay(sheet, planes.dart.steps.length, planes.dart.steps), 80);
    const re5 = computeReynoldsNumber(5, dartAero.chord);
    expect(re5).toBeGreaterThan(40000);
    expect(re5).toBeLessThan(120000);

    const lowAlpha = computePolhamusBreakdown((3 * Math.PI) / 180, dartAero);
    const highAlpha = computePolhamusBreakdown((15 * Math.PI) / 180, dartAero);
    expect(highAlpha.vortexSharePct).toBeGreaterThan(lowAlpha.vortexSharePct);
    expect(highAlpha.vortexCl).toBeGreaterThan(lowAlpha.vortexCl);

    expect(groundEffectDragFactor(0.02, dartAero.span)).toBeLessThan(groundEffectDragFactor(1.5, dartAero.span));
    expect(groundEffectDragFactor(2.0, dartAero.span)).toBeGreaterThan(0.99);
  });
});
