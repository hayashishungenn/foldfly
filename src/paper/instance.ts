/**
 * 纸张三层模型(Phase 04 / 4.1–4.2):
 *   规格(PaperSize: 尺寸) × 材料(PaperMaterial: 材质参数) × 克重(gsm) = 纸张实例(PaperInstance)。
 * 同一种尺寸不再与固定材料绑定;实例是飞行配置快照的一部分,可持久化/分享/复现。
 */
import {papers, weights, type Paper} from './papers';
import {materialProfile, paperGrade, grades, type MaterialProfile, type PaperGradeId} from './material';
import type {FoldStep} from '../fold/types';
import {replay} from '../fold/engine';
import {area} from '../fold/geometry';

export type PaperSizeId = Paper['id'] | 'custom';

export type PaperSize = {
  id: PaperSizeId;
  name: string;
  width: number;
  height: number;
  hint?: string;
};

export type PaperInstance = {
  /** 内置规格 id;custom 时使用 width/height */
  size: PaperSizeId;
  width: number;
  height: number;
  /** 材料 id */
  material: PaperGradeId;
  gsm: number;
};

export type CustomSizeLimits = {minWidth: number; maxWidth: number; minHeight: number; maxHeight: number; minGsm: number; maxGsm: number};

/** 4.2:合法自定义尺寸范围(米/克重),覆盖 A6–A3 并留余量 */
export const CUSTOM_LIMITS: CustomSizeLimits = {
  minWidth: 0.08, maxWidth: 0.45, minHeight: 0.08, maxHeight: 0.65, minGsm: 50, maxGsm: 160,
};

export function builtinSize(id: Paper['id']): Paper {
  const paper = papers.find(p => p.id === id);
  if (!paper) throw new Error(`未知的纸张规格:${String(id)}`);
  return paper;
}

export function makeInstance(size: Paper['id'], material: PaperGradeId, gsm: number): PaperInstance {
  const p = builtinSize(size);
  assertValid({size, width: p.width, height: p.height, material, gsm});
  return {size, width: p.width, height: p.height, material, gsm};
}

export function customInstance(width: number, height: number, material: PaperGradeId, gsm: number): PaperInstance {
  const inst: PaperInstance = {size: 'custom', width, height, material, gsm};
  assertValid(inst);
  return inst;
}

function assertValid(inst: PaperInstance): void {
  if (!Number.isFinite(inst.width) || !Number.isFinite(inst.height)) throw new Error('纸张尺寸必须为有限数');
  if (inst.width < CUSTOM_LIMITS.minWidth || inst.width > CUSTOM_LIMITS.maxWidth) throw new Error(`宽度必须在 ${CUSTOM_LIMITS.minWidth * 1000}–${CUSTOM_LIMITS.maxWidth * 1000} mm 之间`);
  if (inst.height < CUSTOM_LIMITS.minHeight || inst.height > CUSTOM_LIMITS.maxHeight) throw new Error(`高度必须在 ${CUSTOM_LIMITS.minHeight * 1000}–${CUSTOM_LIMITS.maxHeight * 1000} mm 之间`);
  if (!Number.isFinite(inst.gsm) || inst.gsm < CUSTOM_LIMITS.minGsm || inst.gsm > CUSTOM_LIMITS.maxGsm) throw new Error(`克重必须在 ${CUSTOM_LIMITS.minGsm}–${CUSTOM_LIMITS.maxGsm} gsm 之间`);
  paperGrade(inst.material);
}

/** 实例解析:几何/质量/材料参数。 */
export function resolveInstance(inst: PaperInstance): {
  size: {width: number; height: number};
  areaM2: number;
  massKg: number;
  material: MaterialProfile;
} {
  assertValid(inst);
  const areaM2 = inst.width * inst.height;
  return {size: {width: inst.width, height: inst.height}, areaM2, massKg: areaM2 * inst.gsm / 1000, material: materialProfile(inst.material, inst.gsm)};
}

/** 机型 × 纸张兼容性预检(4.2):折叠开始前验证,而不是折完才发现无效。 */
export function checkFoldCompatibility(inst: PaperInstance, program: readonly FoldStep[]): {ok: boolean; reason?: string} {
  try {
    const state = replay({width: inst.width, height: inst.height}, program.length, program);
    const total = state.layers.reduce((s, p) => s + area(p), 0);
    if (!(total > 0)) return {ok: false, reason: '折叠结果无有效纸面'};
    if (Math.abs(total - inst.width * inst.height) > inst.width * inst.height * 1e-6) return {ok: false, reason: '折叠过程面积不守恒'};
    return {ok: true};
  } catch (error) {
    return {ok: false, reason: error instanceof Error ? error.message : '该纸张尺寸无法完成此折序'};
  }
}

/** 机型推荐长宽比范围(教学提示;非硬性拒绝条件)。 */
export const recommendedAspect: Record<string, {min: number; max: number; note: string}> = {
  dart: {min: 1.2, max: 1.6, note: '尖头机依赖较长的纸张形成尖前缘'},
  suzanne: {min: 1.25, max: 1.5, note: 'Suzanne 使用 A4 比例最优'},
  mach5: {min: 1.25, max: 1.5, note: 'Mach 5 团队实测 A4 优于 Letter'},
  skyking: {min: 1.25, max: 1.5, note: 'Sky King 依赖标准 A4 比例'},
  zerofighter: {min: 1.25, max: 1.5, note: '工程近似机型推荐 A4'},
  nakamura: {min: 1.2, max: 1.6, note: '锁头结构对长宽比不敏感'},
  blackburn: {min: 1.2, max: 1.6, note: '宽翼面机型比例容忍度较高'},
};

export function aspectRatioOf(inst: PaperInstance): number {
  return inst.height / inst.width;
}

export {papers, weights, grades};
