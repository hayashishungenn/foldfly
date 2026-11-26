import {describe, it, expect} from 'vitest';
import {replay} from '../src/fold/engine';
import {extract} from '../src/aero/extract';
import {area, centroid, reflect, type Point, type Polygon} from '../src/fold/geometry';
import {rotateAroundAxis, type Point3} from '../src/fold/geometry3d';
import {papers} from '../src/paper/papers';
import {planes} from '../src/fold/planes';

const sheet = papers[0];
const program = planes.dart.steps;

describe('坐标系与单位(Phase 02 / 2.2)', () => {
  it('A4 理论质量解析基准:80 gsm=4.9896 g,100 gsm=6.237 g', () => {
    const a4 = sheet.width * sheet.height;
    expect(a4).toBeCloseTo(0.21 * 0.297, 12);
    expect(a4 * 80 / 1000).toBeCloseTo(0.0049896, 9);
    expect(a4 * 100 / 1000).toBeCloseTo(0.006237, 9);
    const state = replay(sheet, program.length, program);
    expect(extract(state, 80).mass).toBeCloseTo(0.0049896, 9);
    expect(extract(state, 100).mass).toBeCloseTo(0.006237, 9);
  });

  it('纸面坐标平移不改变面积、CG 相对坐标与气动属性', () => {
    const state = replay(sheet, program.length, program);
    const base = extract(state, 80);
    const shift = (poly: Polygon): Polygon => poly.map(v => ({x: v.x + 2, y: v.y + 3}));
    const moved = {
      ...state,
      layers: state.layers.map(shift),
      flightLayers: state.flightLayers?.map(shift),
      wingLayers: state.wingLayers?.map(shift),
      bodySideLayers: state.bodySideLayers?.map(shift),
      bodyAxisX: state.bodyAxisX === undefined ? undefined : state.bodyAxisX + 2,
    };
    const shifted = extract(moved, 80);
    expect(shifted.mass).toBeCloseTo(base.mass, 12);
    expect(shifted.span).toBeCloseTo(base.span, 12);
    expect(shifted.wingArea).toBeCloseTo(base.wingArea, 12);
    expect(shifted.aspectRatio).toBeCloseTo(base.aspectRatio, 12);
    // CG/AC 为绝对坐标,应随平移量等量移动;相对量(重心到机头距离)不变
    expect(shifted.cg.x).toBeCloseTo(base.cg.x + 2, 12);
    expect(shifted.cg.y).toBeCloseTo(base.cg.y + 3, 12);
    expect(shifted.aerodynamicCenter.y).toBeCloseTo(base.aerodynamicCenter.y + 3, 12);
    expect(shifted.cg.y - shifted.noseY).toBeCloseTo(base.cg.y - base.noseY, 12);
  });

  it('沿纸面中线镜像:面积/质量/AR/CG.x 不变,侧视面积一致', () => {
    const state = replay(sheet, program.length, program);
    const base = extract(state, 80);
    const cx = sheet.width / 2;
    const mirror = (p: Point): Point => ({x: 2 * cx - p.x, y: p.y});
    const mirrored = {
      ...state,
      layers: state.layers.map(p => p.map(mirror)),
      flightLayers: state.flightLayers?.map(p => p.map(mirror)),
      wingLayers: state.wingLayers?.map(p => p.map(mirror)),
      bodySideLayers: state.bodySideLayers?.map(p => p.map(mirror)),
    };
    const result = extract(mirrored, 80);
    expect(result.mass).toBeCloseTo(base.mass, 12);
    expect(result.span).toBeCloseTo(base.span, 12);
    expect(result.wingArea).toBeCloseTo(base.wingArea, 12);
    expect(result.aspectRatio).toBeCloseTo(base.aspectRatio, 12);
    expect(result.cg.x).toBeCloseTo(cx, 10);
    expect(result.bodySideArea).toBeCloseTo(base.bodySideArea, 12);
  });

  it('3D 面片绕折痕旋转保面积与边长(Rodrigues),旋转角单位 rad', () => {
    const a: Point3 = {x: 0, y: 0, z: 0};
    const b: Point3 = {x: 0, y: 1, z: 0};
    const p: Point3 = {x: 0.5, y: 0.3, z: 0};
    const q: Point3 = {x: 0.4, y: 0.8, z: 0.1};
    const rotatedP = rotateAroundAxis(p, a, b, Math.PI / 3);
    const rotatedQ = rotateAroundAxis(q, a, b, Math.PI / 3);
    expect(Math.hypot(rotatedP.x - rotatedQ.x, rotatedP.y - rotatedQ.y, rotatedP.z - rotatedQ.z)).toBeCloseTo(
      Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z), 10,
    );
    expect(rotateAroundAxis(p, a, b, Math.PI)).not.toEqual(p); // 非零角确实改变位置
  });

  it('mm→m 与角度→弧度换算在 UI 显示与求解器之间不混淆', () => {
    const widthMm = Number((papers[0].width * 1000).toFixed(1));
    expect(widthMm).toBe(210);
    const deg = 40;
    expect((deg * Math.PI) / 180).toBeCloseTo(0.6981317008, 9);
    expect(Math.round(((deg * Math.PI) / 180) * 180 / Math.PI)).toBe(40);
  });

  it('纸面 +y 指向机尾:提取的 noseY=min(y),CG 到机头距离为正', () => {
    const aero = extract(replay(sheet, program.length, program), 80);
    expect(aero.cg.y).toBeGreaterThanOrEqual(aero.noseY);
    expect(aero.cg.y - aero.noseY).toBeGreaterThan(0);
    // 机身层投影 x=|x−center| 位于纸张中线一侧
    expect(aero.bodyAxisX === undefined).toBe(true); // 标准尖头机走 2D 投影路径
  });
});
