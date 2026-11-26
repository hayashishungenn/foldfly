import {FLIGHT_MODEL_VERSION, type Flight, type Throw} from '../aero/integrator';
import type {PlaneId} from '../fold/planes';
import {papers, weights, type Paper} from '../paper/papers';
import {isPaperGradeId, type PaperGradeId} from '../paper/material';
import {accuracyMiss, accuracyTargetFromSeed} from './accuracy';
import {planes} from '../fold/planes';

export type CompetitionEvent = 'distance' | 'duration' | 'accuracy';
export type CompetitionStatus = 'setup' | 'in-progress' | 'finished' | 'aborted';

export type CompetitionPlayer = {
  id: string;
  name: string;
  plane: PlaneId;
};

export type ThrowRecord = {
  /** 唯一投掷标识:matchId-round-playerId-序号;成绩提交以此保证幂等。 */
  throwId: string;
  round: number;
  playerId: string;
  plane: PlaneId;
  launch: Throw;
  distance: number;
  duration: number;
  height: number;
  landed: boolean;
  valid: boolean;
  invalidReason?: string;
  score: number | null;
  modelVersion: number;
};

export type PlayerStanding = {
  player: CompetitionPlayer;
  rank: number;
  tied: boolean;
  bestScore: number | null;
  sortedValidScores: number[];
  throws: ThrowRecord[];
  bestThrow: ThrowRecord | null;
};

export type CompetitionMatch = {
  id: string;
  event: CompetitionEvent;
  paper: Paper['id'];
  gsm: (typeof weights)[number];
  /** 同场锁定的纸张材质;缺省为普通复印纸(旧存档兼容)。 */
  grade?: PaperGradeId;
  /** 精准赛靶线距离(m);非精准赛为 undefined。由种子确定性生成,同场同靶。 */
  accuracyTarget?: number;
  seed: number;
  rounds: number;
  roundWinds: RoundWind[];
  players: CompetitionPlayer[];
  status: CompetitionStatus;
  locked: boolean;
  currentRound: number; // 1..rounds
  currentPlayerIndex: number; // 0..players.length-1
  records: ThrowRecord[];
  modelVersion: number;
};

export type CompetitionPersonalBest = {
  event: CompetitionEvent;
  score: number;
  playerName: string;
  plane: PlaneId;
  paper: Paper['id'];
  gsm: (typeof weights)[number];
  grade?: PaperGradeId;
  seed: number;
  modelVersion: number;
  recordedAt: string;
};

// 确定性风场与随机源已迁至叶子模块 winds.ts(打断 accuracy↔competition 循环导入);
// 此处仅向后兼容地再导出。
export {seededRandom, generateRoundWinds} from './winds';
export type {RoundWind} from './winds';
import {generateRoundWinds, type RoundWind} from './winds';

export function createCompetitionMatch(config: {
  event: CompetitionEvent;
  paper: Paper['id'];
  gsm: (typeof weights)[number];
  grade?: PaperGradeId;
  seed: number;
  players: CompetitionPlayer[];
  rounds?: number;
}): CompetitionMatch {
  const rounds = config.rounds ?? 3;
  if (config.players.length < 1 || config.players.length > 4) {
    throw new Error('比赛人数必须在 1 到 4 人之间');
  }
  if (config.grade !== undefined && !isPaperGradeId(config.grade)) {
    throw new Error(`未知的纸张材质:${String(config.grade)}`);
  }
  if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff) {
    throw new Error('比赛种子必须是 0–4294967295 内的整数');
  }
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 9) {
    throw new Error('比赛轮数必须是 1–9 的整数');
  }
  if (!papers.some(p => p.id === config.paper)) {
    throw new Error(`未知的纸张规格:${String(config.paper)}`);
  }
  if (!weights.some(w => w === config.gsm)) {
    throw new Error(`未知的纸张克重:${String(config.gsm)}`);
  }
  const playerIds = config.players.map(p => p.id || `p${config.players.indexOf(p) + 1}`);
  if (new Set(playerIds).size !== playerIds.length) {
    throw new Error('选手 ID 必须唯一');
  }
  for (const player of config.players) {
    if (!Object.hasOwn(planes, player.plane)) {
      throw new Error(`未知的参赛机型:${String(player.plane)}`);
    }
  }
  const players = config.players.map((p, idx) => ({
    id: p.id || `p${idx + 1}`,
    name: p.name.trim() || `选手 ${idx + 1}`,
    plane: p.plane,
  }));
  return {
    id: `match-${config.seed}-${config.event}`,
    event: config.event,
    paper: config.paper,
    gsm: config.gsm,
    ...(config.grade !== undefined ? {grade: config.grade} : {}),
    ...(config.event === 'accuracy' ? {accuracyTarget: accuracyTargetFromSeed(config.seed)} : {}),
    seed: config.seed >>> 0,
    rounds,
    roundWinds: generateRoundWinds(config.seed, rounds),
    players,
    status: 'in-progress',
    locked: true,
    currentRound: 1,
    currentPlayerIndex: 0,
    records: [],
    modelVersion: FLIGHT_MODEL_VERSION,
  };
}

