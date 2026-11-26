import {FLIGHT_MODEL_VERSION, type Flight, type Throw} from '../aero/integrator';
import type {PlaneId} from '../fold/planes';
import type {Paper, weights} from '../paper/papers';

export type CompetitionEvent = 'distance' | 'duration';
export type CompetitionStatus = 'setup' | 'in-progress' | 'finished' | 'aborted';

export type CompetitionPlayer = {
  id: string;
  name: string;
  plane: PlaneId;
};

export type ThrowRecord = {
  round: number; // 1..3
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
  seed: number;
  rounds: number;
  roundWinds: number[];
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
  seed: number;
  modelVersion: number;
  recordedAt: string;
};

/** Deterministic Mulberry32 PRNG for reproducible competition wind fields. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate deterministic per-round wind values in [-3, +3] m/s (0.5 m/s steps). */
export function generateRoundWinds(seed: number, rounds = 3): number[] {
  const rand = seededRandom(seed);
  const winds: number[] = [];
  for (let i = 0; i < rounds; i++) {
    // Integer steps -6..+6 -> -3.0..+3.0 m/s in 0.5 m/s increments
    const step = Math.floor(rand() * 13) - 6;
    winds.push(step * 0.5);
  }
  return winds;
}

export function createCompetitionMatch(config: {
  event: CompetitionEvent;
  paper: Paper['id'];
  gsm: (typeof weights)[number];
  seed: number;
  players: CompetitionPlayer[];
  rounds?: number;
}): CompetitionMatch {
  const rounds = config.rounds ?? 3;
  if (config.players.length < 1 || config.players.length > 4) {
    throw new Error('比赛人数必须在 1 到 4 人之间');
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
} | null {
  if (match.status !== 'in-progress') return null;
  const player = match.players[match.currentPlayerIndex];
  if (!player) return null;
  const wind = match.roundWinds[match.currentRound - 1] ?? 0;
  return {
    player,
    playerIndex: match.currentPlayerIndex,
    round: match.currentRound,
    wind,
  };
}

/** Evaluate whether a simulated flight counts as a valid official throw. */
export function evaluateThrow(
  event: CompetitionEvent,
  flight: Pick<Flight, 'distance' | 'duration' | 'height' | 'landed'>,
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
  if (!Number.isFinite(flight.duration) || flight.duration <= 0) {
    return {valid: false, score: null, invalidReason: '滞空时间无效'};
  }
  return {valid: true, score: flight.duration};
}

/** Commit the active player's throw and advance the turn/round state immutably. */
export function recordCompetitionThrow(
  match: CompetitionMatch,
  launch: Throw,
  flight: Pick<Flight, 'distance' | 'duration' | 'height' | 'landed'>,
): {match: CompetitionMatch; record: ThrowRecord} {
  const turn = currentTurn(match);
  if (!turn) {
    throw new Error('当前比赛未在进行中，无法记录成绩');
  }
  const evalRes = evaluateThrow(match.event, flight);
  const record: ThrowRecord = {
    round: turn.round,
    playerId: turn.player.id,
    plane: turn.player.plane,
    launch: {...launch, wind: turn.wind},
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

/** Compare two descending sorted valid score arrays with 1e-3 tie tolerance. */
function compareScoreArrays(a: readonly number[], b: readonly number[]): number {
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    const va = a[i] ?? -1;
    const vb = b[i] ?? -1;
    if (Math.abs(va - vb) > 1e-3) {
      return vb - va; // higher is better
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
    return compareScoreArrays(a.sortedValidScores, b.sortedValidScores);
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
    return parsed as CompetitionPersonalBest;
  } catch {
    return null;
  }
}
