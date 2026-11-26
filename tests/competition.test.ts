import {describe, it, expect} from 'vitest';
import {
  abortCompetitionMatch,
  computeStandings,
  createCompetitionMatch,
  currentTurn,
  decodeCompetitionPb,
  encodeCompetitionPb,
  evaluateThrow,
  generateRoundWinds,
  recordCompetitionThrow,
} from '../src/game/competition';
import {FLIGHT_MODEL_VERSION} from '../src/aero/integrator';

describe('正式飞行比赛系统 (competition)', () => {
  it('确定性风场种子在同场比赛与跨次重建中完全一致', () => {
    const w1 = generateRoundWinds(20261126, 3);
    const w2 = generateRoundWinds(20261126, 3);
    expect(w1).toEqual(w2);
    expect(w1).toHaveLength(3);
    for (const w of w1) {
      expect(w).toBeGreaterThanOrEqual(-3);
      expect(w).toBeLessThanOrEqual(3);
    }
  });

  it('2人3回合距离赛完整流转：锁定环境、轮流投掷、取最佳有效成绩并正确排名', () => {
    let match = createCompetitionMatch({
      event: 'distance',
      paper: 'a4',
      gsm: 100,
      seed: 42,
      players: [
        {id: 'p1', name: '甲选手', plane: 'suzanne'},
        {id: 'p2', name: '乙选手', plane: 'mach5'},
      ],
    });
    expect(match.locked).toBe(true);
    expect(match.status).toBe('in-progress');

    const throws = [
      // Round 1: p1 = 55m, p2 = 62m
      {distance: 55, duration: 6.2, height: 3.1, landed: true},
      {distance: 62, duration: 8.1, height: 9.2, landed: true},
      // Round 2: p1 = unlanded (invalid), p2 = 88.1m
      {distance: 99, duration: 60, height: 5.0, landed: false},
      {distance: 88.1, duration: 12.1, height: 13.4, landed: true},
      // Round 3: p1 = 68.3m, p2 = -1m (behind line, invalid)
      {distance: 68.3, duration: 7.9, height: 2.1, landed: true},
      {distance: -1, duration: 0.4, height: 1.5, landed: true},
    ];

    for (const f of throws) {
      const turn = currentTurn(match)!;
      expect(turn).not.toBeNull();
      const res = recordCompetitionThrow(match, {angle: 20, speed: 24, wind: turn.wind}, f);
      match = res.match;
      expect(res.record.modelVersion).toBe(FLIGHT_MODEL_VERSION);
    }

    expect(match.status).toBe('finished');
    expect(currentTurn(match)).toBeNull();
    expect(match.records).toHaveLength(6);
    expect(match.records[2].valid).toBe(false);
    expect(match.records[5].valid).toBe(false);

    const standings = computeStandings(match);
    expect(standings[0].player.id).toBe('p2');
    expect(standings[0].rank).toBe(1);
    expect(standings[0].bestScore).toBeCloseTo(88.1, 3);
    expect(standings[1].player.id).toBe('p1');
    expect(standings[1].rank).toBe(2);
    expect(standings[1].bestScore).toBeCloseTo(68.3, 3);
  });

  it('并列成绩与全无效成绩按竞赛规则正确处理（1, 1, 3 与无有效成绩排末位）', () => {
    let match = createCompetitionMatch({
      event: 'duration',
      paper: 'a4',
      gsm: 80,
      seed: 99,
      rounds: 1,
      players: [
        {id: 'a', name: 'A', plane: 'skyking'},
        {id: 'b', name: 'B', plane: 'skyking'},
        {id: 'c', name: 'C', plane: 'dart'},
        {id: 'd', name: 'D', plane: 'dart'},
      ],
    });
    match = recordCompetitionThrow(match, {angle: 20, speed: 8, wind: 0}, {distance: 40, duration: 20.5, height: 2.4, landed: true}).match;
    match = recordCompetitionThrow(match, {angle: 20, speed: 8, wind: 0}, {distance: 41, duration: 20.5, height: 2.5, landed: true}).match;
    match = recordCompetitionThrow(match, {angle: 20, speed: 15, wind: 0}, {distance: 14, duration: 2.4, height: 3.2, landed: true}).match;
    match = recordCompetitionThrow(match, {angle: 20, speed: 15, wind: 0}, {distance: 10, duration: 60, height: 5.0, landed: false}).match;

    const standings = computeStandings(match);
    expect(standings[0].rank).toBe(1);
    expect(standings[0].tied).toBe(true);
    expect(standings[1].rank).toBe(1);
    expect(standings[1].tied).toBe(true);
    expect(standings[2].rank).toBe(3);
    expect(standings[2].player.id).toBe('c');
    expect(standings[3].rank).toBe(4);
    expect(standings[3].bestScore).toBeNull();
  });

  it('中途退出比赛与本地最佳成绩版本兼容性校验', () => {
    const match = createCompetitionMatch({
      event: 'distance',
      paper: 'a4',
      gsm: 80,
      seed: 7,
      players: [{id: 'p1', name: '单人', plane: 'dart'}],
    });
    const aborted = abortCompetitionMatch(match);
    expect(aborted.status).toBe('aborted');
    expect(currentTurn(aborted)).toBeNull();

    const evalUnlanded = evaluateThrow('distance', {distance: 50, duration: 60, height: 3, landed: false});
    expect(evalUnlanded.valid).toBe(false);

    const pbRaw = encodeCompetitionPb({
      event: 'distance',
      score: 88.08,
      playerName: '选手 1',
      plane: 'mach5',
      paper: 'a4',
      gsm: 100,
      seed: 123,
      modelVersion: FLIGHT_MODEL_VERSION,
      recordedAt: '2026-11-26T12:00:00Z',
    });
    expect(decodeCompetitionPb(pbRaw, 'distance')?.score).toBeCloseTo(88.08, 4);
    expect(decodeCompetitionPb(pbRaw, 'duration')).toBeNull();

    const wrongVersion = JSON.stringify({...JSON.parse(pbRaw), modelVersion: FLIGHT_MODEL_VERSION + 99});
    expect(decodeCompetitionPb(wrongVersion, 'distance')).toBeNull();
  });
});

