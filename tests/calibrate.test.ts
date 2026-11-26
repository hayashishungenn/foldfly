import {describe, it, expect} from 'vitest';
import {calibrationReport} from '../src/aero/calibrate';
import {planes} from '../src/fold/planes';
import {papers} from '../src/paper/papers';
import {replay} from '../src/fold/engine';
import {extract} from '../src/aero/extract';
import {simulate} from '../src/aero/integrator';

describe('校准报告与历史锚点验证', () => {
  it('根据实际几何模拟已实现机型，数量级吻合三大历史纪录，且不为缺失机型捏造结果', () => {
    const report = calibrationReport();
    const dart = report.find(row => row.id === 'dart')!;
    const suzanne = report.find(row => row.id === 'suzanne' && row.metric === 'distance')!;
    const suzanneTime = report.find(row => row.id === 'suzanne' && row.metric === 'duration')!;
    const mach = report.find(row => row.id === 'mach5')!;
    const sky = report.find(row => row.id === 'skyking')!;
    const zero = report.find(row => row.id === 'zerofighter')!;

    expect(dart.result?.landed).toBe(true);
    expect(dart.settings).toEqual({angle: 0, speed: 20, wind: 0});
    expect(dart.result!.distance).toBeGreaterThan(10);
    expect(dart.result!.distance).toBeLessThan(20);

    // Suzanne: 69.14 m / ~9 s
    expect(suzanne.result?.landed).toBe(true);
    expect(suzanne.result!.distance).toBeGreaterThan(60);
    expect(suzanne.result!.distance).toBeLessThan(75);
    expect(suzanneTime.target).toBe(9);
    expect(suzanneTime.result?.duration).toBe(suzanne.result?.duration);
    expect(suzanneTime.result!.duration).toBeGreaterThan(7);
    expect(suzanneTime.result!.duration).toBeLessThan(11);

    // Mach 5: 88 m
    expect(mach.target).toBe(88);
    expect(mach.gsm).toBe(100);
    expect(mach.result?.landed).toBe(true);
    expect(mach.result!.distance).toBeGreaterThan(80);
    expect(mach.result!.distance).toBeLessThan(95);

    // Sky King: 27.9 s / 29.2 s
    expect(sky.target).toBe(27.9);
    expect(sky.result?.landed).toBe(true);
    expect(sky.result!.duration).toBeGreaterThan(25);
    expect(sky.result!.duration).toBeLessThan(33);

    // Zero Fighter(Phase 06 补齐几何):29.2 s 历史里程碑的校准区间
    expect(zero.target).toBe(29.2);
    expect(zero.result?.landed).toBe(true);
    expect(zero.result!.duration).toBeGreaterThan(25);
    expect(zero.result!.duration).toBeLessThan(33);
  });

  it('满足 M2 机型分化验收：40° 强投下 Mach 5 显著远于 Suzanne，轻投下 Sky King 滞空显著最长，且 A4 优于 US Letter', () => {
    const a4 = papers[0];
    const letter = papers[1];

    const suzanneSteep = simulate(extract(replay(a4, planes.suzanne.steps.length, planes.suzanne.steps), 100), {
      angle: 40,
      speed: 28,
      wind: 0,
    });
    const machSteep = simulate(extract(replay(a4, planes.mach5.steps.length, planes.mach5.steps), 100), {
      angle: 40,
      speed: 28,
      wind: 0,
    });
    expect(machSteep.distance).toBeGreaterThan(suzanneSteep.distance * 2);

    const gentleThrow = {angle: 20, speed: 8, wind: 0};
    const skyGentle = simulate(extract(replay(a4, planes.skyking.steps.length, planes.skyking.steps), 80), gentleThrow);
    const suzanneGentle = simulate(extract(replay(a4, planes.suzanne.steps.length, planes.suzanne.steps), 80), gentleThrow);
    const dartGentle = simulate(extract(replay(a4, planes.dart.steps.length, planes.dart.steps), 80), gentleThrow);
    const machGentle = simulate(extract(replay(a4, planes.mach5.steps.length, planes.mach5.steps), 80), gentleThrow);
    expect(skyGentle.duration).toBeGreaterThan(suzanneGentle.duration * 3);
    expect(skyGentle.duration).toBeGreaterThan(dartGentle.duration * 5);
    expect(skyGentle.duration).toBeGreaterThan(machGentle.duration * 5);

    // A4 vs US Letter comparison
    const suzanneA4 = simulate(extract(replay(a4, planes.suzanne.steps.length, planes.suzanne.steps), 100), {
      angle: 0,
      speed: 28,
      wind: 0,
    });
    const suzanneLetter = simulate(extract(replay(letter, planes.suzanne.steps.length, planes.suzanne.steps), 100), {
      angle: 0,
      speed: 28,
      wind: 0,
    });
    expect(suzanneA4.distance).toBeGreaterThan(suzanneLetter.distance);

    const machLetter = simulate(extract(replay(letter, planes.mach5.steps.length, planes.mach5.steps), 100), {
      angle: 40,
      speed: 28,
      wind: 0,
    });
    expect(machSteep.distance).toBeGreaterThan(machLetter.distance);
  });
});

it('参数扫描从实际飞行结果中选出最大距离和滞空', async () => {
  const {sweepLaunches} = await import('../src/aero/calibrate');
  const inputs = [
    {angle: 0, speed: 12, wind: 0},
    {angle: 20, speed: 15, wind: 0},
  ];
  const rows = sweepLaunches('dart', 80, 'empirical', inputs);
  expect(rows.distance.value).toBeGreaterThan(0);
  expect(rows.duration.value).toBeGreaterThan(0);
  expect(inputs).toContainEqual(rows.distance.input);
  expect(inputs).toContainEqual(rows.duration.input);
});

it('步长对照覆盖已有机型并跳过缺失几何', async () => {
  const {convergenceReport} = await import('../src/aero/calibrate');
  const rows = convergenceReport();
  expect(rows).toHaveLength(12);
  expect(new Set(rows.map(r => r.id))).toEqual(new Set(['dart', 'suzanne', 'mach5', 'skyking', 'zerofighter']));
  for (const row of rows) {
    expect(row.values).toHaveLength(3);
    expect(row.values.every(v => Number.isFinite(v))).toBe(true);
  }
});

it('步长敏感性扫描覆盖每种机型和纸张，并按误差排序', async () => {
  const {convergenceGrid} = await import('../src/aero/calibrate');
  const {planes} = await import('../src/fold/planes');
  const {papers} = await import('../src/paper/papers');
  const rows = convergenceGrid([{angle: 75, speed: 15, wind: 0}]);
  expect(rows).toHaveLength(Object.keys(planes).length * papers.length);
  expect(rows.every((row, i) => i === 0 || rows[i - 1].distanceDifference >= row.distanceDifference)).toBe(true);
  const dart = rows.find(row => row.id === 'dart' && row.paper === 'a4')!;
  expect(dart.distanceDifference).toBeCloseTo(Math.abs(dart.standard.distance - dart.reference.distance), 10);
});
