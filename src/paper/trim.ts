/**
 * 飞机调校(Phase 04 / 4.10)与折痕回弹(4.8)。
 *
 * 调校修改的是真实几何姿态:上反角使翼面投影展长/面积按 cos(Γ) 收缩,
 * 左右不对称使两侧独立收缩并产生滚转偏置;后缘上翘按经典襟翼理论
 * (τ≈0.5)给出小迎角零升偏移。所有效应由几何/控制面近似推导,不是成绩乘数。
 *
 * 回弹模型(4.8):展翼后自然角 = 目标角 − 材料回弹角;回弹角由材料
 * creaseRetention 与层数确定性给出(线性经验模型,范围为估算,未实测)。
 */
import type {Aero} from '../aero/extract';
import type {MaterialProfile} from './material';

export const TRIM_VERSION = 1;

export type TrimConfig = {
  /** 左右上反角(度,0–20,正=翼尖上抬) */
  dihedralLeft: number;
  dihedralRight: number;
  /** 翼尖小翼上折角(度,0–90;仅几何展示与阻力估算,不改变升力) */
  winglet: number;
  /** 后缘上翘(正,度,−10–10;正=上翘=抬机头) */
  trailingEdge: number;
};

export const DEFAULT_TRIM: TrimConfig = {dihedralLeft: 0, dihedralRight: 0, winglet: 0, trailingEdge: 0};

export const TRIM_LIMITS = {dihedral: 20, winglet: 90, trailingEdge: 10} as const;

export function validateTrim(trim: TrimConfig): TrimConfig {
  const check = (v: number, max: number, name: string) => {
    if (!Number.isFinite(v) || Math.abs(v) > max) throw new Error(`${name}必须在 ±${max}° 内`);
  };
  check(trim.dihedralLeft, TRIM_LIMITS.dihedral, '左上反角');
  check(trim.dihedralRight, TRIM_LIMITS.dihedral, '右上反角');
  check(trim.winglet, TRIM_LIMITS.winglet, '翼尖小翼角');
  check(trim.trailingEdge, TRIM_LIMITS.trailingEdge, '后缘角度');
  return {...trim};
}

export function isDefaultTrim(trim: TrimConfig): boolean {
  return trim.dihedralLeft === 0 && trim.dihedralRight === 0 && trim.winglet === 0 && trim.trailingEdge === 0;
}

export type TrimEffect = {
  /** 收缩后的有效翼展/翼面积(投影) */
  span: number;
  wingArea: number;
  aspectRatio: number;
  /** 左右不对称度 0–1 */
  asymmetry: number;
  /** 后缘上翘带来的零升迎角偏移(rad,正=抬机头) */
  alpha0Offset: number;
  /** 几何量(不进入气动) */
  geometryOnly: {wingletAngleDeg: number; note: string};
};

const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * 调校 → 有效气动参数(准静态投影近似)。
 * 上反角:两侧投影展长分别为 b/2·cosΓ;面积按 cosΓ 收缩;
 * 不对称:两侧展长差/和;
 * 后缘:Δα0 ≈ τ·δ·(S_te/S),τ=0.5 为薄翼襟翼效率经典近似,取 S_te/S=1(全后缘)上限。
 */
export function applyTrim(aero: Aero, trim: TrimConfig): TrimEffect {
  validateTrim(trim);
  const gl = rad(trim.dihedralLeft), gr = rad(trim.dihedralRight);
  const halfSpan = aero.span / 2;
  const leftSpan = halfSpan * Math.cos(gl);
  const rightSpan = halfSpan * Math.cos(gr);
  const span = leftSpan + rightSpan;
  const cosAvg = (Math.cos(gl) + Math.cos(gr)) / 2;
  const wingArea = aero.wingArea * cosAvg;
  const asymmetry = aero.span > 1e-9 ? Math.abs(leftSpan - rightSpan) / (leftSpan + rightSpan) : 0;
  const alpha0Offset = rad(trim.trailingEdge) * 0.5;
  return {
    span,
    wingArea,
    aspectRatio: wingArea > 1e-12 ? (span * span) / wingArea : aero.aspectRatio,
    asymmetry,
    alpha0Offset,
    geometryOnly: {wingletAngleDeg: trim.winglet, note: '小翼角仅作几何展示,不参与升力计算'},
  };
}

/** 调校后的 Aero 副本(供求解器直接消费)。 */
export function trimAero(aero: Aero, trim: TrimConfig): Aero {
  if (isDefaultTrim(trim)) return aero;
  const effect = applyTrim(aero, trim);
  return {...aero, span: effect.span, wingArea: effect.wingArea, aspectRatio: effect.aspectRatio};
}

/**
 * 折痕回弹(4.8):展翼自然角 = 90° − 回弹角。
 * 回弹角 = k_spring · (1 − creaseRetention) · (1 + 0.05·(layers−1)),k_spring=20°。
 * 经验线性模型,确定性;未实测前只用于 "自然角" 展示与可选调校基准。
 */
export function wingSpringBackDeg(profile: MaterialProfile, layers = 1): number {
  const retention = profile.grade.creaseRetention;
  const n = Math.max(1, layers);
  return Math.max(0, Math.min(30, 20 * (1 - retention) * (1 + 0.05 * (n - 1))));
}

/** 展翼自然残余角(度),即目标 90° 减去回弹。 */
export function naturalOpenAngleDeg(profile: MaterialProfile, layers = 1): number {
  return 90 - wingSpringBackDeg(profile, layers);
}
