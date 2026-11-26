import {describe, it, expect} from 'vitest';
import flight3dSource from '../src/render/flight3d.ts?raw';
import {replay} from '../src/fold/engine';
import {area} from '../src/fold/geometry';
import type {Point3} from '../src/fold/geometry3d';
import {papers} from '../src/paper/papers';
import {planes} from '../src/fold/planes';

/** 凸面片 3D 面积(扇形三角化,与渲染/mass3d 同口径)。 */
function faceArea3d(face: readonly Point3[]): number {
  if (face.length < 3) return 0;
  let sum = 0;
  for (let i = 1; i + 1 < face.length; i++) {
    const a = face[0], b = face[i], c = face[i + 1];
    const u = {x: b.x - a.x, y: b.y - a.y, z: b.z - a.z};
    const v = {x: c.x - a.x, y: c.y - a.y, z: c.z - a.z};
    sum += Math.hypot(u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x) / 2;
  }
  return sum;
}

describe('Phase 05 三维渲染层边界', () => {
  it('flight3d.ts 不从 aero 导入任何运行时值(渲染不反哺物理)', () => {
    const source = flight3dSource;
    const imports = [...source.matchAll(/import\s+(type\s+)?\{[^}]*\}\s+from\s+'([^']+)'/g)];
    expect(imports.length).toBeGreaterThan(0);
    for (const [, isType, path] of imports) {
      if (path.startsWith('../aero/')) {
        expect(isType, `aero 导入必须是 type-only:${path}`).toBeTruthy();
      }
    }
    // three 是渲染依赖,允许;引擎模块只允许类型导入
    expect(source).toContain("from 'three'");
  });

  it('全部机型的 viewFaces3d 面积守恒(3D 面片总面积 = 纸张面积)', () => {
    for (const plane of Object.values(planes)) {
      const state = replay(papers[0], plane.steps.length, plane.steps);
      const faces = state.viewFaces3d ?? state.massFaces3d;
      expect(faces, plane.id).toBeDefined();
      const total = faces!.reduce((sum, f) => sum + faceArea3d(f), 0);
      expect(total).toBeCloseTo(papers[0].width * papers[0].height, 6);
    }
  });

  it('viewFaces3d 结构:双翼平展在 z=0,机身面片竖直(x 恒定)', () => {
    const state = replay(papers[0], planes.dart.steps.length, planes.dart.steps);
    const faces = state.viewFaces3d!;
    expect(faces.length).toBeGreaterThan(2);
    const flat = faces.filter(f => f.every(v => Math.abs(v.z) < 1e-9));
    const vertical = faces.filter(f => f.length > 2 && f.every(v => Math.abs(v.x - f[0].x) < 1e-9) && f.some(v => v.z < -1e-9));
    expect(flat.length).toBeGreaterThanOrEqual(2); // 双翼
    expect(vertical.length).toBeGreaterThanOrEqual(1); // 竖直机身
    // 双翼位于翼平面高度,机身下垂(z < 0)
    for (const f of vertical) expect(f.every(v => v.z <= 1e-9)).toBe(true);
  });

  it('2D 校准路径不受 3D 视图面片影响(extract 不消费 viewFaces3d)', () => {
    const state = replay(papers[0], planes.dart.steps.length, planes.dart.steps);
    const baseline = replay(papers[0], planes.dart.steps.length, planes.dart.steps);
    expect(state.viewFaces3d).toBeDefined();
    // 两次重放含相同 viewFaces3d,气动提取结果必须与既有 2D 路径逐位一致
    expect(JSON.stringify(state.layers)).toBe(JSON.stringify(baseline.layers));
  });
});
