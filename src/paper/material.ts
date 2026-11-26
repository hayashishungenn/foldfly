/**
 * 纸张材料参数库(经验模型,Phase 01)。
 *
 * 性质声明(docs/PHASES.md 冲突修订第 3 条):
 * - 本模块是参数化材料库,不是物理级 FEM 纸张仿真;
 * - 所有公式与取值均为造纸物理文献常见经验区间的中值,不是本作实测数据;
 * - 质量仍只由折叠几何面积 × 克重(gsm,面密度)决定,厚度不参与质量计算;
 * - Phase 01 仅提供材料属性供 UI/报告/存档展示,不改变飞行物理(FLIGHT_MODEL_VERSION 不变);
 *   Phase 02 才把折痕质量与材质刚度耦合进气动模型,并递增版本号。
 */

export type PaperGradeId = 'copy' | 'laser' | 'coated' | 'origami' | 'news';

export type PaperGrade = {
  id: PaperGradeId;
  name: string;
  hint: string;
  /** 标定厚度系数(µm/gsm,经验:复印纸 80 gsm ≈ 100 µm)。厚度 = gsm × caliperFactor × 1e-6 m */
  caliperFactor: number;
  /** 造纸机方向(顺丝缕 MD)杨氏模量,Pa。常见经验区间 2–6 GPa */
  youngModulusMD: number;
  /** 横丝缕方向(逆丝缕 CD)杨氏模量,Pa。经验上约为 MD 的 50–70% */
  youngModulusCD: number;
  /** 表面涂布/施胶光滑度代理:未涂布 ≈ 1,涂布纸 > 1 */
  surfaceSmoothness: number;
};

/** 材质等级库。参数为经验区间中值(非实测),标注见各字段。 */
export const grades: readonly PaperGrade[] = [
  {
    id: 'copy',
    name: '普通复印纸',
    hint: '日常办公标准纸,厚度、挺度与折痕利落度均衡,默认材质',
    caliperFactor: 1.25,
    youngModulusMD: 4.2e9,
    youngModulusCD: 2.4e9,
    surfaceSmoothness: 1.0,
  },
  {
    id: 'laser',
    name: '高挺激光纸',
    hint: '挺度最高的办公纸,机头配重不易变形,适合大力穿透机型',
    caliperFactor: 1.18,
    youngModulusMD: 5.2e9,
    youngModulusCD: 3.0e9,
    surfaceSmoothness: 1.0,
  },
  {
    id: 'coated',
    name: '铜版纸',
    hint: '涂布表面光滑、空气动力面最平整,但厚折层回弹明显',
    caliperFactor: 1.02,
    youngModulusMD: 3.6e9,
    youngModulusCD: 2.1e9,
    surfaceSmoothness: 1.35,
  },
  {
    id: 'origami',
    name: '折纸专用纸',
    hint: '薄而柔韧,复杂折序每一步都更服帖,适合多步机型',
    caliperFactor: 1.42,
    youngModulusMD: 2.6e9,
    youngModulusCD: 1.7e9,
    surfaceSmoothness: 0.95,
  },
  {
    id: 'news',
    name: '新闻纸',
    hint: '松厚轻软、强度最低,微速轻抛滞空时折痕保持最弱',
    caliperFactor: 1.65,
    youngModulusMD: 1.9e9,
    youngModulusCD: 1.2e9,
    surfaceSmoothness: 0.9,
  },
];

export function isPaperGradeId(value: unknown): value is PaperGradeId {
  return typeof value === 'string' && grades.some(g => g.id === value);
}

/** Look up a grade by id; unknown ids are rejected instead of silently substituted. */
export function paperGrade(id: PaperGradeId): PaperGrade {
  const grade = grades.find(g => g.id === id);
  if (!grade) throw new Error(`未知的纸张材质:${String(id)}`);
  return grade;
}

/** Caliper thickness in metres; linear in gsm by definition of the caliper factor. */
export function thickness(id: PaperGradeId, gsm: number): number {
  return paperGrade(id).caliperFactor * gsm * 1e-6;
}

