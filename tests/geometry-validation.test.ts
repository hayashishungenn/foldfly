import {describe, it, expect} from 'vitest';
import {extract, aeroMetrics} from '../src/aero/extract';
import {replay} from '../src/fold/engine';
import {deploySlopedWings} from '../src/fold/deploy';
import {area, centroid, type Polygon} from '../src/fold/geometry';
import {papers} from '../src/paper/papers';
import {planes} from '../src/fold/planes';

const rect = (x0: number, x1: number, y0: number, y1: number): Polygon => [
  {x: x0, y: y0}, {x: x1, y: y0}, {x: x1, y: y1}, {x: x0, y: y1},
];

describe('几何提取解析验证(Phase 02 / 2.3)', () => {
  it('面积守恒:全部机型每步面积=纸张面积,质量=A4×gsm/1000', () => {
    const sheet = papers[0];
    for (const def of Object.values(planes)) {
      for (let n = 0; n <= def.steps.length; n++) {
        const state = replay(sheet, n, def.steps);
        const total = state.layers.reduce((s, p) => s + area(p), 0);
        expect(total, `${def.id}@${n}`).toBeCloseTo(sheet.width * sheet.height, 8);
      }
      for (const gsm of [70, 80, 100] as const) {
        const a = extract(replay(sheet, def.steps.length, def.steps), gsm);
        expect(a.mass, `${def.id}@${gsm}`).toBeCloseTo(sheet.width * sheet.height * gsm / 1000, 9);
      }
    }
  });

  it('直翼解析构型:矩形翼层面积、CG、翼展、展弦比与惯量可独立计算', () => {
    // 两片完全相同、直接叠放的矩形(模拟重叠机头层):材料面积 2×,受力投影面积 1×
    const wing = rect(0.4, 0.8, 0.1, 0.9);
    const layers = [wing, wing];
    const a = extract({layers, flightLayers: layers, wingLayers: [wing], step: 0}, 80);
    expect(a.wingArea).toBeCloseTo(area(wing), 10); // 并集不重复计受力面积
    expect(a.mass).toBeCloseTo(2 * area(wing) * 0.08, 10); // 但质量保留两层
    expect(a.span).toBeCloseTo(0.4, 10);
    expect(a.aspectRatio).toBeCloseTo(0.4 * 0.4 / area(wing), 10);
    const c = centroid(wing);
    expect(a.cg.x).toBeCloseTo(c.x, 10);
    expect(a.cg.y).toBeCloseTo(c.y, 10);
    // 均匀板绕质心的纵向二阶矩 m·h²/12
    const h = 0.9 - 0.1;
    expect(a.pitchInertia).toBeCloseTo(2 * area(wing) * 0.08 * h * h / 12, 9);
  });

  it('非对称翼层:质量加权重心偏移,翼面并集不重复计重叠', () => {
    const wide = rect(0.0, 0.6, 0.0, 1.0);
    const narrow = rect(0.3, 0.5, 0.0, 1.0); // 完全落在 wide 内部
    const a = extract({layers: [wide, narrow], flightLayers: [wide, narrow], wingLayers: [wide, narrow], step: 0}, 80);
    expect(a.wingArea).toBeCloseTo(area(wide), 10); // 并集=大片
    expect(a.mass).toBeCloseTo((area(wide) + area(narrow)) * 0.08, 10); // 质量=两层
    const expectedCg = (area(wide) * centroid(wide).x + area(narrow) * centroid(narrow).x) / (area(wide) + area(narrow));
    expect(a.cg.x).toBeCloseTo(expectedCg, 10);
  });

  it('斜翼根:deploySlopedWings 的 3D 面片面积守恒,斜根与平根投影不同', () => {
    const sheet = papers[0];
    const layers = [{x: 0, y: 0}, {x: sheet.width, y: 0}, {x: sheet.width, y: sheet.height}, {x: 0, y: sheet.height}];
    const center = sheet.width / 2;
    const sloped = deploySlopedWings([layers], center, {x: center + 0.03, y: 0.05}, {x: center + 0.03, y: sheet.height - 0.05});
    const flat = deploySlopedWings([layers], center, {x: center + 0.03, y: 0}, {x: center + 0.03, y: sheet.height});
    const total3d = (faces: {x: number; y: number; z: number}[][]) =>
      faces.reduce((sum, face) => {
        let a3 = 0;
        for (let i = 1; i + 1 < face.length; i++) {
          const u = {x: face[i].x - face[0].x, y: face[i].y - face[0].y, z: face[i].z - face[0].z};
          const v = {x: face[i + 1].x - face[0].x, y: face[i + 1].y - face[0].y, z: face[i + 1].z - face[0].z};
          a3 += Math.hypot(u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x) / 2;
        }
        return sum + a3;
      }, 0);
    expect(total3d(sloped.massFaces3d)).toBeCloseTo(sheet.width * sheet.height, 6);
    expect(total3d(flat.massFaces3d)).toBeCloseTo(sheet.width * sheet.height, 6);
    expect(sloped.wingLayers).not.toEqual(flat.wingLayers); // 斜根投影确实不同
  });

  it('重叠机头层:质量不丢失且受力翼面积不重复,静稳定余量与翼载荷为有限正值', () => {
    const a = extract(replay(papers[0], planes.mach5.steps.length, planes.mach5.steps), 100);
    const m = aeroMetrics(a);
    expect(a.mass).toBeCloseTo(0.006237, 9);
    expect(a.wingArea).toBeGreaterThan(0);
    expect(a.wingArea).toBeLessThan(papers[0].width * papers[0].height);
    expect(a.pitchInertia).toBeGreaterThan(0);
    expect(m.staticMargin).toBeGreaterThan(0);
    expect(m.wingLoading).toBeGreaterThan(0);
    expect(Number.isFinite(m.wingLoading)).toBe(true);
  });

  it('A4 100 gsm 理论质量 6.237 g 与全部机型提取一致', () => {
    for (const def of Object.values(planes)) {
      const a = extract(replay(papers[0], def.steps.length, def.steps), 100);
      expect(a.mass, def.id).toBeCloseTo(0.006237, 9);
    }
  });
});
