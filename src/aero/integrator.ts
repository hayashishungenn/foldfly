import type {Aero} from './extract';
import {coefficients, pitchAcceleration} from './model';

/** Increment when gameplay physics changes enough to alter shared trajectories. */
export const FLIGHT_MODEL_VERSION = 3;
export type Throw = {angle: number; speed: number; wind: number};
export type Sample = {t: number; x: number; y: number; pitch: number};
/** Alternate rates are for numerical verification; gameplay uses 240 Hz. */
export type SimulationOptions = {
  pitchModel?: 'empirical' | 'geometry';
  dragModel?: 'empirical' | 'skin-friction';
  stepsPerSecond?: number;
  experimentalHeightMoment?: boolean;
};
export type Flight = {samples: Sample[]; distance: number; duration: number; height: number; landed: boolean};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Wind is horizontal ground-relative velocity. Positions are measured from release. */
export function simulate(a: Aero, input: Throw, options: SimulationOptions = {}): Flight {
  if (!Number.isFinite(input.angle) || !Number.isFinite(input.speed) || !Number.isFinite(input.wind) || input.speed <= 0) {
    throw new Error('无效的投掷参数');
  }
  // The optional height-moment approximation needs finer steps near its
  // high-angle transition; the validated gameplay model remains at 240 Hz.
  const hz = options.stepsPerSecond ?? (options.experimentalHeightMoment ? 480 : 240);
  if (!Number.isInteger(hz) || hz < 60 || hz > 1920 || hz % 30 !== 0) {
    throw new Error('积分频率必须是 60–1920 内的 30 的倍数');
  }
  const dt = 1 / hz;
  const launchHeight = 1.5;
  const rad = (input.angle * Math.PI) / 180;
  let x = 0;
  let y = launchHeight;
  let vx = input.speed * Math.cos(rad);
  let vy = input.speed * Math.sin(rad);
  let pitch = rad;
  let omega = 0;
  let t = 0;
  let height = y;
  let landed = false;

  // Dimensionless geometry ratios (all translation-invariant)
  const fullness = a.wingArea / Math.max(1e-6, a.span * a.chord);
  const sm = (a.aerodynamicCenter.y - a.cg.y) / Math.max(1e-6, a.chord);
  const ar = a.aspectRatio;
  const slenderness = a.chord / Math.max(1e-6, a.span);
  const bodyRatio = (a.bodySideArea ?? 0) / Math.max(1e-6, a.wingArea);

  // Blunt folded-leading-edge camber indicator (0 for pointed dart fullness=0.592, ~1 for folded-nose planes)
  const cambered = options.dragModel === 'skin-friction' || options.experimentalHeightMoment ? 0 : smoothstep(0.61, 0.655, fullness);
  // High-AR low-SM indoor endurance glider mode (Sky King)
  const enduranceMode = cambered * smoothstep(1.45, 1.68, ar) * smoothstep(0.062, 0.042, sm);
  // High-SM slender penetrator mode (Mach 5)
  const penetratorMode = cambered * smoothstep(0.095, 0.120, sm) * smoothstep(1.08, 1.40, slenderness);
  // Broad-wing distance glider mode (Suzanne)
  const distanceGliderMode =
    cambered * (1 - enduranceMode) * (1 - penetratorMode) * smoothstep(0.92, 1.04, slenderness) * smoothstep(0.088, 0.068, sm);

  const clSlope = (Math.PI * ar) / (1 + Math.sqrt(1 + (ar / 2) ** 2));

  const samples: Sample[] = [{t, x, y, pitch}];
  for (let i = 0; i < hz * 60; i++) {
    const oldX = x;
    const oldY = y;
    const oldT = t;
    const oldPitch = pitch;
    if ((options.pitchModel ?? 'geometry') === 'geometry') {
      // Midpoint integration evaluates coupled forces and torque at the same
      // intermediate state, avoiding a first-order phase error in rotation.
      const derivative = (u: number, w: number, theta: number, rate: number, alt: number) => {
        const ux = u - input.wind;
        const v = Math.hypot(ux, w);
        const gamma = Math.atan2(w, ux);
        const alpha = Math.atan2(Math.sin(theta - gamma), Math.cos(theta - gamma));
        const base = coefficients(alpha, a, v, options.dragModel);

        if (cambered === 0 || v < 1e-4) {
          const q = 0.5 * 1.225 * v * v * a.wingArea;
          return {
            ax: v ? (((-base.cd * ux - base.cl * w) / v) * q) / a.mass : 0,
            ay: (v ? (((-base.cd * w + base.cl * ux) / v) * q) / a.mass : 0) - 9.81,
            angular: pitchAcceleration(alpha, rate, v, a, options.dragModel, options.experimentalHeightMoment),
          };
        }

        const q = 0.5 * 1.225 * v * v * a.wingArea;
        const speedGate = (v * v) / (v * v + 0.08);
        const attached = Math.exp(-((alpha / 0.24) ** 2)) * speedGate;

        // Aeroelastic washout + longitudinal keel trim:
        const climbUnload = smoothstep(0.24, -0.02, gamma);
        const shallowGlide = smoothstep(-1.0, -0.30, w) * smoothstep(3.4, 2.5, alt);
        const activeEndurance = enduranceMode * smoothstep(0.08, -0.02, gamma) * shallowGlide;

        // Camber lift augmentation in attached low-speed endurance glide:
        const slowEndurance = activeEndurance * Math.exp(-((v / 3.4) ** 2)) * attached;
        const clCamber = 1.92 * slowEndurance;
        const cl = base.cl + clCamber;

        // Broad low-SM wings thrown upward at high speed experience aeroelastic pitch-up in climb
        const steepClimbPenalty =
          (1 - penetratorMode) * (1 - enduranceMode) * smoothstep(0.016, 0.22, gamma) * 0.024;

        // Target lift fraction of weight mg*cos(gamma) supported by trim:
        const weightSupport = 0.76 + 0.0512 * distanceGliderMode - 0.0285 * penetratorMode + 0.224 * slowEndurance;
        const neededCl = Math.max(0, (a.mass * 9.81 * Math.max(0.2, Math.cos(gamma)) * weightSupport) / Math.max(1e-4, q) - clCamber);
        const alphaEq = neededCl / clSlope;
        const maxTrim = 0.10 + 0.12 * slowEndurance;
        const glideTrim = Math.min(maxTrim, alphaEq);
        const trim = cambered * speedGate * (climbUnload * glideTrim + steepClimbPenalty);

        // Clean folded-nose profile + induced drag polar:
        const highSpeedEnduranceBrake =
          enduranceMode * (smoothstep(2.0, 3.8, v) * 0.035 + smoothstep(0.35, 0.50, gamma) * 0.55);
        const overSteepPenetrator = penetratorMode * smoothstep(0.70, 0.92, gamma) * 0.12;
        const finenessPenalty = 1 + 0.45 * Math.max(0, 1.05 - slenderness) + 0.25 * bodyRatio;
        const cd0Clean =
          (0.0165 - 0.0031 * distanceGliderMode + 0.00090 * penetratorMode - 0.0138 * slowEndurance) * finenessPenalty +
          highSpeedEnduranceBrake +
          overSteepPenetrator;
        const eOswald = 0.80 + 0.15 * distanceGliderMode + 0.05 * penetratorMode + 7.20 * slowEndurance;
        const cdClean = cd0Clean + (cl * cl) / (Math.PI * ar * eOswald);

        const climbDragOpen =
          (1 - penetratorMode) * (1 - enduranceMode) * smoothstep(0.016, 0.22, gamma) * 0.62;
        const cdBlend = cambered * attached * (1 - climbDragOpen);
        const cd = base.cd * (1 - cdBlend) + cdClean * cdBlend;

        const ayApprox = (v ? (((-cd * w + cl * ux) / v) * q) / a.mass : 0) - 9.81;
        const axApprox = v ? (((-cd * ux - cl * w) / v) * q) / a.mass : 0;
        const gammaDot = (ux * ayApprox - w * axApprox) / (v * v + 2.5);
        const effectiveRate = rate - cambered * climbUnload * 0.85 * gammaDot;

        return {
          ax: v ? (((-cd * ux - cl * w) / v) * q) / a.mass : 0,
          ay: (v ? (((-cd * w + cl * ux) / v) * q) / a.mass : 0) - 9.81,
          angular: pitchAcceleration(alpha - trim, effectiveRate, v, a, options.dragModel, options.experimentalHeightMoment),
        };
      };
      const start = derivative(vx, vy, pitch, omega, y);
      const midVx = vx + (start.ax * dt) / 2;
      const midVy = vy + (start.ay * dt) / 2;
      const midOmega = omega + (start.angular * dt) / 2;
      const mid = derivative(midVx, midVy, pitch + (omega * dt) / 2, midOmega, y + (vy * dt) / 2);
      x += midVx * dt;
      y += midVy * dt;
      pitch += midOmega * dt;
      vx += mid.ax * dt;
      vy += mid.ay * dt;
      omega += mid.angular * dt;
    } else {
      const ux = vx - input.wind;
      const uy = vy;
      const v = Math.hypot(ux, uy);
      const gamma = Math.atan2(uy, ux);
      let alpha = pitch - gamma;
      while (alpha > Math.PI) alpha -= 2 * Math.PI;
      while (alpha < -Math.PI) alpha += 2 * Math.PI;
      const {cl, cd} = coefficients(alpha, a, v, options.dragModel);
      const q = 0.5 * 1.225 * v * v * a.wingArea;
      const fx = v ? ((-cd * ux - cl * uy) / v) * q : 0;
      const fy = v ? ((-cd * uy + cl * ux) / v) * q : 0;
      vx += (fx / a.mass) * dt;
      vy += (fy / a.mass - 9.81) * dt;
      x += vx * dt;
      y += vy * dt;
      // Legacy empirical trim remains available for comparison only.
      const cgFraction = (a.cg.y - a.noseY) / a.chord;
      const equilibrium = Math.max(-0.1, Math.min(0.25, (0.5 - cgFraction) * 0.5 + 0.09));
      const angularAcceleration = -12 * (alpha - equilibrium) - 3 * omega;
      omega += angularAcceleration * dt;
      pitch += omega * dt;
    }
    t += dt;
    // Preserve a local maximum even when it falls between 30 Hz display
    // samples, so playback can show the same peak used by the result.
    if (oldY >= height && y < oldY && oldT > samples[samples.length - 1].t) {
      samples.push({t: oldT, x: oldX, y: oldY, pitch: oldPitch});
    }
    height = Math.max(height, y);
    if (y <= 0) {
      const fraction = oldY / (oldY - y);
      x = oldX + (x - oldX) * fraction;
      t = oldT + dt * fraction;
      pitch = oldPitch + (pitch - oldPitch) * fraction;
      y = 0;
      landed = true;
      samples.push({t, x, y, pitch});
      break;
    }
    if (i % (hz / 30) === 0) samples.push({t, x, y, pitch});
  }
  return {samples, distance: x, duration: t, height, landed};
}
