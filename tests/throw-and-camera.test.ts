import {describe, it, expect} from 'vitest';
import {mapDragToThrow, THROW_BOUNDS} from '../src/game/throw-control';
import {computeFlightCamera} from '../src/game/camera';
import {replay} from '../src/fold/engine';
import {planes} from '../src/fold/planes';
import {papers} from '../src/paper/papers';
import {extract} from '../src/aero/extract';
import {simulate} from '../src/aero/integrator';

describe('拖动蓄力投掷映射与边界 (throw-control)', () => {
  const anchor = {x: 160, y: 420};

  it('微小拖动未达阈值时不触发投掷，可安全取消', () => {
    const res = mapDragToThrow(anchor, {x: anchor.x - 10, y: anchor.y + 8});
    expect(res.ready).toBe(false);
    expect(res.chargeRatio).toBe(0);
    expect(res.speed).toBe(THROW_BOUNDS.minSpeed);
  });

  it('向后下方拉动映射到合理仰角与初速度，并严格钳位在上下限内', () => {
    // 45° pull back-and-down, moderate distance
    const mid = mapDragToThrow(anchor, {x: anchor.x - 80, y: anchor.y + 80});
    expect(mid.ready).toBe(true);
    expect(mid.angle).toBe(45);
    expect(mid.speed).toBeGreaterThan(THROW_BOUNDS.minSpeed);
    expect(mid.speed).toBeLessThan(THROW_BOUNDS.maxSpeed);

    // Extreme pull clamps strictly to maxSpeed (28 m/s) and maxAngle (75°)
    const extreme = mapDragToThrow(anchor, {x: anchor.x - 10, y: anchor.y + 600});
    expect(extreme.ready).toBe(true);
    expect(extreme.angle).toBe(THROW_BOUNDS.maxAngle);
    expect(extreme.speed).toBe(THROW_BOUNDS.maxSpeed);
    expect(extreme.chargeRatio).toBe(1);

    // Pure horizontal pull back -> 0° launch angle
    const flat = mapDragToThrow(anchor, {x: anchor.x - 220, y: anchor.y});
    expect(flat.ready).toBe(true);
    expect(flat.angle).toBe(0);
    expect(flat.speed).toBe(THROW_BOUNDS.maxSpeed);
  });

  it('相同模型、拖动参数与风场产生的飞行结果完全可复现', () => {
    const aero = extract(replay(papers[0], planes.dart.steps.length, planes.dart.steps), 80);
    const drag = mapDragToThrow(anchor, {x: anchor.x - 120, y: anchor.y + 45});
    const f1 = simulate(aero, {angle: drag.angle, speed: drag.speed, wind: -1});
    const f2 = simulate(aero, {angle: drag.angle, speed: drag.speed, wind: -1});
    expect(f1.distance).toBe(f2.distance);
    expect(f1.duration).toBe(f2.duration);
    expect(f1.height).toBe(f2.height);
  });
});

describe('平滑跟随相机与正式比赛隐藏预演视口 (camera)', () => {
  const aero = extract(replay(papers[0], planes.mach5.steps.length, planes.mach5.steps), 100);
  const flight = simulate(aero, {angle: 40, speed: 28, wind: 0});

  it('飞行中跟随相机随飞机横移，落地后切回全景视口', () => {
    const midCam = computeFlightCamera(flight, flight, null, flight.duration * 0.5, {followCamera: true});
    expect(midCam.isFollowing).toBe(true);
    expect(midCam.minX).toBeGreaterThan(0);
    expect(midCam.maxX - midCam.minX).toBeLessThanOrEqual(35);

    const endCam = computeFlightCamera(flight, flight, null, flight.duration, {followCamera: true});
    expect(endCam.isFollowing).toBe(false);
    expect(endCam.minX).toBe(0);
    expect(endCam.maxX).toBeGreaterThanOrEqual(flight.distance);
  });

  it('正式比赛隐藏预演模式下，出手前视口不暴露最终落点距离', () => {
    const compReadyCam = computeFlightCamera(flight, null, null, 0, {hidePreview: true});
    expect(compReadyCam.isFollowing).toBe(false);
    expect(compReadyCam.maxX).toBe(24);
    expect(compReadyCam.maxX).toBeLessThan(flight.distance);
  });
});
