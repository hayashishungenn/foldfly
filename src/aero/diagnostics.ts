import {aeroMetrics, type Aero} from './extract';
import type {Flight, Sample, Throw} from './integrator';
import {
  computePolhamusBreakdown,
  computeReynoldsNumber,
  effectiveCoefficients,
  groundEffectDragFactor,
} from './polar';

export type ForceVectors = {
  /** Lift force magnitude (N) and unit direction (dx, dy in world coordinates: +x right, +y up). */
  lift: number;
  liftDir: {x: number; y: number};
  /** Drag force magnitude (N) and unit direction (opposite relative airflow). */
  drag: number;
  dragDir: {x: number; y: number};
  /** Weight mg (N), always pointing straight down (0, -1). */
  weight: number;
  /** Ground velocity magnitude (m/s) and unit direction. */
  speed: number;
  velocityDir: {x: number; y: number};
};

export type FlightTelemetry = {
  t: number;
  x: number;
  y: number;
  pitchDeg: number;
  gammaDeg: number;
  alphaDeg: number;
  airSpeed: number;
  groundSpeed: number;
  sinkRate: number;
  liftToDrag: number;
  loadFactor: number;
  reynoldsNumber: number;
  vortexLiftSharePct: number;
  groundEffectReductionPct: number;
  forces: ForceVectors;
};

export type FlightRegime = 'steady-glide' | 'climb-glide' | 'phugoid' | 'stall-recovery';

export type FlightEvent = {
  t: number;
  x: number;
  y: number;
  kind: 'apogee' | 'stall' | 'phugoid' | 'touchdown';
  label: string;
  detail: string;
};

export type FlightComparison = {
  distanceDelta: number;
  durationDelta: number;
  heightDelta: number;
  summary: string;
};

export type FlightAnalysis = {
  regime: FlightRegime;
  regimeLabel: string;
  maxAlphaDeg: number;
  avgGlideRatio: number;
  minSinkRate: number;
  oscillationPeaks: number;
  verdict: string;
  events: FlightEvent[];
  comparison: FlightComparison | null;
};

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function velocityAtIndex(samples: readonly Sample[], idx: number, launch: Throw): {vx: number; vy: number} {
  if (samples.length < 2) {
    const rad = (launch.angle * Math.PI) / 180;
    return {vx: launch.speed * Math.cos(rad), vy: launch.speed * Math.sin(rad)};
  }
  const i0 = Math.max(0, Math.min(samples.length - 2, idx));
  const a = samples[i0];
  const b = samples[i0 + 1];
  const dt = Math.max(1e-5, b.t - a.t);
  return {vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt};
}

/**
 * Compute instantaneous aerodynamic telemetry and force vectors (Lift, Drag,
 * Weight, Velocity) at any elapsed time along a simulated flight.
 * Inspired by Sonville/suzanne-paper-plane-lab's live force vector HUD and
 * Robert F. Stengel's PaperPlane longitudinal flight mechanics equations.
 */
