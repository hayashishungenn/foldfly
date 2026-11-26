import {describe, it, expect} from 'vitest';
import {
  grades,
  isPaperGradeId,
  paperGrade,
  thickness,
  bulkDensity,
  bendingStiffness,
  stiffnessAnisotropy,
  minFoldRadius,
  creaseCrispness,
  materialProfile,
  describeMaterial,
  type PaperGradeId,
} from '../src/paper/material';
import {extract} from '../src/aero/extract';
import {replay} from '../src/fold/engine';
import {papers} from '../src/paper/papers';

const ids = grades.map(g => g.id) as PaperGradeId[];

describe('纸张材料库(Phase 01 纯逻辑)', () => {
  it('复印纸 80 gsm 标定厚度约 100 µm,厚度随克重线性变化', () => {
    expect(thickness('copy', 80)).toBeCloseTo(1.0e-4, 9);
    expect(thickness('copy', 100) / thickness('copy', 80)).toBeCloseTo(1.25, 12);
    expect(thickness('news', 70)).toBeGreaterThan(thickness('coated', 70));
  });

  it('抗弯刚度按薄板公式 B=E·t³/12,随克重呈三次方增长', () => {
    const b80 = bendingStiffness('copy', 80, 'md');
    expect(b80).toBeCloseTo((4.2e9 * 1.0e-4 ** 3) / 12, 15);
    expect(bendingStiffness('copy', 100, 'md') / b80).toBeCloseTo((100 / 80) ** 3, 10);
    // MD 挺度高于 CD,比值与杨氏模量比一致
    expect(bendingStiffness('copy', 80, 'md')).toBeGreaterThan(bendingStiffness('copy', 80, 'cd'));
    expect(bendingStiffness('copy', 80, 'md') / bendingStiffness('copy', 80, 'cd')).toBeCloseTo(stiffnessAnisotropy('copy'), 12);
  });

  it.each(ids)('%s 体积密度落在纸张合理区间且各向异性大于 1', id => {
    for (const gsm of [70, 80, 100]) {
      expect(bulkDensity(id, gsm)).toBeGreaterThan(400);
      expect(bulkDensity(id, gsm)).toBeLessThan(1000);
    }
    expect(stiffnessAnisotropy(id)).toBeGreaterThan(1);
    expect(stiffnessAnisotropy(id)).toBeLessThan(3);
  });

  it('折痕利落度代理在 [0,1] 内且材质排序符合挺度直觉(激光>复印>铜版>折纸>新闻纸)', () => {
    const ordered = ids.map(creaseCrispness);
    for (const v of ordered) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    const byGrade = (id: PaperGradeId) => creaseCrispness(id);
    expect(byGrade('laser')).toBeGreaterThan(byGrade('copy'));
    expect(byGrade('copy')).toBeGreaterThan(byGrade('coated'));
    expect(byGrade('coated')).toBeGreaterThan(byGrade('origami'));
    expect(byGrade('origami')).toBeGreaterThan(byGrade('news'));
  });

  it('最小折叠半径是厚度的固定倍数,随克重增长', () => {
    expect(minFoldRadius('copy', 80)).toBeCloseTo(6 * thickness('copy', 80), 12);
    expect(minFoldRadius('copy', 100)).toBeGreaterThan(minFoldRadius('copy', 80));
  });

  it('材料概要是同一输入的确定性纯函数', () => {
    const a = materialProfile('laser', 100);
    const b = materialProfile('laser', 100);
    expect(a).toEqual(b);
    expect(a.grade.id).toBe('laser');
    expect(a.thickness).toBe(thickness('laser', 100));
    expect(a.creaseCrispness).toBe(creaseCrispness('laser'));
  });

  it('拒绝无效克重与未知材质', () => {
    for (const gsm of [0, -1, NaN, Infinity]) expect(() => materialProfile('copy', gsm)).toThrow();
    expect(() => paperGrade('unknown' as PaperGradeId)).toThrow();
    expect(isPaperGradeId('copy')).toBe(true);
    expect(isPaperGradeId('paper')).toBe(false);
    expect(isPaperGradeId(80)).toBe(false);
  });

  it('材质不影响质量:质量只由折叠几何面积 × 克重决定(Phase 01 不改物理)', () => {
    const state = replay(papers[0], 6);
    expect(extract(state, 80).mass).toBeCloseTo(0.0049896, 9);
    expect(describeMaterial('news', 80)).toContain('新闻纸');
    expect(describeMaterial('news', 80)).not.toContain('undefined');
  });
});
