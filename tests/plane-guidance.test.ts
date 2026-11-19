import {describe, it, expect} from 'vitest';
import {planes, archives} from '../src/fold/planes';
import {papers} from '../src/paper/papers';
import {replay} from '../src/fold/engine';
import {area} from '../src/fold/geometry';
import {extract} from '../src/aero/extract';

describe('机型图鉴与折序完整性', () => {
  it('图鉴保留纪录、设计者与来源，三大历史经典机型均具备可玩折序', () => {
    const mach = archives.find(a => a.id === 'mach5')!;
    expect(mach.record).toContain('88');
    expect(mach.designer).toContain('Ruble');
    expect(mach.source).toMatch(/^https:\/\//);
    expect(Object.hasOwn(planes, mach.id)).toBe(true);
    expect(archives.find(a => a.id === 'suzanne')?.record).toContain('69.14');
    expect(archives.find(a => a.id === 'skyking')?.record).toContain('27.9');
  });

  it('各可用机型建议的投掷参数都在控件范围内', () => {
    for (const p of Object.values(planes)) {
      expect(p.recommendation.angle).toBeGreaterThanOrEqual(0);
      expect(p.recommendation.angle).toBeLessThanOrEqual(75);
      expect(p.recommendation.speed).toBeGreaterThanOrEqual(6);
      expect(p.recommendation.speed).toBeLessThanOrEqual(28);
      expect(p.recommendation.note.length).toBeGreaterThan(0);
    }
  });

  it.each(papers)('Mach 5 在 $name 纸张上每一步保持总面积守恒且展开后左右对称', paper => {
    const steps = planes.mach5.steps;
    for (let i = 0; i <= steps.length; i++) {
      const state = replay(paper, i, steps);
      expect(state.step).toBe(i);
      const totalArea = state.layers.reduce((sum, poly) => sum + area(poly), 0);
      expect(totalArea).toBeCloseTo(paper.width * paper.height, 8);
    }
    const finalState = replay(paper, steps.length, steps);
    const flightArea = finalState.flightLayers!.reduce((sum, poly) => sum + area(poly), 0);
    expect(flightArea).toBeCloseTo(paper.width * paper.height, 8);
    const aero = extract(finalState, 100);
    expect(aero.cg.x).toBeCloseTo(paper.width / 2, 8);
    expect(aero.aerodynamicCenter.y).toBeGreaterThan(aero.cg.y);
  });
});
