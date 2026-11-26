import {seededRandom} from './winds';

/**
 * 精准着陆赛(Phase 07):落点相对靶线的垂直偏差计分,纯物理可算,
 * 无需花式判定。靶线垂直于投掷方向,位于距起点 accuracyTarget 米处;
 * 偏差 = |落点顺风坐标 − accuracyTarget|(侧向漂移不影响垂直偏差)。
 */

export const ACCURACY_TARGET_MIN = 8;
export const ACCURACY_TARGET_MAX = 22;

/** 由比赛种子确定性生成靶线距离(0.5 m 步进,同一比赛全员同靶)。 */
export function accuracyTargetFromSeed(seed: number): number {
  const rand = seededRandom(seed);
  const raw = ACCURACY_TARGET_MIN + rand() * (ACCURACY_TARGET_MAX - ACCURACY_TARGET_MIN);
  return Math.round(raw * 2) / 2;
}

/**
 * 落点到靶线的垂直偏差。distance 为落点水平总距离、drift 为侧向漂移
 * (v5),由此恢复顺风坐标 x = √(distance² − drift²)。
 */
export function accuracyMiss(distance: number, drift: number | undefined, target: number): number {
  const z = drift ?? 0;
  const xSquared = distance * distance - z * z;
  const x = xSquared > 0 ? Math.sqrt(xSquared) : 0;
  return Math.abs(x - target);
}
