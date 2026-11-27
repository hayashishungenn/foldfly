import {describe, it, expect} from 'vitest';
import {simulate, FLIGHT_MODEL_VERSION, type Throw} from '../src/aero/integrator';
import {extract} from '../src/aero/extract';
import {replay} from '../src/fold/engine';
import {papers} from '../src/paper/papers';
import {materialProfile} from '../src/paper/material';
import {resolveInteractiveTarget, foldAccuracy, programFoldQuality, type FoldCursor} from '../src/fold/interact';
import {dart} from '../src/fold/planes/dart';
import {planes, type PlaneId} from '../src/fold/planes';

const aero = (plane: PlaneId, gsm = 80) =>
  extract(replay(papers[0], planes[plane].steps.length, planes[plane].steps), gsm);

const launch: Throw = {angle: 0, speed: 20, wind: 0};

describe('v4 折痕质量与材质定形通道', () => {
  it('版本号已随侧向物理递增到 5(旧 ghost/分享键自动归档)', () => {
    expect(FLIGHT_MODEL_VERSION).toBe(5);
  });

  it('完美折痕 + 缺省材质与显式完美折痕 + 复印纸逐位一致(v3 锚点零漂移)', () => {
    for (const plane of ['dart', 'suzanne', 'mach5', 'skyking'] as const) {
      const a = aero(plane, plane === 'skyking' ? 80 : 100);
      const input: Throw = plane === 'skyking' ? {angle: 20, speed: 8, wind: 0} : launch;
      const legacy = simulate(a, input);
      const explicit = simulate(a, input, {foldQuality: 1, material: materialProfile('copy', plane === 'skyking' ? 80 : 100)});
      expect(explicit.distance).toBe(legacy.distance);
      expect(explicit.duration).toBe(legacy.duration);
      expect(explicit.height).toBe(legacy.height);
      expect(explicit.samples).toEqual(legacy.samples);
    }
  });

  it('拒绝越界或非有限折痕质量', () => {
    const a = aero('dart');
    for (const foldQuality of [-0.1, 1.5, NaN, Infinity]) {
      expect(() => simulate(a, launch, {foldQuality})).toThrow();
    }
  });

  it('折痕不齐单调劣化:尖头机与滑翔机距离随质量下降而缩短', () => {
    for (const plane of ['dart', 'suzanne'] as const) {
      const a = aero(plane);
      const perfect = simulate(a, launch, {foldQuality: 1});
      // 4.7 后默认路径不再用质量乘数;此处显式启用历史通道验证 v4 通道仍可复现
      const sloppy = simulate(a, launch, {foldQuality: 0.6, legacyQualityChannel: true});
      expect(sloppy.distance).toBeLessThan(perfect.distance);
      expect(sloppy.duration).toBeGreaterThan(0);
      const worse = simulate(a, launch, {foldQuality: 0.2, legacyQualityChannel: true});
      expect(worse.distance).toBeLessThan(sloppy.distance);
    }
  });

  it('材质定形只允许退化或持平:新闻纸滞空缩短,激光纸与复印纸持平(无超理想增益)', () => {
    const input: Throw = {angle: 20, speed: 8, wind: 0};
    const a = aero('skyking');
    const copy = simulate(a, input, {material: materialProfile('copy', 80)});
    const laser = simulate(a, input, {material: materialProfile('laser', 80)});
    const news = simulate(a, input, {material: materialProfile('news', 80)});
    const coated = simulate(a, input, {material: materialProfile('coated', 80)});
    expect(laser.duration).toBe(copy.duration);
    expect(news.duration).toBeLessThan(copy.duration);
    expect(coated.duration).toBeLessThan(copy.duration);
  });

  it('材质与折痕质量通道可叠加且方向一致', () => {
    const input: Throw = {angle: 20, speed: 8, wind: 0};
    const a = aero('skyking');
    const newsGood = simulate(a, input, {foldQuality: 1, material: materialProfile('news', 80)});
    const newsSloppy = simulate(a, input, {foldQuality: 0.5, material: materialProfile('news', 80), legacyQualityChannel: true});
    expect(newsSloppy.duration).toBeLessThan(newsGood.duration);
    expect(newsSloppy.distance).toBeLessThan(newsGood.distance);
  });
});

describe('折痕精度评分(纯逻辑)', () => {
  const cursor: FoldCursor = {step: 0, subOp: 0};
  const target = resolveInteractiveTarget(papers[0], dart, cursor)!;

  it('松手落点即目标点 → 满分;接近目标按比例给分', () => {
    const exact = foldAccuracy(target, target.grabPoint, target.targetPoint);
    expect(exact).toBe(1);
    const near = {x: target.grabPoint.x + 0.8 * (target.targetPoint.x - target.grabPoint.x), y: target.grabPoint.y + 0.8 * (target.targetPoint.y - target.grabPoint.y)};
    expect(foldAccuracy(target, target.grabPoint, near)).toBeCloseTo(0.8, 6);
  });

  it('未提交的拖动与翻面/展开步骤不计分(返回 0)', () => {
    const halfway = {x: (target.grabPoint.x + target.targetPoint.x) / 2, y: (target.grabPoint.y + target.targetPoint.y) / 2};
    expect(foldAccuracy(target, target.grabPoint, halfway)).toBe(0);
    // 完全拖反方向 → 0
    const backwards = {x: target.grabPoint.x - (target.targetPoint.x - target.grabPoint.x), y: target.grabPoint.y - (target.targetPoint.y - target.grabPoint.y)};
    expect(foldAccuracy(target, target.grabPoint, backwards)).toBe(0);
  });

  it('整体折痕质量是全部真实折痕的平均,缺省按设计完成计满分', () => {
    expect(programFoldQuality(dart, new Map())).toBe(1);
    // dart 每步 1 条子操作(共 6 步;含展翼步),一条 0.5 分其余满分
    const q = programFoldQuality(dart, new Map([['0:0', 0.5]]));
    const creases = dart.reduce((n, s) => (s.unfold ? n : n + (s.operations ?? [s]).filter(op => !op.flip).length), 0);
    expect(q).toBeCloseTo((0.5 + (creases - 1)) / creases, 10);
    expect(q).toBeLessThan(1);
    expect(q).toBeGreaterThan(0.7);
  });

  it('翻面与展开步骤不参与评分', () => {
    const program = [
      {title: '中折', description: '', kind: 'valley' as const, a: [0.5, 0] as [number, number], b: [0.5, 1] as [number, number], sign: 1 as const},
      {title: '翻面', description: '', kind: 'valley' as const, a: [0.5, 0] as [number, number], b: [0.5, 1] as [number, number], sign: 1 as const, flip: true},
      {title: '展开', description: '', kind: 'valley' as const, a: [0.5, 0] as [number, number], b: [0.5, 1] as [number, number], sign: 1 as const, unfold: true},
      {title: '第二折', description: '', kind: 'valley' as const, a: [0.3, 0] as [number, number], b: [0.3, 1] as [number, number], sign: 1 as const},
    ];
    // 只有两条真实折痕:0:0 与 3:0
    expect(programFoldQuality(program, new Map([['0:0', 0], ['3:0', 1]]))).toBeCloseTo(0.5, 10);
    // 翻面/展开步骤即使记了分也被忽略
    expect(programFoldQuality(program, new Map([['1:0', 0], ['2:0', 0]]))).toBe(1);
  });
});