/** Current turn info (active player, round, deterministic round wind). */
export function currentTurn(match: CompetitionMatch): {
  player: CompetitionPlayer;
  playerIndex: number;
  round: number;
  wind: number;
  crosswind: number;
} | null {
  if (match.status !== 'in-progress') return null;
  const player = match.players[match.currentPlayerIndex];
  if (!player) return null;
  const roundWind = match.roundWinds[match.currentRound - 1] ?? {head: 0, cross: 0};
  return {
    player,
    playerIndex: match.currentPlayerIndex,
    round: match.currentRound,
    wind: roundWind.head,
    crosswind: roundWind.cross,
  };
}

/** Evaluate whether a simulated flight counts as a valid official throw. */
export function evaluateThrow(
  event: CompetitionEvent,
  flight: Pick<Flight, 'distance' | 'duration' | 'height' | 'landed' | 'drift'>,
  accuracyTarget?: number,
): {valid: boolean; score: number | null; invalidReason?: string} {
  if (!flight.landed) {
    return {valid: false, score: null, invalidReason: '超过模拟时限未落地（无效）'};
  }
  if (event === 'distance') {
    if (!Number.isFinite(flight.distance) || flight.distance <= 0) {
      return {valid: false, score: null, invalidReason: '落点未越过起飞线（无效）'};
    }
    return {valid: true, score: flight.distance};
  }
  if (event === 'accuracy') {
    if (!Number.isFinite(accuracyTarget)) {
      throw new Error('精准赛缺少靶线距离');
    }
    const miss = accuracyMiss(flight.distance, flight.drift, accuracyTarget!);
    return {valid: true, score: miss};
  }
  if (!Number.isFinite(flight.duration) || flight.duration <= 0) {
    return {valid: false, score: null, invalidReason: '滞空时间无效'};
  }
  return {valid: true, score: flight.duration};
}

/** 精准赛低分优;其余项目高分优。 */
export function isLowerBetter(event: CompetitionEvent): boolean {
  return event === 'accuracy';
}

/** Commit the active player's throw and advance the turn/round state immutably. */
export function recordCompetitionThrow(
  match: CompetitionMatch,
  launch: Throw,
  flight: Pick<Flight, 'distance' | 'duration' | 'height' | 'landed' | 'drift'>,
): {match: CompetitionMatch; record: ThrowRecord} {
  const turn = currentTurn(match);
  if (!turn) {
    throw new Error('当前比赛未在进行中，无法记录成绩');
  }
  if (match.modelVersion !== FLIGHT_MODEL_VERSION) {
    throw new Error(`比赛记录于其他物理模型版本(v${match.modelVersion}),不能以 v${FLIGHT_MODEL_VERSION} 提交`);
  }
  // 同一选手同一轮不得重复提交(幂等防线,与 UI 层标志互相独立)
  if (match.records.some(r => r.playerId === turn.player.id && r.round === turn.round)) {
    throw new Error('该选手本轮成绩已提交,不能重复记录');
  }
  // 记录的风况必须来自实际参与运算的投掷配置;不一致时拒绝而非静默覆盖
  if (launch.wind !== turn.wind || launch.crosswind !== turn.crosswind) {
    throw new Error('投掷配置风况与当轮锁定风场不一致');
  }
  for (const [key, value] of Object.entries({angle: launch.angle, speed: launch.speed, wind: launch.wind, crosswind: launch.crosswind ?? 0})) {
    if (!Number.isFinite(value)) throw new Error(`投掷参数 ${key} 必须为有限数`);
  }
  for (const [key, value] of Object.entries({distance: flight.distance, duration: flight.duration, height: flight.height})) {
    if (!Number.isFinite(value)) throw new Error(`飞行结果 ${key} 必须为有限数`);
  }
  const evalRes = evaluateThrow(match.event, flight, match.accuracyTarget);
  const record: ThrowRecord = {
    throwId: `${match.id}-r${turn.round}-${turn.player.id}-${match.records.filter(r => r.playerId === turn.player.id).length + 1}`,
    round: turn.round,
    playerId: turn.player.id,
    plane: turn.player.plane,
    launch: {...launch, wind: turn.wind, crosswind: turn.crosswind},
    distance: flight.distance,
    duration: flight.duration,
    height: flight.height,
    landed: flight.landed,
    valid: evalRes.valid,
    invalidReason: evalRes.invalidReason,
    score: evalRes.score,
    modelVersion: FLIGHT_MODEL_VERSION,
  };

  const nextRecords = [...match.records, record];
  const nextPlayerIndex = match.currentPlayerIndex + 1;
  const wrappedRound = nextPlayerIndex >= match.players.length;
  const nextRound = wrappedRound ? match.currentRound + 1 : match.currentRound;
  const finished = nextRound > match.rounds;

  return {
    record,
    match: {
      ...match,
      records: nextRecords,
      currentPlayerIndex: finished ? match.players.length - 1 : wrappedRound ? 0 : nextPlayerIndex,
      currentRound: finished ? match.rounds : nextRound,
      status: finished ? 'finished' : 'in-progress',
    },
  };
}

