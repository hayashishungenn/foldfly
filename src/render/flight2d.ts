import {telemetryAt, type FlightTelemetry} from '../aero/diagnostics';
import type {Aero} from '../aero/extract';
import type {Flight, Throw} from '../aero/integrator';
import {
  analyzeTrajectoryPhases,
  computeAeroPolar,
  effectiveCoefficients,
  type AeroPolar,
  type TrajectoryBreakdown,
} from '../aero/polar';
import {computeFlightCamera} from '../game/camera';
import type {Challenge} from '../game/challenge';
import {playback} from '../game/playback';
import type {CanvasPoint, DragThrowResult} from '../game/throw-control';

export type FlightRenderOptions = {
  hidePreview?: boolean;
  followCamera?: boolean;
  chargeState?: {anchor: CanvasPoint; pointer: CanvasPoint; result: DragThrowResult} | null;
  paused?: boolean;
  /** v5 俯视模式:画布改为 x–z 平面(顶视),展示侧风漂移与偏航。 */
  topView?: boolean;
};

/**
 * v5 俯视图:作业本方格 + 每米刻度,绘制弹道在 x–z 平面的投影、机头朝向
 * 与风矢量。只消费飞行采样(含可选 z/psi),不反推任何物理量。
 */
function renderTopDownView(
  c: CanvasRenderingContext2D,
  preview: Flight,
  actual: Flight | null,
  ghost: Flight | null,
  elapsed: number,
  launch: Throw | undefined,
  options: FlightRenderOptions,
): void {
  const {hidePreview = false} = options;
  c.clearRect(0, 0, 960, 600);
  // 纸面底色 + 方格(作业本质感)
  c.fillStyle = '#FAF6EE';
  c.fillRect(0, 0, 960, 600);

  // 视野:取所有轨迹的 x/z 包络,纵向(x)映射水平,横向(z)映射垂直
  const paths: {points: {x: number; z: number}[]; color: string; dash: number[]; width: number}[] = [];
  const samplePoints = (f: Flight, upto?: number) =>
    f.samples.filter(s => upto === undefined || s.t <= upto).map(s => ({x: s.x, z: s.z ?? 0}));
  if (!hidePreview && !actual) paths.push({points: samplePoints(preview), color: 'rgba(31,58,95,0.4)', dash: [6, 6], width: 1.5});
  if (ghost) paths.push({points: samplePoints(ghost), color: 'rgba(107,114,128,0.55)', dash: [3, 5], width: 1.5});
  if (actual) paths.push({points: samplePoints(actual, elapsed), color: '#1F3A5F', dash: [], width: 2});
  const xs = paths.flatMap(p => p.points.map(q => q.x));
  const zs = paths.flatMap(p => p.points.map(q => q.z));
  const maxX = Math.max(10, ...xs, (launch ? Math.max(6, launch.speed * 2) : 6));
  const maxZ = Math.max(4, ...zs.map(Math.abs), Math.abs(launch?.crosswind ?? 0) * 3);
  const margin = 60;
  const scale = Math.min((960 - margin * 2) / maxX, (600 - margin * 2) / (2 * maxZ + 4));
  const mapX = (x: number) => margin + x * scale;
  const mapZ = (z: number) => 300 + z * scale;

  // 方格纸纹理:5 m 主格 + 1 m 细格
  c.strokeStyle = '#C9DCEB';
  for (let gx = 0; gx <= maxX; gx += 5) {
    c.lineWidth = gx % 10 === 0 ? 1.2 : 0.6;
    c.beginPath();
    c.moveTo(mapX(gx), margin / 2);
    c.lineTo(mapX(gx), 600 - margin / 2);
    c.stroke();
  }
  for (let gz = -Math.ceil(maxZ / 5) * 5; gz <= Math.ceil(maxZ / 5) * 5; gz += 5) {
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(margin / 2, mapZ(gz));
    c.lineTo(960 - margin / 2, mapZ(gz));
    c.stroke();
  }
  // 起飞线与刻度
  c.strokeStyle = '#1F3A5F';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(mapX(0), margin / 2);
  c.lineTo(mapX(0), 600 - margin / 2);
  c.stroke();
  c.fillStyle = '#6B7280';
  c.font = '12px "IBM Plex Mono", monospace';
  for (let gx = 0; gx <= maxX; gx += 10) {
    c.fillText(`${gx}m`, mapX(gx) + 4, 600 - margin / 2 + 16);
  }

  // 风矢量(右上角):顺风/侧风合成方向
  if (launch && (launch.wind !== 0 || (launch.crosswind ?? 0) !== 0)) {
    const arrowScale = 10;
    const wx = launch.wind * arrowScale;
    const wz = (launch.crosswind ?? 0) * arrowScale;
    const ox = 960 - 90;
    const oy = 70;
    c.strokeStyle = '#D9482B';
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(ox, oy);
    c.lineTo(ox + wx, oy + wz);
    c.stroke();
    const ang = Math.atan2(wz, wx);
    c.beginPath();
    c.moveTo(ox + wx, oy + wz);
    c.lineTo(ox + wx - 9 * Math.cos(ang - 0.45), oy + wz - 9 * Math.sin(ang - 0.45));
    c.lineTo(ox + wx - 9 * Math.cos(ang + 0.45), oy + wz - 9 * Math.sin(ang + 0.45));
    c.closePath();
    c.fillStyle = '#D9482B';
    c.fill();
    c.fillStyle = '#6B7280';
    c.font = '11px "IBM Plex Mono", monospace';
    c.fillText('风', ox - 16, oy + 4);
  }

  for (const path of paths) {
    if (path.points.length < 2) continue;
    c.strokeStyle = path.color;
    c.lineWidth = path.width;
    c.setLineDash(path.dash);
    c.beginPath();
    path.points.forEach((q, i) => (i ? c.lineTo(mapX(q.x), mapZ(q.z)) : c.moveTo(mapX(q.x), mapZ(q.z))));
    c.stroke();
    c.setLineDash([]);
  }

  // 当前位置 + 机头朝向
  const current = actual
    ? ([...actual.samples].reverse().find(s => s.t <= elapsed) ?? actual.samples[0])
    : preview.samples[preview.samples.length - 1];
  const cx = mapX(current.x);
  const cz = mapZ(current.z ?? 0);
  const psi = current.psi ?? 0;
  c.save();
  c.translate(cx, cz);
  c.rotate(-psi); // 画布 z 向下为正,偏航右转为正 → 画布上逆时针旋转
  c.fillStyle = '#1F3A5F';
  c.beginPath();
  c.moveTo(14, 0);
  c.lineTo(-9, 7);
  c.lineTo(-5, 0);
  c.lineTo(-9, -7);
  c.closePath();
  c.fill();
  c.restore();
  // 位置圆点
  c.fillStyle = actual ? '#D9482B' : '#1F3A5F';
  c.beginPath();
  c.arc(cx, cz, 3.5, 0, Math.PI * 2);
  c.fill();

  // 标题与说明
  c.fillStyle = '#1F3A5F';
  c.font = '13px "LXGW WenKai", "PingFang SC", sans-serif';
  c.fillText('俯视 · 侧风漂移与机头朝向', margin / 2, 28);
  if (actual) {
    c.fillStyle = '#6B7280';
    c.font = '12px "IBM Plex Mono", monospace';
    c.fillText(`x ${current.x.toFixed(1)}m · z ${(current.z ?? 0).toFixed(1)}m · ψ ${(((current.psi ?? 0) * 180) / Math.PI).toFixed(0)}°`, margin / 2, 48);
  }
}

