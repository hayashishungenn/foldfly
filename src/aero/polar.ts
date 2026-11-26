import type {Aero} from './extract';
import {simulate, type Flight, type Throw} from './integrator';
import {defaultEnvironment, prepareSolver, solveAero, type SolverContext} from './solver';

export type PolarPoint = {
  alphaDeg: number;
  cl: number;
  cd: number;
  ld: number;
  enduranceFactor: number;
  equilibriumSpeed: number;
  horizontalSpeed: number;
  sinkRate: number;
  groundGlideRatio: number;
};

export type PolarOperatingPoint = {
  alphaDeg: number;
  cl: number;
  cd: number;
  ld: number;
  speed: number;
  sinkRate: number;
  gammaDeg: number;
};

export type StabilityModes = {
  /** Short-period pitch natural frequency (rad/s). */
  shortPeriodOmega: number;
  /** Short-period pitch oscillation period (s). */
  shortPeriodPeriod: number;
  /** Short-period pitch damping ratio zeta_sp. */
  shortPeriodDamping: number;
  /** Phugoid (long-period) natural frequency (rad/s). */
  phugoidOmega: number;
  /** Phugoid oscillation period T_ph (s). */
  phugoidPeriod: number;
  /** Phugoid damping ratio zeta_ph = 1 / (sqrt(2) * (L/D)_max). */
  phugoidDamping: number;
  /** Static pitch stiffness M_alpha (1/s^2). */
  pitchStiffness: number;
};

export type AeroPolar = {
  curve: PolarPoint[];
  bestGlide: PolarOperatingPoint;
  windBestGlide: PolarOperatingPoint;
  minSink: PolarOperatingPoint;
  stallAngleDeg: number;
  clMax: number;
  stallSpeed: number;
  wingLoadingPa: number;
  reynoldsAtBestGlide: number;
  vortexLiftSharePct: number;
  stability: StabilityModes;
};

export type PolhamusBreakdown = {
  potentialCl: number;
  vortexCl: number;
  totalPolhamusCl: number;
  vortexSharePct: number;
};

export type TrajectoryPhase = {
  kind: 'climb' | 'transition' | 'glide';
  label: string;
  startTime: number;
  endTime: number;
  startX: number;
  endX: number;
  distanceShare: number;
  energyLossPct: number;
  summary: string;
};

export type TrajectoryProfilePoint = {
  t: number;
  x: number;
  y: number;
  airSpeed: number;
  alphaDeg: number;
  pitchDeg: number;
  gammaDeg: number;
  cl: number;
  cd: number;
  ld: number;
  /** Specific mechanical energy E/m = g*y + 0.5*V^2 (J/kg). */
  specificEnergy: number;
  /** Potential energy share g*y / E_0. */
  potentialShare: number;
  /** Kinetic energy share 0.5*V^2 / E_0. */
  kineticShare: number;
};

export type TrajectoryBreakdown = {
  initialSpecificEnergy: number;
  apogeePotentialConversionPct: number;
  climbDragLossPct: number;
  phases: TrajectoryPhase[];
  profile: TrajectoryProfilePoint[];
};

export type LaunchAngleSweepPoint = {
  angle: number;
  distance: number;
  duration: number;
  height: number;
};