/** Abort an in-progress match cleanly. */
export function abortCompetitionMatch(match: CompetitionMatch): CompetitionMatch {
  if (match.status === 'finished') return match;
  return {...match, status: 'aborted'};
}

/**
 * 成绩统一量化到 1e-3 网格后再比较:同格视为相等,保证排序的确定性与
 * 传递性(治理 1.6;旧的浮点容差比较在 a≈b≈c 时不可传递)。
 */
function quantizeScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function compareScoreArrays(a: readonly number[], b: readonly number[]): number {
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    const va = a[i] === undefined ? -1 : quantizeScore(a[i]);
    const vb = b[i] === undefined ? -1 : quantizeScore(b[i]);
    if (va !== vb) {
      return vb - va; // higher is better (quantized grid)
    }
  }
  return 0;
}

/**
 * Compute competition standings:
 * - Best valid score across 3 rounds determines rank;
 * - Ties break by 2nd-best then 3rd-best valid score;
 * - Exact ties share the same rank (standard 1, 1, 3 competition ranking);
 * - Players with zero valid throws rank last.
 */
export function computeStandings(match: CompetitionMatch): PlayerStanding[] {
  const raw = match.players.map(player => {
    const throws = match.records.filter(r => r.playerId === player.id);
    const validThrows = throws.filter(r => r.valid && r.score !== null);
    const sortedValid = [...validThrows].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const bestThrow = sortedValid[0] ?? null;
    return {
      player,
      bestScore: bestThrow?.score ?? null,
      sortedValidScores: sortedValid.map(t => t.score!),
      throws,
      bestThrow,
    };
  });

  raw.sort((a, b) => {
    if (a.bestScore === null && b.bestScore === null) return 0;
    if (a.bestScore === null) return 1;
    if (b.bestScore === null) return -1;
    const cmp = compareScoreArrays(a.sortedValidScores, b.sortedValidScores);
    return isLowerBetter(match.event) ? -cmp : cmp;
  });

  const standings: PlayerStanding[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    const prev = standings[i - 1];
    const sameAsPrev =
      prev !== undefined &&
      ((item.bestScore === null && prev.bestScore === null) ||
        (item.bestScore !== null &&
          prev.bestScore !== null &&
          compareScoreArrays(item.sortedValidScores, prev.sortedValidScores) === 0));
    const rank = sameAsPrev ? prev.rank : i + 1;
    standings.push({
      ...item,
      rank,
      tied: sameAsPrev,
    });
    if (sameAsPrev && prev) {
      prev.tied = true;
    }
  }
  return standings;
}

export function competitionPbKey(event: CompetitionEvent): string {
  return `foldfly.competition.pb.v1.${event}`;
}

export function encodeCompetitionPb(pb: CompetitionPersonalBest): string {
  return JSON.stringify(pb);
}

export function decodeCompetitionPb(raw: string | null, event: CompetitionEvent): CompetitionPersonalBest | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CompetitionPersonalBest>;
    if (
      parsed.event !== event ||
      typeof parsed.score !== 'number' ||
      !Number.isFinite(parsed.score) ||
      parsed.score <= 0 ||
      parsed.modelVersion !== FLIGHT_MODEL_VERSION ||
      typeof parsed.plane !== 'string' ||
      typeof parsed.playerName !== 'string'
    ) {
      return null;
    }
    if (parsed.grade !== undefined && !isPaperGradeId(parsed.grade)) return null;
    return parsed as CompetitionPersonalBest;
  } catch {
    return null;
  }
}
