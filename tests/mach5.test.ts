import {describe, it, expect} from 'vitest';
import {mach5} from '../src/fold/planes/mach5';
import {suzanne} from '../src/fold/planes/suzanne';
import {replay} from '../src/fold/engine';
import {foldFrame, unfoldFrame, wingOpeningFrame} from '../src/fold/animate';
import {area} from '../src/fold/geometry';
import {papers} from '../src/paper/papers';
import {extract, aeroMetrics} from '../src/aero/extract';
import {encodeFlight, decodeFlight, foldSignature} from '../src/game/share';
import {layerFillColor, renderPlaneBlueprintSvg} from '../src/render/fold2d';
import {archives} from '../src/fold/planes';

describe('Mach 5 折序与气动特征', () => {
  it.each(papers)('$name 每一步均保持纸张面积守恒且可确定性重放', sheet => {
    for (let n = 0; n <= mach5.length; n++) {
      const state = replay(sheet, n, mach5);
      expect(state.layers.reduce((sum, p) => sum + area(p), 0)).toBeCloseTo(sheet.width * sheet.height, 8);
      expect(state.step).toBe(n);
      expect(replay(sheet, n, mach5)).toEqual(state);
    }
  });

  it('具备窄翼展、高机身龙骨与大静稳定裕度的穿透构型特征', () => {
    const sheet = papers[0];
    const machAero = extract(replay(sheet, mach5.length, mach5), 100);
    const suzanneAero = extract(replay(sheet, suzanne.length, suzanne), 100);

    expect(machAero.mass).toBeCloseTo(suzanneAero.mass, 8);
    expect(machAero.cg.x).toBeCloseTo(sheet.width / 2, 8);
    // Narrower wingspan and smaller wing area than Suzanne for lower high-speed drag
    expect(machAero.span).toBeLessThan(suzanneAero.span);
    expect(machAero.wingArea).toBeLessThan(suzanneAero.wingArea);
    // Deeper fuselage keel and larger static margin for 40° high-speed climb stability
    expect(machAero.bodySideArea).toBeGreaterThan(suzanneAero.bodySideArea);
    const machSm = (machAero.aerodynamicCenter.y - machAero.cg.y) / machAero.chord;
    const suzanneSm = (suzanneAero.aerodynamicCenter.y - suzanneAero.cg.y) / suzanneAero.chord;
    expect(machSm).toBeGreaterThan(suzanneSm * 1.5);
  });

  it('每一步过渡动画均不抛错且保持有效多边形', () => {
    const sheet = papers[0];
    for (let i = 0; i < mach5.length; i++) {
      const step = mach5[i];
      const before = replay(sheet, i, mach5);
      const after = replay(sheet, i + 1, mach5);
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        const parts = step.unfold
          ? unfoldFrame(replay(sheet, i - 1, mach5), sheet, mach5[i - 1], progress)
          : step.openToStep !== undefined
            ? wingOpeningFrame(before, sheet, step, after.flightLayers ?? after.layers, progress)
            : foldFrame(before, sheet, step, progress);
        expect(parts.length).toBeGreaterThan(0);
        for (const part of parts) {
          expect(part.polygon.length).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('支持 URL hash 编码与确定性复现', () => {
    const shared = {
      version: 1 as const,
      plane: 'mach5' as const,
      paper: 'a4' as const,
      gsm: 100 as const,
      angle: 40,
      speed: 28,
      wind: 0,
      step: mach5.length,
    };
    const decoded = decodeFlight(encodeFlight(shared));
    expect(decoded?.plane).toBe('mach5');
    expect(decoded?.foldSignature).toBe(foldSignature('mach5'));
    expect(decoded?.step).toBe(mach5.length);
  });

  it('派生无量纲气动指标与蓝图预览、叠层明度衰减及纪录预设一致', () => {
    const sheet = papers[0];
    const machAero = extract(replay(sheet, mach5.length, mach5), 100);
    const metrics = aeroMetrics(machAero);
    expect(metrics.staticMargin).toBeGreaterThan(0.1);
    expect(metrics.wingLoading).toBeGreaterThan(2);
    expect(metrics.nominalGlideSpeed).toBeGreaterThan(3);

    const svg = renderPlaneBlueprintSvg(sheet, mach5, 100);
    expect(svg).toContain('<svg class="plane-blueprint"');
    expect(svg).toContain('<polygon');
    expect(svg).toContain('#D9482B');

    // Layer 0 uses base color; Layer 1 darkens by 8%
    expect(layerFillColor(false, 0)).toBe('rgb(250, 246, 238)');
    expect(layerFillColor(false, 1)).toBe('rgb(230, 226, 219)');

    // Historical records provide valid one-click presets
    expect(archives.map(a => a.preset.plane)).toEqual(['suzanne', 'mach5', 'skyking', 'nakamura', 'blackburn']);
  });
});
