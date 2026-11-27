/**
 * 折层厚度与结构刚度(Phase 04 / 4.4–4.5)。
 *
 * 零厚度模型仍是气动几何基准(兼容选项);本模块给出工程近似的局部厚度
 * 与多层结构刚度,用于结构分析展示与后续调校,不直接伪造飞行效果。
 * 多层刚度采用"完全滑移 ~ 完全黏合"的上下界,真实值位于其间,误差范围
 * 随层数增大(记录为估算,不是实测)。
 */
import type {MaterialProfile} from './material';

export type ThicknessModel = {
  /** 单张厚度 m */
  singleSheetM: number;
  /** n 层压实后厚度 m(压实行数 compaction ∈ [0.7,1]) */
  stack: (layers: number, compaction?: number) => number;
  /** 局部折层厚度(m)。layers<1 视为 1 */
  local: (layers: number) => number;
};

export function thicknessModel(profile: MaterialProfile): ThicknessModel {
  const t = profile.thickness;
  // 压实系数:折痕处纸张被压紧,层间空隙减少;0.85 为经验中值(未实测)
  const compaction = 0.85;
  const local = (layers: number) => Math.max(1, layers) * t * compaction;
  return {
    singleSheetM: t,
    stack: (layers: number, comp = compaction) => Math.max(1, layers) * t * comp,
    local,
  };
}

export type StructuralStiffness = {
  /** 完全黏合上界 B_bond (N·m,单位宽度弯曲刚度) */
  bonded: number;
  /** 完全滑移下界 B_slip */
  slip: number;
  /** 工程中值(几何平均) */
  nominal: number;
  /** 估算误差范围(上界/下界比) */
  ratio: number;
  assumption: string;
};

/**
 * 多层结构弯曲刚度:层数 n、单层 B=E·t³/12。
 * 完全黏合:B_bond = n³·B;完全滑移:B_slip = n·B。两者之间为工程近似。
 * 未考虑层间摩擦的部分黏合与折痕方向差异,误差范围随层数增大。
 */
export function structuralStiffness(profile: MaterialProfile, layers: number, direction: 'md' | 'cd' = 'md'): StructuralStiffness {
  const n = Math.max(1, Math.round(layers));
  const b = direction === 'md' ? profile.bendingStiffnessMD : profile.bendingStiffnessCD;
  const bonded = n ** 3 * b;
  const slip = n * b;
  return {
    bonded,
    slip,
    nominal: Math.sqrt(bonded * slip),
    ratio: bonded / slip,
    assumption: '层间完全黏合为刚度上界、完全滑移为下界;nominal 取几何中值,未考虑层间摩擦与折痕取向差异',
  };
}

/** 折痕处有效厚度(三明治近似:压实的 n 层 + 折痕圆角)。 */
export function creaseThickness(profile: MaterialProfile, layers: number): number {
  const t = profile.thickness;
  const n = Math.max(1, layers);
  return n * t + Math.min(t, 2 * profile.minFoldRadius * 0.5) * 0.5;
}
