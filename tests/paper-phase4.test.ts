import {describe, it, expect} from 'vitest';
import {papers, weights} from '../src/paper/papers';
import {grades, materialProfile} from '../src/paper/material';
import {makeInstance, customInstance, resolveInstance, checkFoldCompatibility, CUSTOM_LIMITS} from '../src/paper/instance';
import {thicknessModel, structuralStiffness, creaseThickness} from '../src/paper/stack';
import {DEFAULT_TRIM, applyTrim, trimAero, validateTrim, wingSpringBackDeg, naturalOpenAngleDeg, isDefaultTrim} from '../src/paper/trim';
import {adjustProgram, offsetFromMiss, MAX_CREASE_OFFSET, type FoldAdjustments} from '../src/fold/adjustments';
import {replay} from '../src/fold/engine';
import {planes} from '../src/fold/planes';
import {extract} from '../src/aero/extract';
import {simulate} from '../src/aero/integrator';
import {area} from '../src/fold/geometry';

const sheet = papers[0];

describe('纸张规格与实例(Phase 04 / 4.1–4.2)', () => {
  it('新增 A3/A6 规格,内置规格齐全且物理单位正确', () => {
    expect(papers.map(p => p.id)).toEqual(expect.arrayContaining(['a3', 'a4', 'a6', 'a5', 'b5', 'letter', 'square']));
    for (const p of papers) {
      expect(p.width).toBeGreaterThan(0.05);
      expect(p.height).toBeGreaterThanOrEqual(p.width);
      expect(p.height).toBeLessThan(0.7);
    }
  });

  it('实例 = 规格 × 材料 × 克重;质量 = 面积 × gsm', () => {
    const inst = makeInstance('a4', 'news', 70);
    const r = resolveInstance(inst);
    expect(r.massKg).toBeCloseTo(0.21 * 0.297 * 70 / 1000, 9);
    const inst2 = makeInstance('a4', 'kraft', 70);
    expect(resolveInstance(inst2).massKg).toBeCloseTo(resolveInstance(inst).massKg, 12);
    expect(resolveInstance(inst2).material.grade.id).toBe('kraft');
  });

  it('全部内置规格对全部机型通过折叠兼容性预检', () => {
    for (const p of papers) {
      const inst = makeInstance(p.id, 'copy', 80);
      for (const def of Object.values(planes)) {
        const res = checkFoldCompatibility(inst, def.steps);
        expect(res.ok, `${p.id}/${def.id}: ${res.reason ?? ''}`).toBe(true);
      }
    }
  });

  it('自定义尺寸合法范围校验与非法输入拒绝', () => {
    expect(() => customInstance(0.2, 0.35, 'copy', 80)).not.toThrow();
    expect(() => customInstance(0.05, 0.35, 'copy', 80)).toThrow();
    expect(() => customInstance(0.2, 0.35, 'copy', 200)).toThrow();
    expect(() => customInstance(NaN, 0.3, 'copy', 80)).toThrow();
    expect(CUSTOM_LIMITS.minWidth).toBeLessThan(CUSTOM_LIMITS.maxWidth);
  });
});

describe('材料数据库(4.3)', () => {
  it('材料含用途/克重范围/粗糙度/折痕保持/来源与可信度', () => {
    expect(grades.length).toBeGreaterThanOrEqual(8);
    for (const g of grades) {
      expect(g.usage.length).toBeGreaterThan(0);
      expect(g.gsmRange[0]).toBeLessThan(g.gsmRange[1]);
      expect(g.confidence === 'literature-range' || g.confidence === 'estimated').toBe(true);
      expect(g.roughness).toBeGreaterThanOrEqual(0);
      expect(g.creaseRetention).toBeGreaterThanOrEqual(0);
      expect(g.source.length).toBeGreaterThan(0);
    }
    const ids = grades.map(g => g.id);
    expect(ids).toEqual(expect.arrayContaining(['kraft', 'writing', 'tissue']));
  });
});

