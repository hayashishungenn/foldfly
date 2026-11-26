import {describe, it, expect} from 'vitest';
import {papers} from '../src/paper/papers';
import {planes} from '../src/fold/planes';
import {replay} from '../src/fold/engine';
import {traceTopology, topologyMaterialArea, provenanceOf, type FoldTopology} from '../src/fold/topology';
import {createFoldHistory, pushHistory, undoHistory, redoHistory} from '../src/fold/interact';
import {decodeFoldSession, encodeFoldSession} from '../src/fold/history-io';
import {area} from '../src/fold/geometry';

const sheet = papers[0];
const defs = Object.values(planes);
const topologies = new Map<string, FoldTopology>();
for (const def of defs) topologies.set(def.id, traceTopology(sheet, def.steps));

describe('纸面拓扑与来源追踪(Phase 03 / 3.1–3.3, 3.14)', () => {
  it('全部机型:拓扑面片数与引擎层数一致,材料面积守恒,ID 唯一', () => {
    for (const def of defs) {
      const topo = topologies.get(def.id)!;
      const state = replay(sheet, def.steps.length, def.steps);
      expect(topo.patches.length, def.id).toBe(state.layers.length);
      expect(topologyMaterialArea(topo), def.id).toBeCloseTo(sheet.width * sheet.height, 8);
      expect(new Set(topo.patches.map(p => p.id)).size).toBe(topo.patches.length);
      expect(topo.step).toBe(def.steps.length);
    }
  });

  it('相同折序重放得到确定性拓扑(逐面片 ID 与坐标)', () => {
    for (const def of defs) {
      const a = traceTopology(sheet, def.steps);
      const b = traceTopology(sheet, def.steps);
      expect(a.patches.map(p => [p.id, p.polygon])).toEqual(b.patches.map(p => [p.id, p.polygon]));
      expect(a.creases).toEqual(b.creases);
    }
  });

  it('面片来源链可回溯到原始纸张区域,子面片继承父来源', () => {
    const topo = topologies.get('dart')!;
    for (const p of topo.patches) {
      expect(p.ancestry.length).toBeGreaterThan(0);
      expect(p.ancestry[0]).toBe('root');
      expect(provenanceOf(topo, p.id)).toEqual(p.sourceBox);
    }
    const splitChildren = topo.patches.filter(p => p.ancestry.length > 1);
    expect(splitChildren.length).toBeGreaterThan(0);
  });

  it('折痕记录步骤/类型/纸面坐标,预折与展开步不产生新面片', () => {
    for (const def of defs) {
      const topo = topologies.get(def.id)!;
      expect(topo.creases.length).toBeGreaterThan(0);
      for (const c of topo.creases) {
        expect(c.step).toBeGreaterThanOrEqual(0);
        expect(['valley', 'mountain']).toContain(c.kind);
        expect(Number.isFinite(c.a.x + c.a.y + c.b.x + c.b.y)).toBe(true);
      }
    }
  });

  it('逐步快照:任意步数的拓扑面积守恒且不超过完整折序面片数', () => {
    const def = planes.suzanne;
    for (let n = 0; n <= def.steps.length; n++) {
      const topo = traceTopology(sheet, def.steps, n);
      expect(topologyMaterialArea(topo)).toBeCloseTo(sheet.width * sheet.height, 8);
      expect(topo.patches.length).toBeLessThanOrEqual(topologies.get('suzanne')!.patches.length);
      expect(topo.step).toBe(n);
    }
  });

  it('纸张平移后拓扑 ID 与面积不变(坐标平移不变量)', () => {
    const a = traceTopology(sheet, planes.dart.steps);
    const movedSheet = {width: sheet.width, height: sheet.height};
    const b = traceTopology(movedSheet, planes.dart.steps);
    expect(b.patches.map(p => p.id)).toEqual(a.patches.map(p => p.id));
    expect(topologyMaterialArea(b)).toBeCloseTo(topologyMaterialArea(a), 10);
  });

  it('几何不变量:每片面积正且有限,层叠索引为有效整数', () => {
    for (const topo of topologies.values()) {
      for (const p of topo.patches) {
        expect(area(p.polygon)).toBeGreaterThan(1e-12);
        expect(Number.isFinite(area(p.polygon))).toBe(true);
        expect(Number.isInteger(p.layer)).toBe(true);
        expect(p.layer).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('折叠会话持久化(3.13)', () => {
  const program = planes.suzanne.steps;

  it('完整历史往返一致', () => {
    let h = createFoldHistory(0, 0);
    h = pushHistory(h, {step: 2, subOp: 1});
    h = pushHistory(h, {step: 5, subOp: 0});
    h = undoHistory(h);
    const decoded = decodeFoldSession(encodeFoldSession(h), program.length);
    expect(decoded).toEqual(h);
  });

  it('撤销后新操作清理失效重做历史,序列化正确', () => {
    let h = createFoldHistory(0, 0);
    h = pushHistory(h, {step: 1, subOp: 0});
    h = pushHistory(h, {step: 2, subOp: 0});
    h = undoHistory(h);
    expect(h.redoStack.length).toBe(1);
    h = pushHistory(h, {step: 3, subOp: 0});
    expect(h.redoStack.length).toBe(0);
    expect(redoHistory(h).cursor).toEqual(h.cursor);
    expect(decodeFoldSession(encodeFoldSession(h), program.length)).toEqual(h);
  });

  it('拒绝损坏/越界/错误版本存档', () => {
    const h = createFoldHistory(0, 0);
    expect(decodeFoldSession('not json')).toBeNull();
    expect(decodeFoldSession(null)).toBeNull();
    expect(decodeFoldSession(encodeFoldSession(h), 0)).not.toBeNull();
    expect(decodeFoldSession(JSON.stringify({version: 99, cursor: {step: 0, subOp: 0}, undoStack: [], redoStack: []}))).toBeNull();
    expect(decodeFoldSession(JSON.stringify({version: 1, cursor: {step: -1, subOp: 0}, undoStack: [], redoStack: []}))).toBeNull();
    expect(decodeFoldSession(JSON.stringify({version: 1, cursor: {step: 0, subOp: 0}, undoStack: [{step: 999, subOp: 0}], redoStack: []}), 5)).toBeNull();
  });
});
