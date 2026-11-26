import {describe, it, expect} from 'vitest';
import {simulate, FLIGHT_MODEL_VERSION, type Throw} from '../src/aero/integrator';
import {extract} from '../src/aero/extract';
import {replay} from '../src/fold/engine';
import {papers} from '../src/paper/papers';
import {planes, type PlaneId} from '../src/fold/planes';

const aero = (plane: PlaneId, gsm = 80) =>
  extract(replay(papers[0], planes[plane].steps.length, planes[plane].steps), gsm);

const base: Throw = {angle: 20, speed: 15, wind: 0};

describe('v5 侧向物理(侧滑/偏航/横滚)', () => {
  it('版本号已递增到 5', () => {
    expect(FLIGHT_MODEL_VERSION).toBe(5);
  });

  it('无侧风时全部侧向状态恒为零,轨迹与纵向 2D 等价', () => {
    const a = aero('suzanne', 100);
    const flight = simulate(a, base);
    expect(flight.drift).toBe(0);
    for (const s of flight.samples) {
      expect(s.z ?? 0).toBe(0);
      expect(s.psi ?? 0).toBe(0);
      expect(s.phi ?? 0).toBe(0);
    }
    // 等价性:同一输入重复模拟(确定性)且距离与纵向口径一致
    const again = simulate(a, base);
    expect(again.distance).toBe(flight.distance);
    expect(again.samples).toEqual(flight.samples);
  });

  it('右侧风(+z)使飞机向右漂移并向左偏航(风标迎风)', () => {
    const a = aero('suzanne', 100);
    const flight = simulate(a, {...base, crosswind: 3});
    expect(flight.landed).toBe(true);
    expect(flight.drift!).toBeGreaterThan(0.5);
    const last = flight.samples.at(-1)!;
    expect(last.psi ?? 0).toBeLessThan(0); // 机头偏向来流(左侧)
    expect(Number.isFinite(flight.distance)).toBe(true);
  });

  it('温和侧风下风标稳定:偏航/横滚有界,滑翔不被侧风摧毁(回归:风标正反馈自旋缺陷)', () => {
    const a = aero('suzanne', 100);
    const calm = simulate(a, base);
    const windy = simulate(a, {angle: 0, speed: 28, wind: 0, crosswind: 3});
    expect(windy.landed).toBe(true);
    // 滑翔必须保留:3 m/s 侧风下水平路径长度不低于无风滑翔的一半
    expect(windy.distance).toBeGreaterThan(calm.distance * 0.5);
    expect(windy.duration).toBeGreaterThan(calm.duration * 0.5);
    // 偏航与横滚有界:不出现持续自旋或翻滚
    let peakPsi = 0;
    let peakPhi = 0;
    for (const s of windy.samples) {
      peakPsi = Math.max(peakPsi, Math.abs(s.psi ?? 0));
      peakPhi = Math.max(peakPhi, Math.abs(s.phi ?? 0));
    }
    expect(peakPsi).toBeLessThan((50 * Math.PI) / 180);
    expect(peakPhi).toBeLessThan((15 * Math.PI) / 180);
  });

  it('左侧风(-z)镜像对称:漂移与偏航方向相反,幅值一致', () => {
    const a = aero('suzanne', 100);
    const right = simulate(a, {...base, crosswind: 3});
    const left = simulate(a, {...base, crosswind: -3});
    expect(left.drift!).toBeLessThan(-0.5);
    expect(left.samples.at(-1)!.psi ?? 0).toBeGreaterThan(0);
    expect(Math.abs(left.drift!)).toBeCloseTo(Math.abs(right.drift!), 3);
    expect(left.distance).toBeCloseTo(right.distance, 6);
  });

  it('同一侧风输入与种子完全可复现,不同种子阵风相位不同', () => {
    const a = aero('suzanne', 100);
    const input: Throw = {...base, crosswind: 3};
    const s1 = simulate(a, input, {windSeed: 7});
    const s2 = simulate(a, input, {windSeed: 7});
    expect(s1.samples).toEqual(s2.samples);
    const s3 = simulate(a, input, {windSeed: 8});
    expect(s3.distance).not.toBe(s1.distance);
    // 无侧风时种子不起作用
    const calm1 = simulate(a, base, {windSeed: 1});
    const calm2 = simulate(a, base, {windSeed: 2});
    expect(calm1.distance).toBe(calm2.distance);
  });

  it('全机型在 ±4 m/s 侧风与阵风下保持有限并落地', () => {
    for (const plane of Object.values(planes)) {
      const a = aero(plane.id, 80);
      for (const cross of [-4, 4] as const) {
        const f = simulate(a, {...base, crosswind: cross}, {windSeed: 3});
        expect(f.landed, `${plane.id} cross=${cross}`).toBe(true);
        expect([f.distance, f.duration, f.drift!, f.height].every(Number.isFinite)).toBe(true);
        expect(f.samples.length).toBeLessThan(2000);
      }
    }
  });

  it('龙骨尾鳍臂为正:全部机型可提取重心后的龙骨面积与力臂', () => {
    for (const plane of Object.values(planes)) {
      const a = aero(plane.id, 80);
      expect(a.keelAftArea).toBeGreaterThan(0);
      expect(a.keelAftLever).toBeGreaterThan(0);
    }
  });

  it('大风 keel 机型(风标稳定强)漂移小于弱龙骨机型', () => {
    const mach = aero('mach5', 100);
    const dart = aero('dart', 80);
    const machFlight = simulate(mach, {angle: 40, speed: 28, wind: 0, crosswind: 4});
    const dartFlight = simulate(dart, {angle: 20, speed: 15, wind: 0, crosswind: 4});
    expect(machFlight.landed).toBe(true);
    expect(dartFlight.landed).toBe(true);
    // 投射条件不同,不能直接比绝对漂移;归一到各自距离比较相对漂移率
    expect(machFlight.drift! / machFlight.distance).toBeLessThan(dartFlight.drift! / dartFlight.distance);
  });

  it('拒绝越界与非有限侧风', () => {
    const a = aero('dart');
    for (const crosswind of [4.5, -4.5, NaN, Infinity]) {
      expect(() => simulate(a, {...base, crosswind})).toThrow();
    }
    expect(() => simulate(a, base, {windSeed: NaN})).toThrow();
  });
});
