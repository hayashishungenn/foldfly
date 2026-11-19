import {describe, it, expect} from 'vitest';
import {blackburn} from '../src/fold/planes/blackburn';
import {replay} from '../src/fold/engine';
import {area} from '../src/fold/geometry';
import {papers} from '../src/paper/papers';
import {extract, aeroMetrics} from '../src/aero/extract';
import {simulate} from '../src/aero/integrator';

describe('Blackburn Glider 折序与气动特性', () => {
  it.each(papers)('$name 每一步均守恒且可重放', sheet => {
    for (let n = 0; n <= blackburn.length; n++) {
      const state = replay(sheet, n, blackburn);
      expect(state.layers.reduce((sum, p) => sum + area(p), 0)).toBeCloseTo(sheet.width * sheet.height, 7);
      expect(state.step).toBe(n);
      expect(replay(sheet, n, blackburn)).toEqual(state);
    }
  });

  it('折后几何提取质量、翼展、翼面积与静稳定度均有效', () => {
    const a = extract(replay(papers[0], blackburn.length, blackburn), 80);
    const m = aeroMetrics(a);
    expect(a.mass).toBeCloseTo(0.0049896, 6);
    expect(a.span).toBeGreaterThan(0.13);
    expect(a.wingArea).toBeGreaterThan(0.02);
    expect(a.cg.x).toBeCloseTo(papers[0].width / 2, 6);
    expect(m.staticMargin).toBeGreaterThan(0);
  });

  it('25° 高抛时爬升并顺畅滑翔', () => {
    const a = extract(replay(papers[0], blackburn.length, blackburn), 80);
    const flight = simulate(a, {angle: 25, speed: 18, wind: 0});
    expect(flight.landed).toBe(true);
    expect(flight.distance).toBeGreaterThan(20);
    expect(flight.height).toBeGreaterThan(3.5);
  });
});
