import {describe, it, expect} from 'vitest';
import {replay} from '../src/fold/engine';
import {planes} from '../src/fold/planes';
import {papers} from '../src/paper/papers';
import {extract, aeroMetrics} from '../src/aero/extract';
import {simulate} from '../src/aero/integrator';
import {WORLD_RECORDS, challengeResult} from '../src/game/challenge';

describe('P1 气动物理敏感性与极端边界审查 (aero-audit)', () => {
  const a4 = papers[0];
  const dartState = replay(a4, planes.dart.steps.length, planes.dart.steps);
  const dart80 = extract(dartState, 80);

  it('质量与翼载荷随克重（70/80/100 gsm）严格线性增长，基准滑翔速单调上升', () => {
    const a70 = extract(dartState, 70);
    const a80 = extract(dartState, 80);
    const a100 = extract(dartState, 100);

    expect(a80.mass / a70.mass).toBeCloseTo(80 / 70, 6);
    expect(a100.mass / a80.mass).toBeCloseTo(100 / 80, 6);

    const m70 = aeroMetrics(a70);
    const m80 = aeroMetrics(a80);
    const m100 = aeroMetrics(a100);
    expect(m80.wingLoading).toBeGreaterThan(m70.wingLoading);
    expect(m100.wingLoading).toBeGreaterThan(m80.wingLoading);
    expect(m100.nominalGlideSpeed).toBeGreaterThan(m80.nominalGlideSpeed);
    expect(m80.nominalGlideSpeed).toBeGreaterThan(m70.nominalGlideSpeed);
  });

  it('风速对地面航程的影响方向正确：顺风增距、逆风减距，且强逆风不发散', () => {
    const head = simulate(dart80, {angle: 15, speed: 15, wind: -4});
    const calm = simulate(dart80, {angle: 15, speed: 15, wind: 0});
    const tail = simulate(dart80, {angle: 15, speed: 15, wind: 4});

    expect(head.landed).toBe(true);
    expect(calm.landed).toBe(true);
    expect(tail.landed).toBe(true);
    expect(tail.distance).toBeGreaterThan(calm.distance);
    expect(calm.distance).toBeGreaterThan(head.distance);
  });

  it('初速度提升单调增加初始动能，经典尖头机平抛距离随速度增长', () => {
    const slow = simulate(dart80, {angle: 15, speed: 6, wind: 0});
    const med = simulate(dart80, {angle: 15, speed: 15, wind: 0});
    const fast = simulate(dart80, {angle: 15, speed: 25, wind: 0});

    expect(med.distance).toBeGreaterThan(slow.distance);
    expect(fast.distance).toBeGreaterThan(med.distance);
  });

  it('极端仰角（0°/75°）、低速（6 m/s）与强逆风（-4 m/s）下所有机型均数值稳定且步长收敛', () => {
    const extremes = [
      {angle: 0, speed: 6, wind: -4},
      {angle: 75, speed: 24, wind: -4},
      {angle: 75, speed: 6, wind: 0},
    ];
    for (const p of Object.values(planes)) {
      const aero = extract(replay(a4, p.steps.length, p.steps), 80);
      for (const launch of extremes) {
        const f240 = simulate(aero, launch, {stepsPerSecond: 240});
        const f960 = simulate(aero, launch, {stepsPerSecond: 960});
        expect(Number.isFinite(f240.distance)).toBe(true);
        expect(Number.isFinite(f240.duration)).toBe(true);
        expect(f240.landed).toBe(true);
        expect(Math.abs(f240.distance - f960.distance)).toBeLessThan(0.15);
      }
    }
  });

  it('世界纪录口径更新：距离现役 98.43 m / 历史里程碑 88.31 m，滞空区分 27.9 s / 29.2 s / 31.2 s', () => {
    expect(WORLD_RECORDS.distanceCurrent.value).toBe(98.43);
    expect(WORLD_RECORDS.distanceMach5Milestone.value).toBe(88.31);
    expect(WORLD_RECORDS.durationSkyKing.value).toBe(27.9);
    expect(WORLD_RECORDS.durationZeroFighter.value).toBe(29.2);
    expect(WORLD_RECORDS.durationCurrent.value).toBe(31.2);

    const r90 = challengeResult('distance', {distance: 90, duration: 10});
    expect(r90.beaten).toBe(true);
    expect(r90.worldRecordBeaten).toBe(false);

    const r99 = challengeResult('distance', {distance: 99, duration: 12});
    expect(r99.worldRecordBeaten).toBe(true);
  });
});
