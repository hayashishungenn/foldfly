/**
 * 统一三维几何输出(Phase 03 / 3.11):渲染层与气动层消费同一份实际折叠几何。
 * 兼容两条既有来源:3D 折痕路径(massFaces3d)与水平翼根投影路径(viewFaces3d)。
 */
import type {FoldState, Sheet} from './engine';
import type {Point3} from './geometry3d';
import {signedArea, type Polygon} from './geometry';
import {traceTopology} from './topology';
import type {FoldStep} from './types';
import type {PaperPatch} from './topology';

export type Face3D = {
  vertices: Point3[];
  normal: {x: number; y: number; z: number};
  area: number;
  layer: number;
  sourcePatchId: string | null;
  kind: 'wing' | 'body' | 'folded';
};

export type FoldedGeometry3D = {
  faces: Face3D[];
  bbox: {min: Point3; max: Point3};
  /** 可直接送入 WebGL 的三角化顶点(每三个顶点一三角形) */
  triangles: number[];
  source: 'massFaces3d' | 'viewFaces3d';
};

function normalOf(face: readonly Point3[]): Face3D['normal'] {
  if (face.length < 3) return {x: 0, y: 1, z: 0};
  const u = {x: face[1].x - face[0].x, y: face[1].y - face[0].y, z: face[1].z - face[0].z};
  const v = {x: face[2].x - face[0].x, y: face[2].y - face[0].y, z: face[2].z - face[0].z};
  const n = {x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x};
  const len = Math.hypot(n.x, n.y, n.z);
  return len > 1e-12 ? {x: n.x / len, y: n.y / len, z: n.z / len} : {x: 0, y: 1, z: 0};
}

function polyArea3(face: readonly Point3[]): number {
  if (face.length < 3) return 0;
  let total = 0;
  for (let i = 1; i + 1 < face.length; i++) {
    const u = {x: face[i].x - face[0].x, y: face[i].y - face[0].y, z: face[i].z - face[0].z};
    const v = {x: face[i + 1].x - face[0].x, y: face[i + 1].y - face[0].y, z: face[i + 1].z - face[0].z};
    total += Math.hypot(u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x) / 2;
  }
  return total;
}

/** 从折叠状态生成统一 3D 几何(纯函数)。 */
export function foldedGeometry3D(
  state: FoldState,
  sheet: Sheet,
  program?: readonly FoldStep[],
  topologyPatches?: PaperPatch[],
): FoldedGeometry3D {
  const source = state.viewFaces3d ? 'viewFaces3d' : 'massFaces3d';
  const faces3d = state.viewFaces3d ?? state.massFaces3d ?? [];
  const patches = topologyPatches ?? (program ? traceTopology(sheet, program, state.step).patches : []);
  const min = {x: Infinity, y: Infinity, z: Infinity};
  const max = {x: -Infinity, y: -Infinity, z: -Infinity};
  const triangles: number[] = [];
  const faces: Face3D[] = faces3d.map((face, i) => {
    for (const v of face) {
      min.x = Math.min(min.x, v.x); min.y = Math.min(min.y, v.y); min.z = Math.min(min.z, v.z);
      max.x = Math.max(max.x, v.x); max.y = Math.max(max.y, v.y); max.z = Math.max(max.z, v.z);
    }
    for (let k = 1; k + 1 < face.length; k++) {
      triangles.push(face[0].x, face[0].y, face[0].z, face[k].x, face[k].y, face[k].z, face[k + 1].x, face[k + 1].y, face[k + 1].z);
    }
    const wing = state.wingLayers ?? [];
    const body = state.bodySideLayers ?? [];
    const projected = face.map(v => ({x: v.x, y: v.y}));
    const isBody = body.some(p => signedArea(p) > 0 && projected.length === p.length);
    const isWing = wing.some(p => projected.length === p.length && p.every((v, j) => Math.abs(v.x - projected[j].x) < 1e-6 && Math.abs(v.y - projected[j].y) < 1e-6));
    return {
      vertices: face.map(v => ({...v})),
      normal: normalOf(face),
      area: polyArea3(face),
      layer: patches[i]?.layer ?? 0,
      sourcePatchId: patches[i]?.id ?? null,
      kind: isBody ? 'body' : isWing ? 'wing' : 'folded',
    };
  });
  return {
    faces,
    bbox: faces.length ? {min, max} : {min: {x: 0, y: 0, z: 0}, max: {x: 0, y: 0, z: 0}},
    triangles,
    source,
  };
}