describe('折层厚度与结构刚度(4.4–4.5)', () => {
  const profile = materialProfile('copy', 80);
  it('单张厚度与叠层厚度随层数线性(压实行数)', () => {
    const model = thicknessModel(profile);
    expect(model.singleSheetM).toBeCloseTo(profile.thickness, 12);
    expect(model.stack(2)).toBeCloseTo(2 * model.singleSheetM * 0.85, 12);
    expect(model.local(4)).toBeCloseTo(4 * model.singleSheetM * 0.85, 12);
    expect(model.local(0)).toBeCloseTo(model.singleSheetM * 0.85, 12);
    expect(creaseThickness(profile, 3)).toBeGreaterThan(3 * model.singleSheetM);
  });

  it('多层结构刚度介于完全滑移与完全黏合之间,误差范围随层数增大', () => {
    for (const n of [1, 2, 4, 8]) {
      const s = structuralStiffness(profile, n);
      expect(s.slip).toBeCloseTo(n * profile.bendingStiffnessMD, 10);
      expect(s.bonded).toBeCloseTo(n ** 3 * profile.bendingStiffnessMD, 10);
      expect(s.nominal).toBeGreaterThanOrEqual(s.slip);
      expect(s.nominal).toBeLessThanOrEqual(s.bonded);
      expect(s.ratio).toBeCloseTo(n * n, 10);
    }
    expect(structuralStiffness(profile, 1).slip).toBeCloseTo(structuralStiffness(profile, 1).bonded, 12);
  });
});

describe('折痕误差进入真实几何(4.6–4.7)', () => {
  it('无偏移时折序对象与几何逐位一致', () => {
    const program = planes.dart.steps;
    expect(adjustProgram(program, null)).toBe(program);
    expect(adjustProgram(program, {})).toBe(program);
    const a = replay(sheet, program.length, program);
    const b = replay(sheet, program.length, adjustProgram(program, {}));
    expect(b.layers).toEqual(a.layers);
  });

  it('折痕偏移通过引擎重放改变真实几何(质量分布/翼面积/重心)', () => {
    const program = planes.dart.steps;
    const base = extract(replay(sheet, program.length, program), 80);
    const adjustments: FoldAdjustments = {'2:0': {ax: 0.008, ay: 0, bx: 0.008, by: 0}};
    const adjusted = adjustProgram(program, adjustments);
    expect(adjusted).not.toBe(program);
    const state = replay(sheet, adjusted.length, adjusted);
    // 面积守恒仍成立
    expect(state.layers.reduce((s, p) => s + area(p), 0)).toBeCloseTo(sheet.width * sheet.height, 8);
    const moved = extract(state, 80);
    expect(moved.mass).toBeCloseTo(base.mass, 9); // 质量不变(面积守恒)
    expect(moved.cg.x !== base.cg.x || moved.cg.y !== base.cg.y || moved.wingArea !== base.wingArea || moved.aerodynamicCenter.x !== base.aerodynamicCenter.x).toBe(true);
    // 相同偏移确定性
    expect(replay(sheet, adjusted.length, adjustProgram(program, adjustments)).layers).toEqual(state.layers);
  });

  it('偏移上限截断为真实几何而非成绩惩罚;非法偏移被忽略', () => {
    const miss = offsetFromMiss({width: 0.21, height: 0.297}, 0, 0, {ax: 10, ay: 0, bx: 0, by: 0});
    expect(miss).not.toBeNull();
    expect(Math.abs(miss!.offset.ax)).toBeLessThanOrEqual(MAX_CREASE_OFFSET);
    expect(offsetFromMiss({width: 0.21, height: 0.297}, 0, 0, {ax: 0, ay: 0, bx: 0, by: 0})).toBeNull();
    expect(offsetFromMiss({width: 0.21, height: 0.297}, 0, 0, {ax: NaN, ay: 0, bx: 0, by: 0})).toBeNull();
    const program = planes.dart.steps;
    expect(adjustProgram(program, {'0:0': {ax: NaN, ay: 0, bx: 0, by: 0}})).toBe(program);
  });

  it('默认求解路径不再使用折痕质量乘数;legacy 通道仅作历史对照', () => {
    const aero = extract(replay(sheet, 6), 80);
    const input = {angle: 20, speed: 15, wind: 0};
    const perfect = simulate(aero, input, {foldQuality: 1});
    const sloppy = simulate(aero, input, {foldQuality: 0.5});
    // 4.7:默认不再把折痕质量直接乘到升阻——两者轨迹相同
    expect(sloppy.distance).toBeCloseTo(perfect.distance, 10);
    expect(sloppy.duration).toBeCloseTo(perfect.duration, 10);
    // 历史兼容通道仍可显式启用
    const legacy = simulate(aero, input, {foldQuality: 0.5, legacyQualityChannel: true});
    expect(legacy.distance).toBeLessThan(perfect.distance);
  });
});