/** Bulk density kg/m³ (apparent density from caliper). Uncoated papers sit near 600–850. */
export function bulkDensity(id: PaperGradeId, gsm: number): number {
  const t = thickness(id, gsm);
  if (t <= 0) throw new Error('纸张厚度必须大于零');
  return gsm / 1000 / t;
}

/** Bending stiffness per unit width, B = E·t³/12 (units N·m); classic thin-plate relation. */
export function bendingStiffness(id: PaperGradeId, gsm: number, dir: 'md' | 'cd'): number {
  const grade = paperGrade(id);
  const t = thickness(id, gsm);
  if (t <= 0) throw new Error('纸张厚度必须大于零');
  const modulus = dir === 'md' ? grade.youngModulusMD : grade.youngModulusCD;
  return (modulus * t ** 3) / 12;
}

/** Stiffness anisotropy E_MD/E_CD; real machine-made paper is always > 1. */
export function stiffnessAnisotropy(id: PaperGradeId): number {
  const grade = paperGrade(id);
  return grade.youngModulusMD / grade.youngModulusCD;
}

/**
 * Minimum fold radius proxy (经验:纸的弯曲损伤半径约为数倍厚度,取 6×)。
 * 折痕越接近最小半径,损伤与回弹越大——Phase 02 的折痕质量模型使用它做归一化。
 */
export function minFoldRadius(id: PaperGradeId, gsm: number): number {
  return 6 * thickness(id, gsm);
}

/**
 * 折痕利落度代理 ∈ [0, 1](经验代理,非实测):随挺度上升、表面光滑度小幅加成。
 * 1 = 折痕锐利且保持性好;0 = 折痕松软回弹。排序:激光 > 复印 > 铜版 > 折纸 > 新闻纸。
 */
export function creaseCrispness(id: PaperGradeId): number {
  const grade = paperGrade(id);
  const raw = 0.2 + 0.12 * (grade.youngModulusMD / 1e9) + 0.08 * grade.surfaceSmoothness;
  return Math.min(1, Math.max(0, raw));
}

export type MaterialProfile = {
  grade: PaperGrade;
  gsm: number;
  /** m */
  thickness: number;
  /** kg/m³ */
  bulkDensity: number;
  /** N·m per unit width */
  bendingStiffnessMD: number;
  bendingStiffnessCD: number;
  /** E_MD/E_CD */
  anisotropy: number;
  /** m */
  minFoldRadius: number;
  /** [0,1] 经验代理 */
  creaseCrispness: number;
};

/** Full deterministic material profile; identical inputs always yield identical outputs. */
export function materialProfile(id: PaperGradeId, gsm: number): MaterialProfile {
  if (!Number.isFinite(gsm) || gsm <= 0) throw new Error('纸张克重必须为正的有限数');
  const grade = paperGrade(id);
  return {
    grade,
    gsm,
    thickness: thickness(id, gsm),
    bulkDensity: bulkDensity(id, gsm),
    bendingStiffnessMD: bendingStiffness(id, gsm, 'md'),
    bendingStiffnessCD: bendingStiffness(id, gsm, 'cd'),
    anisotropy: stiffnessAnisotropy(id),
    minFoldRadius: minFoldRadius(id, gsm),
    creaseCrispness: creaseCrispness(id),
  };
}

const GRADE_NOTES: Record<PaperGradeId, string> = {
  copy: '折痕利落度均衡,基准材质',
  laser: '最挺括,配重机头保持最好',
  coated: '翼面最平整,厚折层回弹偏大',
  origami: '最柔韧,多步折序服帖',
  news: '最松软,折痕保持最弱',
};

/** One-line human-readable summary for UI and CLI reports. */
export function describeMaterial(id: PaperGradeId, gsm: number): string {
  const p = materialProfile(id, gsm);
  return `${p.grade.name} ${gsm} gsm · 厚度 ${(p.thickness * 1e6).toFixed(0)} µm · 挺度(MD) ${(p.bendingStiffnessMD * 1e3).toFixed(2)} mN·m · ${GRADE_NOTES[id]}`;
}
