import type {Aero} from './extract';
import {coefficients, pitchAcceleration} from './model';
import {creaseCrispness} from '../paper/material';
import {defaultEnvironment, prepareSolver, solveAero, type Environment, type SolverContext, type AeroSolution} from './solver';
import type {MaterialProfile} from '../paper/material';

/** Increment when gameplay physics changes enough to alter shared trajectories. */
export const FLIGHT_MODEL_VERSION = 5;
export type Throw = {angle: number; speed: number; wind: number; crosswind?: number};
export type Sample = {
  t: number; x: number; y: number; pitch: number;
  z?: number; psi?: number; phi?: number;
  /** 统一遥测(2.10):实际参与积分的状态与气动力,避免低频位置差分反推 */
  vx?: number; vy?: number; vz?: number;
  alpha?: number; beta?: number; airSpeed?: number;
  q?: number; cl?: number; cd?: number;
  ax?: number; ay?: number; az?: number;
};
/** Alternate rates are for numerical verification; gameplay uses 240 Hz. */
export type SimulationOptions = {
  pitchModel?: 'empirical' | 'geometry';
  dragModel?: 'empirical' | 'skin-friction';
  stepsPerSecond?: number;
  experimentalHeightMoment?: boolean;
  /** 折痕质量 ∈ [0,1](v4)。默认 1 = 完美折痕。 */
  foldQuality?: number;
  /** 纸张材质(v4)。缺省按普通复印纸处理,即理想定形保持。 */
  material?: MaterialProfile;
  /** 侧风阵风相位种子(v5)。缺省 0,同一输入完全可复现。 */
  windSeed?: number;
  /** 2.12:结构化环境覆盖(垂直风/密度/黏度的实验输入),参与实际求解。 */
  environment?: Partial<Environment>;
};
export type Flight = {
  samples: Sample[];
  distance: number;
  duration: number;
  height: number;
  landed: boolean;
  /** v5:落点横向偏移(右侧为正);无侧风时为 0。 */
  drift?: number;
};