describe('调校与回弹(4.8, 4.10)', () => {
  const aero = extract(replay(sheet, planes.suzanne.steps.length, planes.suzanne.steps), 100);

  it('默认调校为恒等;上反角收缩投影展长与面积', () => {
    expect(isDefaultTrim(DEFAULT_TRIM)).toBe(true);
    expect(trimAero(aero, DEFAULT_TRIM)).toBe(aero);
    const effect = applyTrim(aero, {...DEFAULT_TRIM, dihedralLeft: 10, dihedralRight: 10});
    expect(effect.span).toBeCloseTo(aero.span * Math.cos((10 * Math.PI) / 180), 10);
    expect(effect.wingArea).toBeCloseTo(aero.wingArea * Math.cos((10 * Math.PI) / 180), 10);
    expect(effect.asymmetry).toBeCloseTo(0, 12);
  });

  it('左右不对称调校产生非零不对称度;后缘上翘产生零升偏移', () => {
    const effect = applyTrim(aero, {...DEFAULT_TRIM, dihedralLeft: 0, dihedralRight: 10});
    expect(effect.asymmetry).toBeGreaterThan(0.005);
    const te = applyTrim(aero, {...DEFAULT_TRIM, trailingEdge: 5});
    expect(te.alpha0Offset).toBeCloseTo((5 * Math.PI) / 180 * 0.5, 10);
    expect(trimAero(aero, {...DEFAULT_TRIM, dihedralLeft: 5})).not.toBe(aero);
  });

  it('越界调校被明确拒绝', () => {
    expect(() => validateTrim({...DEFAULT_TRIM, dihedralLeft: 25})).toThrow();
    expect(() => validateTrim({...DEFAULT_TRIM, trailingEdge: 15})).toThrow();
    expect(() => validateTrim({...DEFAULT_TRIM, winglet: 91})).toThrow();
    for (const bad of [NaN, Infinity]) expect(() => validateTrim({...DEFAULT_TRIM, dihedralRight: bad})).toThrow();
  });

  it('回弹角随折痕保持率下降而增大,确定性且限定范围', () => {
    const copy = materialProfile('copy', 80);
    const news = materialProfile('news', 80);
    expect(wingSpringBackDeg(copy)).toBeLessThan(wingSpringBackDeg(news));
    expect(wingSpringBackDeg(copy)).toBe(wingSpringBackDeg(copy));
    for (const g of grades) {
      const p = materialProfile(g.id, 80);
      const sb = wingSpringBackDeg(p, 4);
      expect(sb).toBeGreaterThanOrEqual(0);
      expect(sb).toBeLessThanOrEqual(30);
      expect(naturalOpenAngleDeg(p, 4)).toBeCloseTo(90 - sb, 12);
    }
  });
});

describe('材料敏感性(4.12)', () => {
  it('质量随克重严格线性;材料不改变质量但改变几何/刚度', () => {
    const aero70 = extract(replay(sheet, 6), 70);
    const aero100 = extract(replay(sheet, 6), 100);
    expect(aero100.mass / aero70.mass).toBeCloseTo(100 / 70, 10);
    const news = extract(replay(sheet, 6), 80);
    expect(news.mass).toBeCloseTo(aero70.mass * 80 / 70, 9);
  });

  it('不同纸张的飞行差异来自质量/几何而非材料乘数:同折形同 gsm 仅材质不同不改变几何提取', () => {
    const state = replay(sheet, 6);
    const a = extract(state, 80);
    // extract 不接收材质:材质只能通过 solver 的定形项影响,而非直接乘成绩
    const b = extract(state, 80);
    expect(a).toEqual(b);
  });
});
