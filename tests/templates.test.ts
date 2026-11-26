import {describe, it, expect} from 'vitest';
import {renderAeroDeepHtml, renderMaterialInfo, renderPlaneDetail, renderRecordsWall} from '../src/ui/templates';
import {escapeHtml} from '../src/ui/safe';
import {planes} from '../src/fold/planes';
import {papers} from '../src/paper/papers';
import {replay} from '../src/fold/engine';
import {extract} from '../src/aero/extract';
import {simulate} from '../src/aero/integrator';

describe('UI 模板模块(治理 1.9 拆分保护)', () => {
  const dartAero = extract(replay(papers[0], planes.dart.steps.length, planes.dart.steps), 80);
  const dartFlight = simulate(dartAero, {angle: 20, speed: 15, wind: 0, crosswind: 0});

  it('renderAeroDeepHtml 输出极曲线与调校手记,无未定义字面量', () => {
    const html = renderAeroDeepHtml(dartFlight, dartAero, {angle: 20, speed: 15, wind: 0, crosswind: 0}, 'dart');
    expect(html).toContain('aero-deep-intro');
    expect(html).toContain('最大滑翔比');
    expect(html).toContain('设计者调校手记');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
  });

  it('自由设计机型使用内置回退手记', () => {
    const html = renderAeroDeepHtml(dartFlight, dartAero, {angle: 20, speed: 15, wind: 0, crosswind: 0}, 'freestyle');
    expect(html).toContain('自由设计台');
  });

  it('renderMaterialInfo 展示厚度与挺度且标注经验估算', () => {
    const html = renderMaterialInfo('copy', 80);
    expect(html).toContain('100 µm');
    expect(html).toContain('经验参数库估算');
  });

  it('renderPlaneDetail 输出折序清单、克重对照与本机最佳', () => {
    const html = renderPlaneDetail('dart', 80, 'copy');
    expect(html).toContain('详情 · 折序清单与克重对照');
    expect(html).toContain('折出中线');
    expect(html).toContain('本机最佳');
    expect(html).toContain('非实测纪录条件');
  });

  it('renderRecordsWall 转义外部选手名(注入回归)', () => {
    const html = renderRecordsWall();
    // node 环境无 localStorage:面板应安全降级为空数据而非抛错
    expect(html).toContain('纪录墙与成就');
    expect(html).toContain('正式赛个人最佳');
    expect(html).not.toContain('<img');
  });

  it('escapeHtml 与模板互操作:恶意选手名不产生标签', () => {
    const evil = '"><img src=x onerror=1>';
    expect(escapeHtml(evil)).not.toContain('<img');
    expect(escapeHtml(evil)).toContain('&quot;&gt;');
  });
});
