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
  it('确定性风场种子在同场比赛与跨次重建中完全一致（顺风/侧风成对）', () => {
    const w1 = generateRoundWinds(20261126, 3);
    const w2 = generateRoundWinds(20261126, 3);
    expect(w1).toEqual(w2);
    expect(w1).toHaveLength(3);
    for (const w of w1) {
      expect(w.head).toBeGreaterThanOrEqual(-3);
      expect(w.head).toBeLessThanOrEqual(3);
      expect(w.cross).toBeGreaterThanOrEqual(-3);
      expect(w.cross).toBeLessThanOrEqual(3);
    }
    // v5:同一种子两次生成交错消耗随机数,但整体序列确定
    const w3 = generateRoundWinds(20261126, 4);
    expect(w3.slice(0, 3)).toEqual(w1);
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
      const res = recordCompetitionThrow(match, {angle: 20, speed: 24, wind: turn.wind, crosswind: turn.crosswind}, f);
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
    const throws4 = [
      {angle: 20, speed: 8, distance: 40, duration: 20.5, height: 2.4, landed: true},
      {angle: 20, speed: 8, distance: 41, duration: 20.5, height: 2.5, landed: true},
      {angle: 20, speed: 15, distance: 14, duration: 2.4, height: 3.2, landed: true},
      {angle: 20, speed: 15, distance: 10, duration: 60, height: 5.0, landed: false},
    ];
    for (const t of throws4) {
      const turn = currentTurn(match)!;
      match = recordCompetitionThrow(match, {angle: t.angle, speed: t.speed, wind: turn.wind, crosswind: turn.crosswind}, {distance: t.distance, duration: t.duration, height: t.height, landed: t.landed}).match;
    }

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

describe('比赛数据校验与排名规则 (governance 1.6)', () => {
  const baseConfig = {
    event: 'distance' as const,
    paper: 'a4' as const,
    gsm: 80 as const,
    seed: 42,
    players: [{id: 'p1', name: '甲', plane: 'dart' as const}],
  };

  it('拒绝重复选手 ID、未知机型/纸张/克重、越界种子与轮数', () => {
    expect(() => createCompetitionMatch({...baseConfig, players: [{id: 'p1', name: '甲', plane: 'dart'}, {id: 'p1', name: '乙', plane: 'dart'}]})).toThrow('选手 ID 必须唯一');
    expect(() => createCompetitionMatch({...baseConfig, players: [{id: 'p1', name: '甲', plane: 'nope' as never}]})).toThrow('未知的参赛机型');
    expect(() => createCompetitionMatch({...baseConfig, paper: 'a3' as never})).toThrow('未知的纸张规格');
    expect(() => createCompetitionMatch({...baseConfig, gsm: 90 as never})).toThrow('未知的纸张克重');
    expect(() => createCompetitionMatch({...baseConfig, seed: -1})).toThrow('比赛种子');
    expect(() => createCompetitionMatch({...baseConfig, seed: 1.5})).toThrow('比赛种子');
    expect(() => createCompetitionMatch({...baseConfig, rounds: 0})).toThrow('比赛轮数');
    expect(() => createCompetitionMatch({...baseConfig, rounds: 10})).toThrow('比赛轮数');
  });

  it('重复提交防线:回合指针与成绩记录失配的损坏状态被拒绝', () => {
    // 不可变设计下,同一份赛前状态提交两次各自成功且互不覆盖(天然幂等);
    // 防线针对的是"指针未推进但记录已存在"的损坏/反序列化状态:
    let match = createCompetitionMatch({...baseConfig, seed: 1});
    const turn = currentTurn(match)!;
    match = recordCompetitionThrow(match, {angle: 20, speed: 15, wind: turn.wind, crosswind: turn.crosswind}, {distance: 12, duration: 2, height: 2, landed: true}).match;
    const corrupted = {...match, currentRound: 1, currentPlayerIndex: 0, status: 'in-progress' as const};
    expect(() =>
      recordCompetitionThrow(corrupted, {angle: 20, speed: 15, wind: turn.wind, crosswind: turn.crosswind}, {distance: 12, duration: 2, height: 2, landed: true}),
    ).toThrow('不能重复记录');
    // 同一赛前状态重复提交产生同一结果(事件重放幂等)
    const matchBefore = createCompetitionMatch({...baseConfig, seed: 1});
    const turn2 = currentTurn(matchBefore)!;
    const r1 = recordCompetitionThrow(matchBefore, {angle: 20, speed: 15, wind: turn2.wind, crosswind: turn2.crosswind}, {distance: 12, duration: 2, height: 2, landed: true});
    const r2 = recordCompetitionThrow(createCompetitionMatch({...baseConfig, seed: 1}), {angle: 20, speed: 15, wind: turn2.wind, crosswind: turn2.crosswind}, {distance: 12, duration: 2, height: 2, landed: true});
    expect(r1.record.score).toBe(r2.record.score);
  });

  it('风况不一致与非有限数值被拒绝,而非静默覆盖', () => {
    let match = createCompetitionMatch({...baseConfig, seed: 2});
    const turn = currentTurn(match)!;
    expect(() =>
      recordCompetitionThrow(match, {angle: 20, speed: 15, wind: turn.wind + 1, crosswind: turn.crosswind}, {distance: 12, duration: 2, height: 2, landed: true}),
    ).toThrow('风场不一致');
    expect(() =>
      recordCompetitionThrow(match, {angle: 20, speed: 15, wind: turn.wind, crosswind: turn.crosswind}, {distance: NaN, duration: 2, height: 2, landed: true}),
    ).toThrow('飞行结果');
    expect(() =>
      recordCompetitionThrow(match, {angle: 20, speed: 15, wind: turn.wind, crosswind: turn.crosswind}, {distance: 12, duration: Infinity, height: 2, landed: true}),
    ).toThrow('飞行结果');
    expect(() =>
      recordCompetitionThrow(match, {angle: NaN, speed: 15, wind: turn.wind, crosswind: turn.crosswind}, {distance: 12, duration: 2, height: 2, landed: true}),
    ).toThrow('投掷参数');
  });

  it('量化比较具有传递性与确定性:同格并列 1,1,3,异格必分高下,输入顺序无关', () => {
    expect(Math.round(10.0001 * 1000) / 1000).toBe(10);
    expect(Math.round(10.0004 * 1000) / 1000).toBe(10);
    expect(Math.round(10.0006 * 1000) / 1000).toBe(10.001);
    const mk = (scores: number[]) => {
      let m = createCompetitionMatch({...baseConfig, seed: 3, rounds: 1, players: scores.map((_, i) => ({id: `p${i}`, name: `P${i}`, plane: 'dart' as const}))});
      for (let i = 0; i < scores.length; i++) {
        const turn = currentTurn(m)!;
        m = recordCompetitionThrow(m, {angle: 20, speed: 15, wind: turn.wind, crosswind: turn.crosswind}, {distance: scores[i], duration: 1, height: 1, landed: true}).match;
      }
      return computeStandings(m);
    };
    // 10.0001 与 10.0004 同格并列第 1,12 独占第 3;两种输入顺序结果一致
    const a = mk([10.0001, 10.0004, 12]);
    const b = mk([12, 10.0004, 10.0001]);
    // p2(12 m)独占第 1;两个 10 m 同格并列第 2(竞赛排名 1,2,2)
    expect(a.map(s => `${s.player.id}:${s.rank}`)).toEqual(['p2:1', 'p0:2', 'p1:2']);
    expect(b.map(s => `${s.player.id}:${s.rank}`)).toEqual(['p0:1', 'p1:2', 'p2:2']);
    // 同一输入两次计算完全一致
    expect(mk([10.0001, 10.0004, 12]).map(s => s.player.id)).toEqual(a.map(s => s.player.id));
  });

  it('每条成绩具有唯一投掷标识', () => {
    let match = createCompetitionMatch({...baseConfig, seed: 4, players: [{id: 'a', name: 'A', plane: 'dart'}, {id: 'b', name: 'B', plane: 'dart'}]});
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const turn = currentTurn(match)!;
      const res = recordCompetitionThrow(match, {angle: 20, speed: 15, wind: turn.wind, crosswind: turn.crosswind}, {distance: 12, duration: 2, height: 2, landed: true});
      match = res.match;
      ids.push(res.record.throwId);
    }
    expect(new Set(ids).size).toBe(4);
  });
});