describe('同场锁定纸张材质 (grade)', () => {
  it('比赛配置接受材质并在匹配对象上保持,非法材质抛错', () => {
    const match = createCompetitionMatch({
      event: 'distance',
      paper: 'a4',
      gsm: 100,
      grade: 'laser',
      seed: 5,
      players: [{id: 'p1', name: '单人', plane: 'mach5'}],
    });
    expect(match.grade).toBe('laser');
    expect(() =>
      createCompetitionMatch({
        event: 'distance',
        paper: 'a4',
        gsm: 100,
        grade: 'steel' as never,
        seed: 5,
        players: [{id: 'p1', name: '单人', plane: 'mach5'}],
      }),
    ).toThrow();
    // 缺省材质(旧调用方式)不写字段,行为兼容
    const legacy = createCompetitionMatch({
      event: 'duration',
      paper: 'a4',
      gsm: 80,
      seed: 5,
      players: [{id: 'p1', name: '单人', plane: 'skyking'}],
    });
    expect(legacy.grade).toBeUndefined();
  });

  it('个人最佳成绩保存材质,旧存档缺省材质仍可读取,非法材质拒绝', () => {
    const pb = {
      event: 'distance' as const,
      score: 88.08,
      playerName: '选手 1',
      plane: 'mach5' as const,
      paper: 'a4' as const,
      gsm: 100 as const,
      grade: 'coated' as const,
      seed: 123,
      modelVersion: FLIGHT_MODEL_VERSION,
      recordedAt: '2026-11-26T12:00:00Z',
    };
    expect(decodeCompetitionPb(encodeCompetitionPb(pb), 'distance')?.grade).toBe('coated');
    const legacyRaw = JSON.stringify({...pb, grade: undefined});
    expect(decodeCompetitionPb(legacyRaw, 'distance')?.grade).toBeUndefined();
    const invalidRaw = JSON.stringify({...pb, grade: 'titanium'});
    expect(decodeCompetitionPb(invalidRaw, 'distance')).toBeNull();
  });
});
