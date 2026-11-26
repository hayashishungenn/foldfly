import {describe, it, expect} from 'vitest';
import {
  buildDesign,
  decodeDesign,
  designSignature,
  designToSteps,
  encodeDesign,
  FREESTYLE_PLANE_ID,
  MAX_FREESTYLE_CREASES,
  validateCrease,
  type FreestyleCrease,
} from '../src/fold/freestyle';
import {replay} from '../src/fold/engine';
import {area} from '../src/fold/geometry';
import {extract} from '../src/aero/extract';
import {simulate} from '../src/aero/integrator';
import {papers} from '../src/paper/papers';

const centerFold: FreestyleCrease = {a: [0.5, 0], b: [0.5, 1], kind: 'valley', layer: 'all'};
const wingOpen: FreestyleCrease = {a: [0.75, 0], b: [0.75, 1], kind: 'valley', layer: 'all', open: true};

describe('自由折纸设计(Phase 03 纯逻辑)', () => {
  it('校验合法折痕并拒绝端点越界、重合与非有限坐标', () => {
    expect(validateCrease(centerFold)).toEqual(centerFold);
    for (const bad of [
      {a: [0.5, -0.1], b: [0.5, 1], kind: 'valley', layer: 'all'},
      {a: [1.2, 0], b: [0.5, 1], kind: 'valley', layer: 'all'},
      {a: [0.5, 0], b: [0.5, NaN], kind: 'valley', layer: 'all'},
      {a: [0.5, 0.5], b: [0.5, 0.5], kind: 'valley', layer: 'all'},
      {a: [0.5, 0], b: [0.5, 1], kind: 'reverse', layer: 'all'},
      {a: [0.5, 0], b: [0.5, 1], kind: 'valley', layer: 'bottom'},
      {a: [0.5, 0], b: [0.5, 1], kind: 'valley', layer: 'all', open: 'yes'},
      null,
    ]) {
      expect(() => validateCrease(bad)).toThrow();
    }
  });

  it('构建设计时拒绝未知纸张、空名称和超过上限的折痕', () => {
    expect(() => buildDesign('a4', '我的设计', [centerFold])).not.toThrow();
    expect(() => buildDesign('a3' as never, '我的设计', [centerFold])).toThrow();
    expect(() => buildDesign('a4', '   ', [centerFold])).toThrow();
    expect(() => buildDesign('a4', 'x', Array.from({length: MAX_FREESTYLE_CREASES + 1}, () => centerFold))).toThrow();
  });

  it('折痕序列可被折叠引擎重放:中间折叠态面积有限,展翼投影恢复整纸面积', () => {
    const design = buildDesign('a4', '对称滑翔机', [centerFold, wingOpen]);
    const program = designToSteps(design);
    const sheet = papers[0];
    // 中间态:折叠层叠面积应为正、有限,且不超过整纸面积
    for (let i = 0; i < program.length; i++) {
      const state = replay(sheet, i, program);
      const total = state.layers.reduce((sum, p) => sum + area(p), 0);
      expect(total).toBeGreaterThan(0);
      expect(total).toBeLessThanOrEqual(sheet.width * sheet.height + 1e-9);
    }
    // 展翼后的平面投影(flightLayers = 双翼 + 机身)应恢复整纸面积
    const final = replay(sheet, program.length, program);
    const total = final.flightLayers!.reduce((sum, p) => sum + area(p), 0);
    expect(total).toBeCloseTo(sheet.width * sheet.height, 8);
    const aero = extract(final, 80);
    expect(aero.mass).toBeCloseTo(0.0049896, 6);
    expect(aero.span).toBeGreaterThan(0);
  });

  it('自由折产物可直接模拟飞行并落地', () => {
    const design = buildDesign('a4', '对称滑翔机', [centerFold, wingOpen]);
    const aero = extract(replay(papers[0], designToSteps(design).length, designToSteps(design)), 80);
    const flight = simulate(aero, {angle: 20, speed: 15, wind: 0});
    expect(flight.landed).toBe(true);
    expect(Number.isFinite(flight.distance)).toBe(true);
    expect(flight.distance).toBeGreaterThan(0);
  });

  it('引擎无法表达的展翼折序抛出明确错误,而不是静默近似', () => {
    // 对角线折痕上做展翼投影:翼根折线非水平,应被拒绝
    const design = buildDesign('a4', '非法展翼', [
      centerFold,
      {a: [0.5, 0.5], b: [1, 1], kind: 'valley', layer: 'all', open: true},
    ]);
    const program = designToSteps(design);
    expect(() => replay(papers[0], program.length, program)).toThrow();
  });

  it('序列化往返一致,签名随内容变化', () => {
    const design = buildDesign('a4', '往返设计', [centerFold, {a: [0.3, 0], b: [0.3, 1], kind: 'mountain', layer: 'top'}]);
    const decoded = decodeDesign(encodeDesign(design))!;
    expect(decoded.creases).toEqual(design.creases);
    expect(decoded.name).toBe('往返设计');
    expect(decoded.sheet).toBe('a4');
    expect(designSignature(design)).not.toBe(designSignature(buildDesign('a4', '往返设计', [centerFold])));
    expect(decodeDesign(encodeDesign(design))).toEqual(decodeDesign(encodeDesign(design)));
  });

  it('拒绝篡改、未知版本、超长与畸形数据', () => {
    const design = buildDesign('a4', '篡改测试', [centerFold]);
    const encoded = encodeDesign(design);
    const tampered = JSON.stringify({...JSON.parse(encoded), creases: [{...centerFold, a: [0.4, 0]}]});
    expect(decodeDesign(tampered)).toBeNull();
    expect(decodeDesign(JSON.stringify({...JSON.parse(encoded), version: 2}))).toBeNull();
    expect(decodeDesign(JSON.stringify({...JSON.parse(encoded), signature: '00000000'}))).toBeNull();
    expect(decodeDesign('not json')).toBeNull();
    expect(decodeDesign(null)).toBeNull();
    expect(decodeDesign('x'.repeat(100001))).toBeNull();
    // 无签名的旧数据仍可读取(向后兼容本地存档)
    const unsigned = JSON.stringify(design);
    expect(decodeDesign(unsigned)?.creases).toEqual([centerFold]);
  });

  it('自由设计使用专用平面标识,不与预设机型混淆', () => {
    expect(FREESTYLE_PLANE_ID).not.toHaveProperty('steps');
    expect(FREESTYLE_PLANE_ID).toBe('freestyle');
  });
});
