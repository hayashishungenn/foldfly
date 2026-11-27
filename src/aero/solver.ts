/**
 * 统一气动力求解器(Phase 02 / 2.4–2.5)。
 *
 * 纯函数:相同输入(几何 Aero、物理状态、环境、版本/选项)必得相同输出。
 * 积分器、极曲线、遥测与受力渲染共用此入口;分项阻力与修正项可追溯到最终合力。
 * 不按机型 ID 取任何参数——所有门控都由几何比值 + 材质/折痕质量输入计算。
 *
 * 模型变体:
 * - 'v5'(默认):现行带经验构型门控的历史兼容模型(见 AERO-FORMULAS.md §3)。
 * - 'baseline':无经验门控的物理基准模型(2.7),仅基础升阻力 + 几何静稳定,
 *   不作为默认 gameplay,不改变已有成绩版本。
 */
import type {Aero} from './extract';
import {coefficients} from './model';
import type {MaterialProfile} from '../paper/material';
import {creaseCrispness} from '../paper/material';

export type Vec3 = {x: number; y: number; z: number};

/** 参与积分的瞬时物理状态(环境/机体分离;v5 保留 3D 扩展边界)。 */
export type PhysicsState = {
  position: Vec3;
  /** 地面参考系速度(m/s) */
  velocity: Vec3;
  /** 机体姿态(rad):pitch 抬头为正,yaw 向 +z 为正,roll 右翼下为正 */
  attitude: {pitch: number; yaw: number; roll: number};
  /** 角速度(rad/s) */
  angularVelocity: {pitch: number; yaw: number; roll: number};
  time: number;
};

/** 环境输入(2.12):与机体状态分离;verticalWind 为实验输入,默认 0。 */
export type Environment = {
  wind: number;
  crosswind: number;
  verticalWind?: number;
  density: number;
  kinematicViscosity: number;
  seed: number;
};

export type SolverOptions = {
  dragModel?: 'empirical' | 'skin-friction';
  experimentalHeightMoment?: boolean;
  foldQuality?: number;
  material?: MaterialProfile;
  model?: 'v5' | 'baseline';
  /** 仅历史对照:恢复 v4/v5 的折痕质量力乘数通道 */
  legacyQualityChannel?: boolean;
};

export type DragBreakdown = {
  induced: number;
  zeroLift: number;
  separated: number;
  /** 折层/机身附加(经 finenessPenalty,已并入 zeroLift,不重复累加) */
  bodyPenaltyShare: number;
  /** 爬升/门控修正造成的增减(正=增阻) */
  gateCorrection: number;
};

export type AeroSolution = {
  relativeVelocity: Vec3;
  relativeSpeed: number;
  alpha: number;
  beta: number;
  dynamicPressure: number;
  cl: number;
  cd: number;
  lift: number;
  drag: number;
  sideForce: number;
  /** 不含重力的气动力合力(N) */
  totalAerodynamicForce: Vec3;
  pitchMoment: number;
  yawMoment: number;
  rollMoment: number;
  liftDirection: Vec3;
  dragDirection: Vec3;
  dragBreakdown: DragBreakdown;
  corrections: {
    clCamber: number;
    cambered: number;
    shapeKeep: number;
    eOswald: number;
    trim: number;
    liftScale: number;
    dragScale: number;
    enduranceMode: number;
    penetratorMode: number;
    distanceGliderMode: number;
    model: 'v5' | 'baseline';
  };
};

