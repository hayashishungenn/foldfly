/**
 * 成就系统与纪录墙数据聚合(Phase 09)。
 *
 * 设计约定:
 * - 成就是**纯函数**:给定可观察状态快照(AchievementContext)判定解锁,
 *   幂等且与时间无关;不维护独立的事件流存档;
 * - 状态快照来自既有持久化:自由挑战幽灵(每机型×模式)、正式赛 PB(三项目)、
 *   生涯进度;IO 只发生在 collectAchievementContext(UI 层调用);
 * - 所有阈值与历史里程碑口径一致(AERO-AUDIT §3):88 m / 29.2 s 为里程碑
 *   参照,98.43 m / 31.2 s 为现役世界纪录,都不作为强制拟合目标。
 */

import {careerChallenges, careerProgress, type CareerState} from './career';
import type {CompetitionEvent} from './competition';
import type {PlaneId} from '../fold/planes';

export type GhostSummary = {distance: number | null; duration: number | null};

export type AchievementContext = {
  /** 每机型最佳(自由挑战,两模式)。 */
  ghosts: Partial<Record<PlaneId, GhostSummary>>;
  competitionPbs: Partial<Record<CompetitionEvent, {score: number; playerName: string}>>;
  career: CareerState | null;
  /** 自由设计台是否保存过设计。 */
  hasDesign: boolean;
};

export type Achievement = {
  id: string;
  title: string;
  description: string;
  check: (ctx: AchievementContext) => boolean;
};

const anyGhostDistance = (ctx: AchievementContext, min: number): boolean =>
  Object.values(ctx.ghosts).some(g => (g?.distance ?? 0) >= min);
const anyGhostDuration = (ctx: AchievementContext, min: number): boolean =>
  Object.values(ctx.ghosts).some(g => (g?.duration ?? 0) >= min);

/** 成就定义(全部为纯判定)。 */
export const achievements: readonly Achievement[] = [
  {id: 'first-flight', title: '第一次试飞', description: '完成一次落地并留下个人纪录。', check: ctx => Object.keys(ctx.ghosts).length > 0},
  {id: 'distance-50', title: '五十大关', description: '任一机型飞出 50 m 以上。', check: ctx => anyGhostDistance(ctx, 50)},
  {id: 'distance-69', title: 'Suzanne 之壁', description: '任一机型飞越 69.14 m——2012 年距离纪录线。', check: ctx => anyGhostDistance(ctx, 69.14)},
  {id: 'distance-88', title: '里程碑 88 m', description: '任一机型飞越 88 m——2022 年 Boeing 团队历史里程碑。', check: ctx => anyGhostDistance(ctx, 88)},
  {id: 'duration-20', title: '廿秒滞空', description: '任一机型滞空 20 s 以上。', check: ctx => anyGhostDuration(ctx, 20)},
  {id: 'duration-29', title: '29.2 秒里程碑', description: '任一机型滞空 29.2 s 以上——2010 年历史里程碑线。', check: ctx => anyGhostDuration(ctx, 29.2)},
  {id: 'accuracy-heart', title: '靶心之友', description: '正式赛精准赛留下个人最佳(距靶 3 m 内)。', check: ctx => (ctx.competitionPbs.accuracy?.score ?? Infinity) <= 3},
  {id: 'competition-all', title: '三项目全能', description: '距离、滞空、精准三个正式赛项目都有个人最佳。', check: ctx => ['distance', 'duration', 'accuracy'].every(e => Boolean(ctx.competitionPbs[e as CompetitionEvent]))},
  {id: 'career-three', title: '生涯三级跳', description: '完成任意 3 个生涯关卡。', check: ctx => (ctx.career ? careerProgress(ctx.career).done : 0) >= 3},
  {id: 'career-all', title: '殿堂殿堂', description: '完成全部生涯关卡。', check: ctx => (ctx.career ? careerProgress(ctx.career).done : 0) >= careerChallenges.length},
  {id: 'freestyle-designer', title: '自由设计师', description: '在自由设计台保存过一架自己的纸飞机。', check: ctx => ctx.hasDesign},
];

/** 幂等纯判定:同一上下文永远得到同一解锁集合。 */
export function evaluateAchievements(ctx: AchievementContext): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const a of achievements) out[a.id] = a.check(ctx);
  return out;
}

const GHOST_KEY_PREFIX = 'foldfly-ghost-v';

/** 从 localStorage 聚合可观察状态(容错:任何损坏条目跳过)。UI 层调用。 */
export function collectAchievementContext(read: (key: string) => string | null = key => localStorage.getItem(key), keys?: string[]): AchievementContext {
  const ctx: AchievementContext = {ghosts: {}, competitionPbs: {}, career: null, hasDesign: false};
  let keyList: string[] = [];
  if (keys) keyList = keys;
  else {
    try {
      keyList = Object.keys(localStorage);
    } catch {
      keyList = [];
    }
  }
  for (const key of keyList) {
    try {
      const raw = read(key);
      if (!raw) continue;
      if (key.startsWith(GHOST_KEY_PREFIX)) {
        const data = JSON.parse(raw) as {mode?: string; flight?: {distance?: number; duration?: number}};
        const planeMatch = key.match(/-v\d+-([a-z]+)-(distance|duration)-/);
        if (!planeMatch || (data.mode !== 'distance' && data.mode !== 'duration') || typeof data.flight?.distance !== 'number' || typeof data.flight?.duration !== 'number') continue;
        const planeId = planeMatch[1] as PlaneId;
        const existing = ctx.ghosts[planeId] ?? {distance: null, duration: null};
        if (data.mode === 'distance') existing.distance = Math.max(existing.distance ?? 0, data.flight.distance);
        else existing.duration = Math.max(existing.duration ?? 0, data.flight.duration);
        ctx.ghosts[planeId] = existing;
      } else if (key.startsWith('foldfly.competition.pb.v1.')) {
        const event = key.slice('foldfly.competition.pb.v1.'.length) as CompetitionEvent;
        const data = JSON.parse(raw) as {score?: number; playerName?: string};
        if (typeof data.score === 'number' && Number.isFinite(data.score) && typeof data.playerName === 'string') {
          ctx.competitionPbs[event] = {score: data.score, playerName: data.playerName};
        }
      } else if (key === 'foldfly-career-v1') {
        const data = JSON.parse(raw) as CareerState;
        if (data.version === 1 && data.completed && typeof data.completed === 'object') ctx.career = data;
      } else if (key === 'foldfly-design-v1') {
        ctx.hasDesign = true;
      }
    } catch {
      // 损坏条目跳过
    }
  }
  return ctx;
}
