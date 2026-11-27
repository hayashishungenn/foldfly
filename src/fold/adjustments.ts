/**
 * 折痕误差 → 真实几何(Phase 04 / 4.6–4.7)。
 *
 * 手工折叠的落点偏差被记录为归一化折痕端点偏移;重放折序时把偏移施加到
 * 对应折痕线上,由引擎重新剖分/反射,因此误差通过真实材料分布影响重心、
 * 翼面积与对称性——而不是对成绩直接乘系数。
 *
 * 约束:
 * - 自动演示/跳过教学不产生偏移(确定性标准折序);
 * - 偏移上限 MAX_CREASE_OFFSET(归一化,约为纸宽的 4%),超出被拒绝;
 * - 相同折序 + 相同偏移 → 相同几何(确定性)。
 */
import type {FoldOperation, FoldPoint, FoldStep} from './types';
import {EPS_MATCH} from './geometry-constants';

/** 单条折痕归一化端点偏移(相对纸宽/纸高)。 */
export type CreaseOffset = {ax: number; ay: number; bx: number; by: number};

/** 键:`${step}:${subOp}` */
export type FoldAdjustments = Readonly<Record<string, CreaseOffset>>;

export const MAX_CREASE_OFFSET = 0.04;

export function normalizeOffset(offset: CreaseOffset): CreaseOffset | null {
  const values = [offset.ax, offset.ay, offset.bx, offset.by];
  if (!values.every(Number.isFinite)) return null;
  if (values.some(v => Math.abs(v) > MAX_CREASE_OFFSET + EPS_MATCH)) return null;
  if (values.every(v => Math.abs(v) < EPS_MATCH)) return null;
  return offset;
}

function shiftPoint(p: FoldPoint, dx: number, dy: number): FoldPoint {
  if (Array.isArray(p)) return [p[0] + dx, p[1] + dy];
  if ('bisector' in p) {
    return {bisector: {...p.bisector, vertex: shiftPoint(p.bisector.vertex, dx, dy), through: shiftPoint(p.bisector.through, dx, dy), other: shiftPoint(p.bisector.other, dx, dy)}};
  }
  return {x: [p.x[0] + dx, p.x[1]], y: p.y, offset: [p.offset?.[0] ?? 0, p.offset?.[1] ?? 0]};
}

function shiftOp(op: FoldOperation, offset: CreaseOffset): FoldOperation {
  return {
    ...op,
    a: shiftPoint(op.a, offset.ax, offset.ay),
    b: shiftPoint(op.b, offset.bx, offset.by),
  };
}

/** 应用偏移后的折序副本;无偏移的步骤保持原对象(逐位一致)。 */
export function adjustProgram(program: readonly FoldStep[], adjustments: FoldAdjustments | null | undefined): readonly FoldStep[] {
  if (!adjustments || Object.keys(adjustments).length === 0) return program;
  let anyApplied = false;
  const result = program.map((step, index) => {
    const ops = step.operations ?? [step];
    let changed = false;
    const nextOps = ops.map((op, subOp) => {
      const raw = adjustments[`${index}:${subOp}`];
      const offset = raw ? normalizeOffset(raw) : null;
      if (!offset) return op;
      changed = true;
      return shiftOp(op, offset);
    });
    if (!changed) return step;
    anyApplied = true;
    if (step.operations) return {...step, operations: nextOps};
    return {...step, ...nextOps[0]};
  });
  return anyApplied ? result : program;
}

/** 落点偏差(纸面坐标,m)→ 归一化偏移;超出上限时截断到上限(仍为真实几何,不是成绩惩罚)。 */
export function offsetFromMiss(sheet: {width: number; height: number}, step: number, subOp: number, miss: {ax: number; ay: number; bx: number; by: number}): {key: string; offset: CreaseOffset} | null {
  const clamp = (v: number, span: number) => Math.max(-MAX_CREASE_OFFSET, Math.min(MAX_CREASE_OFFSET, v / span));
  const offset: CreaseOffset = {
    ax: clamp(miss.ax, sheet.width), ay: clamp(miss.ay, sheet.height),
    bx: clamp(miss.bx, sheet.width), by: clamp(miss.by, sheet.height),
  };
  const normalized = normalizeOffset(offset);
  return normalized ? {key: `${step}:${subOp}`, offset: normalized} : null;
}