export type SolverContext = {
  aero: Aero;
  options: Required<Omit<SolverOptions, 'material'>> & {material?: MaterialProfile};
  gates: {
    cambered: number;
    enduranceMode: number;
    penetratorMode: number;
    distanceGliderMode: number;
    shapeKeep: number;
    forceLift: number;
    forceDrag: number;
    clSlope: number;
    ar: number;
    slenderness: number;
    bodyRatio: number;
    cyBeta: number;
    cnBeta: number;
    cnrNorm: number;
    clBeta: number;
    clpNorm: number;
    rollInertia: number;
    yawInertia: number;
  };
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 默认环境:标准海平面密度与 20°C 运动黏度(NASA),种子 0。 */
export function defaultEnvironment(): Environment {
  return {wind: 0, crosswind: 0, verticalWind: 0, density: 1.225, kinematicViscosity: 1.511e-5, seed: 0};
}

/** 从几何与选项一次性准备门控/常数(纯函数,积分器每场飞行调用一次)。 */
export function prepareSolver(aero: Aero, options: SolverOptions = {}): SolverContext {
  const model = options.model ?? 'v5';
  const quality = options.foldQuality ?? 1;
  if (!Number.isFinite(quality) || quality < 0 || quality > 1) throw new Error('折痕质量必须在 [0,1]');
  const fullness = aero.wingArea / Math.max(1e-6, aero.span * aero.chord);
  const sm = (aero.aerodynamicCenter.y - aero.cg.y) / Math.max(1e-6, aero.chord);
  const ar = aero.aspectRatio;
  const slenderness = aero.chord / Math.max(1e-6, aero.span);
  const bodyRatio = (aero.bodySideArea ?? 0) / Math.max(1e-6, aero.wingArea);
  const crispNorm = options.material ? creaseCrispness(options.material.grade.id) / creaseCrispness('copy') : 1;
  // Phase 04 / 4.7:折痕质量不再直接乘在升阻上;默认仅材质定形(crispness)参与,
  // 手工折叠误差通过真实几何偏移(adjustments.ts)进入质量分布与翼面。
  // legacyQualityChannel 仅为历史对照测试保留。
  const qualityForModel = options.legacyQualityChannel ? quality : 1;
  const shapeKeep = model === 'baseline' ? 1 : Math.min(1, qualityForModel * crispNorm);
  const cambered = model === 'baseline' ? 0 : smoothstep(0.61, 0.655, fullness);
  const enduranceMode = cambered * smoothstep(1.45, 1.68, ar) * smoothstep(0.062, 0.042, sm);
  const penetratorMode = cambered * smoothstep(0.095, 0.12, sm) * smoothstep(1.08, 1.40, slenderness);
  const distanceGliderMode =
    cambered * (1 - enduranceMode) * (1 - penetratorMode) * smoothstep(0.92, 1.04, slenderness) * smoothstep(0.088, 0.068, sm);
  const span = Math.max(1e-4, aero.span);
  const cyBeta = 1.1 * (1 + 0.5 * Math.min(1, bodyRatio));
  const cnBeta = Math.PI * ((aero.keelAftArea ?? 0) * (aero.keelAftLever ?? 0)) / Math.max(1e-6, aero.wingArea * span);
  const cnrNorm = -2 * cnBeta * ((aero.keelAftLever ?? 0) / span) - cyBeta / 3;
  return {
    aero,
    options: {
      dragModel: options.dragModel ?? 'empirical',
      experimentalHeightMoment: options.experimentalHeightMoment ?? false,
      foldQuality: quality,
      model,
      legacyQualityChannel: options.legacyQualityChannel ?? false,
      ...(options.material ? {material: options.material} : {}),
    },
    gates: {
      cambered,
      enduranceMode,
      penetratorMode,
      distanceGliderMode,
      shapeKeep,
      forceLift: options.legacyQualityChannel ? 1 - 0.1 * (1 - quality) : 1,
      forceDrag: options.legacyQualityChannel ? 1 + 0.25 * (1 - quality) : 1,
      clSlope: (Math.PI * ar) / (1 + Math.sqrt(1 + (ar / 2) ** 2)),
      ar, slenderness, bodyRatio, cyBeta, cnBeta, cnrNorm,
      clBeta: -1.1 * ((aero.bodySideArea ?? 0) * Math.max(0, aero.cgDepth)) / Math.max(1e-6, aero.wingArea * span),
      clpNorm: -2.2 * (ar / (ar + 1.5)),
      rollInertia: Math.max(1e-12, aero.mass * (span / 4) ** 2),
      yawInertia: Math.max(1e-12, aero.pitchInertia + aero.mass * (span / 4) ** 2),
    },
  };
}

/**
 * 统一求解:输入物理状态与环境,输出可追溯的气动力/力矩/系数。
 * `state.velocity` 为地面参考系速度;阵风由 env.seed 与 time 确定性给出。
 */
export function solveAero(ctx: SolverContext, state: PhysicsState, env: Environment): AeroSolution {
  const {aero, gates, options} = ctx;
  const vWind = env.crosswind === 0 ? 0 : env.crosswind * (1 + 0.3 * Math.sin(2 * Math.PI * 0.4 * state.time + env.seed * 0.7));
  const relativeVelocity: Vec3 = {
    x: state.velocity.x - env.wind,
    y: state.velocity.y - (env.verticalWind ?? 0),
    z: state.velocity.z - vWind,
  };
  const v = Math.hypot(relativeVelocity.x, relativeVelocity.y, relativeVelocity.z);
  const q = 0.5 * env.density * v * v * aero.wingArea;

  // 机体轴(见 COORDINATES.md)
  const {pitch: theta, yaw: psi, roll: phi} = state.attitude;
  const cosYaw = Math.cos(psi), sinYaw = Math.sin(psi);
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  const n = {x: cosT * cosYaw, y: sinT, z: cosT * sinYaw};
  const r = {x: -sinYaw, y: 0, z: cosYaw};
  const up = {x: -sinT * cosYaw, y: cosT, z: -sinT * sinYaw};
  const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
  const vbF = dot(relativeVelocity, n);
  const vbR = dot(relativeVelocity, r);
  const vbU = dot(relativeVelocity, up);
  const alpha = v > 1e-9 ? Math.atan2(-vbU, vbF) : 0;
  const beta = v > 1e-9 ? Math.atan2(vbR, vbF) : 0;
  const airDir: Vec3 = v > 1e-9
    ? {x: relativeVelocity.x / v, y: relativeVelocity.y / v, z: relativeVelocity.z / v}
    : {x: 0, y: 0, z: 0};
  const proj = v > 1e-9 ? vbU / v : 0;
  let liftDir: Vec3 = {x: up.x - proj * airDir.x, y: up.y - proj * airDir.y, z: up.z - proj * airDir.z};
  const ln = Math.hypot(liftDir.x, liftDir.y, liftDir.z);
  if (ln > 1e-9) {
    liftDir = {x: liftDir.x / ln, y: liftDir.y / ln, z: liftDir.z / ln};
  } else {
    liftDir = up; // 速度沿机体上方时升力方向退化,取机体上方
  }
  const dragDir: Vec3 = {x: -airDir.x, y: -airDir.y, z: -airDir.z};

  const base = coefficients(alpha, aero, v, options.dragModel);
  let cl = base.cl * gates.forceLift;
  let cd: number;
  let cdInduced = 0;
  let cd0Clean = 0;
  let cdSeparated = 0;
  let clCamber = 0;
  let eOswald = 0.8;
  let trim = 0;
  let effectiveRate = state.angularVelocity.pitch;
  const cambered = gates.cambered;
  const baseline = options.model === 'baseline';
  if ((cambered === 0 || v < 1e-4) || baseline) {
    cd = base.cd * gates.forceDrag;
    cd0Clean = options.dragModel === 'skin-friction' ? 0 : 0.025 + 0.01 * (aero.span * aero.chord / aero.wingArea);
    cdInduced = base.cl * base.cl / (Math.PI * gates.ar * 0.8);
    cdSeparated = Math.max(0, base.cd - cd0Clean - cdInduced);
  } else {
    // 与 v5 integrator 逐式一致的历史兼容模型(经验门控分类见 AERO-FORMULAS.md §3)
    const speedGate = (v * v) / (v * v + 0.08);
    const attached = Math.exp(-((alpha / 0.24) ** 2)) * speedGate;
    const gamma = Math.atan2(relativeVelocity.y, Math.hypot(relativeVelocity.x, relativeVelocity.z));
    const climbUnload = smoothstep(0.24, -0.02, gamma);
    const shallowGlide = smoothstep(-1.0, -0.30, relativeVelocity.y) * smoothstep(3.4, 2.5, state.position.y);
    const activeEndurance = gates.enduranceMode * smoothstep(0.08, -0.02, gamma) * shallowGlide;
    const slowEndurance = activeEndurance * Math.exp(-((v / 3.4) ** 2)) * attached * gates.shapeKeep;
    clCamber = 1.92 * slowEndurance;
    cl = (base.cl + clCamber) * gates.forceLift;
    const steepClimbPenalty = (1 - gates.penetratorMode) * (1 - gates.enduranceMode) * smoothstep(0.016, 0.22, gamma) * 0.024;
    const weightSupport = 0.76 + 0.0512 * gates.distanceGliderMode - 0.0285 * gates.penetratorMode + 0.224 * slowEndurance;
    const neededCl = Math.max(0, (aero.mass * 9.81 * Math.max(0.2, Math.cos(gamma)) * weightSupport) / Math.max(1e-4, q) - clCamber);
    const alphaEq = neededCl / gates.clSlope;
    const maxTrim = 0.10 + 0.12 * slowEndurance;
    const glideTrim = Math.min(maxTrim, alphaEq);
    trim = cambered * speedGate * (climbUnload * glideTrim + steepClimbPenalty);
    const highSpeedEnduranceBrake = gates.enduranceMode * (smoothstep(2.0, 3.8, v) * 0.035 + smoothstep(0.35, 0.50, gamma) * 0.55);
    const overSteepPenetrator = gates.penetratorMode * smoothstep(0.70, 0.92, gamma) * 0.12;
    const finenessPenalty = 1 + 0.45 * Math.max(0, 1.05 - gates.slenderness) + 0.25 * gates.bodyRatio;
    cd0Clean =
      (0.0165 - 0.0031 * gates.distanceGliderMode + 0.00090 * gates.penetratorMode - 0.0138 * slowEndurance) *
        finenessPenalty * (1 + 0.2 * (1 - gates.shapeKeep)) +
      highSpeedEnduranceBrake + overSteepPenetrator;
    eOswald = (0.80 + 0.15 * gates.distanceGliderMode + 0.05 * gates.penetratorMode + 7.20 * slowEndurance) * (1 - 0.15 * (1 - gates.shapeKeep));
    const cdClean = (cd0Clean + (cl * cl) / (Math.PI * gates.ar * eOswald)) * gates.forceDrag;
    const climbDragOpen = (1 - gates.penetratorMode) * (1 - gates.enduranceMode) * smoothstep(0.016, 0.22, gamma) * 0.62;
    const cdBlend = cambered * attached * (1 - climbDragOpen);
    cd = base.cd * (1 - cdBlend) + cdClean * cdBlend;
    const ayApprox = (v ? (((-cd * relativeVelocity.y + cl * relativeVelocity.x) / v) * q) / aero.mass : 0) - 9.81;
    const axApprox = v ? (((-cd * relativeVelocity.x - cl * relativeVelocity.y) / v) * q) / aero.mass : 0;
    const gammaDot = (relativeVelocity.x * ayApprox - relativeVelocity.y * axApprox) / (v * v + 2.5);
    effectiveRate = state.angularVelocity.pitch - cambered * climbUnload * 0.85 * gammaDot;
    cdInduced = cl * cl / (Math.PI * gates.ar * eOswald);
    cdSeparated = 0; // 已并入 cdClean 的分离/零升部分,不重复累加
  }
  const lift = q * cl;
  const drag = q * cd;
  const sideForce = q * gates.cyBeta * Math.sin(beta);
  const totalAerodynamicForce: Vec3 = {
    x: lift * (Math.cos(phi) * liftDir.x + Math.sin(phi) * r.x) - drag * airDir.x - sideForce * r.x,
    y: lift * (Math.cos(phi) * liftDir.y + Math.sin(phi) * r.y) - drag * airDir.y - sideForce * r.y,
    z: lift * (Math.cos(phi) * liftDir.z + Math.sin(phi) * r.z) - drag * airDir.z - sideForce * r.z,
  };
  const qMoment = q * aero.span;
  const yawMoment = qMoment * (gates.cnBeta * Math.sin(beta) + gates.cnrNorm * (state.angularVelocity.yaw * aero.span / (2 * Math.max(v, 0.5))));
  const rollMoment = qMoment * (gates.clBeta * Math.sin(beta) + gates.clpNorm * (state.angularVelocity.roll * aero.span / (2 * Math.max(v, 0.5))))
    - aero.mass * 9.81 * Math.max(0, aero.cgDepth) * Math.sin(phi);
  // 与 model.ts pitchAcceleration 逐式一致:在配平后的迎角处重算系数,
  // 阻尼斜率用经典有限翼 2πAR/(AR+2)(不是配平用的 clSlope,两者不可混用)。
  const momentAlpha = alpha - trim;
  const momentCoeff = coefficients(momentAlpha, aero, v, options.dragModel);
  const normal = momentCoeff.cl * gates.forceLift * Math.cos(momentAlpha) + momentCoeff.cd * gates.forceDrag * Math.sin(momentAlpha);
  const axial = momentCoeff.cd * gates.forceDrag * Math.cos(momentAlpha) - momentCoeff.cl * gates.forceLift * Math.sin(momentAlpha);
  const pressureY = aero.wingCentroid.y + (aero.aerodynamicCenter.y - aero.wingCentroid.y) * Math.cos(momentAlpha);
  const lever = pressureY - aero.cg.y;
  const slope = 2 * Math.PI * gates.ar / (gates.ar + 2);
  const pitchMoment = q * aero.wingArea * (-normal * lever - slope * effectiveRate * aero.wingPitchSecondMoment / Math.max(v, 1e-6)
    + (options.experimentalHeightMoment ? axial * aero.cgDepth : 0));

  return {
    relativeVelocity,
    relativeSpeed: v,
    alpha,
    beta,
    dynamicPressure: q,
    cl, cd, lift, drag, sideForce,
    totalAerodynamicForce,
    pitchMoment,
    yawMoment,
    rollMoment,
    liftDirection: liftDir,
    dragDirection: dragDir,
    dragBreakdown: {
      induced: q * cdInduced,
      zeroLift: q * cd0Clean,
      separated: q * cdSeparated,
      bodyPenaltyShare: q * cd0Clean * 0.25 * Math.min(1, gates.bodyRatio),
      gateCorrection: q * (cd0Clean + cdInduced + cdSeparated),
    },
    corrections: {
      clCamber, cambered, shapeKeep: gates.shapeKeep, eOswald, trim,
      liftScale: gates.forceLift, dragScale: gates.forceDrag,
      enduranceMode: gates.enduranceMode, penetratorMode: gates.penetratorMode,
      distanceGliderMode: gates.distanceGliderMode, model: options.model,
    },
  };
}
