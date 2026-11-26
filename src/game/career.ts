import type {CompetitionEvent} from './competition';
import type {PaperGradeId} from '../paper/material';
import type {PlaneId} from '../fold/planes';
import type {Paper} from '../paper/papers';

/**
 * 单人生涯模式(Phase 08,纯逻辑)。
 *
 * 设计约定:
 * - 挑战链是数据:每关锁定机型/纸张/克重/材质/投掷参数/风况/项目与目标;
 * - 关卡种子固定 → 每次尝试的风场与阵风完全一致(公平且可复现);
 * - 顺序解锁:第 N 关在前一关完成后解锁;
 * - 状态为不可变对象,完成关卡返回新状态;存档带版本号与迁移函数。
 */

export const CAREER_SAVE_VERSION = 1;
export const careerStorageKey = 'foldfly-career-v1';

export type CareerChallenge = {
  id: string;
  title: string;
  description: string;
  plane: PlaneId;
  paper: Paper['id'];
  gsm: 70 | 80 | 100;
  grade?: PaperGradeId;
  /**
   * 锁定投掷参数(生涯挑战锁定滑块);undefined = 开放给玩家调整
   * (精准赛必须开放,否则确定性模拟使关卡恒过或恒不过)。
   */
  angle?: number;
  speed?: number;
  /** 锁定风况(顺风/侧风),由 seed 无法推出时用显式值;阵风相位用 seed。 */
  wind: number;
  crosswind: number;
  seed: number;
  event: CompetitionEvent;
  /** 达标线:距离/滞空为下限,精准为上限(距靶米数)。 */
  target: number;
  /** 精准赛靶线距起点的距离(m);非精准赛为 undefined。 */
  targetLine?: number;
};

export type CareerCompletion = {score: number; finishedAt: string};

export type CareerState = {
  version: typeof CAREER_SAVE_VERSION;
  /** 已完成关卡 → 最佳成绩(生涯内不覆盖更差成绩,只保留最好)。 */
  completed: Record<string, CareerCompletion>;
};

/** 挑战链(顺序即解锁顺序)。目标值来自校准后的示例投掷量级,不虚构纪录条件。 */
export const careerChallenges: readonly CareerChallenge[] = [
  {
    id: 'dart-basics', title: '第一架 · 童年回忆', description: '用经典尖头机水平掷出 10 m 以上。',
    plane: 'dart', paper: 'a4', gsm: 80, angle: 0, speed: 20, wind: 0, crosswind: 0, seed: 1,
    event: 'distance', target: 10,
  },
  {
    id: 'dart-crosswind', title: '逆风飞行', description: '尖头机在 3 m/s 逆风中飞越 10 m。',
    plane: 'dart', paper: 'a4', gsm: 80, angle: 20, speed: 20, wind: -3, crosswind: 0, seed: 2,
    event: 'distance', target: 10,
  },
  {
    id: 'suzanne-glide', title: '滑翔教材 · Suzanne', description: 'A4 100g 的 Suzanne 平射 55 m 以上。',
    plane: 'suzanne', paper: 'a4', gsm: 100, angle: 0, speed: 28, wind: 0, crosswind: 0, seed: 3,
    event: 'distance', target: 55,
  },
  {
    id: 'skyking-hover', title: '室内滞空 · Sky King', description: 'A4 80g 的 Sky King 轻抛滞空 20 s 以上。',
    plane: 'skyking', paper: 'a4', gsm: 80, angle: 20, speed: 8, wind: 0, crosswind: 0, seed: 4,
    event: 'duration', target: 20,
  },
  {
    id: 'accuracy-warmup', title: '落靶热身', description: '尖头机落点投到 14 m 靶线 3 m 以内(角度与力度自行调整)。',
    plane: 'dart', paper: 'a4', gsm: 80, wind: 0, crosswind: 0, seed: 21,
    event: 'accuracy', target: 3, targetLine: 14,
  },
  {
    id: 'mach5-penetration', title: '穿透爬升 · Mach 5', description: 'A4 100g 的 Mach 5 以 40° 全力投出 75 m 以上。',
    plane: 'mach5', paper: 'a4', gsm: 100, angle: 40, speed: 28, wind: 0, crosswind: 0, seed: 6,
    event: 'distance', target: 75,
  },
  {
    id: 'zerofighter-endurance', title: '零战长夜', description: 'Zero Fighter(工程近似)轻抛滞空 22 s 以上。',
    plane: 'zerofighter', paper: 'a4', gsm: 80, angle: 20, speed: 8, wind: 0, crosswind: 0, seed: 7,
    event: 'duration', target: 22,
  },
  {
    id: 'crosswind-drift', title: '侧风之壁', description: 'Suzanne 在 3 m/s 侧风中仍滑出 45 m 以上。',
    plane: 'suzanne', paper: 'a4', gsm: 100, angle: 0, speed: 28, wind: 0, crosswind: 3, seed: 8,
    event: 'distance', target: 45,
  },
  {
    id: 'accuracy-blade', title: '刀锋落靶', description: '给配重沉重的 Mach 5 收着劲,落点距 17.5 m 靶线 1.5 m 以内。',
    plane: 'mach5', paper: 'a4', gsm: 100, wind: 0, crosswind: 0, seed: 5,
    event: 'accuracy', target: 1.5, targetLine: 17.5,
  },
  {
    id: 'news-endurance', title: '新闻纸的倔强', description: '用最松软的新闻纸折叠 Sky King,滞空 15 s 以上。',
    plane: 'skyking', paper: 'a4', gsm: 70, grade: 'news', angle: 20, speed: 8, wind: 0, crosswind: 0, seed: 10,
    event: 'duration', target: 15,
  },
];

