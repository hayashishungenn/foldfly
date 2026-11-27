/**
 * 结构分析数据(Phase 04 / 4.11):左右翼面积、对称度、局部折层与刚度估计。
 * 全部由折叠几何计算;经验估计量带显式标记,不显示无依据的虚假精度。
 */
import type {FoldState} from '../fold/engine';
import {area, clip, type Polygon} from '../fold/geometry';
import type {MaterialProfile} from './material';
import {structuralStiffness, type StructuralStiffness} from './stack';

export type WingSideAnalysis = {
  leftArea: number;
  rightArea: number;
  /** 0 = 完全对称,1 = 仅单侧有翼 */
  asymmetry: number;
  leftSpan: number;
  rightSpan: number;
};

function bbox(polys: readonly Polygon[]) {
  const pts = polys.flat();
  return {
    minX: Math.min(...pts.map(p => p.x)), maxX: Math.max(...pts.map(p => p.x)),
    minY: Math.min(...pts.map(p => p.y)), maxY: Math.max(...pts.map(p => p.y)),
  };
}

/** 按翼面中心线拆分左右翼面积与展长(纯几何)。 */
export function wingSideAnalysis(state: FoldState): WingSideAnalysis {
  const wings = state.wingLayers ?? state.layers;
  const {minX, maxX} = bbox(wings);
  const center = (minX + maxX) / 2;
  const axisA = {x: center, y: -1e6};
  const axisB = {x: center, y: 1e6};
  let leftArea = 0;
  let rightArea = 0;
  let leftMax = minX;
  let rightMin = maxX;
  for (const poly of wings) {
    const left = clip(poly, axisA, axisB, -1);
    const right = clip(poly, axisA, axisB, 1);
    if (left.length >= 3) {
      leftArea += area(left);
      for (const v of left) leftMax = Math.max(leftMax, v.x);
    }
    if (right.length >= 3) {
      rightArea += area(right);
      for (const v of right) rightMin = Math.min(rightMin, v.x);
    }
  }
  const total = leftArea + rightArea;
  const leftSpan = Math.max(0, center - minX);
  const rightSpan = Math.max(0, maxX - center);
  return {
    leftArea,
    rightArea,
    asymmetry: total > 1e-12 ? Math.abs(leftArea - rightArea) / total : 0,
    leftSpan: leftSpan,
    rightSpan,
  };
}

/** 结构刚度估计(经验,范围标注)。layers 取该机型典型折层数(由 UI 提供)。 */
export function stiffnessEstimate(profile: MaterialProfile, layers: number): StructuralStiffness & {confidence: string} {
  return {...structuralStiffness(profile, layers, 'md'), confidence: '经验估算:层间黏合/滑移界之间,未实测'};
}