export function telemetryAt(
  flight: Flight,
  aero: Aero,
  launch: Throw,
  elapsed: number,
): FlightTelemetry {
  const samples = flight.samples;
  const targetT = clamp(elapsed, 0, flight.duration);
  let idx = 0;
  while (idx + 1 < samples.length && samples[idx + 1].t < targetT) {
    idx++;
  }
  const s0 = samples[idx];
  const s1 = samples[Math.min(samples.length - 1, idx + 1)];
  const span = Math.max(1e-6, s1.t - s0.t);
  const f = s1.t > s0.t ? clamp((targetT - s0.t) / span, 0, 1) : 0;

  const x = s0.x + (s1.x - s0.x) * f;
  const y = s0.y + (s1.y - s0.y) * f;
  const pitch = s0.pitch + (s1.pitch - s0.pitch) * f;
  const rad = (launch.angle * Math.PI) / 180;
  // 2.10:优先使用采样时写入的真实积分状态;旧存档/外部 Flight 回退到差分反推
  const recorded = s0.vx !== undefined && s1.vx !== undefined && s0.vy !== undefined && s1.vy !== undefined;
  const vx = recorded ? s0.vx! + (s1.vx! - s0.vx!) * f : targetT <= 1e-6 ? launch.speed * Math.cos(rad) : velocityAtIndex(samples, idx, launch).vx;
  const vy = recorded ? s0.vy! + (s1.vy! - s0.vy!) * f : targetT <= 1e-6 ? launch.speed * Math.sin(rad) : velocityAtIndex(samples, idx, launch).vy;

  const ux = vx - launch.wind;
  const uy = vy;
  const airSpeed = recorded && s0.airSpeed !== undefined ? s0.airSpeed + ((s1.airSpeed ?? s0.airSpeed) - s0.airSpeed) * f : Math.hypot(ux, uy);
  const groundSpeed = Math.hypot(vx, vy);
  const gamma = airSpeed > 1e-4 ? Math.atan2(uy, ux) : pitch;
  const interpolatedAlpha = recorded && s0.alpha !== undefined ? s0.alpha + ((s1.alpha ?? s0.alpha) - s0.alpha) * f : null;
  const alpha = interpolatedAlpha ?? Math.atan2(Math.sin(pitch - gamma), Math.cos(pitch - gamma));

  const cl = recorded && s0.cl !== undefined ? s0.cl + ((s1.cl ?? s0.cl) - s0.cl) * f : effectiveCoefficients(alpha, aero, airSpeed).cl;
  const cd = recorded && s0.cd !== undefined ? s0.cd + ((s1.cd ?? s0.cd) - s0.cd) * f : effectiveCoefficients(alpha, aero, airSpeed).cd;
  const q = recorded && s0.q !== undefined ? s0.q + ((s1.q ?? s0.q) - s0.q) * f : 0.5 * 1.225 * airSpeed * airSpeed * aero.wingArea;
  const liftSigned = cl * q;
  const drag = cd * q;
  const weight = aero.mass * 9.81;

  // Relative wind unit vector (ux/airSpeed, uy/airSpeed)
  const wx = airSpeed > 1e-4 ? ux / airSpeed : Math.cos(pitch);
  const wy = airSpeed > 1e-4 ? uy / airSpeed : Math.sin(pitch);

  // Drag acts opposite to relative airflow (-wx, -wy)
  // Lift acts perpendicular to relative airflow (-wy, wx) scaled by sign(cl)
  const liftSign = liftSigned >= 0 ? 1 : -1;
  const liftDir = {x: -wy * liftSign, y: wx * liftSign};
  const dragDir = {x: -wx, y: -wy};
  const velocityDir = groundSpeed > 1e-4 ? {x: vx / groundSpeed, y: vy / groundSpeed} : {x: Math.cos(pitch), y: Math.sin(pitch)};

  const reynoldsNumber = computeReynoldsNumber(airSpeed, aero.chord);
  const vortexLiftSharePct = computePolhamusBreakdown(alpha, aero).vortexSharePct;
  const groundEffectReductionPct = Math.max(0, (1 - groundEffectDragFactor(y, aero.span)) * 100);

  return {
    t: targetT,
    x,
    y,
    pitchDeg: (pitch * 180) / Math.PI,
    gammaDeg: (gamma * 180) / Math.PI,
    alphaDeg: (alpha * 180) / Math.PI,
    airSpeed,
    groundSpeed,
    sinkRate: -vy,
    liftToDrag: cd > 1e-5 ? cl / cd : 0,
    loadFactor: weight > 1e-6 ? liftSigned / weight : 0,
    reynoldsNumber,
    vortexLiftSharePct,
    groundEffectReductionPct,
    forces: {
      lift: Math.abs(liftSigned),
      liftDir,
      drag,
      dragDir,
      weight,
      speed: groundSpeed,
      velocityDir,
    },
  };
}

/**
 * Analyze a completed or preview trajectory to classify its longitudinal flight
 * regime (Stengel: Steady Glide, Climb-to-Glide, Phugoid Oscillation, Stall Recovery),
 * detect key trajectory events, and produce an actionable diagnostic verdict.
 */