export function flightLaunchAnchor(
  preview: Flight,
  actual: Flight | null,
  ghost: Flight | null,
  hidePreview = false,
): CanvasPoint {
  const cam = computeFlightCamera(preview, actual, ghost, 0, {followCamera: false, hidePreview});
  return {x: cam.mapX(0), y: cam.mapY(1.5)};
}

export function renderFlightCanvas(
  canvas: HTMLCanvasElement,
  preview: Flight,
  actual: Flight | null,
  ghost: Flight | null,
  challenge: Challenge,
  elapsed: number,
  launch?: Throw,
  aero?: Aero,
  showForces = true,
  showPolar = true,
  options: FlightRenderOptions = {},
): void {
  const c = canvas.getContext('2d')!;
  const {hidePreview = false, followCamera = true, chargeState = null, paused = false, topView = false} = options;
  // v5 俯视模式:独立绘制分支,共用同一数据源
  if (topView) {
    renderTopDownView(c, preview, actual, ghost, elapsed, launch, options);
    return;
  }
  const {minX, maxX, maxY, sy, mapX, isFollowing} = computeFlightCamera(preview, actual, ghost, elapsed, {
    followCamera,
    hidePreview,
  });

  // Sky vertical gradient: --sky (#8FC7E8) at top to --sky-hi (#DCEFF9) above horizon
  const skyGrad = c.createLinearGradient(0, 0, 0, 520);
  skyGrad.addColorStop(0, '#8FC7E8');
  skyGrad.addColorStop(1, '#DCEFF9');
  c.fillStyle = skyGrad;
  c.fillRect(0, 0, 960, 520);

  // Minimalist monochrome clouds (--paper #FAF6EE) with parallax scrolling during follow-camera flight
  const cloudShift = isFollowing ? (minX * 14) % 960 : 0;
  c.save();
  c.fillStyle = '#FAF6EE';
  c.globalAlpha = 0.65;
  for (const [baseCx, cy, rx, ry] of [
    [180, 95, 52, 16],
    [215, 90, 38, 14],
    [520, 72, 64, 18],
    [565, 68, 42, 14],
    [810, 110, 48, 15],
  ] as const) {
    const cx = ((baseCx - cloudShift) % 1080 + 1080) % 1080 - 60;
    c.beginPath();
    c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();

  // Subtle horizontal altitude grid lines & left altitude scale
  const altStep = maxY <= 6 ? 1 : maxY <= 15 ? 2 : maxY <= 35 ? 5 : 10;
  c.save();
  c.font = "11px 'IBM Plex Mono', monospace";
  for (let h = altStep; h < maxY * 0.95; h += altStep) {
    const y = 520 - h * sy;
    c.strokeStyle = '#FAF6EE';
    c.globalAlpha = 0.45;
    c.lineWidth = 1;
    c.setLineDash([4, 6]);
    c.beginPath();
    c.moveTo(54, y);
    c.lineTo(920, y);
    c.stroke();
    c.setLineDash([]);
    c.globalAlpha = 0.75;
    c.fillStyle = '#1F3A5F';
    c.fillText(`${h} m`, 16, y + 4);
  }
  c.restore();

  // Wind streamlines when wind !== 0
  if (launch && launch.wind !== 0) {
    drawWindIndicator(c, launch.wind);
  }

  // Ground grass block (--grass #7FA86B) with world-space grass blades that scroll smoothly
  c.fillStyle = '#7FA86B';
  c.fillRect(0, 520, 960, 80);
  drawGrassBlades(c, minX, maxX, mapX);
  c.strokeStyle = '#1F3A5F';
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(0, 520);
  c.lineTo(960, 520);
  c.stroke();

  // Ground distance ticks
  const spanX = Math.max(1, maxX - minX);
  const tickStep = spanX <= 20 ? 1 : spanX <= 50 ? 2 : 5;
  const firstTick = Math.ceil(minX / tickStep) * tickStep;
  c.strokeStyle = '#1F3A5F';
  c.lineWidth = 1;
  for (let m = firstTick; m <= maxX; m += tickStep) {
    const tx = mapX(m);
    const major = m % (tickStep * 5) === 0;
    c.beginPath();
    c.moveTo(tx, 520);
    c.lineTo(tx, major ? 530 : 525);
    c.stroke();
  }

  // Historical Suzanne 69.14 m milestone signpost when visible
  if (maxX >= 69.14 && minX <= 69.14) {
    const sx = mapX(69.14);
    c.save();
    c.strokeStyle = '#6B7280';
    c.lineWidth = 1;
    c.setLineDash([3, 4]);
    c.beginPath();
    c.moveTo(sx, 480);
    c.lineTo(sx, 520);
    c.stroke();
    c.setLineDash([]);
    c.font = "11px 'IBM Plex Mono', monospace";
    c.fillStyle = '#1F3A5F';
    c.textAlign = 'center';
    c.fillText('Suzanne 69.1m', sx, 474);
    c.restore();
  }

  // Historical challenge milestone (88.31 m Mach 5) & Current Distance WR (98.43 m, 2025-12-28)
  c.font = "15px 'IBM Plex Mono', monospace";
  c.fillStyle = '#D9482B';
  if (challenge === 'distance') {
    if (maxX >= 88.31 && minX <= 88.31) {
      const x = mapX(88.31);
      c.strokeStyle = '#D9482B';
      c.lineWidth = 1.5;
      c.setLineDash([6, 6]);
      c.beginPath();
      c.moveTo(x, 35);
      c.lineTo(x, 520);
      c.stroke();
      c.setLineDash([]);
      c.fillText('★ 88.3m 里程碑', Math.min(795, x + 6), 52);
    }
    if (maxX >= 98.43 && minX <= 98.43) {
      const wx = mapX(98.43);
      c.strokeStyle = '#C9A227';
      c.fillStyle = '#C9A227';
      c.lineWidth = 1.6;
      c.setLineDash([4, 4]);
      c.beginPath();
      c.moveTo(wx, 58);
      c.lineTo(wx, 520);
      c.stroke();
      c.setLineDash([]);
      c.fillText('WR 98.43m', Math.min(845, wx + 6), 74);
    } else if (maxX < 88.31) {
      c.fillText('里程碑 88.3m / WR 98.4m →', 690, 52);
    }
  } else {
    c.fillText('里程碑 29.2s / WR 31.2s', 705, 52);
  }

  function path(f: Flight, limit: number, color: string, dashed: boolean) {
    c.beginPath();
    f.samples
      .filter(p => p.t <= limit)
      .forEach((p, i) => {
        const x = mapX(p.x);
        const y = 520 - p.y * sy;
        if (i) c.lineTo(x, y);
        else c.moveTo(x, y);
      });
    c.strokeStyle = color;
    c.lineWidth = 2.5;
    c.setLineDash(dashed ? [8, 8] : []);
    c.stroke();
    c.setLineDash([]);
  }

  // Preview trajectory (dashed ink) — hidden in official competition mode so landing is not spoiled
  if (!hidePreview) {
    path(preview, Infinity, '#1F3A5F', true);
  }

  // Launch stand & live release vector at (x = 0, y = 1.5 m)
  const originX = mapX(0);
  const originY = 520 - 1.5 * sy;
  const activeLaunch = chargeState?.result.ready && launch
    ? {...launch, angle: chargeState.result.angle, speed: chargeState.result.speed}
    : launch;
  drawLaunchStand(c, originX, originY, activeLaunch, !actual, aero);

  if (!actual && chargeState) {
    drawChargeSlingshot(c, originX, originY, chargeState);
  } else if (!actual) {
    drawThrowPrompt(c, originX, originY);
  }

  // Apogee marker on active flight (or preview in free experiment mode)
  const refFlight = actual ?? preview;
  const refLimit = actual ? elapsed : Infinity;
  if (actual || !hidePreview) {
    drawApogeeCallout(c, refFlight, refLimit, mapX, sy);
  }

  const phases = aero && activeLaunch && (actual || !hidePreview) ? analyzeTrajectoryPhases(refFlight, aero, activeLaunch) : undefined;
  if (phases && showForces && (actual || !hidePreview)) {
    drawGlideTransitionCallout(c, phases, refLimit, mapX, sy);
  }

  if (ghost && !hidePreview) {
    path(ghost, actual ? elapsed : Infinity, '#6B7280', true);
    if (actual) {
      const pos = playback(ghost, Math.min(elapsed, ghost.duration)).sample;
      drawPaperPlaneSprite(c, mapX(pos.x), 520 - pos.y * sy, -pos.pitch, aero, true);
    }
  }

  let activeTelemetry: FlightTelemetry | undefined;
  if (actual) {
    path(actual, elapsed, '#1F3A5F', false);
    const frame = playback(actual, elapsed);
    const pos = frame.sample;
    const px = mapX(pos.x);
    const py = 520 - pos.y * sy;

    if (aero && activeLaunch) {
      activeTelemetry = telemetryAt(actual, aero, activeLaunch, elapsed);
      if (showForces) {
        if (!frame.finished) {
          drawForceVectors(c, px, py, activeTelemetry);
        }
        drawTelemetryHud(c, activeTelemetry);
      }
    }

    drawPaperPlaneSprite(c, px, py, -pos.pitch, aero, false);

    if (frame.finished && actual.landed) {
      drawLandingPin(c, mapX(actual.distance), 520, actual.distance);
    }
  } else if (aero && activeLaunch) {
    activeTelemetry = telemetryAt(preview, aero, activeLaunch, 0);
    if (showForces) {
      drawForceVectors(c, originX, originY, activeTelemetry);
      drawTelemetryHud(c, activeTelemetry);
    }
  }

  if (showPolar && aero && activeLaunch && phases && activeTelemetry) {
    const polar = computeAeroPolar(aero, activeLaunch.wind);
    drawPolarAndEnergyInset(c, polar, phases, activeTelemetry, aero);
  }

  if (paused && actual) {
    c.save();
    c.fillStyle = 'rgba(250, 246, 238, 0.92)';
    c.strokeStyle = '#1F3A5F';
    c.lineWidth = 1.4;
    c.fillRect(422, 16, 116, 30);
    c.strokeRect(422, 16, 116, 30);
    c.font = "12px 'IBM Plex Mono', monospace";
    c.fillStyle = '#1F3A5F';
    c.textAlign = 'center';
    c.fillText('❚❚ 已暂停', 480, 35);
    c.restore();
  }

  c.font = "16px 'IBM Plex Mono', monospace";
  c.fillStyle = '#1F3A5F';
  c.textAlign = 'left';
  for (let i = 0; i <= 4; i++) {
    c.fillText(`${(minX + ((maxX - minX) * i) / 4).toFixed(0)} m`, 60 + (840 * i) / 4, 558);
  }
}

/**
 * Draw aerodynamic force vectors (Lift L, Drag D, Weight mg, Velocity v) at the
 * airplane's center of mass, adapted from Sonville/suzanne-paper-plane-lab.
 */
function drawForceVectors(
  c: CanvasRenderingContext2D,
  px: number,
  py: number,
  telemetry: FlightTelemetry,
): void {
  const {forces} = telemetry;
  const weightN = Math.max(1e-4, forces.weight);
  const clampLen = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

  // Scale vectors relative to weight mg (where mg = 26 px)
  const weightLen = 26;
  const liftLen = clampLen((forces.lift / weightN) * 26, 10, 56);
  const dragLen = clampLen((forces.drag / weightN) * 32, 8, 48);
  const speedLen = clampLen(12 + forces.speed * 1.4, 14, 52);

  const arrow = (dx: number, dy: number, len: number, color: string, label: string) => {
    const ex = px + dx * len;
    const ey = py - dy * len; // Canvas Y is inverted relative to world Y
    const angle = Math.atan2(ey - py, ex - px);
    c.save();
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = 1.8;
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(ex, ey);
    c.stroke();

    const head = 6;
    c.beginPath();
    c.moveTo(ex, ey);
    c.lineTo(ex - head * Math.cos(angle - 0.4), ey - head * Math.sin(angle - 0.4));
    c.lineTo(ex - head * Math.cos(angle + 0.4), ey - head * Math.sin(angle + 0.4));
    c.closePath();
    c.fill();

    c.font = "10px 'IBM Plex Mono', monospace";
    c.fillText(label, ex + Math.cos(angle) * 8 - 4, ey + Math.sin(angle) * 8 + 3);
    c.restore();
  };

  // Weight mg (straight down)
  arrow(0, -1, weightLen, '#6B7280', 'mg');
  // Drag D (opposite airflow)
  arrow(forces.dragDir.x, forces.dragDir.y, dragLen, '#D9482B', 'D');
  // Lift L (perpendicular to airflow)
  arrow(forces.liftDir.x, forces.liftDir.y, liftLen, '#1F3A5F', 'L');
  // Velocity v
  arrow(forces.velocityDir.x, forces.velocityDir.y, speedLen, '#C9A227', 'v');
}

function drawTelemetryHud(c: CanvasRenderingContext2D, t: FlightTelemetry): void {
  c.save();
  const x = 62;
  const y = 16;
  const w = 398;
  const h = 48;
  c.fillStyle = 'rgba(250, 246, 238, 0.88)';
  c.strokeStyle = '#1F3A5F';
  c.lineWidth = 1;
  c.fillRect(x, y, w, h);
  c.strokeRect(x, y, w, h);

  c.font = "11px 'IBM Plex Mono', monospace";
  c.fillStyle = '#1F3A5F';
  c.textAlign = 'left';
  c.fillText(
    `空速 ${t.airSpeed.toFixed(1)} m/s · 攻角 α ${t.alphaDeg.toFixed(1)}° · 俯仰 θ ${t.pitchDeg.toFixed(1)}° · Re ${(t.reynoldsNumber / 1000).toFixed(0)}k`,
    x + 10,
    y + 19,
  );
  c.fillStyle = '#6B7280';
  c.fillText(
    `L/D ${t.liftToDrag.toFixed(1)} · 载荷 ${t.loadFactor.toFixed(2)}g · 涡升 ${t.vortexLiftSharePct.toFixed(0)}% · [L / D / mg / v]`,
    x + 10,
    y + 37,
  );
  c.restore();
}

function drawGrassBlades(
  c: CanvasRenderingContext2D,
  minX: number,
  maxX: number,
  mapX: (x: number) => number,
): void {
  const startM = Math.floor(minX * 2) / 2;
  const endM = Math.ceil(maxX * 2) / 2;
  c.save();
  c.strokeStyle = '#1F3A5F';
  c.globalAlpha = 0.24;
  c.lineWidth = 1;
  for (let m = startM; m <= endM; m += 0.5) {
    const hash = Math.abs(Math.sin(m * 127.1) * 43758.5453) % 1;
    const x = mapX(m + (hash - 0.5) * 0.35);
    if (x < -10 || x > 970) continue;
    const y = 522 + (hash * 14);
    c.beginPath();
    c.moveTo(x, y + 4);
    c.lineTo(x + (hash - 0.5) * 5, y - 3);
    c.stroke();
  }
  c.restore();
}

function drawThrowPrompt(c: CanvasRenderingContext2D, ox: number, oy: number): void {
  c.save();
  c.strokeStyle = '#D9482B';
  c.globalAlpha = 0.32;
  c.lineWidth = 1.4;
  c.setLineDash([4, 4]);
  c.beginPath();
  c.arc(ox, oy, 26, 0, Math.PI * 2);
  c.stroke();
  c.setLineDash([]);
  c.globalAlpha = 0.85;
  c.font = "11px 'IBM Plex Mono', monospace";
  c.fillStyle = '#1F3A5F';
  c.textAlign = 'left';
  c.fillText('↖ 向后下方拖动蓄力，松手投掷', Math.max(16, ox - 12), Math.min(508, oy + 48));
  c.restore();
}

function drawChargeSlingshot(
  c: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  charge: {anchor: CanvasPoint; pointer: CanvasPoint; result: DragThrowResult},
): void {
  const {pointer, result} = charge;
  const pullX = ox + result.pullVector.x;
  const pullY = oy + result.pullVector.y;

  c.save();
  // Elastic pull-back band from launch stand to finger/cursor
  c.strokeStyle = result.ready ? '#D9482B' : '#6B7280';
  c.lineWidth = result.ready ? 2.2 : 1.4;
  c.setLineDash([5, 4]);
  c.beginPath();
  c.moveTo(ox, oy);
  c.lineTo(pullX, pullY);
  c.stroke();
  c.setLineDash([]);

  // Pull handle dot
  c.fillStyle = result.ready ? '#D9482B' : '#6B7280';
  c.beginPath();
  c.arc(pullX, pullY, 6, 0, Math.PI * 2);
  c.fill();

  // Power gauge arc around launch origin
  if (result.ready) {
    c.strokeStyle = '#C9A227';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(ox, oy, 32, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * result.chargeRatio);
    c.stroke();
  }

  // Live charge readout pill
  const label = result.ready
    ? `蓄力 ${Math.round(result.chargeRatio * 100)}% · 仰角 ${result.angle}° · 初速 ${result.speed} m/s`
    : '继续向后下方拉动以蓄力（松手取消）';
  c.font = "12px 'IBM Plex Mono', monospace";
  const w = Math.min(340, c.measureText(label).width + 20);
  const bx = Math.max(14, Math.min(946 - w, pointer.x - w / 2));
  const by = Math.max(68, Math.min(478, oy - 58));
  c.fillStyle = 'rgba(250, 246, 238, 0.94)';
  c.strokeStyle = result.ready ? '#D9482B' : '#6B7280';
  c.lineWidth = 1.2;
  c.fillRect(bx, by, w, 26);
  c.strokeRect(bx, by, w, 26);
  c.fillStyle = result.ready ? '#1F3A5F' : '#6B7280';
  c.textAlign = 'left';
  c.fillText(label, bx + 10, by + 17);
  c.restore();
}

function drawWindIndicator(c: CanvasRenderingContext2D, wind: number): void {
  const dir = wind > 0 ? 1 : -1;
  const len = 28 + Math.abs(wind) * 10;
  c.save();
  c.strokeStyle = '#1F3A5F';
  c.fillStyle = '#1F3A5F';
  c.globalAlpha = 0.55;
  c.lineWidth = 1.4;
  for (const [sx, sy] of [
    [460, 40],
    [535, 50],
  ] as const) {
    const ex = sx + dir * len;
    c.beginPath();
    c.moveTo(sx, sy);
    c.lineTo(ex, sy);
    c.lineTo(ex - dir * 6, sy - 4);
    c.moveTo(ex, sy);
    c.lineTo(ex - dir * 6, sy + 4);
    c.stroke();
  }
  c.font = "12px 'IBM Plex Mono', monospace";
  c.fillText(`${wind > 0 ? '顺风' : '逆风'} ${wind > 0 ? '+' : ''}${wind} m/s`, 458, 28);
  c.restore();
}

function drawLaunchStand(
  c: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  launch: Throw | undefined,
  showReadyPlane: boolean,
  aero?: Aero,
): void {
  c.save();
  // Vertical release height pole from ground (520) to release point (1.5 m)
  c.strokeStyle = '#6B7280';
  c.lineWidth = 1.2;
  c.setLineDash([3, 3]);
  c.beginPath();
  c.moveTo(ox, 520);
  c.lineTo(ox, oy);
  c.stroke();
  c.setLineDash([]);

  c.fillStyle = '#1F3A5F';
  c.beginPath();
  c.arc(ox, oy, 3.5, 0, Math.PI * 2);
  c.fill();

  if (launch) {
    const rad = (launch.angle * Math.PI) / 180;
    const vecLen = 28 + (launch.speed - 6) * 2.1;
    const vx = ox + Math.cos(rad) * vecLen;
    const vy = oy - Math.sin(rad) * vecLen;

    // Horizontal reference & angle arc when angle > 0
    if (launch.angle > 0) {
      c.strokeStyle = '#6B7280';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(ox, oy);
      c.lineTo(ox + 26, oy);
      c.stroke();
      c.beginPath();
      c.arc(ox, oy, 20, -rad, 0);
      c.stroke();
    }

    // Launch velocity vector arrow (--mark-red #D9482B)
    c.strokeStyle = '#D9482B';
    c.fillStyle = '#D9482B';
    c.lineWidth = 1.8;
    c.beginPath();
    c.moveTo(ox, oy);
    c.lineTo(vx, vy);
    c.stroke();

    const headLen = 7;
    c.beginPath();
    c.moveTo(vx, vy);
    c.lineTo(vx - headLen * Math.cos(rad - 0.35), vy + headLen * Math.sin(rad - 0.35));
    c.lineTo(vx - headLen * Math.cos(rad + 0.35), vy + headLen * Math.sin(rad + 0.35));
    c.closePath();
    c.fill();

    if (showReadyPlane) {
      drawPaperPlaneSprite(c, ox, oy, -rad, aero, false);
    }
  }
  c.restore();
}

function drawApogeeCallout(
  c: CanvasRenderingContext2D,
  flight: Flight,
  limit: number,
  mapX: (x: number) => number,
  sy: number,
): void {
  let peak = flight.samples[0];
  for (const s of flight.samples) {
    if (s.t > limit) break;
    if (s.y > peak.y) peak = s;
  }
  if (!peak || peak.y <= 1.65) return;
  const px = mapX(peak.x);
  const py = 520 - peak.y * sy;
  c.save();
  c.fillStyle = '#1F3A5F';
  c.beginPath();
  c.arc(px, py, 3, 0, Math.PI * 2);
  c.fill();
  c.font = "11px 'IBM Plex Mono', monospace";
  c.textAlign = 'center';
  c.fillText(`最高 ${peak.y.toFixed(1)} m`, Math.max(58, Math.min(900, px)), Math.max(22, py - 8));
  c.restore();
}

function drawLandingPin(c: CanvasRenderingContext2D, lx: number, ly: number, distance: number): void {
  const x = Math.max(40, Math.min(920, lx));
  c.save();
  c.strokeStyle = '#D9482B';
  c.fillStyle = '#D9482B';
  c.lineWidth = 1.8;
  c.beginPath();
  c.moveTo(x, ly);
  c.lineTo(x, ly - 24);
  c.stroke();
  c.beginPath();
  c.moveTo(x, ly - 24);
  c.lineTo(x + 14, ly - 19);
  c.lineTo(x, ly - 14);
  c.closePath();
  c.fill();
  c.font = "12px 'IBM Plex Mono', monospace";
  c.textAlign = 'center';
  c.fillText(`${distance.toFixed(1)} m`, x, ly - 29);
  c.restore();
}

/**
 * Draw a 3D-shaded paper airplane silhouette scaled by its extracted geometric
 * proportions (wing span ratio & fuselage keel depth).
 */
function drawPaperPlaneSprite(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  rotation: number,
  aero: Aero | undefined,
  isGhost: boolean,
): void {
  const spanFactor = aero ? Math.max(0.55, Math.min(1.25, (aero.span / Math.max(0.1, aero.chord)) * 0.95)) : 0.85;
  const keelDepth = aero ? (2 * (aero.bodySideArea ?? 0)) / Math.max(0.1, aero.chord) : 0.02;
  const keelFactor = aero ? Math.max(0.65, Math.min(1.4, (keelDepth / Math.max(0.1, aero.chord)) * 9.5)) : 0.9;
  const L = isGhost ? 15 : 19;
  const wingUp = L * 0.42 * spanFactor;
  const wingDown = L * 0.18 * spanFactor;
  const keelDown = L * 0.34 * keelFactor;

  c.save();
  c.translate(x, y);
  c.rotate(rotation);

  if (isGhost) {
    c.globalAlpha = 0.65;
    c.fillStyle = '#6B7280';
    c.beginPath();
    c.moveTo(L, 0);
    c.lineTo(-L * 0.78, -wingUp);
    c.lineTo(-L * 0.42, 0);
    c.lineTo(-L * 0.78, keelDown);
    c.closePath();
    c.fill();
    c.restore();
    return;
  }

  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.lineWidth = 1.25;
  c.strokeStyle = '#1F3A5F';

  // 1. Far wing (shaded underside/back --paper-back #E8E2D4)
  c.fillStyle = '#E8E2D4';
  c.beginPath();
  c.moveTo(L, 0);
  c.lineTo(-L * 0.75, -wingUp);
  c.lineTo(-L * 0.52, 0);
  c.closePath();
  c.fill();
  c.stroke();

  // 2. Central fuselage V-keel (--ink #1F3A5F)
  c.fillStyle = '#1F3A5F';
  c.beginPath();
  c.moveTo(L, 0);
  c.lineTo(-L * 0.58, 0);
  c.lineTo(-L * 0.72, keelDown);
  c.closePath();
  c.fill();
  c.stroke();

  // 3. Near main wing (--paper #FAF6EE)
  c.fillStyle = '#FAF6EE';
  c.beginPath();
  c.moveTo(L, 0);
  c.lineTo(-L * 0.82, wingDown);
  c.lineTo(-L * 0.54, -L * 0.06);
  c.closePath();
  c.fill();
  c.stroke();

  // 4. Red nose trim mark (--mark-red #D9482B)
  c.fillStyle = '#D9482B';
  c.beginPath();
  c.moveTo(L, 0);
  c.lineTo(L * 0.62, -L * 0.05);
  c.lineTo(L * 0.62, L * 0.06);
  c.closePath();
  c.fill();

  c.restore();
}

/**
 * Mark the phase boundary where the airplane completes apogee pitch transition
 * and enters steady equilibrium glide.
 */
function drawGlideTransitionCallout(
  c: CanvasRenderingContext2D,
  phases: TrajectoryBreakdown,
  limit: number,
  mapX: (x: number) => number,
  sy: number,
): void {
  const glidePhase = phases.phases.find(p => p.kind === 'glide');
  if (!glidePhase || glidePhase.startTime > limit || glidePhase.startX <= 1.2) return;
  const pt = phases.profile.find(p => p.t >= glidePhase.startTime);
  if (!pt || pt.y <= 0.35) return;

  const gx = mapX(pt.x);
  const gy = 520 - pt.y * sy;
  c.save();
  c.strokeStyle = '#C9A227';
  c.fillStyle = '#FAF6EE';
  c.lineWidth = 1.5;
  c.beginPath();
  c.arc(gx, gy, 4, 0, Math.PI * 2);
  c.fill();
  c.stroke();

  c.font = "10px 'IBM Plex Mono', monospace";
  c.fillStyle = '#1F3A5F';
  c.textAlign = 'center';
  c.fillText(`滑翔切入 L/D ${pt.ld.toFixed(1)}`, Math.max(64, Math.min(890, gx)), Math.min(508, gy + 16));
  c.restore();
}

/**
 * Blueprint inset card displaying:
 * 1) Left subplot: Lift-Drag Polar CL(CD) with origin tangent for Best Glide (L/D)_max,
 *    Min Sink w_min, Stall point, and live operating point (CD(t), CL(t))
 *    (adapted from tfraudet/glider-polar-analysis & Stengel's PaperPlane_Sim.m).
 * 2) Right subplot: Specific Mechanical Energy envelope Es(x) = gy + 0.5*V^2 showing
 *    real-time kinetic-to-potential conversion and glide dissipation.
 */
function drawPolarAndEnergyInset(
  c: CanvasRenderingContext2D,
  polar: AeroPolar,
  phases: TrajectoryBreakdown,
  telemetry: FlightTelemetry,
  aero: Aero,
): void {
  const cardX = 656;
  const cardY = 66;
  const cardW = 288;
  const cardH = 152;

  c.save();
  c.fillStyle = 'rgba(250, 246, 238, 0.90)';
  c.strokeStyle = '#1F3A5F';
  c.lineWidth = 1;
  c.fillRect(cardX, cardY, cardW, cardH);
  c.strokeRect(cardX, cardY, cardW, cardH);

  // Subplot 1: CL-CD Polar (left half)
  const pX = cardX + 12;
  const pY = cardY + 22;
  const pW = 122;
  const pH = 98;

  c.font = "10px 'IBM Plex Mono', monospace";
  c.fillStyle = '#1F3A5F';
  c.textAlign = 'left';
  c.fillText('升阻极曲线 CL(CD)', pX, cardY + 14);

  c.strokeStyle = '#C9DCEB';
  c.lineWidth = 0.8;
  c.strokeRect(pX, pY, pW, pH);

  const visibleCurve = polar.curve.filter(pt => pt.alphaDeg >= -4 && pt.alphaDeg <= 24);
  const maxCd = Math.max(0.28, ...visibleCurve.map(pt => pt.cd)) * 1.08;
  const maxCl = Math.max(0.45, polar.clMax) * 1.12;
  const minCl = -0.08;
  const mapCd = (cd: number) => pX + Math.min(1, Math.max(0, cd / maxCd)) * pW;
  const mapCl = (cl: number) => pY + pH - Math.min(1, Math.max(0, (cl - minCl) / (maxCl - minCl))) * pH;

  // Origin tangent line for (L/D)_max (--gold #C9A227)
  const bgX = mapCd(polar.bestGlide.cd);
  const bgY = mapCl(polar.bestGlide.cl);
  const zeroX = mapCd(0);
  const zeroY = mapCl(0);
  c.strokeStyle = '#C9A227';
  c.lineWidth = 1;
  c.setLineDash([3, 3]);
  c.beginPath();
  c.moveTo(zeroX, zeroY);
  c.lineTo(bgX, bgY);
  c.stroke();
  c.setLineDash([]);

  // Polar curve CL(CD) (--ink #1F3A5F)
  c.strokeStyle = '#1F3A5F';
  c.lineWidth = 1.5;
  c.beginPath();
  visibleCurve.forEach((pt, idx) => {
    const cx = mapCd(pt.cd);
    const cy = mapCl(pt.cl);
    if (idx === 0) c.moveTo(cx, cy);
    else c.lineTo(cx, cy);
  });
  c.stroke();

  // Best Glide point (#C9A227) & Min Sink point (#7FA86B)
  c.fillStyle = '#C9A227';
  c.beginPath();
  c.arc(bgX, bgY, 3, 0, Math.PI * 2);
  c.fill();

  const msX = mapCd(polar.minSink.cd);
  const msY = mapCl(polar.minSink.cl);
  c.fillStyle = '#7FA86B';
  c.beginPath();
  c.arc(msX, msY, 2.8, 0, Math.PI * 2);
  c.fill();

  // Live operating point (CD(t), CL(t)) on the polar curve (--mark-red #D9482B)
  const liveCoeff = effectiveCoefficients((telemetry.alphaDeg * Math.PI) / 180, aero, telemetry.airSpeed);
  const liveX = mapCd(liveCoeff.cd);
  const liveY = mapCl(liveCoeff.cl);
  c.strokeStyle = '#D9482B';
  c.fillStyle = '#D9482B';
  c.lineWidth = 1.2;
  c.beginPath();
  c.arc(liveX, liveY, 4.5, 0, Math.PI * 2);
  c.stroke();
  c.beginPath();
  c.arc(liveX, liveY, 2, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = '#6B7280';
  c.fillText(`(L/D)max ${polar.bestGlide.ld.toFixed(1)} @${polar.bestGlide.alphaDeg.toFixed(1)}°`, pX, cardY + 134);
  c.fillText(`w_min ${polar.minSink.sinkRate.toFixed(2)}m/s · V_eq ${polar.bestGlide.speed.toFixed(1)}`, pX, cardY + 146);

  // Subplot 2: Specific Energy Envelope Es(x) = g*y + 0.5*V^2 (right half)
  const eX = cardX + 152;
  const eY = cardY + 22;
  const eW = 124;
  const eH = 98;

  c.fillStyle = '#1F3A5F';
  c.fillText('比机械能 Es(x)', eX, cardY + 14);

  c.strokeStyle = '#C9DCEB';
  c.lineWidth = 0.8;
  c.strokeRect(eX, eY, eW, eH);

  const prof = phases.profile;
  const maxDist = Math.max(1, prof[prof.length - 1]?.x ?? 1);
  const maxEs = Math.max(20, phases.initialSpecificEnergy * 1.05);
  const mapEx = (x: number) => eX + Math.min(1, Math.max(0, x / maxDist)) * eW;
  const mapEy = (es: number) => eY + eH - Math.min(1, Math.max(0, es / maxEs)) * eH;

  // Potential energy gy(x) shaded area (--sky)
  c.fillStyle = 'rgba(143, 199, 232, 0.45)';
  c.beginPath();
  c.moveTo(eX, eY + eH);
  for (const pt of prof) {
    const potE = 9.81 * Math.max(0, pt.y);
    c.lineTo(mapEx(pt.x), mapEy(potE));
  }
  c.lineTo(mapEx(prof[prof.length - 1]?.x ?? 0), eY + eH);
  c.closePath();
  c.fill();

  // Total specific energy Es(x) curve (--ink #1F3A5F)
  c.strokeStyle = '#1F3A5F';
  c.lineWidth = 1.4;
  c.beginPath();
  prof.forEach((pt, idx) => {
    const cx = mapEx(pt.x);
    const cy = mapEy(pt.specificEnergy);
    if (idx === 0) c.moveTo(cx, cy);
    else c.lineTo(cx, cy);
  });
  c.stroke();

  // Current flight progress marker on Es(x)
  const curPt = prof.find(pt => pt.t >= telemetry.t) ?? prof[prof.length - 1];
  if (curPt) {
    const curX = mapEx(curPt.x);
    const curY = mapEy(curPt.specificEnergy);
    c.strokeStyle = '#D9482B';
    c.fillStyle = '#D9482B';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(curX, eY);
    c.lineTo(curX, eY + eH);
    c.stroke();
    c.beginPath();
    c.arc(curX, curY, 2.8, 0, Math.PI * 2);
    c.fill();
  }

  c.fillStyle = '#6B7280';
  c.fillText(
    `势能转化 ${phases.apogeePotentialConversionPct.toFixed(0)}% · 阻耗 ${phases.climbDragLossPct.toFixed(0)}%`,
    eX,
    cardY + 134,
  );
  c.fillText(
    `T_sp ${polar.stability.shortPeriodPeriod.toFixed(2)}s · T_ph ${polar.stability.phugoidPeriod.toFixed(1)}s`,
    eX,
    cardY + 146,
  );

  c.restore();
}

export type ComparisonFlightEntry = {
  label: string;
  flight: Flight;
  scoreText: string;
};

/**
 * Render an overlay comparison canvas for the Competition Settlement view,
 * plotting each player's best valid trajectory using the DESIGN.md palette.
 */
export function renderComparisonCanvas(
  canvas: HTMLCanvasElement,
  entries: readonly ComparisonFlightEntry[],
): void {
  const c = canvas.getContext('2d')!;
  const palette = ['#1F3A5F', '#D9482B', '#C9A227', '#6B7280'];
  const flights = entries.map(e => e.flight);
  const cam = computeFlightCamera(
    flights[0] ?? {samples: [{t: 0, x: 0, y: 1.5, pitch: 0}], distance: 10, duration: 1, height: 4, landed: true},
    null,
    null,
    0,
    {followCamera: false, hidePreview: false},
  );
  // Expand bounds to cover all entries
  let minX = 0;
  let maxX = 12;
  let maxY = 4;
  for (const f of flights) {
    maxY = Math.max(maxY, f.height);
    for (const s of f.samples) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      maxY = Math.max(maxY, s.y);
    }
  }
  const scaleX = 840 / Math.max(1, maxX - minX);
  const mapX = (x: number) => 60 + (x - minX) * scaleX;
  const sy = 460 / maxY;

  const skyGrad = c.createLinearGradient(0, 0, 0, 520);
  skyGrad.addColorStop(0, '#8FC7E8');
  skyGrad.addColorStop(1, '#DCEFF9');
  c.fillStyle = skyGrad;
  c.fillRect(0, 0, 960, 520);

  c.fillStyle = '#7FA86B';
  c.fillRect(0, 520, 960, 80);
  drawGrassBlades(c, minX, maxX, mapX);
  c.strokeStyle = '#1F3A5F';
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(0, 520);
  c.lineTo(960, 520);
  c.stroke();

  entries.forEach((entry, idx) => {
    const color = palette[idx % palette.length];
    c.save();
    c.beginPath();
    entry.flight.samples.forEach((p, i) => {
      const x = mapX(p.x);
      const y = 520 - p.y * sy;
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    });
    c.strokeStyle = color;
    c.lineWidth = idx === 0 ? 3 : 2.2;
    c.setLineDash(idx === 0 ? [] : [8, 5]);
    c.stroke();
    c.setLineDash([]);

    // Landing marker
    const lx = mapX(entry.flight.distance);
    c.fillStyle = color;
    c.beginPath();
    c.arc(lx, 520, 4.5, 0, Math.PI * 2);
    c.fill();
    c.restore();
  });

  // Legend box top-left
  c.save();
  const boxH = 20 + entries.length * 20;
  c.fillStyle = 'rgba(250, 246, 238, 0.92)';
  c.strokeStyle = '#1F3A5F';
  c.lineWidth = 1;
  c.fillRect(24, 16, 290, boxH);
  c.strokeRect(24, 16, 290, boxH);
  c.font = "12px 'IBM Plex Mono', monospace";
  c.textAlign = 'left';
  entries.forEach((entry, idx) => {
    const color = palette[idx % palette.length];
    const y = 36 + idx * 20;
    c.fillStyle = color;
    c.fillRect(36, y - 8, 12, 4);
    c.fillStyle = '#1F3A5F';
    c.fillText(`${entry.label} · ${entry.scoreText}`, 56, y - 2);
  });
  c.restore();

  // Distance scale labels
  c.font = "16px 'IBM Plex Mono', monospace";
  c.fillStyle = '#1F3A5F';
  c.textAlign = 'left';
  for (let i = 0; i <= 4; i++) {
    c.fillText(`${(minX + ((maxX - minX) * i) / 4).toFixed(0)} m`, 60 + (840 * i) / 4, 558);
  }
  void cam;
}
