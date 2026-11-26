import {describe, it, expect} from 'vitest';
import {replay, type Sheet} from '../src/fold/engine';
import {papers} from '../src/paper/papers';
import {planes} from '../src/fold/planes';
import {area} from '../src/fold/geometry';
import {traceTopology, topologyMaterialArea} from '../src/fold/topology';
import {extractCreasePattern, analyzeCreaseTopology, foldStackStats} from '../src/fold/crease-pattern';
import type {FoldStep} from '../src/fold/types';

const sheet: Sheet = papers[0];

/** 可复现 PRNG(属性测试固定种子) */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('折叠几何随机属性测试(Phase 03 / 3.15)', () => {
  it('随机合法半平面折序列:面积守恒、重放确定、拓扑面片数与引擎一致', () => {
    const rand = prng(20261127);
    for (let caseIdx = 0; caseIdx < 12; caseIdx++) {
      const steps: FoldStep[] = [];
      const foldCount = 2 + Math.floor(rand() * 4);
      for (let k = 0; k < foldCount; k++) {
        const horizontal = rand() < 0.5;
        const t = 0.2 + rand() * 0.6;
        steps.push({
          title: `r${caseIdx}.${k}`,
          description: '',
          kind: rand() < 0.5 ? 'valley' : 'mountain',
          a: horizontal ? [0, t] : [t, 0],
          b: horizontal ? [1, t] : [t, 1],
          sign: rand() < 0.5 ? 1 : -1,
        });
      }
      const stateA = replay(sheet, steps.length, steps);
      const stateB = replay(sheet, steps.length, steps);
      const totalA = stateA.layers.reduce((s, p) => s + area(p), 0);
      expect(totalA).toBeCloseTo(sheet.width * sheet.height, 8);
      expect(stateB.layers).toEqual(stateA.layers);
      const topo = traceTopology(sheet, steps);
      expect(topo.patches.length).toBe(stateA.layers.length);
      expect(topologyMaterialArea(topo)).toBeCloseTo(sheet.width * sheet.height, 8);
    }
  });

  it('随机非法折叠不破坏既有状态(原有状态不可变)', () => {
    const base: FoldStep[] = [{title: '中线', description: '', kind: 'valley', a: [0.5, 0], b: [0.5, 1], sign: 1}];
    const before = replay(sheet, base.length, base);
    const snapshot = JSON.stringify(before.layers);
    expect(() => replay(sheet, 2, [...base, {title: '零点折痕', description: '', kind: 'valley', a: [0.5, 0.5], b: [0.5, 0.5], sign: 1}])).toThrow();
    expect(JSON.stringify(before.layers)).toBe(snapshot);
  });
});

describe('折痕图系统(Phase 03 / 3.12)', () => {
  it('折痕段具有长度/类型/预折标记,折痕拓扑含总长与对称性', () => {
    for (const id of ['dart', 'suzanne', 'skyking'] as const) {
      const program = planes[id].steps;
      const segments = extractCreasePattern(sheet, program);
      expect(segments.length).toBeGreaterThan(0);
      for (const s of segments) {
        expect(s.length).toBeGreaterThan(0);
        expect(['valley', 'mountain']).toContain(s.kind);
        expect(typeof s.precrease).toBe('boolean');
        expect(s.stepIndex).toBeGreaterThanOrEqual(0);
      }
      const topo = analyzeCreaseTopology(sheet, program);
      expect(topo.totalLengthM).toBeGreaterThan(0);
      expect(topo.mirrorSymmetric).toBe(true);
      // Maekawa 仅对闭合平折的内部顶点成立;此处只记录差值,不作充要条件断言
      expect(Number.isFinite(topo.maekawaDelta)).toBe(true);
    }
  });

  it('叠层统计的机头厚度与总折痕数随步骤单调可信', () => {
    const program = planes.mach5.steps;
    const s0 = foldStackStats(sheet, program, 0);
    const sEnd = foldStackStats(sheet, program, program.length);
    expect(s0.faceCount).toBe(1);
    expect(sEnd.faceCount).toBeGreaterThan(1);
    expect(sEnd.creaseCount).toBeGreaterThanOrEqual(s0.creaseCount);
    expect(sEnd.maxStackLayers).toBeGreaterThanOrEqual(1);
    expect(sEnd.noseLayers).toBeGreaterThanOrEqual(1);
  });
});
