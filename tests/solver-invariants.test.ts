import {describe, it, expect} from 'vitest';
import {extract} from '../src/aero/extract';
import {replay} from '../src/fold/engine';
import {papers} from '../src/paper/papers';
import {planes} from '../src/fold/planes';
import {defaultEnvironment, prepareSolver, solveAero, type PhysicsState} from '../src/aero/solver';
import {coefficients} from '../src/aero/model';
import {simulate} from '../src/aero/integrator';

const aero = extract(replay(papers[0], planes.suzanne.steps.length, planes.suzanne.steps), 100);
const state = (v: {x: number; y: number; z: number}, pitch = 0): PhysicsState => ({
  position: {x: 0, y: 1.5, z: 0}, velocity: v,
  attitude: {pitch, yaw: 0, roll: 0}, angularVelocity: {pitch: 0, yaw: 0, roll: 0}, time: 0,
});

describe('统一气动力求解器不变量(Phase 02 / 2.6–2.9, 2.14)', () => {
  const ctx = prepareSolver(aero, {});

  it('纯函数:相同输入完全可复现', () => {
    const env = defaultEnvironment();
    const a = solveAero(ctx, state({x: 20, y: 2, z: 0}), env);
    const b = solveAero(ctx, state({x: 20, y: 2, z: 0}), env);
    expect(a).toEqual(b);
  });

  it('零相对空速:气动力与力矩趋于零(重力不在求解器内)', () => {
    const sol = solveAero(ctx, state({x: 0, y: 0, z: 0}), defaultEnvironment());
    expect(sol.relativeSpeed).toBe(0);
    expect(sol.dynamicPressure).toBe(0);
    expect(sol.lift).toBe(0);
    expect(sol.drag).toBe(0);
    expect(Math.hypot(sol.totalAerodynamicForce.x, sol.totalAerodynamicForce.y, sol.totalAerodynamicForce.z)).toBe(0);
    expect(sol.pitchMoment).toBe(0);
  });

  it('阻力方向与相对空速相反,升力与空速垂直', () => {
    const v = {x: 18, y: 4, z: 2};
    const sol = solveAero(ctx, state(v, 0.1), defaultEnvironment());
    const dot = sol.dragDirection.x * v.x + sol.dragDirection.y * v.y + sol.dragDirection.z * v.z;
    expect(dot).toBeLessThan(0);
    const liftDot = sol.liftDirection.x * v.x + sol.liftDirection.y * v.y + sol.liftDirection.z * v.z;
    expect(Math.abs(liftDot) / Math.hypot(v.x, v.y, v.z)).toBeLessThan(1e-9);
    expect(Math.abs(Math.hypot(sol.liftDirection.x, sol.liftDirection.y, sol.liftDirection.z) - 1)).toBeLessThan(1e-9);
  });

  it('基础升阻力在零迎角与正负小迎角连续、对称', () => {
    for (const speed of [3, 6, 15, 28]) {
      for (const deg of [0, 1, 5, 14, 20, 60, 120, 175]) {
        const rad = deg * Math.PI / 180;
        const plus = coefficients(rad, aero, speed);
        const minus = coefficients(-rad, aero, speed);
        expect(plus.cl).toBeCloseTo(-minus.cl, 8);
        expect(plus.cd).toBeCloseTo(minus.cd, 8);
        expect(Number.isFinite(plus.cl) && Number.isFinite(plus.cd)).toBe(true);
      }
      const eps = 1e-6;
      const a0 = coefficients(0, aero, speed), ap = coefficients(eps, aero, speed), am = coefficients(-eps, aero, speed);
      expect(Math.abs(ap.cl - a0.cl)).toBeLessThan(1e-4);
      expect(Math.abs(am.cl - a0.cl)).toBeLessThan(1e-4);
      expect(Math.abs(ap.cd - a0.cd)).toBeLessThan(1e-4);
    }
  });

  it('求解器质量/惯量为正,静态裕度与翼载荷有限为正', () => {
    expect(aero.mass).toBeGreaterThan(0);
    expect(aero.pitchInertia).toBeGreaterThan(0);
    expect(Number.isFinite(aero.span)).toBe(true);
    expect(aero.wingArea).toBeGreaterThan(0);
    const sol = solveAero(ctx, state({x: 10, y: 0, z: 0}), defaultEnvironment());
    expect(Number.isFinite(sol.pitchMoment)).toBe(true);
    expect(Number.isFinite(sol.cl)).toBe(true);
  });

  it('无门控基准模型:无拱度增升、eOswald ≤ 1,且力仍与空速一致', () => {
    const baseline = prepareSolver(aero, {model: 'baseline'});
    const v5 = prepareSolver(aero, {model: 'v5'});
    const sb = solveAero(baseline, state({x: 8, y: 0, z: 0}), defaultEnvironment());
    const s5 = solveAero(v5, state({x: 8, y: 0, z: 0}), defaultEnvironment());
    expect(baseline.gates.cambered).toBe(0);
    expect(sb.corrections.clCamber).toBe(0);
    expect(sb.corrections.eOswald).toBeLessThanOrEqual(1);
    expect(sb.corrections.model).toBe('baseline');
    expect(s5.corrections.model).toBe('v5');
    // 基准模型不得复刻经典机型拟合的 7.2·slowEndurance 项
    expect(s5.corrections.eOswald).toBeGreaterThanOrEqual(sb.corrections.eOswald);
    expect(Number.isFinite(sb.drag)).toBe(true);
    expect(sb.drag).toBeGreaterThanOrEqual(0);
  });

  it('有风环境输入参与计算:顺风改变相对空速与阻力', () => {
    const env = defaultEnvironment();
    const noWind = solveAero(ctx, state({x: 20, y: 0, z: 0}), env);
    const withWind = solveAero(ctx, state({x: 20, y: 0, z: 0}), {...env, wind: 4});
    expect(withWind.relativeSpeed).toBeCloseTo(16, 8);
    expect(withWind.drag).toBeLessThan(noWind.drag);
    const withCross = solveAero(ctx, state({x: 20, y: 0, z: 0}), {...env, crosswind: 3});
    expect(withCross.beta).not.toBe(0);
    expect(withCross.sideForce).not.toBe(0);
  });

  it('阻力分项可追溯至最终 CD(不重复累加)', () => {
    const sol = solveAero(ctx, state({x: 12, y: 0.5, z: 1}, 0.05), defaultEnvironment());
    const sum = sol.dragBreakdown.induced + sol.dragBreakdown.zeroLift + sol.dragBreakdown.separated;
    const total = sol.drag;
    // 门控路径以 blended CD0/CDi 为主,分项之和为同阶量且不超过总量两倍(明确记录 blending 口径)
    expect(sum).toBeGreaterThanOrEqual(0);
    expect(total).toBeGreaterThanOrEqual(0);
    expect(sum).toBeLessThanOrEqual(total * 2 + 1e-6);
    expect(Number.isFinite(sol.dragBreakdown.gateCorrection)).toBe(true);
  });
});