export const careerChallengeById = (id: string): CareerChallenge | undefined =>
  careerChallenges.find(c => c.id === id);

export function createCareerState(): CareerState {
  return {version: CAREER_SAVE_VERSION, completed: {}};
}

/** 第 index 关解锁当且仅当它是第一关,或前一关已完成。 */
export function isChallengeUnlocked(state: CareerState, id: string): boolean {
  const index = careerChallenges.findIndex(c => c.id === id);
  if (index < 0) return false;
  if (index === 0) return true;
  return Boolean(state.completed[careerChallenges[index - 1].id]);
}

/**
 * 成绩是否达标:距离/滞空为目标下限(达标即可完成),精准为上限。
 * 未落地(landed=false)一律不达标。
 */
export function isChallengeMet(challenge: CareerChallenge, landed: boolean, score: number): boolean {
  if (!landed) return false;
  return challenge.event === 'accuracy' ? score <= challenge.target : score >= challenge.target;
}

/** 完成关卡:只在新成绩更优(距离/滞空更大、精准更小)时更新,返回新状态。 */
export function completeChallenge(
  state: CareerState,
  challenge: CareerChallenge,
  score: number,
  now = new Date().toISOString(),
): CareerState {
  const previous = state.completed[challenge.id];
  if (previous && !isBetterScore(challenge.event, score, previous.score)) return state;
  return {
    ...state,
    completed: {...state.completed, [challenge.id]: {score, finishedAt: now}},
  };
}

function isBetterScore(event: CompetitionEvent, candidate: number, incumbent: number): boolean {
  return event === 'accuracy' ? candidate < incumbent : candidate > incumbent;
}

export function careerProgress(state: CareerState): {done: number; total: number} {
  const done = careerChallenges.filter(c => state.completed[c.id]).length;
  return {done, total: careerChallenges.length};
}

export function encodeCareer(state: CareerState): string {
  return JSON.stringify(state);
}

/** 读取存档:未知版本返回 null(不静默迁移);当前版本做字段消毒。 */
export function decodeCareer(raw: string | null): CareerState | null {
  if (!raw || raw.length > 100000) return null;
  try {
    const data = JSON.parse(raw) as Partial<CareerState>;
    if (data.version !== CAREER_SAVE_VERSION) return null;
    if (!data.completed || typeof data.completed !== 'object') return null;
    const completed: Record<string, CareerCompletion> = {};
    for (const [id, entry] of Object.entries(data.completed)) {
      if (!careerChallengeById(id) || !entry || typeof entry.score !== 'number' || !Number.isFinite(entry.score)) continue;
      completed[id] = {score: entry.score, finishedAt: typeof entry.finishedAt === 'string' ? entry.finishedAt : ''};
    }
    return {version: CAREER_SAVE_VERSION, completed};
  } catch {
    return null;
  }
}

/**
 * 版本迁移入口:未来 CAREER_SAVE_VERSION 提升时,在此把旧档逐步升到当前版。
 * 当前只有 v1,任何非当前版本都返回 null(由 UI 提示重新开始,不静默改档)。
 */
export function migrateCareer(raw: string | null): {state: CareerState | null; needsReset: boolean} {
  const state = decodeCareer(raw);
  if (state) return {state, needsReset: false};
  return {state: null, needsReset: raw !== null && raw.length > 0};
}