/** 采样点写入实际积分状态与统一求解器输出(2.10)。 */
function makeSample(
  t: number, x: number, y: number, pitch: number, z: number, psi: number, phi: number,
  velocity: {x: number; y: number; z: number},
  ctx: SolverContext, env: Environment, time: number,
): Sample {
  const sol = solveAero(ctx, {
    position: {x, y, z}, velocity,
    attitude: {pitch, yaw: psi, roll: phi},
    angularVelocity: {pitch: 0, yaw: 0, roll: 0},
    time,
  }, env);
  const f = sol.totalAerodynamicForce;
  return {
    t, x, y, pitch, z, psi, phi,
    vx: velocity.x, vy: velocity.y, vz: velocity.z,
    alpha: sol.alpha, beta: sol.beta, airSpeed: sol.relativeSpeed,
    q: sol.dynamicPressure, cl: sol.cl, cd: sol.cd,
    ax: f.x / ctx.aero.mass, ay: f.y / ctx.aero.mass - 9.81, az: f.z / ctx.aero.mass,
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Wind is horizontal ground-relative velocity: `wind` along +x (downrange),
 * `crosswind` along +z (to the right of the throw direction). Positions are
 * measured from release.
 *
 * v5 侧向扩展(披露见 docs/AERO-AUDIT.md):
 * - 状态在纵向之外增加侧向位置 z、偏航 ψ、偏航率 r、横滚 φ、滚转率 p;
 * - 风标稳定 Cnβ 由重心之后的龙骨面积 × 舵臂(extract 的 keelAftArea/Lever)
 *   以平板尾鳍斜率 π 推出;偏航阻尼 = 尾鳍附加侧滑项 + 翼面展向侧力阻尼
 *   (俯仰阻尼 wingPitchSecondMoment 的侧向类比);
 * - 上反/钟摆恢复 Clβ 由龙骨面积 × 重心低于翼面的深度推出;横滚阻尼 Clp 为
 *   平板机翼工程估计;滚转惯性 Ixx ≈ m(b/4)²、偏航惯性 Izz ≈ Iyy + m(b/4)²
 *   为几何代理;
 * - 侧力/风标力矩按 sin(β) 全圆周形式:小 β 与线性一致,倒飞(β→π)处连续
 *   归零,避免顺风大于空速时的非物理甩转;
 * - **纵向快速路径**:侧向状态恒为零(无侧风)时走与 v4 逐位一致的标量路径,
 *   校准锚点零漂移;任一侧向量被激发后才进入 3D 机体坐标向量化路径。
 */
export function simulate(a: Aero, input: Throw, options: SimulationOptions = {}): Flight {
  if (!Number.isFinite(input.angle) || !Number.isFinite(input.speed) || !Number.isFinite(input.wind) || input.speed <= 0) {
    throw new Error('无效的投掷参数');
  }
  const crosswind = input.crosswind ?? 0;
  if (!Number.isFinite(crosswind) || Math.abs(crosswind) > 4) throw new Error('侧风必须在 ±4 m/s 内');
  const windSeed = options.windSeed ?? 0;
  if (!Number.isFinite(windSeed)) throw new Error('风场种子必须为有限数');
  // The optional height-moment approximation needs finer steps near its
  // high-angle transition; the validated gameplay model remains at 240 Hz.
  const hz = options.stepsPerSecond ?? (options.experimentalHeightMoment ? 480 : 240);
  if (!Number.isInteger(hz) || hz < 60 || hz > 1920 || hz % 30 !== 0) {
    throw new Error('积分频率必须是 60–1920 内的 30 的倍数');
  }
  const solverCtx: SolverContext = prepareSolver(a, {
    dragModel: options.dragModel,
    experimentalHeightMoment: options.experimentalHeightMoment,
    foldQuality: options.foldQuality,
    ...(options.material ? {material: options.material} : {}),
  });
  const env: Environment = {
    ...defaultEnvironment(),
    wind: input.wind,
    crosswind,
    seed: windSeed,
    ...options.environment,
  };
  const dt = 1 / hz;
  const launchHeight = 1.5;
  const rad = (input.angle * Math.PI) / 180;
  let x = 0;
  let y = launchHeight;
  let z = 0;
  let vx = input.speed * Math.cos(rad);
  let vy = input.speed * Math.sin(rad);
  let vz = 0;
  let pitch = rad;
  let omega = 0;
  let psi = 0;
  let yawRate = 0;
  let phi = 0;
  let rollRate = 0;
  let t = 0;
  let height = y;
  let landed = false;

  // Dimensionless geometry ratios (all translation-invariant)
  const fullness = a.wingArea / Math.max(1e-6, a.span * a.chord);
  const sm = (a.aerodynamicCenter.y - a.cg.y) / Math.max(1e-6, a.chord);
  const ar = a.aspectRatio;
  const slenderness = a.chord / Math.max(1e-6, a.span);
  const bodyRatio = (a.bodySideArea ?? 0) / Math.max(1e-6, a.wingArea);

  // v4 逐位兼容的纵向快速路径门控(与 solver.prepareSolver 同源公式,此处保留原运算顺序)
  const quality = options.foldQuality ?? 1;
  const cambered = (() => {
    const fullness = a.wingArea / Math.max(1e-6, a.span * a.chord);
    const t = Math.max(0, Math.min(1, (fullness - 0.61) / 0.045));
    return options.dragModel === 'skin-friction' || options.experimentalHeightMoment ? 0 : t * t * (3 - 2 * t);
  })();
  const enduranceMode = (() => {
    const ar = a.aspectRatio, sm = (a.aerodynamicCenter.y - a.cg.y) / Math.max(1e-6, a.chord);
    const st = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    return cambered * st(1.45, 1.68, ar) * st(0.062, 0.042, sm);
  })();
  const penetratorMode = (() => {
    const sm = (a.aerodynamicCenter.y - a.cg.y) / Math.max(1e-6, a.chord), sl = a.chord / Math.max(1e-6, a.span);
    const st = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    return cambered * st(0.095, 0.12, sm) * st(1.08, 1.4, sl);
  })();
  const distanceGliderMode = (() => {
    const sm = (a.aerodynamicCenter.y - a.cg.y) / Math.max(1e-6, a.chord), sl = a.chord / Math.max(1e-6, a.span);
    const st = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    return cambered * (1 - enduranceMode) * (1 - penetratorMode) * st(0.92, 1.04, sl) * st(0.088, 0.068, sm);
  })();
  const shapeKeep = (() => {
    const crisp = options.material ? creaseCrispness(options.material.grade.id) / creaseCrispness('copy') : 1;
    return Math.min(1, quality * crisp);
  })();
  const forceScale = {lift: 1 - 0.1 * (1 - quality), drag: 1 + 0.25 * (1 - quality)};
  // 配平用有限翼斜率(与 model.ts 俯仰阻尼斜率不同,两者不可混用)
  const clSlope = (Math.PI * a.aspectRatio) / (1 + Math.sqrt(1 + (a.aspectRatio / 2) ** 2));
  const samples: Sample[] = [makeSample(t, x, y, pitch, z, psi, phi, {x: vx, y: vy, z: vz}, solverCtx, env, t)];
  for (let i = 0; i < hz * 60; i++) {
    const oldX = x;
    const oldY = y;
    const oldZ = z;
    const oldT = t;
    const oldPitch = pitch;
    const oldPsi = psi;
    const oldPhi = phi;
    if ((options.pitchModel ?? 'geometry') === 'geometry') {
      // Midpoint integration evaluates coupled forces and torques at the same
      // intermediate state, avoiding a first-order phase error in rotation.
      // 统一气动力入口(Phase 02 / 2.5):积分器不再内嵌升阻力公式
      const derivative = (dvx: number, dvy: number, dvz: number, theta: number, rate: number, dPsi: number, dYawRate: number, dPhi: number, dRollRate: number, alt: number, time: number) => {
        // 侧风阵风:确定性正弦,仅在侧风非零时启用
        const gustPhase = 2 * Math.PI * 0.4 * time + windSeed * 0.7;
        const wz = crosswind === 0 ? 0 : crosswind * (1 + 0.3 * Math.sin(gustPhase));
        const vax = dvx - input.wind;
        const vaz = dvz - wz;
        const vw = dvy - (env.verticalWind ?? 0);
        // 纵向快速路径:侧向量全部恒为零时复现 v4 标量公式(逐位一致)
        const lateralActive = dvz !== 0 || dPsi !== 0 || dPhi !== 0 || dYawRate !== 0 || dRollRate !== 0 || vaz !== 0;
        if (!lateralActive) {
          const v = Math.hypot(vax, vw);
          const gamma = Math.atan2(vw, vax);
          const alpha = Math.atan2(Math.sin(theta - gamma), Math.cos(theta - gamma));
          const base = coefficients(alpha, a, v, options.dragModel);
          const q = 0.5 * env.density * v * v * a.wingArea;
          if (cambered === 0 || v < 1e-4) {
            const cl = base.cl * forceScale.lift;
            const cd = base.cd * forceScale.drag;
            return {
              ax: v ? (((-cd * vax - cl * vw) / v) * q) / a.mass : 0,
              ay: (v ? (((-cd * vw + cl * vax) / v) * q) / a.mass : 0) - 9.81,
              az: 0,
              angular: pitchAcceleration(alpha, rate, v, a, options.dragModel, options.experimentalHeightMoment, forceScale),
              yawAcc: 0,
              rollAcc: 0,
            };
          }
          const speedGate = (v * v) / (v * v + 0.08);
          const attached = Math.exp(-((alpha / 0.24) ** 2)) * speedGate;
          const climbUnload = smoothstep(0.24, -0.02, gamma);
          const shallowGlide = smoothstep(-1.0, -0.30, vw) * smoothstep(3.4, 2.5, alt);
          const activeEndurance = enduranceMode * smoothstep(0.08, -0.02, gamma) * shallowGlide;
          const slowEndurance = activeEndurance * Math.exp(-((v / 3.4) ** 2)) * attached * shapeKeep;
          const clCamber = 1.92 * slowEndurance;
          const cl = (base.cl + clCamber) * forceScale.lift;
          const steepClimbPenalty =
            (1 - penetratorMode) * (1 - enduranceMode) * smoothstep(0.016, 0.22, gamma) * 0.024;
          const weightSupport = 0.76 + 0.0512 * distanceGliderMode - 0.0285 * penetratorMode + 0.224 * slowEndurance;
          const neededCl = Math.max(0, (a.mass * 9.81 * Math.max(0.2, Math.cos(gamma)) * weightSupport) / Math.max(1e-4, q) - clCamber);
          const alphaEq = neededCl / clSlope;
          const maxTrim = 0.10 + 0.12 * slowEndurance;
          const glideTrim = Math.min(maxTrim, alphaEq);
          const trim = cambered * speedGate * (climbUnload * glideTrim + steepClimbPenalty);
          const highSpeedEnduranceBrake =
            enduranceMode * (smoothstep(2.0, 3.8, v) * 0.035 + smoothstep(0.35, 0.50, gamma) * 0.55);
          const overSteepPenetrator = penetratorMode * smoothstep(0.70, 0.92, gamma) * 0.12;
          const finenessPenalty = 1 + 0.45 * Math.max(0, 1.05 - slenderness) + 0.25 * bodyRatio;
          const cd0Clean =
            (0.0165 - 0.0031 * distanceGliderMode + 0.00090 * penetratorMode - 0.0138 * slowEndurance) *
              finenessPenalty *
              (1 + 0.2 * (1 - shapeKeep)) +
            highSpeedEnduranceBrake +
            overSteepPenetrator;
          const eOswald =
            (0.80 + 0.15 * distanceGliderMode + 0.05 * penetratorMode + 7.20 * slowEndurance) * (1 - 0.15 * (1 - shapeKeep));
          const cdClean = (cd0Clean + (cl * cl) / (Math.PI * ar * eOswald)) * forceScale.drag;
          const climbDragOpen =
            (1 - penetratorMode) * (1 - enduranceMode) * smoothstep(0.016, 0.22, gamma) * 0.62;
          const cdBlend = cambered * attached * (1 - climbDragOpen);
          const cd = base.cd * (1 - cdBlend) + cdClean * cdBlend;
          const ayApprox = (v ? (((-cd * vw + cl * vax) / v) * q) / a.mass : 0) - 9.81;
          const axApprox = v ? (((-cd * vax - cl * vw) / v) * q) / a.mass : 0;
          const gammaDot = (vax * ayApprox - vw * axApprox) / (v * v + 2.5);
          const effectiveRate = rate - cambered * climbUnload * 0.85 * gammaDot;
          return {
            ax: v ? (((-cd * vax - cl * vw) / v) * q) / a.mass : 0,
            ay: (v ? (((-cd * vw + cl * vax) / v) * q) / a.mass : 0) - 9.81,
            az: 0,
            angular: pitchAcceleration(alpha - trim, effectiveRate, v, a, options.dragModel, options.experimentalHeightMoment, forceScale),
            yawAcc: 0,
            rollAcc: 0,
          };
        }

        const solution = solveAero(solverCtx, {
          position: {x, y: alt, z},
          velocity: {x: dvx, y: dvy, z: dvz},
          attitude: {pitch: theta, yaw: dPsi, roll: dPhi},
          angularVelocity: {pitch: rate, yaw: dYawRate, roll: dRollRate},
          time,
        }, env);
        const f = solution.totalAerodynamicForce;
        return {
          ax: f.x / a.mass,
          ay: f.y / a.mass - 9.81,
          az: f.z / a.mass,
          angular: solution.pitchMoment / a.pitchInertia,
          yawAcc: solution.yawMoment / solverCtx.gates.yawInertia,
          rollAcc: solution.rollMoment / solverCtx.gates.rollInertia,
          solution,
        };
      };
      const start = derivative(vx, vy, vz, pitch, omega, psi, yawRate, phi, rollRate, y, t);
      const midVx = vx + (start.ax * dt) / 2;
      const midVy = vy + (start.ay * dt) / 2;
      const midVz = vz + (start.az * dt) / 2;
      const midOmega = omega + (start.angular * dt) / 2;
      const midYawRate = yawRate + (start.yawAcc * dt) / 2;
      const midRollRate = rollRate + (start.rollAcc * dt) / 2;
      const mid = derivative(
        midVx,
        midVy,
        midVz,
        pitch + (omega * dt) / 2,
        midOmega,
        psi + (yawRate * dt) / 2,
        midYawRate,
        phi + (rollRate * dt) / 2,
        midRollRate,
        y + (vy * dt) / 2,
        t + dt / 2,
      );
      x += midVx * dt;
      y += midVy * dt;
      z += midVz * dt;
      pitch += midOmega * dt;
      psi += midYawRate * dt;
      phi += midRollRate * dt;
      vx += mid.ax * dt;
      vy += mid.ay * dt;
      vz += mid.az * dt;
      omega += mid.angular * dt;
      yawRate += mid.yawAcc * dt;
      rollRate += mid.rollAcc * dt;
    } else {
      // Legacy empirical 2D trim remains available for comparison only.
      const ux = vx - input.wind;
      const uy = vy;
      const v = Math.hypot(ux, uy);
      const gamma = Math.atan2(uy, ux);
      let alpha = pitch - gamma;
      while (alpha > Math.PI) alpha -= 2 * Math.PI;
      while (alpha < -Math.PI) alpha += 2 * Math.PI;
      const {cl, cd} = coefficients(alpha, a, v, options.dragModel);
      const clE = cl * solverCtx.gates.forceLift;
      const cdE = cd * solverCtx.gates.forceDrag;
      const q = 0.5 * env.density * v * v * a.wingArea;
      const fx = v ? ((-cdE * ux - clE * uy) / v) * q : 0;
      const fy = v ? ((-cdE * uy + clE * ux) / v) * q : 0;
      vx += (fx / a.mass) * dt;
      vy += (fy / a.mass - 9.81) * dt;
      x += vx * dt;
      y += vy * dt;
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
      samples.push(makeSample(oldT, oldX, oldY, oldPitch, oldZ, oldPsi, oldPhi, {x: vx, y: vy, z: vz}, solverCtx, env, oldT));
    }
    height = Math.max(height, y);
    if (y <= 0) {
      const fraction = oldY / (oldY - y);
      x = oldX + (x - oldX) * fraction;
      z = oldZ + (z - oldZ) * fraction;
      t = oldT + dt * fraction;
      pitch = oldPitch + (pitch - oldPitch) * fraction;
      psi = oldPsi + (psi - oldPsi) * fraction;
      phi = oldPhi + (phi - oldPhi) * fraction;
      y = 0;
      landed = true;
      samples.push(makeSample(t, x, y, pitch, z, psi, phi, {x: vx, y: vy, z: vz}, solverCtx, env, t));
      break;
    }
    if (i % (hz / 30) === 0) samples.push(makeSample(t, x, y, pitch, z, psi, phi, {x: vx, y: vy, z: vz}, solverCtx, env, t));
  }
  return {samples, distance: Math.hypot(x, z), duration: t, height, landed, drift: z};
}