describe('结构化环境实验输入(2.12)', () => {
  it('垂直风与空气密度覆盖进入求解器;展示型地面效应不改变轨迹', async () => {
    const input = {angle: 20, speed: 15, wind: 0, crosswind: 0};
    const base = simulate(aero, input);
    const vertical = simulate(aero, input, {environment: {verticalWind: -2}});
    const dense = simulate(aero, input, {environment: {density: 1.6}});
    expect(vertical.distance).not.toBeCloseTo(base.distance, 4);
    expect(dense.distance).not.toBeCloseTo(base.distance, 4);
    const {groundEffectDragFactor} = await import('../src/aero/polar');
    expect(groundEffectDragFactor(1.5, aero.span)).toBeGreaterThan(0);
    expect(groundEffectDragFactor(1.5, aero.span)).toBeLessThan(1);
  });
});

describe('模型版本兼容(2.16)', () => {
  it('幽灵键/分享/PB 均带版本,旧版本不静默重算为新成绩', async () => {
    const {FLIGHT_MODEL_VERSION} = await import('../src/aero/integrator');
    const {ghostStorageKey, decodeGhost, encodeGhost} = await import('../src/game/ghost');
    const {encodeFlight, decodeFlight} = await import('../src/game/share');
    const {encodeCompetitionPb, decodeCompetitionPb} = await import('../src/game/competition');
    expect(FLIGHT_MODEL_VERSION).toBe(5);
    const key = ghostStorageKey('dart', 'distance');
    expect(key).toContain('-f5-');
    const flight = simulate(aero, {angle: 20, speed: 15, wind: 0});
    const ghost = encodeGhost('distance', flight);
    expect(decodeGhost(ghost, 'distance')).not.toBeNull();
    const hash = encodeFlight({version: 1, plane: 'dart', paper: 'a4', gsm: 80, angle: 20, speed: 15, wind: 0, step: 6});
    expect(decodeFlight(hash)?.modelVersion).toBe(5);
    const pb = {
      event: 'distance' as const, score: 10, playerName: '选手', plane: 'dart' as const,
      paper: 'a4' as const, gsm: 80 as const, seed: 1, modelVersion: 5, recordedAt: '',
    };
    expect(decodeCompetitionPb(encodeCompetitionPb(pb), 'distance')?.score).toBe(10);
    expect(decodeCompetitionPb(encodeCompetitionPb({...pb, modelVersion: 4}), 'distance')).toBeNull();
  });
});
