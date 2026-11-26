/**
 * 受限自由折纸设计(docs/PHASES.md Phase 03)。
 *
 * 范围声明:用户在当前纸上画折痕(两点定线 + 谷/山 + 层范围),每道折痕
 * 复用引擎现有原语(整叠/仅顶层 + 展翼投影),不做层序求解;引擎无法表达
 * 的折序会抛出明确错误,而不是静默近似。设计是纯数据,可被
 * replay/extract/simulate 全链路消费。
 */
import type {FoldStep} from './types';
import {papers, type Paper} from '../paper/papers';

export const FREESTYLE_DESIGN_VERSION = 1;
/** 序列化上界:防止退化链接超长,也对应真实手工折的合理复杂度。 */
export const MAX_FREESTYLE_CREASES = 40;
export const FREESTYLE_PLANE_ID = 'freestyle';
export const designStorageKey = 'foldfly-design-v1';

export type FreestyleCrease = {
  a: [number, number];
  b: [number, number];
  kind: 'valley' | 'mountain';
  layer: 'all' | 'top';
  /** 折完后沿该折痕展开双翼(引擎 openToStep 投影)。 */
  open?: boolean;
};

export type FreestyleDesign = {
  version: 1;
  sheet: Paper['id'];
  name: string;
  creases: FreestyleCrease[];
};

const isCoord = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** Validate a single crease; rejects instead of silently repairing. */
export function validateCrease(input: unknown): FreestyleCrease {
  const c = input as Partial<FreestyleCrease>;
  if (!c || typeof c !== 'object') throw new Error('折痕数据无效');
  if (!Array.isArray(c.a) || !Array.isArray(c.b) || c.a.length !== 2 || c.b.length !== 2 || !isCoord(c.a[0]) || !isCoord(c.a[1]) || !isCoord(c.b[0]) || !isCoord(c.b[1])) {
    throw new Error('折痕端点必须在纸面内');
  }
  if (c.a[0] === c.b[0] && c.a[1] === c.b[1]) throw new Error('折痕两端不能重合');
  if (c.kind !== 'valley' && c.kind !== 'mountain') throw new Error('折痕类型必须是谷折或山折');
  if (c.layer !== 'all' && c.layer !== 'top') throw new Error('层范围必须是全部纸层或仅顶层');
  if (c.open !== undefined && typeof c.open !== 'boolean') throw new Error('展翼标记无效');
  return {a: [c.a[0], c.a[1]], b: [c.b[0], c.b[1]], kind: c.kind, layer: c.layer, ...(c.open ? {open: true} : {})};
}

/** Build a validated design; creases are copied so callers cannot mutate shared state. */
export function buildDesign(sheet: Paper['id'], name: string, creases: readonly unknown[]): FreestyleDesign {
  if (!papers.some(p => p.id === sheet)) throw new Error(`未知的纸张规格:${String(sheet)}`);
  if (typeof name !== 'string' || !name.trim()) throw new Error('设计名称不能为空');
  if (creases.length > MAX_FREESTYLE_CREASES) throw new Error(`折痕数量超过上限 ${MAX_FREESTYLE_CREASES} 道`);
  return {version: 1, sheet, name: name.trim().slice(0, 24), creases: creases.map(validateCrease)};
}

/** Convert a crease list into a fold program consumable by replay/extract/simulate. */
export function designToSteps(design: FreestyleDesign): FoldStep[] {
  return design.creases.map((crease, index) => ({
    title: `第 ${index + 1} 道折痕`,
    description: `${crease.kind === 'valley' ? '谷折' : '山折'} · ${crease.layer === 'top' ? '仅顶层' : '全部纸层'}${crease.open ? ' · 折后展开双翼' : ''}`,
    kind: crease.kind,
    a: crease.a,
    b: crease.b,
    sign: (crease.kind === 'valley' ? 1 : -1) as 1 | -1,
    layer: crease.layer === 'top' ? ('top' as const) : ('all' as const),
    ...(crease.open ? {openToStep: Math.max(0, index - 1)} : {}),
  }));
}

/** FNV-1a over the geometry; detects edits even when the crease count is unchanged. */
function hashCreases(value: unknown): string {
  let hash = 2166136261;
  for (const ch of JSON.stringify(value)) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function designSignature(design: FreestyleDesign): string {
  return hashCreases({sheet: design.sheet, creases: design.creases});
}

/** Serialize for localStorage / URL sharing; signature verifies content integrity. */
export function encodeDesign(design: FreestyleDesign): string {
  return JSON.stringify({...design, signature: designSignature(design)});
}

/** Decode and fully validate; anything malformed returns null instead of partial data. */
export function decodeDesign(raw: string | null): FreestyleDesign | null {
  if (!raw || raw.length > 100000) return null;
  try {
    const x = JSON.parse(raw) as Partial<FreestyleDesign & {signature: string}>;
    if (x.version !== FREESTYLE_DESIGN_VERSION) return null;
    if (!Array.isArray(x.creases) || x.creases.length > MAX_FREESTYLE_CREASES) return null;
    const design = buildDesign(x.sheet as Paper['id'], typeof x.name === 'string' ? x.name : '自由设计', x.creases);
    if (x.signature !== undefined && x.signature !== designSignature(design)) return null;
    return design;
  } catch {
    return null;
  }
}
