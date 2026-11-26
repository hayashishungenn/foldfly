import {describe, it, expect} from 'vitest';
import {replay} from '../src/fold/engine';
import {papers} from '../src/paper/papers';
import {planes} from '../src/fold/planes';
import {foldedGeometry3D} from '../src/fold/geometry-out';
import {topologyMaterialArea, traceTopology} from '../src/fold/topology';
import type {FoldStep} from '../src/fold/types';
import {area} from '../src/fold/geometry';

const sheet = papers[0];

describe('统一三维几何输出(Phase 03 / 3.11)', () => {
  it('全部机型输出面片、法向量、面积、包围盒与三角网格,面积与纸张一致', () => {
    for (const def of Object.values(planes)) {
      const state = replay(sheet, def.steps.length, def.steps);
      const geo = foldedGeometry3D(state, sheet, def.steps);
      expect(geo.faces.length, def.id).toBeGreaterThan(0);
      const total = geo.faces.reduce((s, f) => s + f.area, 0);
      expect(total, def.id).toBeCloseTo(sheet.width * sheet.height, 6);
      expect(geo.triangles.length % 9).toBe(0);
      expect(geo.triangles.length / 9).toBeGreaterThanOrEqual(geo.faces.length);
      for (const f of geo.faces) {
        expect(Math.abs(Math.hypot(f.normal.x, f.normal.y, f.normal.z) - 1)).toBeLessThan(1e-9);
        expect(f.area).toBeGreaterThan(0);
        expect(f.kind === 'wing' || f.kind === 'body' || f.kind === 'folded').toBe(true);
      }
      const {min, max} = geo.bbox;
      expect(max.x - min.x).toBeGreaterThan(0);
      expect(max.y - min.y).toBeGreaterThan(0);
    }
  });

  it('气动层与渲染层共享同一折叠状态(3D 面片来源与拓扑面片数一致)', () => {
    for (const id of ['dart', 'suzanne', 'mach5'] as const) {
      const def = planes[id];
      const state = replay(sheet, def.steps.length, def.steps);
      const topo = traceTopology(sheet, def.steps);
      const geo = foldedGeometry3D(state, sheet, def.steps, topo.patches);
      expect(state.viewFaces3d ?? state.massFaces3d).toBeDefined();
      expect(geo.faces.length).toBe(topo.patches.length);
      expect(geo.faces.every(f => f.sourcePatchId !== null)).toBe(true);
    }
  });

  it('任意倾斜翼根(openRoot):展翼面积守恒且输出 3D 几何', () => {
    const steps: FoldStep[] = [
      {title: '中线', description: '', kind: 'valley', a: [0.5, 0], b: [0.5, 1], sign: 1},
      {title: '机身', description: '', kind: 'mountain', a: [0.5, 0], b: [0.5, 1], sign: 1},
      {
        title: '斜根展翼', description: '', kind: 'valley', a: [0.62, 0], b: [0.7, 1], sign: -1, openToStep: 1,
        openRoot: {a: [0.62, 0], b: [0.7, 1], sign: -1},
      },
    ];
    const state = replay(sheet, steps.length, steps);
    expect(state.flightLayers).toBeDefined();
    const total = (state.flightLayers ?? []).reduce((s, p) => s + area(p), 0);
    // deploySlopedWings 对斜根投影的裁剪是文档化近似:误差 ≤0.2%(AERO-AUDIT 记录)
    expect(Math.abs(total - sheet.width * sheet.height) / (sheet.width * sheet.height)).toBeLessThan(0.002);
    const geo = foldedGeometry3D(state, sheet, steps);
    expect(geo.faces.length).toBeGreaterThan(0);
    expect(Math.abs(geo.faces.reduce((s, f) => s + f.area, 0) - total) / total).toBeLessThan(0.01);
    expect(geo.source).toBe('massFaces3d');
  });

  it('非法翼根(零长度)明确拒绝,不静默产生错误几何', () => {
    const steps: FoldStep[] = [
      {title: '中线', description: '', kind: 'valley', a: [0.5, 0], b: [0.5, 1], sign: 1},
      {title: '机身', description: '', kind: 'mountain', a: [0.5, 0], b: [0.5, 1], sign: 1},
      {
        title: '坏翼根', description: '', kind: 'valley', a: [0.62, 0], b: [0.7, 1], sign: -1, openToStep: 1,
        openRoot: {a: [0.62, 0.5], b: [0.62, 0.5], sign: -1},
      },
    ];
    expect(() => replay(sheet, steps.length, steps)).toThrow();
  });

  it('拓扑材料面积与 3D 面片面积互相印证', () => {
    for (const id of ['dart', 'skyking'] as const) {
      const def = planes[id];
      const topo = traceTopology(sheet, def.steps);
      const state = replay(sheet, def.steps.length, def.steps);
      expect(topologyMaterialArea(topo)).toBeCloseTo(foldedGeometry3D(state, sheet, def.steps).faces.reduce((s, f) => s + f.area, 0), 6);
    }
  });
});
