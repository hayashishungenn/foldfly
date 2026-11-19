import {describe, it, expect} from 'vitest';
import {nakamura} from '../src/fold/planes/nakamura';
import {replay} from '../src/fold/engine';
import {area} from '../src/fold/geometry';
import {papers} from '../src/paper/papers';
import {extract, aeroMetrics} from '../src/aero/extract';
import {simulate} from '../src/aero/integrator';

describe('Nakamura Lock 折序与气动特性', () => {
  it.each(papers)('$name 每一步均守恒且可重放', sheet => {
    for (let n = 0; n <= nakamura.length; n++) {
      const state = replay(sheet, n, nakamura);
      expect(state.layers.reduce((sum, p) => sum + area(p), 0)).toBeCloseTo(sheet.width * sheet.height, 7);
      expect(state.step).toBe(n);
      expect(replay(sheet, n, nakamura)).toEqual(state);
    }
  });

  it('折后几何提取质量、翼展、翼面积与静稳定度均有效', () => {
    const a = extract(replay(papers[0], nakamura.length, nakamura), 80);
    const m = aeroMetrics(a);
    expect(a.mass).toBeCloseTo(0.0049896, 6);
    expect(a.span).toBeGreaterThan(0.14);
    expect(a.wingArea).toBeGreaterThan(0.018);
    expect(a.cg.x).toBeCloseTo(papers[0].width / 2, 6);
    expect(m.staticMargin).toBeGreaterThan(0.02);
  });

  it('15° 中速释放能进入平稳自稳滑翔', () => {
    const a = extract(replay(papers[0], nakamura.length, nakamura), 80);
    const flight = simulate(a, {angle: 15, speed: 12, wind: 0});
    expect(flight.landed).toBe(true);
    expect(flight.distance).toBeGreaterThan(20);
    expect(flight.duration).toBeGreaterThan(4.0);
  });
});
