/**
 * 纸面拓扑追踪(Phase 03 / 3.2–3.3)。
 *
 * 与现有 FoldState 并行工作:不替换引擎、不改任何机型折序。
 * 对每次折叠调用引擎同款 `splitFold` 剖分,把每个输出面片绑定到父面片,
 * 赋予确定性 ID、来源纸面区域、层序与折痕标识。相同折序重放得到相同拓扑。
 *
 * 层序采用引擎的线性层叠索引(engine.layerGroups 的语义);局部复杂层序
 * (纸袋/锁头的真实前后关系)在 3.8 范围内显式标记为"近似",不作全局保证。
 */
import {initial, line, splitFold, tuckIndex, type FoldState, type Sheet} from './engine';
import {area, reflect, signedArea, type Polygon} from './geometry';
import type {FoldOperation, FoldStep} from './types';

export const TOPOLOGY_VERSION = 1;

export type PatchId = string;
export type PaperPatch = {
  id: PatchId;
  /** 原始整纸面片的 ID 链(根为 'root');切分后子面片继承父链。 */
  ancestry: PatchId[];
  /** 面片来源区域的规范化包围盒(纸面坐标系,m) */
  sourceBox: {x0: number; y0: number; x1: number; y1: number};
  polygon: Polygon;
  /** 面片当前投影的朝向:1=正面朝上,-1=背面朝上(按多边形有向面积判定) */
  side: 1 | -1;
  /** 当前层叠索引(0=底层,越大越靠上);近似值,见模块说明 */
  layer: number;
  /** 创建该面片的折痕步骤;根面片为 -1 */
  createdAtStep: number;
  /** 该面片边界上的折痕标识 */
  creaseId: string | null;
};

export type FoldTopology = {
  version: typeof TOPOLOGY_VERSION;
  sheet: Sheet;
  step: number;
  patches: PaperPatch[];
  /** 当前累积折痕(纸面坐标,来源步骤) */
  creases: {id: string; step: number; a: {x: number; y: number}; b: {x: number; y: number}; kind: 'valley' | 'mountain'}[];
};

const norm = (poly: Polygon): string => JSON.stringify(poly.map(v => [v.x, v.y]));

function boxOf(poly: Polygon): PaperPatch['sourceBox'] {
  const xs = poly.map(v => v.x), ys = poly.map(v => v.y);
  return {x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys)};
}

/** 已验证的复杂度上限:面片数超过该值时明确报错,避免页面无响应(3.16)。 */
export const TOPOLOGY_PATCH_LIMIT = 4000;

/** 追踪整段折序;与 replay 同输入、同剖分原语。 */