export function analyzeFlight(
  flight: Flight,
  aero: Aero,
  launch: Throw,
  previous?: Flight | null,
): FlightAnalysis {
  const samples = flight.samples;
  const metrics = aeroMetrics(aero);

  let peakSample = samples[0];
  let maxAlphaDeg = 0;
  let stallSample: Sample | null = null;
  let peakCount = 0;
  let glideLdSum = 0;
  let glideSinkSum = 0;
  let glideCount = 0;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.y > peakSample.y) peakSample = s;

    if (i > 0 && i + 1 < samples.length) {
      if (samples[i].y > samples[i - 1].y + 0.04 && samples[i].y >= samples[i + 1].y) {
        peakCount++;
      }
    }

    const {vx, vy} = velocityAtIndex(samples, i, launch);
    const ux = vx - launch.wind;
    const airSpeed = Math.hypot(ux, vy);
    if (airSpeed < 0.2) continue;
    const gamma = Math.atan2(vy, ux);
    const alpha = Math.atan2(Math.sin(s.pitch - gamma), Math.cos(s.pitch - gamma));
    const alphaDeg = Math.abs((alpha * 180) / Math.PI);
    if (alphaDeg > maxAlphaDeg) {
      maxAlphaDeg = alphaDeg;
      if (alphaDeg > 15.5 && !stallSample) {
        stallSample = s;
      }
    }

    if (vy < 0 && s.t > flight.duration * 0.3) {
      const {cl, cd} = effectiveCoefficients(alpha, aero, airSpeed);
      if (cd > 1e-5 && cl > 0) {
        glideLdSum += cl / cd;
        glideSinkSum += -vy;
        glideCount++;
      }
    }
  }

  const avgGlideRatio = glideCount > 0 ? glideLdSum / glideCount : flight.distance / Math.max(0.5, 1.5);
  const minSinkRate = glideCount > 0 ? glideSinkSum / glideCount : 1.5 / Math.max(0.2, flight.duration);

  let regime: FlightRegime = 'steady-glide';
  let regimeLabel = '平稳滑翔 (Equilibrium Glide)';
  if (peakCount >= 2) {
    regime = 'phugoid';
    regimeLabel = '长周期波状振荡 (Phugoid Mode)';
  } else if (maxAlphaDeg > 18) {
    regime = 'stall-recovery';
    regimeLabel = '大攻角失速改出 (Stall Recovery)';
  } else if (peakSample.y > 2.3) {
    regime = 'climb-glide';
    regimeLabel = '高速爬升转滑翔 (Climb-to-Glide)';
  }

  const events: FlightEvent[] = [];
  if (peakSample && peakSample.y > 1.55) {
    events.push({
      t: peakSample.t,
      x: peakSample.x,
      y: peakSample.y,
      kind: 'apogee',
      label: '弹道最高点',
      detail: `${peakSample.y.toFixed(1)} m @ ${peakSample.t.toFixed(1)} s`,
    });
  }
  if (stallSample && maxAlphaDeg > 16) {
    events.push({
      t: stallSample.t,
      x: stallSample.x,
      y: stallSample.y,
      kind: 'stall',
      label: '大攻角失速区',
      detail: `最大攻角 ${maxAlphaDeg.toFixed(0)}°`,
    });
  }
  if (peakCount >= 2) {
    events.push({
      t: peakSample.t,
      x: peakSample.x,
      y: peakSample.y,
      kind: 'phugoid',
      label: '动能-势能交换',
      detail: `${peakCount} 次波峰起伏`,
    });
  }
  const last = samples[samples.length - 1];
  if (last && flight.landed) {
    events.push({
      t: last.t,
      x: last.x,
      y: 0,
      kind: 'touchdown',
      label: '着陆触地',
      detail: `${flight.distance.toFixed(1)} m · ${flight.duration.toFixed(1)} s`,
    });
  }

  // Physics-based diagnostic verdict inspired by Sonville/suzanne-paper-plane-lab
  let verdict: string;
  if (regime === 'phugoid') {
    verdict = `出现 ${peakCount} 次波状起伏（Phugoid 模态）：出手速度与配平攻角不匹配，动能与重力势能反复交替；适度降低仰角或匹配滑翔速（~${metrics.nominalGlideSpeed.toFixed(1)} m/s）可平抑振荡。`;
  } else if (regime === 'stall-recovery') {
    verdict = `爬升段最大攻角达 ${maxAlphaDeg.toFixed(0)}°（超过 14° 分离阈值），诱导阻力陡增导致失速低头；减小投掷仰角或选用静稳定裕度更高的构型可改善穿透。`;
  } else if (regime === 'climb-glide') {
    verdict = `高初速冲高至 ${peakSample.y.toFixed(1)} m 顶点后顺滑改平，将初始动能转化为势能储备，滑翔段平均升阻比 L/D ≈ ${avgGlideRatio.toFixed(1)}。`;
  } else {
    verdict = `出手姿态接近配平滑翔角，全程附着流平稳滑翔（平均升阻比 L/D ≈ ${avgGlideRatio.toFixed(1)}，沉降率 ${minSinkRate.toFixed(2)} m/s）。`;
  }

  let comparison: FlightComparison | null = null;
  if (previous && previous !== flight) {
    const distanceDelta = flight.distance - previous.distance;
    const durationDelta = flight.duration - previous.duration;
    const heightDelta = flight.height - previous.height;
    const fmt = (n: number, u: string) => `${n >= 0 ? '+' : ''}${n.toFixed(1)} ${u}`;
    comparison = {
      distanceDelta,
      durationDelta,
      heightDelta,
      summary: `与上一投相比：距离 ${fmt(distanceDelta, 'm')} · 滞空 ${fmt(durationDelta, 's')} · 最高 ${fmt(heightDelta, 'm')}`,
    };
  }

  return {
    regime,
    regimeLabel,
    maxAlphaDeg,
    avgGlideRatio,
    minSinkRate,
    oscillationPeaks: peakCount,
    verdict,
    events,
    comparison,
  };
}
