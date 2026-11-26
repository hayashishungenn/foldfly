import {describe, it, expect} from 'vitest';
import {
  careerChallenges,
  careerChallengeById,
  createCareerState,
  isChallengeUnlocked,
  isChallengeMet,
  completeChallenge,
  careerProgress,
  encodeCareer,
  decodeCareer,
  migrateCareer,
  CAREER_SAVE_VERSION,
} from '../src/game/career';
import {planes} from '../src/fold/planes';
import {replay} from '../src/fold/engine';
import {papers} from '../src/paper/papers';
import {extract} from '../src/aero/extract';
import {simulate} from '../src/aero/integrator';
import {materialProfile} from '../src/paper/material';

describe('单人生涯模式(Phase 08 纯逻辑)', () => {
  it('挑战链为数据且引用的机型/纸张真实存在', () => {
    expect(careerChallenges.length).toBeGreaterThanOrEqual(10);
    for (const c of careerChallenges) {
      expect(planes[c.plane], c.id).toBeDefined();
      expect(papers.some(p => p.id === c.paper), c.id).toBe(true);
      if (c.event === 'accuracy') {
        expect(c.targetLine, c.id).toBeDefined();
        expect(c.angle, '精准赛必须开放投掷参数:' + c.id).toBeUndefined();
      }
    }
  });

  it('顺序解锁:第一关始终解锁,后续关依前一关完成而解锁', () => {
    const state = createCareerState();
    expect(isChallengeUnlocked(state, careerChallenges[0].id)).toBe(true);
    expect(isChallengeUnlocked(state, careerChallenges[1].id)).toBe(false);
    const step1 = completeChallenge(state, careerChallenges[0], 100);
    expect(isChallengeUnlocked(step1, careerChallenges[1].id)).toBe(true);
    expect(isChallengeUnlocked(step1, careerChallenges[2].id)).toBe(false);
    // 未知关卡与越界关卡不解锁
    expect(isChallengeUnlocked(state, 'nope')).toBe(false);
  });

  it('达标判定按项目方向:距离/滞空为下限,精准为上限,未落地一律不达标', () => {
    const dist = careerChallengeById('dart-basics')!;
    expect(isChallengeMet(dist, true, dist.target)).toBe(true);
    expect(isChallengeMet(dist, true, dist.target - 0.1)).toBe(false);
    const acc = careerChallengeById('accuracy-warmup')!;
    expect(isChallengeMet(acc, true, acc.target)).toBe(true);
    expect(isChallengeMet(acc, true, acc.target + 0.1)).toBe(false);
    expect(isChallengeMet(acc, false, 0)).toBe(false);
  });

  it('完成关卡只保留更优成绩:距离/滞空取大,精准取小', () => {
    const dist = careerChallengeById('dart-basics')!;
    const s1 = completeChallenge(createCareerState(), dist, 11.2, '2026-11-26T00:00:00Z');
    expect(s1.completed['dart-basics']?.score).toBeCloseTo(11.2, 9);
    const s2 = completeChallenge(s1, dist, 10.5);
    expect(s2.completed['dart-basics']?.score).toBeCloseTo(11.2, 9);
    const s3 = completeChallenge(s2, dist, 12.3, '2026-11-26T01:00:00Z');
    expect(s3.completed['dart-basics']?.score).toBeCloseTo(12.3, 9);
    expect(s3.completed['dart-basics']?.finishedAt).toBe('2026-11-26T01:00:00Z');
    // 状态不可变
    expect(s1.completed['dart-basics']?.score).toBeCloseTo(11.2, 9);

    const acc = careerChallengeById('accuracy-warmup')!;
    const a1 = completeChallenge(createCareerState(), acc, 2.0);
    const a2 = completeChallenge(a1, acc, 1.0);
    const a3 = completeChallenge(a2, acc, 1.4);
    expect(a3.completed['accuracy-warmup']?.score).toBeCloseTo(1.0, 9);
  });

  it('进度统计与序列化往返、非法数据消毒、未知版本要求重置', () => {
    let state = createCareerState();
    state = completeChallenge(state, careerChallenges[0], 11.2);
    state = completeChallenge(state, careerChallenges[1], 10.4);
    expect(careerProgress(state)).toEqual({done: 2, total: careerChallenges.length});
    const decoded = decodeCareer(encodeCareer(state))!;
    expect(decoded).toEqual(state);
    // 消毒:未知关卡、非法分数被剔除
    const polluted = JSON.stringify({version: CAREER_SAVE_VERSION, completed: {nope: {score: 1}, 'dart-basics': {score: NaN}, ...state.completed}});
    const clean = decodeCareer(polluted)!;
    expect(Object.keys(clean.completed).sort()).toEqual(['dart-basics', 'dart-crosswind']);
    // 迁移:当前版本通过,损坏/异版本要求重置
    expect(migrateCareer(encodeCareer(state)).needsReset).toBe(false);
    expect(migrateCareer('garbage').needsReset).toBe(true);
    expect(migrateCareer(JSON.stringify({version: 99, completed: {}})).needsReset).toBe(true);
    expect(migrateCareer(null).state).toBeNull();
  });

  it('全部挑战目标在当前物理下可达(锁定参数挑战直接达标;禁止虚构目标)', () => {
    for (const c of careerChallenges) {
      if (c.event === 'accuracy') {
        // 精准关开放参数:验证靶线附近存在可达落点(用推荐机型的中速滑翔区间粗校)
        expect(c.targetLine!).toBeGreaterThanOrEqual(8);
        expect(c.targetLine!).toBeLessThanOrEqual(30);
        continue;
      }
      const a = extract(replay(papers.find(p => p.id === c.paper)!, planes[c.plane].steps.length, planes[c.plane].steps), c.gsm);
      const f = simulate(a, {angle: c.angle!, speed: c.speed!, wind: c.wind, crosswind: c.crosswind}, {
        material: materialProfile(c.grade ?? 'copy', c.gsm),
        windSeed: c.seed,
        foldQuality: 1,
      });
      expect(f.landed, c.id).toBe(true);
      const score = c.event === 'distance' ? f.distance : f.duration;
      expect(score, `${c.id} score=${score.toFixed(2)} target=${c.target}`).toBeGreaterThanOrEqual(c.target);
    }
  });
});