export function traceTopology(sheet: Sheet, program: readonly FoldStep[], upTo = program.length): FoldTopology {
  const limit = Math.max(0, Math.min(upTo, program.length));
  let layers: Polygon[] = initial(sheet).layers;
  let groups: number[] = layers.map((_, i) => i);
  let patches: PaperPatch[] = layers.map(poly => ({
    id: 'root', ancestry: ['root'], sourceBox: boxOf(poly), polygon: poly,
    side: 1, layer: 0, createdAtStep: -1, creaseId: null,
  }));
  const creases: FoldTopology['creases'] = [];
  const snapshots: {layers: Polygon[]; groups: number[]; patches: PaperPatch[]}[] = [
    {layers, groups, patches},
  ];

  for (let step = 0; step < limit; step++) {
    const def = program[step];
    if (def.unfold || def.unfoldToStep !== undefined) {
      // 展开步骤:恢复目标步骤快照(与引擎 replay 一致),折痕保留为预折记录
      const target = def.unfoldToStep ?? 0; // 引擎 replay:两者同时存在时以 unfoldToStep 为准
      const snap = snapshots[Math.max(0, Math.min(target, snapshots.length - 1))];
      layers = snap.layers.map(p => p.map(v => ({...v})));
      groups = [...snap.groups];
      patches = snap.patches.map(p => ({...p, ancestry: [...p.ancestry], polygon: p.polygon.map(v => ({...v}))}));
      snapshots.push({
        layers: layers.map(p => p.map(v => ({...v}))),
        groups: [...groups],
        patches: patches.map(p => ({...p, ancestry: [...p.ancestry], polygon: p.polygon.map(v => ({...v}))})),
      });
      continue;
    }
    const ops: readonly FoldOperation[] = def.operations ?? [def];
    for (let oi = 0; oi < ops.length; oi++) {
      const op = ops[oi];
      if (op.flip) {
        layers = layers.reverse().map(p => p.map(v => ({x: sheet.width - v.x, y: v.y})));
        groups = groups.reverse();
        patches = patches.reverse().map(p => ({
          ...p,
          polygon: p.polygon.map(v => ({x: sheet.width - v.x, y: v.y})),
          side: p.side === 1 ? -1 : 1,
        }));
        continue;
      }
      const creaseId = `c${step}.${oi}`;
      const [ca, cb] = line(op, sheet);
      creases.push({id: creaseId, step, a: ca, b: cb, kind: op.kind});

      const before = new Map<string, PaperPatch[]>();
      for (const p of patches) {
        const key = norm(p.polygon);
        const list = before.get(key) ?? [];
        list.push(p);
        before.set(key, list);
      }
      const split = splitFold(layers, groups, sheet, op);
      // 与 engine.foldLayers 完全一致的反射 + 层叠顺序
      const [fa, fb] = line(op, sheet);
      for (const part of split.moving) part.polygon = part.polygon.map(v => reflect(v, fa, fb));
      const inserted = split.moving.slice().reverse();
      const insertAt = op.tuckUnder === undefined
        ? (op.kind === 'mountain' ? 0 : split.still.length)
        : tuckIndex(split.still.map(part => part.group), op.tuckUnder);
      const ordered = [...split.still.slice(0, insertAt), ...inserted, ...split.still.slice(insertAt)];
      const outputs = ordered.map(part => ({
        ...part,
        moving: split.moving.includes(part),
      }));
      const nextPatches: PaperPatch[] = [];
      const used = new Map<string, number>();
      for (const out of outputs) {
        const parentList = before.get(norm(out.polygon)) ?? [];
        const parent = parentList[0];
        // 剖分后多边形坐标改变:按包围盒与父面片包含关系回退匹配
        const fallback = parent ?? patches.find(p => {
          const pb = p.sourceBox, ob = boxOf(out.polygon);
          return ob.x0 >= pb.x0 - 1e-9 && ob.x1 <= pb.x1 + 1e-9 && ob.y0 >= pb.y0 - 1e-9 && ob.y1 <= pb.y1 + 1e-9;
        });
        const base = fallback ?? patches[0];
        const key = base?.id ?? 'root';
        const idx = used.get(key) ?? 0;
        used.set(key, idx + 1);
        const movingSide = out.moving ? (op.kind === 'valley' ? -1 : 1) : base?.side ?? 1;
        nextPatches.push({
          id: `${base?.id ?? 'root'}@${step}.${oi}.${idx}`,
          ancestry: [...(base?.ancestry ?? ['root']), `${step}.${oi}.${idx}`],
          sourceBox: out.moving && base ? base.sourceBox : boxOf(out.polygon),
          polygon: out.polygon,
          side: signedArea(out.polygon) >= 0 ? (movingSide === -1 ? -1 : 1) : movingSide,
          layer: 0,
          createdAtStep: out.moving ? step : (base?.createdAtStep ?? -1),
          creaseId: out.moving ? creaseId : (base?.creaseId ?? null),
        });
      }
      patches = nextPatches;
      if (patches.length > TOPOLOGY_PATCH_LIMIT) {
        throw new Error(`折叠复杂度超出已验证范围(面片 ${patches.length} > ${TOPOLOGY_PATCH_LIMIT})`);
      }
      layers = ordered.map(part => part.polygon);
      groups = ordered.map(part => part.group);
    }
    // 层叠索引由引擎的组序列规范化得出(确定性)
    const uniqueGroups = [...new Set(groups)];
    patches = patches.map((p, i) => ({...p, layer: uniqueGroups.indexOf(groups[i])}));
    snapshots.push({
      layers: layers.map(p => p.map(v => ({...v}))),
      groups: [...groups],
      patches: patches.map(p => ({...p, ancestry: [...p.ancestry], polygon: p.polygon.map(v => ({...v}))})),
    });
  }
  return {version: TOPOLOGY_VERSION, sheet, step: limit, patches, creases};
}

/** 面积守恒:追踪面片材料面积总和必须等于纸张面积(与层叠投影无关)。 */
export function topologyMaterialArea(topology: FoldTopology): number {
  return topology.patches.reduce((sum, p) => sum + area(p.polygon), 0);
}

/** 来源回溯:给定面片 ID,返回其原始纸面区域包围盒链。 */
export function provenanceOf(topology: FoldTopology, id: PatchId): PaperPatch['sourceBox'] | null {
  return topology.patches.find(p => p.id === id)?.sourceBox ?? null;
}
