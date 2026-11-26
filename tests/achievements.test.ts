import {describe, it, expect} from 'vitest';
import {achievements, evaluateAchievements, collectAchievementContext, type AchievementContext} from '../src/game/achievements';
import {createCareerState, completeChallenge, careerChallengeById, encodeCareer} from '../src/game/career';

const emptyCtx: AchievementContext = {ghosts: {}, competitionPbs: {}, career: null, hasDesign: false};
const ctx = (over: Partial<AchievementContext>): AchievementContext => ({...emptyCtx, ...over});

describe('成就系统(Phase 09 纯判定)', () => {
  it('成就定义为纯函数:同一上下文幂等,解锁集合稳定', () => {
    const c = ctx({ghosts: {dart: {distance: 90, duration: 30}}});
    const a = evaluateAchievements(c);
    const b = evaluateAchievements(c);
    expect(a).toEqual(b);
    expect(a['distance-88']).toBe(true);
    expect(a['duration-29']).toBe(true);
    expect(a['distance-50']).toBe(true);
    expect(a['first-flight']).toBe(true);
    expect(a['career-all']).toBe(false);
    // 空状态:除可空判定外全部未解锁
    const none = evaluateAchievements(emptyCtx);
    expect(Object.values(none).every(v => v === false)).toBe(true);
  });

  it('里程碑阈值与史实口径一致(69.14/88/20/29.2)', () => {
    const borderline = evaluateAchievements(ctx({ghosts: {suzanne: {distance: 69.14, duration: 29.2}}}));
    expect(borderline['distance-69']).toBe(true);
    expect(borderline['distance-88']).toBe(false);
    expect(borderline['duration-29']).toBe(true);
  });

  it('正式赛三项目全能与精准心判定', () => {
    const partial = evaluateAchievements(ctx({
      competitionPbs: {distance: {score: 20, playerName: '甲'}, duration: {score: 5, playerName: '甲'}},
    }));
    expect(partial['competition-all']).toBe(false);
    const full = evaluateAchievements(ctx({
      competitionPbs: {
        distance: {score: 20, playerName: '甲'},
        duration: {score: 5, playerName: '甲'},
        accuracy: {score: 2.5, playerName: '甲'},
      },
    }));
    expect(full['competition-all']).toBe(true);
    expect(full['accuracy-heart']).toBe(true);
    const wide = evaluateAchievements(ctx({competitionPbs: {accuracy: {score: 3.5, playerName: '甲'}}}));
    expect(wide['accuracy-heart']).toBe(false);
  });

  it('生涯进度判定与自由设计师判定', () => {
    let career = createCareerState();
    career = completeChallenge(career, careerChallengeById('dart-basics')!, 11);
    const one = evaluateAchievements(ctx({career}));
    expect(one['career-three']).toBe(false);
    for (const c of ['dart-crosswind', 'suzanne-glide'].map(id => careerChallengeById(id)!)) career = completeChallenge(career, c, 1);
    const three = evaluateAchievements(ctx({career}));
    expect(three['career-three']).toBe(true);
    // 设计师成就读 hasDesign 标志
    expect(evaluateAchievements(ctx({hasDesign: true}))['freestyle-designer']).toBe(true);
    expect(evaluateAchievements(emptyCtx)['freestyle-designer']).toBe(false);
  });

  it('collectAchievementContext 从注入键聚合(幽灵取最大、PB/生涯/设计)', () => {
    const store: Record<string, string> = {
      'foldfly-ghost-v4-dart-distance-sig-f5-a5': JSON.stringify({version: 4, mode: 'distance', flight: {samples: [], distance: 30, duration: 3, height: 2, landed: true}}),
      'foldfly-ghost-v4-dart-distance-sig-f6-a6': JSON.stringify({version: 4, mode: 'distance', flight: {samples: [], distance: 45, duration: 3.4, height: 2, landed: true}}),
      'foldfly-ghost-v4-suzanne-duration-sig-f7-a7': JSON.stringify({version: 4, mode: 'duration', flight: {samples: [], distance: 60, duration: 8.2, height: 2, landed: true}}),
      'foldfly-ghost-v4-broken-distance-sig-f8-a8': '{broken json',
      'foldfly.competition.pb.v1.accuracy': JSON.stringify({event: 'accuracy', score: 2.4, playerName: '选手', plane: 'dart', paper: 'a4', gsm: 80, seed: 1, modelVersion: 5, recordedAt: ''}),
      'foldfly-career-v1': encodeCareer(completeChallenge(createCareerState(), careerChallengeById('dart-basics')!, 11)),
      'foldfly-design-v1': '{"version":1}',
    };
    const read = (key: string) => store[key] ?? null;
    const ctx2 = collectAchievementContext(read, Object.keys(store));
    expect(ctx2.ghosts.dart?.distance).toBe(45); // 同机型取最大
    expect(ctx2.ghosts.suzanne?.duration).toBeCloseTo(8.2, 6);
    expect(ctx2.competitionPbs.accuracy?.score).toBeCloseTo(2.4, 6);
    expect(ctx2.career?.completed['dart-basics']).toBeDefined();
    expect(ctx2.hasDesign).toBe(true);
    // 损坏条目被跳过,不抛错
    expect(ctx2.ghosts['broken' as keyof typeof ctx2.ghosts]).toBeUndefined();
    // 聚合后即可判定
    expect(evaluateAchievements(ctx2)['first-flight']).toBe(true);
    expect(evaluateAchievements(ctx2)['career-three']).toBe(false);
  });
});