export type LaunchSweepResult = {
  points: LaunchAngleSweepPoint[];
  bestDistance: LaunchAngleSweepPoint;
  bestDuration: LaunchAngleSweepPoint;
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Evaluate the effective lift and drag coefficients at angle of attack `alpha` (rad)
 * and airspeed `v` (m/s), including the geometry-derived folded-leading-edge camber
 * and Oswald efficiency from the flight integrator.
 */
const solverContexts = new WeakMap<Aero, SolverContext>();

/**
 * 条件化参考系数(2.11):固定水平姿态、高度 1.5 m、无角速度的稳态参考曲线,
 * 由统一求解器给出;**不是任意时刻的非定常实时气动力**(那由 Flight.samples 记录)。
 */
export function effectiveCoefficients(alpha: number, a: Aero, v = 6): {cl: number; cd: number} {
  let ctx = solverContexts.get(a);
  if (!ctx) {
    ctx = prepareSolver(a, {});
    solverContexts.set(a, ctx);
  }
  const sol = solveAero(ctx, {
    position: {x: 0, y: 1.5, z: 0},
    velocity: {x: Math.max(0, v), y: 0, z: 0},
    attitude: {pitch: alpha, yaw: 0, roll: 0},
    angularVelocity: {pitch: 0, yaw: 0, roll: 0},
    time: 0,
  }, defaultEnvironment());
  return {cl: sol.cl, cd: sol.cd};
}

/**
 * Compute chord-based Reynolds number Re = V * c / nu in standard sea-level air
 * (kinematic viscosity nu = 1.511e-5 m^2/s at 20 °C, per NASA Glenn Research Center).
 */
export function computeReynoldsNumber(airSpeed: number, chord: number): number {
  const nu = 1.511e-5;
  return (Math.max(0, airSpeed) * Math.max(1e-4, chord)) / nu;
}

/**
 * Polhamus (1966, NASA TN D-3767) leading-edge suction analogy breakdown for
 * sharp-edged slender delta/swept paper wings:
 *   C_L(alpha) = K_p * sin(alpha)*cos^2(alpha) + K_v * cos(alpha)*sin^2(alpha)
 * Returns potential-flow lift C_{L,p}, leading-edge vortex lift C_{L,v}, and vortex share %.
 */
export function computePolhamusBreakdown(alphaRad: number, a: Aero): PolhamusBreakdown {
  const ar = Math.max(0.2, a.aspectRatio);
  const kp = (2 * Math.PI * ar) / (ar + 2 * Math.sqrt(1 + (ar / 2) ** 2));
  const kv = Math.PI * Math.sqrt(Math.max(0.15, 1 - (ar / (ar + 4)) ** 2));
  const sinA = Math.sin(alphaRad);
  const cosA = Math.cos(alphaRad);
  const potentialCl = kp * sinA * cosA * cosA;
  const vortexCl = Math.sign(sinA) * kv * cosA * sinA * sinA;
  const totalPolhamusCl = potentialCl + vortexCl;
  const denom = Math.abs(potentialCl) + Math.abs(vortexCl);
  const vortexSharePct = denom > 1e-6 ? (Math.abs(vortexCl) / denom) * 100 : 0;
  return {potentialCl, vortexCl, totalPolhamusCl, vortexSharePct};
}

/**
 * McCormick (1979) / Wieselsberger ground-effect induced-drag reduction factor:
 *   phi(h/b) = (16 * h / b)^2 / (1 + (16 * h / b)^2)
 * Approaches 1 out of ground effect (h >> b) and drops toward 0 near the ground (h < b).
 */
export function groundEffectDragFactor(heightM: number, spanM: number): number {
  const hb = Math.max(0, heightM) / Math.max(0.02, spanM);
  const term = 16 * hb;
  return (term * term) / (1 + term * term);
}

/**
 * Compute longitudinal dynamic stability eigenmodes (Short-Period Pitch Mode &
 * Lanchester-Prandtl Phugoid Mode) from the airplane's extracted geometry.
 * Reference: Robert F. Stengel, Flight Dynamics (Princeton University).
 */
export function computeStabilityModes(a: Aero, speed = 5, maxLd = 6): StabilityModes {
  const rho = 1.225;
  const g = 9.81;
  const v = Math.max(1.5, speed);
  const slope = (2 * Math.PI * a.aspectRatio) / (a.aspectRatio + 2);
  const lever = Math.max(0, a.aerodynamicCenter.y - a.cg.y);
  const qS = 0.5 * rho * v * v * a.wingArea;

  // M_alpha = d(Moment)/d(alpha) / I_yy (rad/s^2 per rad)
  const mAlpha = (qS * slope * lever) / Math.max(1e-9, a.pitchInertia);
  // M_q = d(Moment)/d(q) / I_yy (1/s)
  const mQ = (qS * slope * a.wingPitchSecondMoment) / (v * Math.max(1e-9, a.pitchInertia));

  const shortPeriodOmega = Math.sqrt(Math.max(0.01, mAlpha));
  const shortPeriodPeriod = (2 * Math.PI) / shortPeriodOmega;
  const shortPeriodDamping = mQ / (2 * shortPeriodOmega);

  // Lanchester-Prandtl Phugoid approximation: omega_ph = g * sqrt(2) / V_eq
  const phugoidOmega = (g * Math.SQRT2) / v;
  const phugoidPeriod = (2 * Math.PI) / phugoidOmega;
  const phugoidDamping = 1 / (Math.SQRT2 * Math.max(1, maxLd));

  return {
    shortPeriodOmega,
    shortPeriodPeriod,
    shortPeriodDamping,
    phugoidOmega,
    phugoidPeriod,
    phugoidDamping,
    pitchStiffness: mAlpha,
  };
}

const polarCache = new WeakMap<Aero, Map<number, AeroPolar>>();
const phaseCache = new WeakMap<Flight, Map<string, TrajectoryBreakdown>>();
const sweepCache = new WeakMap<Aero, Map<string, LaunchSweepResult>>();

/**
 * Build the complete aerodynamic polar curve (CL-CD polar & V_x-V_z speed polar),
 * locating Best Glide (max L/D), Wind-Corrected Best Glide (origin/wind tangent per
 * tfraudet/glider-polar-analysis), Minimum Sink Rate (max CL^1.5/CD), and Stall.
 */
export function computeAeroPolar(a: Aero, wind = 0): AeroPolar {
  let byWind = polarCache.get(a);
  if (byWind) {
    const cached = byWind.get(wind);
    if (cached) return cached;
  } else {
    byWind = new Map();
    polarCache.set(a, byWind);
  }

  const rho = 1.225;
  const g = 9.81;
  const wingLoadingPa = (a.mass * g) / Math.max(1e-6, a.wingArea);
  const refNomSpeed = Math.sqrt((2 * wingLoadingPa) / (rho * 0.55));

  const curve: PolarPoint[] = [];
  let clMax = 0.1;
  let stallAngleDeg = 14;

  for (let deg = -6; deg <= 32; deg += 0.5) {
    const rad = (deg * Math.PI) / 180;
    // Two-step fixed-point iteration for equilibrium airspeed at this incidence
    let estV = refNomSpeed;
    for (let iter = 0; iter < 2; iter++) {
      const {cl, cd} = effectiveCoefficients(rad, a, estV);
      const cR = Math.hypot(cl, cd);
      if (cl > 0.02 && cR > 0.02) {
        estV = Math.sqrt((2 * wingLoadingPa) / (rho * cR));
      }
    }
    const {cl, cd} = effectiveCoefficients(rad, a, estV);
    if (cl > clMax && deg <= 25) {
      clMax = cl;
      stallAngleDeg = deg;
    }
    const cR = Math.hypot(Math.max(0.01, cl), cd);
    const ld = cd > 1e-5 ? cl / cd : 0;
    const enduranceFactor = cl > 0 && cd > 1e-5 ? Math.pow(cl, 1.5) / cd : 0;
    const equilibriumSpeed = cl > 0.03 ? Math.sqrt((2 * wingLoadingPa) / (rho * cR)) : refNomSpeed * 2;
    const horizontalSpeed = cl > 0.03 ? equilibriumSpeed * (cl / cR) : equilibriumSpeed;
    const sinkRate = cl > 0.03 ? equilibriumSpeed * (cd / cR) : equilibriumSpeed * 0.5;
    const groundGlideRatio = cl > 0.05 && sinkRate > 1e-4 ? Math.max(0, horizontalSpeed + wind) / sinkRate : 0;

    curve.push({
      alphaDeg: deg,
      cl,
      cd,
      ld,
      enduranceFactor,
      equilibriumSpeed,
      horizontalSpeed,
      sinkRate,
      groundGlideRatio,
    });
  }

  const positive = curve.filter(p => p.alphaDeg >= 0.5 && p.alphaDeg <= 20 && p.cl > 0.05);
  const bestLdPt = positive.reduce((best, p) => (p.ld > best.ld ? p : best), positive[0]);
  const windBestPt = positive.reduce(
    (best, p) => (p.groundGlideRatio > best.groundGlideRatio ? p : best),
    bestLdPt,
  );
  const minSinkPt = positive.reduce((best, p) => (p.sinkRate < best.sinkRate ? p : best), positive[0]);

  const toOp = (p: PolarPoint): PolarOperatingPoint => ({
    alphaDeg: p.alphaDeg,
    cl: p.cl,
    cd: p.cd,
    ld: p.ld,
    speed: p.equilibriumSpeed,
    sinkRate: p.sinkRate,
    gammaDeg: (-Math.atan2(1, Math.max(0.1, p.ld)) * 180) / Math.PI,
  });

  const bestGlide = toOp(bestLdPt);
  const windBestGlide = toOp(windBestPt);
  const minSink = toOp(minSinkPt);
  const stallSpeed = Math.sqrt((2 * wingLoadingPa) / (rho * Math.max(0.1, clMax)));
  const reynoldsAtBestGlide = computeReynoldsNumber(bestGlide.speed, a.chord);
  const vortexLiftSharePct = computePolhamusBreakdown((bestGlide.alphaDeg * Math.PI) / 180, a).vortexSharePct;
  const stability = computeStabilityModes(a, bestGlide.speed, bestGlide.ld);

  const result: AeroPolar = {
    curve,
    bestGlide,
    windBestGlide,
    minSink,
    stallAngleDeg,
    clMax,
    stallSpeed,
    wingLoadingPa,
    reynoldsAtBestGlide,
    vortexLiftSharePct,
    stability,
  };
  byWind.set(wind, result);
  return result;
}

/**
 * Perform an energy-state and flight-phase breakdown of a simulated trajectory,
 * segmenting it into Ballistic Climb, Apogee Pitch Transition, and Steady Glide.
 */
export function analyzeTrajectoryPhases(
  flight: Flight,
  a: Aero,
  launch: Throw,
): TrajectoryBreakdown {
  const key = `${a.mass}:${launch.angle}:${launch.speed}:${launch.wind}`;
  let byKey = phaseCache.get(flight);
  if (byKey) {
    const cached = byKey.get(key);
    if (cached) return cached;
  } else {
    byKey = new Map();
    phaseCache.set(flight, byKey);
  }
  const g = 9.81;
  const samples = flight.samples;
  const rad0 = (launch.angle * Math.PI) / 180;
  const v0 = launch.speed;
  const y0 = samples[0]?.y ?? 1.5;
  const initialSpecificEnergy = g * y0 + 0.5 * v0 * v0;

  let peakIdx = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].y > samples[peakIdx].y) peakIdx = i;
  }

  const profile: TrajectoryProfilePoint[] = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    let vx: number;
    let vy: number;
    if (i === 0) {
      vx = v0 * Math.cos(rad0);
      vy = v0 * Math.sin(rad0);
    } else {
      const prev = samples[i - 1];
      const dt = Math.max(1e-5, s.t - prev.t);
      vx = (s.x - prev.x) / dt;
      vy = (s.y - prev.y) / dt;
    }
    const ux = vx - launch.wind;
    const airSpeed = Math.hypot(ux, vy);
    const gamma = airSpeed > 1e-4 ? Math.atan2(vy, ux) : s.pitch;
    const alpha = Math.atan2(Math.sin(s.pitch - gamma), Math.cos(s.pitch - gamma));
    const {cl, cd} = effectiveCoefficients(alpha, a, airSpeed);
    const ld = cd > 1e-5 ? cl / cd : 0;
    const pot = g * Math.max(0, s.y);
    const kin = 0.5 * (vx * vx + vy * vy);
    const specE = pot + kin;

    profile.push({
      t: s.t,
      x: s.x,
      y: s.y,
      airSpeed,
      alphaDeg: (alpha * 180) / Math.PI,
      pitchDeg: (s.pitch * 180) / Math.PI,
      gammaDeg: (gamma * 180) / Math.PI,
      cl,
      cd,
      ld,
      specificEnergy: specE,
      potentialShare: pot / Math.max(1e-4, initialSpecificEnergy),
      kineticShare: kin / Math.max(1e-4, initialSpecificEnergy),
    });
  }

  const peakPt = profile[peakIdx] ?? profile[0];
  const initialKinetic = 0.5 * v0 * v0;
  const gainedPotential = Math.max(0, g * (peakPt.y - y0));
  const apogeePotentialConversionPct = initialKinetic > 1e-4 ? Math.min(100, (gainedPotential / initialKinetic) * 100) : 0;
  const climbDragLossPct =
    initialSpecificEnergy > 1e-4
      ? Math.max(0, ((initialSpecificEnergy - peakPt.specificEnergy) / initialSpecificEnergy) * 100)
      : 0;

  const totalDist = Math.max(0.01, flight.distance);
  const phases: TrajectoryPhase[] = [];

  if (peakIdx > 1 && peakPt.y > y0 + 0.15) {
    const transEndIdx = Math.min(
      profile.length - 1,
      peakIdx + Math.max(2, Math.round((profile.length - peakIdx) * 0.16)),
    );
    const transPt = profile[transEndIdx];
    const lastPt = profile[profile.length - 1];

    const isFlatPenetration = launch.angle <= 8 && peakPt.y - y0 < 1.2 && peakPt.x > totalDist * 0.45;
    phases.push({
      kind: 'climb',
      label: isFlatPenetration ? '① 高速平射穿刺段' : '① 高速爬升转换段',
      startTime: 0,
      endTime: peakPt.t,
      startX: 0,
      endX: peakPt.x,
      distanceShare: (peakPt.x / totalDist) * 100,
      energyLossPct: climbDragLossPct,
      summary: isFlatPenetration
        ? `初速 ${v0} m/s 近水平低阻穿刺 ${peakPt.x.toFixed(1)} m 并微升至 ${peakPt.y.toFixed(1)} m，高动压动能直接转化为水平巡航航程（占 ${((peakPt.x / totalDist) * 100).toFixed(0)}%）。`
        : `初速 ${v0} m/s 冲高至 ${peakPt.y.toFixed(1)} m，约 ${apogeePotentialConversionPct.toFixed(0)}% 初始动能转化为重力势能，爬升耗散 ${climbDragLossPct.toFixed(0)}%。`,
    });

    phases.push({
      kind: 'transition',
      label: '② 顶点俯仰配平段',
      startTime: peakPt.t,
      endTime: transPt.t,
      startX: peakPt.x,
      endX: transPt.x,
      distanceShare: ((transPt.x - peakPt.x) / totalDist) * 100,
      energyLossPct: Math.max(
        0,
        ((peakPt.specificEnergy - transPt.specificEnergy) / Math.max(1e-4, initialSpecificEnergy)) * 100,
      ),
      summary: `顶点空速降至 ${peakPt.airSpeed.toFixed(1)} m/s，焦点后置静稳定力矩压低机头，捕获配平滑翔角。`,
    });

    phases.push({
      kind: 'glide',
      label: '③ 稳态滑翔巡航段',
      startTime: transPt.t,
      endTime: lastPt.t,
      startX: transPt.x,
      endX: lastPt.x,
      distanceShare: ((lastPt.x - transPt.x) / totalDist) * 100,
      energyLossPct: Math.max(
        0,
        ((transPt.specificEnergy - lastPt.specificEnergy) / Math.max(1e-4, initialSpecificEnergy)) * 100,
      ),
      summary: `利用 ${peakPt.y.toFixed(1)} m 势能储备滑翔 ${(lastPt.x - transPt.x).toFixed(1)} m（占总航程 ${(((lastPt.x - transPt.x) / totalDist) * 100).toFixed(0)}%）。`,
    });
  } else {
    const transIdx = Math.min(profile.length - 1, Math.max(1, Math.round(profile.length * 0.2)));
    const transPt = profile[transIdx];
    const lastPt = profile[profile.length - 1];
    phases.push({
      kind: 'transition',
      label: '① 平飞释放过渡段',
      startTime: 0,
      endTime: transPt.t,
      startX: 0,
      endX: transPt.x,
      distanceShare: (transPt.x / totalDist) * 100,
      energyLossPct: Math.max(
        0,
        ((initialSpecificEnergy - transPt.specificEnergy) / Math.max(1e-4, initialSpecificEnergy)) * 100,
      ),
      summary: `近水平高速释放（${launch.angle}°），动压迅速建立升力并进入浅下滑角配平。`,
    });
    phases.push({
      kind: 'glide',
      label: '② 稳态低阻滑翔段',
      startTime: transPt.t,
      endTime: lastPt.t,
      startX: transPt.x,
      endX: lastPt.x,
      distanceShare: ((lastPt.x - transPt.x) / totalDist) * 100,
      energyLossPct: Math.max(
        0,
        ((transPt.specificEnergy - lastPt.specificEnergy) / Math.max(1e-4, initialSpecificEnergy)) * 100,
      ),
      summary: `保持低零升阻力姿态滑翔 ${(lastPt.x - transPt.x).toFixed(1)} m（占总航程 ${(((lastPt.x - transPt.x) / totalDist) * 100).toFixed(0)}%）。`,
    });
  }

  const breakdown: TrajectoryBreakdown = {
    initialSpecificEnergy,
    apogeePotentialConversionPct,
    climbDragLossPct,
    phases,
    profile,
  };
  byKey.set(key, breakdown);
  return breakdown;
}

/**
 * Sweep launch angles (0°..60° in 5° steps) at the given speed and wind to identify
 * the optimal launch angle for maximum distance and maximum duration.
 */
export function sweepLaunchAngles(a: Aero, speed: number, wind = 0): LaunchSweepResult {
  const key = `${speed}:${wind}`;
  let byKey = sweepCache.get(a);
  if (byKey) {
    const cached = byKey.get(key);
    if (cached) return cached;
  } else {
    byKey = new Map();
    sweepCache.set(a, byKey);
  }

  const points: LaunchAngleSweepPoint[] = [];
  for (let angle = 0; angle <= 60; angle += 5) {
    const res = simulate(a, {angle, speed, wind});
    points.push({
      angle,
      distance: res.distance,
      duration: res.duration,
      height: res.height,
    });
  }
  const bestDistance = points.reduce((best, p) => (p.distance > best.distance ? p : best), points[0]);
  const bestDuration = points.reduce((best, p) => (p.duration > best.duration ? p : best), points[0]);
  const result = {points, bestDistance, bestDuration};
  byKey.set(key, result);
  return result;
}
