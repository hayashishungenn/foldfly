import {describe, it, expect} from 'vitest';
import {accuracyTargetFromSeed, accuracyMiss, ACCURACY_TARGET_MIN, ACCURACY_TARGET_MAX} from '../src/game/accuracy';
import {
  computeStandings,
  createCompetitionMatch,
  currentTurn,
  decodeCompetitionPb,
  encodeCompetitionPb,
  evaluateThrow,
  isLowerBetter,
  recordCompetitionThrow,
} from '../src/game/competition';
import {FLIGHT_MODEL_VERSION} from '../src/aero/integrator';

describe('精准着陆赛(Phase 07 纯逻辑)', () => {
  it('靶线距离由种子确定性生成,落在 [8, 22] m 的 0.5 m 步进', () => {
    const t1 = accuracyTargetFromSeed(20261126);
    const t2 = accuracyTargetFromSeed(20261126);
    expect(t1).toBe(t2);
    expect(t1).toBeGreaterThanOrEqual(ACCURACY_TARGET_MIN);
    expect(t1).toBeLessThanOrEqual(ACCURACY_TARGET_MAX);
    expect(t1 * 2).toBe(Math.round(t1 * 2)); // 0.5 m 步进
    const targets = new Set([11, 42, 99, 12345, 777].map(accuracyTargetFromSeed));
    expect(targets.size).toBeGreaterThan(1);
  });

  it('偏差 = |落点顺风坐标 − 靶线|,侧向漂移不改变垂直偏差', () => {
    expect(accuracyMiss(15, 0, 15)).toBe(0);
    expect(accuracyMiss(17, 0, 15)).toBeCloseTo(2, 10);
    expect(accuracyMiss(13, 0, 15)).toBeCloseTo(2, 10);
    // 漂移只改变落点侧向位置:总距离 15、漂移 3 → 顺风坐标 √(15²−3²)≈14.70
    expect(accuracyMiss(15, 3, 15)).toBeCloseTo(15 - Math.sqrt(15 ** 2 - 3 ** 2), 8);
    expect(accuracyMiss(17, 4, 15)).toBeCloseTo(Math.sqrt(17 ** 2 - 4 ** 2) - 15, 8);
    // 由距离与漂移恢复顺风坐标:√(17²−8²)=15(浮点容差)
    expect(accuracyMiss(Math.hypot(15, 8), 8, 15)).toBeCloseTo(0, 8);
    // 退化:漂移超过总距离时顺风坐标取 0
    expect(accuracyMiss(3, 5, 15)).toBe(15);
  });

  it('evaluateThrow 精准赛:落地即有效、成绩为距靶偏差、缺靶线抛错', () => {
    const res = evaluateThrow('accuracy', {distance: 17, duration: 2, height: 3, landed: true, drift: 0}, 15);
    expect(res.valid).toBe(true);
    expect(res.score).toBeCloseTo(2, 10);
    expect(() => evaluateThrow('accuracy', {distance: 17, duration: 2, height: 3, landed: true}, undefined)).toThrow();
    const unlanded = evaluateThrow('accuracy', {distance: 15, duration: 60, height: 3, landed: false}, 15);
    expect(unlanded.valid).toBe(false);
  });

  it('精准赛排名低分优:距靶更近者排前,并列同名次', () => {
    expect(isLowerBetter('accuracy')).toBe(true);
    expect(isLowerBetter('distance')).toBe(false);
    let match = createCompetitionMatch({
      event: 'accuracy',
      paper: 'a4',
      gsm: 80,
      seed: 8,
      players: [
        {id: 'near', name: '近靶选手', plane: 'dart'},
        {id: 'far', name: '远靶选手', plane: 'dart'},
        {id: 'tie', name: '并列选手', plane: 'dart'},
      ],
    });
    const target = match.accuracyTarget!;
    // 落点 = 靶线 ± 偏差
    const throwAt = (downrange: number) => {
      const turn = currentTurn(match)!;
      const flight = {distance: downrange, duration: 2, height: 2, landed: true, drift: 0};
      match = recordCompetitionThrow(match, {angle: 20, speed: 15, wind: turn.wind}, flight).match;
    };
    throwAt(target + 0.5); // near:0.5
    throwAt(target + 2.0); // far:2.0
    throwAt(target - 0.5); // tie:0.5(与 near 并列)
    const standings = computeStandings(match);
    expect(standings[0].player.id).toBe('near');
    expect(standings[1].player.id).toBe('tie');
    expect(standings[0].rank).toBe(1);
    expect(standings[1].tied).toBe(true);
    expect(standings[1].rank).toBe(1);
    expect(standings[2].player.id).toBe('far');
    expect(standings[2].rank).toBe(3);
    expect(standings[2].bestScore).toBeCloseTo(2.0, 6);
  });

  it('精准赛个人最佳存档按低分优刷新,旧方向存档不会被错误覆盖', () => {
    const pb = {
      event: 'accuracy' as const,
      score: 1.2,
      playerName: '老纪录',
      plane: 'dart' as const,
      paper: 'a4' as const,
      gsm: 80 as const,
      seed: 5,
      modelVersion: FLIGHT_MODEL_VERSION,
      recordedAt: '2026-11-26T00:00:00Z',
    };
    expect(decodeCompetitionPb(encodeCompetitionPb(pb), 'accuracy')?.score).toBeCloseTo(1.2, 6);
    expect(decodeCompetitionPb(encodeCompetitionPb(pb), 'distance')).toBeNull();
  });
});
