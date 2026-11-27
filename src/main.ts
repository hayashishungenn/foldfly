import {encodeFlight, decodeFlight, matchesSharedResult, resultForShare, type SharedResult} from './game/share';
import {playback, airSpeedAt} from './game/playback';
import {Sound} from './audio/sound';
import {challengeResult, type Challenge} from './game/challenge';
import {bestFlight, decodeGhost, encodeGhost, ghostStorageKey} from './game/ghost';
import {mapDragToThrow, type CanvasPoint, type DragThrowResult} from './game/throw-control';
import {accuracyMiss, accuracyTargetFromSeed} from './game/accuracy';
import {achievements, collectAchievementContext, evaluateAchievements} from './game/achievements';
import {
  careerChallenges,
  careerChallengeById,
  createCareerState,
  decodeCareer,
  encodeCareer,
  completeChallenge,
  isChallengeMet,
  isChallengeUnlocked,
  careerProgress,
  careerStorageKey,
  migrateCareer,
  type CareerChallenge,
  type CareerState,
} from './game/career';
import {
  abortCompetitionMatch,
  competitionPbKey,
  computeStandings,
  createCompetitionMatch,
  isLowerBetter,
  currentTurn,
  decodeCompetitionPb,
  encodeCompetitionPb,
  generateRoundWinds,
  recordCompetitionThrow,
  type CompetitionEvent,
  type CompetitionMatch,
  type CompetitionPersonalBest,
  type CompetitionPlayer,
  type ThrowRecord,
} from './game/competition';
import {escapeHtml} from './ui/safe';
import {slider, renderMaterialInfo, renderPlaneDetail, renderRecordsWall, renderAeroDeepHtml} from './ui/templates';
import './style.css';
import {papers, weights, weightHints} from './paper/papers';
import {grades, materialProfile, paperGrade, isPaperGradeId, type PaperGradeId} from './paper/material';
import {trimAero, DEFAULT_TRIM, validateTrim, type TrimConfig} from './paper/trim';
import {adjustProgram, offsetFromMiss, type FoldAdjustments} from './fold/adjustments';
import {wingSideAnalysis} from './paper/analysis';
import {structuralStiffness} from './paper/stack';
import {foldStackStats} from './fold/crease-pattern';
import {planes, archives, type PlaneId} from './fold/planes';
import {replay, FOLD_ENGINE_VERSION} from './fold/engine';
import {
  buildDesign,
  decodeDesign,
  designStorageKey,
  designToSteps,
  encodeDesign,
  FREESTYLE_PLANE_ID,
  validateCrease,
  type FreestyleDesign,
} from './fold/freestyle';
import {
  createFoldHistory,
  evaluateDrag,
  foldAccuracy,
  isGrabHit,
  nextCursor,
  programFoldQuality,
  pushHistory,
  redoHistory,
  resolveInteractiveTarget,
  undoHistory,
  type DragStatus,
  type FoldHistory,
} from './fold/interact';
import {extract, aeroMetrics, type Aero} from './aero/extract';
import {analyzeFlight} from './aero/diagnostics';
import {analyzeTrajectoryPhases, computeAeroPolar, sweepLaunchAngles} from './aero/polar';
import {simulate, FLIGHT_MODEL_VERSION, type Flight, type SimulationOptions, type Throw} from './aero/integrator';
import {foldViewport, renderFoldCanvas, renderPlaneBlueprintSvg, type FoldViewMode} from './render/fold2d';
import {
  flightLaunchAnchor,
  renderComparisonCanvas,
  renderFlightCanvas,
  type ComparisonFlightEntry,
} from './render/flight2d';
type Flight3DModule = typeof import('./render/flight3d');
/** 三维视图模块按需加载(代码分割):three 只在首次开启三维视图时下载。 */
let flight3dModule: Flight3DModule | null = null;

const app = document.querySelector<HTMLDivElement>('#app')!;
const sound = new Sound();
let landingSoundPlayed = false;
let celebrated = false;
let paper = 0;
let gsm: (typeof weights)[number] = 80;
let grade: PaperGradeId = 'copy';
// Phase 04:调校与折痕误差(真实几何输入,非成绩乘数)
let trim: TrimConfig = {...DEFAULT_TRIM};
let creaseAdjustments: FoldAdjustments = {};
let step = 0;
let foldHistory: FoldHistory = createFoldHistory(0, 0);
/** 手动折叠每条子操作的折痕精度(v4 折痕质量通道);自动/跳过的子操作视为按设计完成。 */
let foldScores = new Map<string, number>();
let manualFoldMode = true;
let foldHint = false;
let dragStatus: DragStatus = 'idle';
let dragProgress = 0;
let stage: 'paper' | 'fold' | 'design' | 'career' | 'flight' | 'settlement' = 'paper';
let foldViewMode: FoldViewMode = 'folded';
let auto = false;
let animating = false;
let flight: Flight | null = null;
let previousFlight: Flight | null = null;
let showForces = false;
let topView = false;
let use3D = false;
let view3d: {canvas: HTMLCanvasElement; ctrl: import('./render/flight3d').Flight3DController} | null = null;
/** 当前折叠完成态的 3D 观察面片(米制);仅渲染消费。 */
let lastViewFaces: {x: number; y: number; z: number}[][] | null = null;
/** 精准赛靶线距离(仅渲染展示);由飞行场渲染更新。 */
let accuracyTargetDisplay: number | undefined = undefined;

/**
 * 单次投掷配置快照(治理 1.4):预演、实际飞行、诊断、声音与成绩提交
 * 必须共享同一份不可变配置。构建器在调用时刻读取权威模块状态,
 * 而非渲染期的闭包常量(修复 C-02:滑块改变后仍用旧 activeWind)。
 */
type ThrowConfig = Readonly<{
  planeId: PlaneId | typeof FREESTYLE_PLANE_ID;
  paperId: string;
  gsm: number;
  grade: PaperGradeId;
  angle: number;
  speed: number;
  wind: number;
  crosswind: number;
  foldQuality: number;
  foldEngineVersion: number;
  flightModelVersion: number;
}>;
let showPolar = false;
let followCamera = true;
let flightPaused = false;
let pausedElapsed = 0;
let chargeState: {anchor: CanvasPoint; pointer: CanvasPoint; result: DragThrowResult} | null = null;
/** 回放倍率;e2e 可经 sessionStorage('fly-rate') 提速(1–50),正常用户恒为 1。 */
const E2E_PLAYBACK_RATE = (() => {
  try {
    const saved = Number(sessionStorage.getItem('fly-rate'));
    return Number.isFinite(saved) && saved >= 1 && saved <= 50 ? saved : 1;
  } catch {
    return 1;
  }
})();
let playbackRate = E2E_PLAYBACK_RATE;
let playStart = 0;
let animation = 0;
let angle = 20;
let speed = 15;
let wind = 0;
let crosswind = 0;
let challenge: Challenge = 'distance';
let plane: PlaneId = 'dart';

// 自由设计台(Phase 03):折痕画布状态与待试飞的自由设计
let design: FreestyleDesign | null = null;
let designPending: {x: number; y: number} | null = null;
let designKind: 'valley' | 'mountain' = 'valley';
let designLayer: 'all' | 'top' = 'all';
let designOpen = false;
let designError = '';
let flightDesign: FreestyleDesign | null = null;
// 单人生涯(Phase 08):本地存档 + 进行中的关卡
let careerState: CareerState = createCareerState();
let careerActive: CareerChallenge | null = null;
let careerNeedsReset = false;
let careerEvaluated = false;
/** 治理 1.7:存档写入失败必须可见,不能让玩家误以为进度已持久化。 */
let careerSaveFailed = false;

// Official local competition state (independent from free experiment mode)
let flightMode: 'free' | 'competition' = 'free';
let compEvent: CompetitionEvent = 'distance';
let compPlayerCount: 1 | 2 | 3 | 4 = 1;
let compSeed = 20261126;
let compSetupPlayers: CompetitionPlayer[] = [
  {id: 'p1', name: '选手 1', plane: 'dart'},
  {id: 'p2', name: '选手 2', plane: 'suzanne'},
  {id: 'p3', name: '选手 3', plane: 'mach5'},
  {id: 'p4', name: '选手 4', plane: 'skyking'},
];
let activeMatch: CompetitionMatch | null = null;
let compLastRecord: ThrowRecord | null = null;
let compThrowRecorded = false;
let compThrowFlights = new Map<string, Flight>();
let compNewPb = false;

function loadCompetitionPb(event: CompetitionEvent): CompetitionPersonalBest | null {
  try {
    return decodeCompetitionPb(localStorage.getItem(competitionPbKey(event)), event);
  } catch {
    return null;
  }
}

function saveCompetitionPbIfBetter(match: CompetitionMatch): boolean {
  const standings = computeStandings(match);
  const top = standings[0];
  if (!top || top.bestScore === null || !top.bestThrow) return false;
  const existing = loadCompetitionPb(match.event);
  if (existing) {
    // 精准赛低分优,其余项目高分优;同分不刷新
    const better = isLowerBetter(match.event) ? top.bestScore < existing.score : top.bestScore > existing.score;
    if (!better) return false;
  }
  const pb: CompetitionPersonalBest = {
    event: match.event,
    score: top.bestScore,
    playerName: top.player.name,
    plane: top.player.plane,
    paper: match.paper,
    gsm: match.gsm,
    ...(match.grade !== undefined ? {grade: match.grade} : {}),
    seed: match.seed,
    modelVersion: FLIGHT_MODEL_VERSION,
    recordedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(competitionPbKey(match.event), encodeCompetitionPb(pb));
  } catch {}
  return true;
}

/** 游戏阶段(治理 1.8):进入条件与出口清理集中于此,禁止散落赋值。 */
type Stage = 'paper' | 'fold' | 'design' | 'career' | 'flight' | 'settlement';
function gotoStage(next: Stage, renderNow = true) {
  // 统一出口清理:终止动画链与风声,复位瞬态交互状态
  cancelAnimationFrame(animation);
  auto = false;
  animating = false;
  flightPaused = false;
  pausedElapsed = 0;
  chargeState = null;
  sound.wind(0);
  // 上一投回看与成绩提交标志属于比赛流程,由比赛控制器显式管理,不在此清
  stage = next;
  if (renderNow) render();
}

const currentPlane = () => planes[plane];
/** v4 模拟选项:材质定形通道 + 折痕质量通道(正式比赛用预设折序 = 完美折痕)。 */
function simOptions(gradeId: PaperGradeId, gsmValue: number, quality: number): SimulationOptions {
  return {material: materialProfile(gradeId, gsmValue), foldQuality: quality};
}
const ghosts: Record<string, Flight | null> = {};
let activeGhost: Flight | null = null;

function getGhost(mode: Challenge): Flight | null {
  const key = ghostStorageKey(plane, mode);
  if (!(key in ghosts)) {
    try {
      const saved = localStorage.getItem(key);
      ghosts[key] = saved ? decodeGhost(saved, mode) : null;
    } catch {
      ghosts[key] = null;
    }
  }
  return ghosts[key];
}

function bestLabel(): string {
  const record = getGhost(challenge);
  return record ? (challenge === 'distance' ? record.distance.toFixed(1) + ' m' : record.duration.toFixed(1) + ' s') : '—';
}

// 自由设计分享链接(#design=)优先于成绩分享链接解析
const sharedDesign = location.hash.startsWith('#design=') ? decodeDesign(decodeURIComponent(location.hash.slice(8))) : null;
const invalidDesign = location.hash.startsWith('#design=') && !sharedDesign;
if (sharedDesign) {
  design = sharedDesign;
  paper = Math.max(0, papers.findIndex(p => p.id === sharedDesign.sheet));
  stage = 'design'; // 启动初始化:gotoStage 的清理逻辑尚无意义且 render() 由底部统一调用
}

const shared = decodeFlight(location.hash);
const invalidShare = location.hash.startsWith('#flight=') && !shared;
let sharedResult: SharedResult | undefined = shared?.result;
if (shared) {
  paper = papers.findIndex(p => p.id === shared.paper);
  gsm = shared.gsm;
  if (shared.grade) grade = shared.grade;
  if (shared.trim) trim = {...shared.trim};
  if (shared.creases) creaseAdjustments = {...(shared.creases as FoldAdjustments)};
  angle = shared.angle;
  speed = shared.speed;
  wind = shared.wind;
  plane = shared.plane;
  step = currentPlane().steps.length;
  stage = 'flight'; // 启动初始化:与 #design= 同理,直接赋值(此时 render 尚不可调用)
  challenge = shared.challenge ?? 'distance';
}

let legacyMessage = shared
  ? [
      !shared.foldSignature ? '这是旧版分享链接，折序是否一致无法验证。' : '',
      shared.foldEngineVersion === undefined
        ? '链接未记录折叠引擎版本，几何可能不同。'
        : shared.foldEngineVersion !== FOLD_ENGINE_VERSION
          ? '链接使用其他折叠引擎版本，几何可能不同。'
          : '',
      shared.modelVersion === undefined
        ? '链接未记录飞行模型版本，结果可能不同。'
        : shared.modelVersion !== FLIGHT_MODEL_VERSION
          ? '链接使用其他飞行模型版本，结果可能不同。'
          : '',
    ]
      .filter(Boolean)
      .join(' ')
  : '';

const reduced = matchMedia('(prefers-reduced-motion: reduce)');

function shell(content: string) {
  const workshopActive = stage === 'paper' || stage === 'fold' || stage === 'design' || stage === 'career';
  app.innerHTML = `<main><header><span class="stamp">一纸冲天</span><h1>FoldFly <small>纸飞机工坊</small></h1><p>一张纸，一次认真折叠，一段自己的飞行。</p><button class="sound-toggle" id="sound-toggle" aria-pressed="${sound.enabled}">${sound.enabled ? '声音开启' : '声音关闭'}</button></header><nav aria-label="进度"><span class="${workshopActive ? 'active' : ''}">① 折纸工坊</span><span class="${stage === 'flight' ? 'active' : ''}">② 飞行赛场</span><span class="${stage === 'settlement' ? 'active' : ''}">③ 比赛结算</span></nav>${content}</main>`;
  document.querySelector<HTMLButtonElement>('#sound-toggle')!.onclick = () => {
    const enabled = sound.toggle();
    const button = document.querySelector<HTMLButtonElement>('#sound-toggle')!;
    button.textContent = enabled ? '声音开启' : '声音关闭';
    button.setAttribute('aria-pressed', String(enabled));
  };
}




function render() {
  cancelAnimationFrame(animation);
  if (stage === 'paper') {
    const activeSheet = papers[paper];
    const planeCardsHtml = Object.values(planes)
      .map(p => {
        const folded = replay(activeSheet, p.steps.length, p.steps);
        const aero = extract(folded, gsm);
        const m = aeroMetrics(aero);
        const svg = renderPlaneBlueprintSvg(activeSheet, p.steps, gsm);
        return `<div class="plane-block"><button class="plane-choice ${plane === p.id ? 'selected' : ''}" data-plane="${p.id}" aria-pressed="${plane === p.id}">
          <div class="plane-choice-top">
            ${svg}
            <div class="plane-choice-copy">
              <strong>${p.name}</strong>
              <small>${p.description}</small>
            </div>
          </div>
          <div class="plane-choice-specs mono">
            <span>${p.steps.length} 步</span>
            <span>翼展 ${(aero.span * 100).toFixed(1)} cm</span>
            <span>AR ${aero.aspectRatio.toFixed(2)}</span>
            <span>SM ${(m.staticMargin * 100).toFixed(0)}%</span>
          </div>
        </button>${renderPlaneDetail(p.id, gsm, grade)}</div>`;
      })
      .join('');

    const archiveCardsHtml = archives
      .map(
        a => `<article class="record-card">
          <div class="rc-head">
            <span class="badge mono record-badge">${a.badge} · ${a.record}</span>
            <h4>${a.name}</h4>
            <div class="sub">${a.designer}</div>
          </div>
          <div class="rc-body">
            <div class="stats">
              <div><span class="lbl">纪录成绩</span><span class="val mono">${a.score}</span></div>
              <div><span class="lbl">推荐用纸</span><span class="val mono">${a.recommendedPaper}</span></div>
              <div><span class="lbl">最佳投掷</span><span class="val mono">${a.optimalAngle}</span></div>
            </div>
            <small>${a.story}</small>
            <small>投掷策略：${a.strategy}</small>
            <div class="rc-foot">
              <a href="${a.source}" target="_blank" rel="noopener noreferrer">${a.sourceLabel} ↗</a>
              <button type="button" class="preset-btn" data-preset="${a.id}">选用纪录配置</button>
            </div>
          </div>
        </article>`,
      )
      .join('');

    shell(
      `<section><div class="section-head"><div><p class="eyebrow">01 / 选择纸张</p><h2>从一张纸开始</h2><p>纸张的大小、克重和材质，会改变飞机的几何比例、翼载荷与飞行表现。</p></div></div>${invalidShare ? '<p role="status">分享链接无效或来自旧版折序，请重新选择配置。</p>' : ''}${invalidDesign ? '<p role="status">设计链接无效或来自不兼容版本。</p>' : ''}<h3>纸张规格</h3><div class="cards">${papers.map((p, i) => `<button class="card ${paper === i ? 'selected' : ''}" data-paper="${i}" aria-pressed="${paper === i}"><span class="paper-icon ${p.id}"></span><strong>${p.name}</strong><span class="mono">${Number((p.width * 1000).toFixed(1))} × ${Number((p.height * 1000).toFixed(1))} mm</span><small>${p.hint}</small></button>`).join('')}</div><h3>纸张克重 <small>g / m²</small></h3><div class="weights">${weights.map(w => `<button class="${gsm === w ? 'selected' : ''}" data-weight="${w}" aria-pressed="${gsm === w}">${w} gsm</button>`).join('')}</div><p class="weight-hint">${weightHints[gsm]}</p><h3>纸张材质</h3><div class="weights">${grades.map(g => `<button class="${grade === g.id ? 'selected' : ''}" data-grade="${g.id}" aria-pressed="${grade === g.id}">${g.name}</button>`).join('')}</div>${renderMaterialInfo(grade, gsm)}<h3>选择机型 <small>（下方蓝图与参数随当前所选纸张实时重算）</small></h3><div class="plane-choices">${planeCardsHtml}</div><div class="archive"><h3>经典机型图鉴</h3><p>从童年的尖头机开始，认识人类纸飞机纪录史上的三座里程碑。</p><div class="archive-grid">${archiveCardsHtml}</div><p class="archive-note">注：气动参数（质量、重心、翼面积、展弦比、静稳定度）全部由折后纸层几何实时计算；材料厚度、挺度等为经验参数库估算，非实测。</p></div><div class="actions"><span>已选 ${papers[paper].name} · ${gsm} gsm · ${paperGrade(grade).name} · ${currentPlane().name}</span><button id="design-start">自由设计 →</button><button id="career-start">生涯模式 →</button><button class="primary" id="start">开始折纸 →</button></div></section>`,
    );
    document.querySelectorAll<HTMLButtonElement>('[data-paper]').forEach(
      el =>
        (el.onclick = () => {
          paper = Number(el.dataset.paper);
          render();
          document.querySelector<HTMLButtonElement>(`[data-paper="${paper}"]`)?.focus();
        }),
    );
    document.querySelectorAll<HTMLButtonElement>('[data-weight]').forEach(
      el =>
        (el.onclick = () => {
          gsm = Number(el.dataset.weight) as (typeof weights)[number];
          render();
          document.querySelector<HTMLButtonElement>(`[data-weight="${gsm}"]`)?.focus();
        }),
    );
    document.querySelectorAll<HTMLButtonElement>('[data-grade]').forEach(
      el =>
        (el.onclick = () => {
          const id = el.dataset.grade;
          if (!isPaperGradeId(id)) return;
          grade = id;
          render();
          document.querySelector<HTMLButtonElement>(`[data-grade="${grade}"]`)?.focus();
        }),
    );
    document.querySelectorAll<HTMLButtonElement>('[data-plane]').forEach(
      el =>
        (el.onclick = () => {
          plane = el.dataset.plane as PlaneId;
          angle = planes[plane].recommendation.angle;
          speed = planes[plane].recommendation.speed;
          foldScores = new Map();
          render();
          document.querySelector<HTMLButtonElement>(`[data-plane="${plane}"]`)?.focus();
        }),
    );
    document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(
      el =>
        (el.onclick = () => {
          const item = archives.find(a => a.id === el.dataset.preset);
          if (!item) return;
          plane = item.preset.plane;
          paper = Math.max(0, papers.findIndex(p => p.id === item.preset.paper));
          gsm = item.preset.gsm;
          angle = item.preset.angle;
          speed = item.preset.speed;
          challenge = item.preset.challenge;
          render();
          document.querySelector<HTMLButtonElement>('#start')?.focus();
        }),
    );
    document.querySelector<HTMLButtonElement>('#start')!.onclick = () => {
      gotoStage('fold');
      foldHistory = createFoldHistory(0, 0);
      foldScores = new Map();
      step = 0;
      foldHint = false;
      dragStatus = 'idle';
      dragProgress = 0;
      foldViewMode = 'folded';
      render();
    };
    document.querySelector<HTMLButtonElement>('#career-start')!.onclick = () => {
      gotoStage('career');
      render();
    };
    document.querySelector<HTMLButtonElement>('#design-start')!.onclick = () => {
      design = buildDesign(papers[paper].id, '我的纸飞机', []);
      designPending = null;
      designError = '';
      designKind = 'valley';
      designLayer = 'all';
      designOpen = false;
      gotoStage('design');
      render();
    };
    return;
  }

  if (stage === 'career') {
    const progress = careerProgress(careerState);
    const cards = careerChallenges
      .map((c, idx) => {
        const unlocked = isChallengeUnlocked(careerState, c.id);
        const done = careerState.completed[c.id];
        const unit = c.event === 'duration' ? ' s' : ' m';
        const targetText = c.event === 'accuracy' ? `距靶 ≤ ${c.target} m` : `≥ ${c.target}${unit}`;
        return `<div class="career-card ${!unlocked ? 'locked' : ''} ${done ? 'done' : ''}">
          <div class="career-head"><span class="mono career-no">${String(idx + 1).padStart(2, '0')}</span><strong>${c.title}</strong>${done ? '<span class="badge mono">✓ 已完成</span>' : unlocked ? '<span class="badge mono unlocked">进行中</span>' : '<span class="badge mono">🔒</span>'}</div>
          <p>${c.description}</p>
          <div class="career-meta mono">${planes[c.plane].name} · ${papers.find(p => p.id === c.paper)!.name} ${c.gsm}g${c.grade ? ` · ${paperGrade(c.grade).name}` : ''} · ${c.event === 'accuracy' ? `靶线 ${c.targetLine} m` : c.event === 'distance' ? '距离赛' : '滞空赛'}${c.wind !== 0 ? ` · 逆风 ${c.wind} m/s` : ''}${c.crosswind !== 0 ? ` · 侧风 ${c.crosswind} m/s` : ''} · 目标 ${targetText}</div>
          ${done ? `<div class="career-best mono">生涯最佳 ${done.score.toFixed(2)}${unit}</div>` : ''}
          ${unlocked && !done ? `<button class="primary" data-career-play="${c.id}">开始挑战 →</button>` : done ? `<button data-career-play="${c.id}">再试一次</button>` : ''}
        </div>`;
      })
      .join('');
    shell(
      `<section><div class="section-head"><div><p class="eyebrow">单人生涯</p><h2>从童年回忆到纪录殿堂</h2><p>按顺序挑战 ${careerChallenges.length} 个关卡;每关锁定纸张与风况,精准赛开放角度与力度供你调整。${progress.done > 0 ? `已完成 ${progress.done}/${progress.total}。` : ''}</p></div><div class="flight-head-tools"><button id="career-back">← 返回选纸</button>${progress.done > 0 ? '<button id="career-reset">重置生涯</button>' : ''}</div></div>${careerNeedsReset ? '<p role="status">检测到不兼容的旧版生涯存档,已完成进度不可读;请重置后重新开始。</p>' : ''}${careerSaveFailed ? '<p role="alert">⚠ 本次进度未能写入本地存储(隐私模式或空间不足)——当前会话内进度仍有效,但刷新后将丢失。</p>' : ''}<div class="career-grid">${cards}</div>${renderRecordsWall()}</section>`,
    );
    document.querySelector<HTMLButtonElement>('#career-back')!.onclick = () => {
      gotoStage('paper');
      render();
    };
    const resetBtn = document.querySelector<HTMLButtonElement>('#career-reset');
    if (resetBtn) {
      resetBtn.onclick = () => {
        careerState = createCareerState();
        careerNeedsReset = false;
        try {
          localStorage.removeItem(careerStorageKey);
        } catch {}
        render();
      };
    }
    document.querySelectorAll<HTMLButtonElement>('[data-career-play]').forEach(
      el =>
        (el.onclick = () => {
          const challenge = careerChallengeById(el.dataset.careerPlay ?? '');
          if (!challenge || !isChallengeUnlocked(careerState, challenge.id)) return;
          careerActive = challenge;
          paper = Math.max(0, papers.findIndex(p => p.id === challenge.paper));
          gsm = challenge.gsm;
          grade = challenge.grade ?? 'copy';
          plane = challenge.plane;
          angle = challenge.angle ?? planes[challenge.plane].recommendation.angle;
          speed = challenge.speed ?? planes[challenge.plane].recommendation.speed;
          careerEvaluated = false;
          flight = null;
          previousFlight = null;
          flightDesign = null;
          foldScores = new Map();
          gotoStage('flight');
          render();
        }),
    );
    return;
  }

  if (stage === 'design' && design) {
    const sheet = papers[paper];
    const program = designToSteps(design);
    shell(
      `<section><div class="section-head"><div><p class="eyebrow">02 / 自由设计台 · ${paperGrade(grade).name}</p><h2>${escapeHtml(design.name)}</h2><p>${design.creases.length} 道折痕 · ${sheet.name} ${gsm} gsm · 在画布上点两点定一道折痕${designError ? `<span class="invalid-score"> · ${designError}</span>` : ''}</p></div><div class="fold-head-tools"><button type="button" id="design-kind" class="${designKind === 'mountain' ? 'selected' : ''}">${designKind === 'valley' ? '谷折' : '山折'}</button><button type="button" id="design-layer" class="${designLayer === 'top' ? 'selected' : ''}">${designLayer === 'all' ? '全部纸层' : '仅顶层'}</button><button type="button" id="design-open" class="${designOpen ? 'selected' : ''}" aria-pressed="${designOpen}">折后展翼：${designOpen ? '开' : '关'}</button></div></div><div class="canvas-wrap"><canvas id="fold" width="960" height="600" aria-label="自由设计台"></canvas></div><p class="ghost-note">第一点为折痕起点，第二点为终点；山折将标记侧向背面折。引擎无法表达的折序会被明确拒绝，不会被静默近似。</p><div class="actions"><button id="design-undo" ${design.creases.length ? '' : 'disabled'}>撤销上一道</button><button id="design-clear" ${design.creases.length ? '' : 'disabled'}>清空重折</button><button id="design-save">保存到本地</button><button id="design-load">载入本地</button><button id="design-share">复制设计链接</button><button id="design-back">← 换纸重选</button><span class="spacer"></span><button class="primary" id="design-fly" ${design.creases.length ? '' : 'disabled'}>试飞这架 →</button></div></section>`,
    );
    drawDesignCanvas();

    const canvas = document.querySelector<HTMLCanvasElement>('#fold')!;
    const vp = foldViewport(sheet);
    canvas.onpointerdown = e => {
      if (!design) return;
      const rect = canvas.getBoundingClientRect();
      const cx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 960;
      const cy = ((e.clientY - rect.top) / Math.max(1, rect.height)) * 600;
      const pt = vp.toSheet(cx, cy);
      if (!designPending) {
        designPending = pt;
        designError = '';
        drawDesignCanvas();
        return;
      }
      const start = designPending;
      designPending = null;
      try {
        const crease = validateCrease({
          a: [start.x / sheet.width, start.y / sheet.height],
          b: [pt.x / sheet.width, pt.y / sheet.height],
          kind: designKind,
          layer: designLayer,
          ...(designOpen ? {open: true} : {}),
        });
        const candidate = buildDesign(design.sheet, design.name, [...design.creases, crease]);
        replay(sheet, candidate.creases.length, designToSteps(candidate));
        design = candidate;
        designError = '';
        sound.fold();
      } catch (error) {
        designError = error instanceof Error ? error.message : '该折痕无法折叠';
      }
      render();
    };

    document.querySelector<HTMLButtonElement>('#design-kind')!.onclick = () => {
      designKind = designKind === 'valley' ? 'mountain' : 'valley';
      render();
    };
    document.querySelector<HTMLButtonElement>('#design-layer')!.onclick = () => {
      designLayer = designLayer === 'all' ? 'top' : 'all';
      render();
    };
    document.querySelector<HTMLButtonElement>('#design-open')!.onclick = () => {
      designOpen = !designOpen;
      render();
    };
    document.querySelector<HTMLButtonElement>('#design-undo')!.onclick = () => {
      if (!design?.creases.length) return;
      design = buildDesign(design.sheet, design.name, design.creases.slice(0, -1));
      designError = '';
      render();
    };
    document.querySelector<HTMLButtonElement>('#design-clear')!.onclick = () => {
      if (!design) return;
      design = buildDesign(design.sheet, design.name, []);
      designPending = null;
      designError = '';
      render();
    };
    document.querySelector<HTMLButtonElement>('#design-save')!.onclick = () => {
      if (!design) return;
      const button = document.querySelector<HTMLButtonElement>('#design-save')!;
      try {
        localStorage.setItem(designStorageKey, encodeDesign(design));
        button.textContent = '已保存';
      } catch {
        button.textContent = '保存失败';
      }
    };
    document.querySelector<HTMLButtonElement>('#design-load')!.onclick = () => {
      const loaded = decodeDesign(localStorage.getItem(designStorageKey));
      if (!loaded) {
        designError = '本地没有有效设计存档';
      } else {
        design = loaded;
        paper = Math.max(0, papers.findIndex(p => p.id === loaded.sheet));
        designPending = null;
        designError = '';
      }
      render();
    };
    document.querySelector<HTMLButtonElement>('#design-share')!.onclick = () => {
      if (!design) return;
      const button = document.querySelector<HTMLButtonElement>('#design-share')!;
      history.replaceState(null, '', '#design=' + encodeURIComponent(encodeDesign(design)));
      (navigator.clipboard?.writeText(location.href) ?? Promise.reject()).then(
        () => (button.textContent = '链接已复制'),
        () => (button.textContent = '请复制地址栏链接'),
      );
    };
    document.querySelector<HTMLButtonElement>('#design-back')!.onclick = () => {
      gotoStage('paper');
      designPending = null;
      render();
    };
    document.querySelector<HTMLButtonElement>('#design-fly')!.onclick = () => {
      if (!design) return;
      flightDesign = design;
      foldScores = new Map();
      flight = null;
      previousFlight = null;
      gotoStage('flight');
      render();
    };
    return;
  }

  if (stage === 'fold') {
    const program = currentPlane().steps;
    const n = program.length;
    step = foldHistory.cursor.step;
    const subOp = foldHistory.cursor.subOp;
    const current = program[Math.min(step, n - 1)];
    const target = foldViewMode === 'folded' && step < n ? resolveInteractiveTarget(papers[paper], program, foldHistory.cursor) : null;
    const canUndo = foldHistory.undoStack.length > 0 || step > 0 || subOp > 0;
    const canRedo = foldHistory.redoStack.length > 0;
    const timelineHtml = Array.from({length: n + 1}, (_, idx) => {
      const label = idx === 0 ? '展开' : idx === n ? '完成' : `${idx}`;
      return `<button type="button" class="step-pill mono ${step === idx ? 'selected' : ''}" data-jump-step="${idx}" ${animating ? 'disabled' : ''}>${label}</button>`;
    }).join('');
    const subBadge = target && target.subOpCount > 1 ? ` · 第 ${subOp + 1}/${target.subOpCount} 侧` : '';

    shell(
      `<section><div class="section-head"><div><p class="eyebrow">02 / ${currentPlane().name}</p><h2>${step === n ? '折好了，准备试飞' : `第 ${step + 1} 步 · ${current.title}${subBadge}`}</h2><p>${step === n ? '轻轻压平折痕，让机翼保持对称；画布已标出重心 CG、气动焦点 AC 与龙骨剖面。' : current.description}</p></div><div class="fold-head-tools"><button type="button" id="toggle-fold-mode" class="${manualFoldMode ? 'selected' : ''}" aria-pressed="${manualFoldMode}" ${animating ? 'disabled' : ''}>${manualFoldMode ? '手动折纸' : '自动教学'}</button><button type="button" id="toggle-cp" class="${foldViewMode === 'cp' ? 'selected' : ''}" aria-pressed="${foldViewMode === 'cp'}" ${animating ? 'disabled' : ''}>${foldViewMode === 'cp' ? '返回折叠态' : '折痕图 CP'}</button><span class="step-count mono">${step} / ${n}</span><span class="step-count mono">${papers[paper].name} ${gsm} g · ${paperGrade(grade).name}</span></div></div><div class="canvas-wrap"><canvas id="fold" class="${manualFoldMode && foldViewMode === 'folded' && step < n ? 'interactive-fold' : ''}" width="960" height="600" aria-label="折纸工作台"></canvas></div><div class="step-timeline" aria-label="步骤时间轴">${timelineHtml}</div><div class="legend"><span>┄┄ 谷折 · 空心箭头</span><span class="red">━ · ━ 山折 · 实心箭头</span><span>◎ 金圈吸附目标</span><span>⊕ 重心 CG · ◎ 焦点 AC</span></div><div class="actions"><button id="back" ${!canUndo || animating ? 'disabled' : ''}>← 上一步</button><button id="redo" ${!canRedo || animating ? 'disabled' : ''}>重做 ↻</button>${step < n ? `<button id="fold-hint" class="${foldHint ? 'selected' : ''}" aria-pressed="${foldHint}" ${animating ? 'disabled' : ''}>提示</button>` : ''}<button id="auto" ${step === n || (animating && !auto) ? 'disabled' : ''}>${auto ? '停止演示' : '自动演示'}</button>${step < n ? `<button id="finish-fold" ${animating ? 'disabled' : ''}>跳过教学</button>` : ''}<span class="spacer"></span>${step === n ? '<button class="primary" id="next">前往试飞 →</button>' : `<button class="primary" id="next" ${animating ? 'disabled' : ''}>完成这一步 →</button>`}</div></section>`,
    );
    drawFold(dragProgress);

    const canvas = document.querySelector<HTMLCanvasElement>('#fold')!;
    if (manualFoldMode && foldViewMode === 'folded' && step < n && target && !animating) {
      let draggingId: number | null = null;
      let dragStart = target.grabPoint;
      const vp = foldViewport(papers[paper]);
      const toSheet = (e: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        const cx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 960;
        const cy = ((e.clientY - rect.top) / Math.max(1, rect.height)) * 600;
        return vp.toSheet(cx, cy);
      };

      canvas.onpointerdown = e => {
        if (animating || draggingId !== null) return;
        const pt = toSheet(e);
        if (!isGrabHit(target, pt)) return;
        sound.activate();
        draggingId = e.pointerId;
        dragStart = pt;
        dragStatus = 'dragging';
        dragProgress = 0;
        canvas.classList.add('dragging');
        canvas.setPointerCapture?.(e.pointerId);
        drawFold(0);
      };

      canvas.onpointermove = e => {
        if (draggingId !== e.pointerId) return;
        const pt = toSheet(e);
        const ev = evaluateDrag(target, dragStart, pt);
        dragProgress = ev.progress;
        dragStatus = ev.status;
        drawFold(dragProgress);
      };

      const endDrag = (e: PointerEvent, cancelled: boolean) => {
        if (draggingId !== e.pointerId) return;
        draggingId = null;
        canvas.classList.remove('dragging');
        const pt = toSheet(e);
        const ev = cancelled ? {progress: 0, shouldCommit: false, status: 'idle' as DragStatus} : evaluateDrag(target, dragStart, pt);
        if (ev.shouldCommit) {
          // 4.6/4.7:记录落点相对目标的偏差,作为折痕平移偏移进入真实几何
          const miss = offsetFromMiss(
            {width: papers[paper].width, height: papers[paper].height},
            foldHistory.cursor.step, foldHistory.cursor.subOp,
            {ax: pt.x - target.targetPoint.x, ay: pt.y - target.targetPoint.y, bx: pt.x - target.targetPoint.x, by: pt.y - target.targetPoint.y},
          );
          if (miss) creaseAdjustments = {...creaseAdjustments, [miss.key]: miss.offset};
          animating = true;
          const startP = ev.progress;
          const t0 = performance.now();
          const dur = reduced.matches ? 0 : 180;
          const snapTick = (now: number) => {
            const k = dur ? Math.min(1, (now - t0) / dur) : 1;
            const p = startP + (1 - startP) * k;
            drawFold(p);
            if (k < 1) {
              animation = requestAnimationFrame(snapTick);
            } else {
              sound.fold();
              foldScores.set(`${foldHistory.cursor.step}:${foldHistory.cursor.subOp}`, foldAccuracy(target, dragStart, pt));
              foldHistory = pushHistory(foldHistory, nextCursor(foldHistory.cursor, program));
              step = foldHistory.cursor.step;
              foldHint = false;
              dragStatus = 'idle';
              dragProgress = 0;
              animating = false;
              render();
            }
          };
          animation = requestAnimationFrame(snapTick);
        } else {
          const startP = dragProgress;
          const finalStatus: DragStatus = ev.status === 'wrong-direction' ? 'wrong-direction' : 'idle';
          const t0 = performance.now();
          const dur = reduced.matches || startP < 0.02 ? 0 : 150;
          const revertTick = (now: number) => {
            const k = dur ? Math.min(1, (now - t0) / dur) : 1;
            dragProgress = startP * (1 - k);
            dragStatus = k < 1 ? 'dragging' : finalStatus;
            drawFold(dragProgress);
            if (k < 1) {
              animation = requestAnimationFrame(revertTick);
            } else {
              dragProgress = 0;
            }
          };
          animation = requestAnimationFrame(revertTick);
        }
      };

      canvas.onpointerup = e => endDrag(e, false);
      canvas.onpointercancel = e => endDrag(e, true);
    }

    document.querySelector<HTMLButtonElement>('#toggle-fold-mode')!.onclick = () => {
      auto = false;
      manualFoldMode = !manualFoldMode;
      dragStatus = 'idle';
      dragProgress = 0;
      render();
    };
    document.querySelector<HTMLButtonElement>('#toggle-cp')!.onclick = () => {
      foldViewMode = foldViewMode === 'cp' ? 'folded' : 'cp';
      dragStatus = 'idle';
      dragProgress = 0;
      render();
    };
    document.querySelectorAll<HTMLButtonElement>('[data-jump-step]').forEach(
      el =>
        (el.onclick = () => {
          auto = false;
          const targetStep = Number(el.dataset.jumpStep);
          foldHistory = pushHistory(foldHistory, {step: targetStep, subOp: 0});
          step = targetStep;
          foldHint = false;
          dragStatus = 'idle';
          dragProgress = 0;
          render();
        }),
    );
    document.querySelector<HTMLButtonElement>('#back')!.onclick = () => {
      auto = false;
      foldHistory = undoHistory(foldHistory);
      step = foldHistory.cursor.step;
      foldHint = false;
      dragStatus = 'idle';
      dragProgress = 0;
      render();
    };
    document.querySelector<HTMLButtonElement>('#redo')!.onclick = () => {
      auto = false;
      foldHistory = redoHistory(foldHistory);
      step = foldHistory.cursor.step;
      foldHint = false;
      dragStatus = 'idle';
      dragProgress = 0;
      render();
    };
    const hintBtn = document.querySelector<HTMLButtonElement>('#fold-hint');
    if (hintBtn) {
      hintBtn.onclick = () => {
        foldHint = !foldHint;
        foldViewMode = 'folded';
        render();
      };
    }
    document.querySelector<HTMLButtonElement>('#auto')!.onclick = () => {
      auto = !auto;
      foldViewMode = 'folded';
      if (auto) advance();
      else if (!animating) render();
      else document.querySelector<HTMLButtonElement>('#auto')!.textContent = '自动演示';
    };
    const finishBtn = document.querySelector<HTMLButtonElement>('#finish-fold');
    if (finishBtn) {
      finishBtn.onclick = () => {
        auto = false;
        foldHistory = pushHistory(foldHistory, {step: n, subOp: 0});
        step = n;
        foldHint = false;
        dragStatus = 'idle';
        dragProgress = 0;
        render();
      };
    }
    document.querySelector<HTMLButtonElement>('#next')!.onclick = () => {
      if (step === n) {
        auto = false;
        gotoStage('flight');
        render();
      } else {
        foldViewMode = 'folded';
        advance();
      }
    };
    return;
  }

  if (stage === 'settlement' && activeMatch && activeMatch.status === 'finished') {
    const standings = computeStandings(activeMatch);
    const unit = activeMatch.event === 'duration' ? 's' : 'm';
    const eventLabel = activeMatch.event === 'distance' ? '距离赛' : activeMatch.event === 'accuracy' ? '精准赛（距靶，越近越好）' : '滞空赛';
    const matchPaper = papers.find(p => p.id === activeMatch!.paper) ?? papers[0];
    const champions = standings.filter(s => s.rank === 1 && s.bestScore !== null);
    const pb = loadCompetitionPb(activeMatch.event);
    const champTitle =
      champions.length === 0
        ? '本场无有效成绩'
        : champions.length === 1
          ? `冠军：${escapeHtml(champions[0].player.name)}（${champions[0].bestScore!.toFixed(2)} ${unit}）`
          : `并列冠军：${champions.map(c => escapeHtml(c.player.name)).join(' / ')}（${champions[0].bestScore!.toFixed(2)} ${unit}）`;

    const fmtRound = (r?: ThrowRecord) => {
      if (!r) return '—';
      if (!r.valid || r.score === null) return `<span class="invalid-score">无效</span>`;
      return `${r.score.toFixed(1)} ${unit}`;
    };

    const rowsHtml = standings
      .map(s => {
        const r1 = s.throws.find(t => t.round === 1);
        const r2 = s.throws.find(t => t.round === 2);
        const r3 = s.throws.find(t => t.round === 3);
        const rankText = s.bestScore === null ? '—' : s.tied ? `T${s.rank}` : `#${s.rank}`;
        return `<tr class="${s.rank === 1 && s.bestScore !== null ? 'leader' : ''}"><td class="mono">${rankText}</td><td>${escapeHtml(s.player.name)}</td><td>${planes[s.player.plane].name}</td><td class="mono">${fmtRound(r1)}</td><td class="mono">${fmtRound(r2)}</td><td class="mono">${fmtRound(r3)}</td><td class="mono"><b>${s.bestScore !== null ? `${s.bestScore.toFixed(2)} ${unit}` : '无有效成绩'}</b></td></tr>`;
      })
      .join('');

    shell(
      `<section><div class="section-head"><div><p class="eyebrow">03 / 比赛结算 · ${eventLabel}</p><h2>正式比赛排行榜</h2><p>${matchPaper.name} · ${activeMatch.gsm} gsm · ${paperGrade(activeMatch.grade ?? 'copy').name} · 风场种子 #${activeMatch.seed} · 物理模型 v${activeMatch.modelVersion}</p></div><div class="flight-head-tools"><button id="comp-rematch" class="primary">再来一场 →</button><button id="comp-back-free">返回自由实验</button></div></div><div class="champion-banner"><div><h3>${champTitle}</h3><p>每轮锁定风场：${activeMatch.roundWinds.map((w, i) => `R${i + 1} ${w.head >= 0 ? '+' : ''}${w.head.toFixed(1)}/${w.cross >= 0 ? '+' : ''}${w.cross.toFixed(1)}m/s`).join(' · ')}</p></div>${compNewPb ? '<span class="pb-tag mono">★ 刷新正式赛个人最佳！</span>' : pb ? `<span class="pb-tag mono">正式赛个人最佳 ${pb.score.toFixed(2)} ${unit} (${escapeHtml(pb.playerName)})</span>` : ''}</div><div class="canvas-wrap"><canvas id="comp-compare" width="960" height="600" aria-label="选手最佳轨迹对比"></canvas></div><div class="comp-board"><h3>三回合详细成绩</h3><table class="standings-table"><thead><tr><th>排名</th><th>选手</th><th>机型</th><th>第 1 投</th><th>第 2 投</th><th>第 3 投</th><th>最佳有效成绩</th></tr></thead><tbody>${rowsHtml}</tbody></table></div><div class="actions"><button id="comp-reconfig">重新配置赛制与选手</button><button id="comp-go-workshop">返回折纸工坊</button><span class="spacer"></span><button class="primary" id="comp-rematch-bottom">原班人马再来一场 →</button></div></section>`,
    );

    const compareCanvas = document.querySelector<HTMLCanvasElement>('#comp-compare')!;
    const entries: ComparisonFlightEntry[] = [];
    for (const s of standings) {
      if (!s.bestThrow || s.bestScore === null) continue;
      const key = `${s.player.id}-${s.bestThrow.round}`;
      let f = compThrowFlights.get(key);
      if (!f) {
        const pSheet = papers.find(p => p.id === activeMatch!.paper) ?? papers[0];
        const a = extract(replay(pSheet, planes[s.player.plane].steps.length, planes[s.player.plane].steps), activeMatch.gsm);
        f = simulate(a, s.bestThrow.launch, simOptions(activeMatch!.grade ?? 'copy', activeMatch!.gsm, 1));
      }
      entries.push({
        label: `#${s.rank} ${s.player.name} (${planes[s.player.plane].name})`, /* canvas-text:fillText 按文本渲染,不转义 */
        flight: f,
        scoreText: `${s.bestScore.toFixed(2)} ${unit}`,
      });
    }
    renderComparisonCanvas(compareCanvas, entries);

    const startRematch = () => {
      compSeed = (compSeed * 1664525 + 1013904223) >>> 0;
      activeMatch = createCompetitionMatch({
        event: activeMatch!.event,
        paper: activeMatch!.paper,
        gsm: activeMatch!.gsm,
        seed: compSeed,
        players: activeMatch!.players,
      });
      compLastRecord = null;
      compThrowRecorded = false;
      compThrowFlights = new Map();
      compNewPb = false;
      flight = null;
      flightMode = 'competition';
      gotoStage('flight');
      render();
    };
    document.querySelector<HTMLButtonElement>('#comp-rematch')!.onclick = startRematch;
    document.querySelector<HTMLButtonElement>('#comp-rematch-bottom')!.onclick = startRematch;
    document.querySelector<HTMLButtonElement>('#comp-reconfig')!.onclick = () => {
      activeMatch = null;
      compLastRecord = null;
      compThrowRecorded = false;
      flight = null;
      flightMode = 'competition';
      gotoStage('flight');
      render();
    };
    document.querySelector<HTMLButtonElement>('#comp-back-free')!.onclick = () => {
      flightMode = 'free';
      activeMatch = null;
      flight = null;
      gotoStage('flight');
      render();
    };
    document.querySelector<HTMLButtonElement>('#comp-go-workshop')!.onclick = () => {
      activeMatch = null;
      flight = null;
      gotoStage('paper');
      render();
    };
    return;
  }

  // Stage: Flight Arena (supports both Free Experiment and Official Local Competition)
  const isOfficialActive =
    flightMode === 'competition' &&
    activeMatch !== null &&
    (activeMatch.status === 'in-progress' || (activeMatch.status === 'finished' && compThrowRecorded));
  const activeTurn = isOfficialActive ? currentTurn(activeMatch!) : null;
  const lastCompPlayer =
    isOfficialActive && !activeTurn && compLastRecord
      ? activeMatch!.players.find(p => p.id === compLastRecord!.playerId) ?? activeMatch!.players[0]
      : null;
  // 生涯挑战:锁定机型/纸张/风况,精准赛开放角度与力度
  const career = careerActive && !isOfficialActive ? careerActive : null;
  // 治理 1.5(C-03):成绩提交后、用户未进入下一位之前,赛场必须继续以
  // 上一投的飞机/风况/参数展示上一投的轨迹,而不是已指向下一位的 currentTurn。
  const reviewing = isOfficialActive && compThrowRecorded ? compLastRecord : null;
  const activeSheet = career ? papers.find(p => p.id === career.paper) ?? papers[paper] : isOfficialActive ? (papers.find(p => p.id === activeMatch!.paper) ?? papers[paper]) : papers[paper];
  const activeGsm = career ? career.gsm : isOfficialActive ? activeMatch!.gsm : gsm;
  const activeGrade: PaperGradeId = career ? career.grade ?? 'copy' : isOfficialActive ? activeMatch!.grade ?? 'copy' : grade;
  const activePlaneId: PlaneId = career ? career.plane : reviewing ? reviewing.plane : activeTurn ? activeTurn.player.plane : lastCompPlayer ? lastCompPlayer.plane : plane;
  const activeWind = career ? career.wind : reviewing ? reviewing.launch.wind : activeTurn ? activeTurn.wind : compLastRecord ? compLastRecord.launch.wind : wind;
  const activeCross = career ? career.crosswind : reviewing ? reviewing.launch.crosswind ?? 0 : activeTurn ? activeTurn.crosswind : compLastRecord ? compLastRecord.launch.crosswind ?? 0 : crosswind;
  // 闭包(投掷/滑块/拖动)在渲染之后运行,必须动态读取模块状态而非渲染时的 const
  const currentCross = () => (career ? career.crosswind : isOfficialActive ? activeCross : crosswind);
  const currentWind = () => (career ? career.wind : isOfficialActive ? activeWind : wind);
  const buildThrowConfig = (): ThrowConfig => ({
    planeId: designProgram ? FREESTYLE_PLANE_ID : activePlaneId,
    paperId: activeSheet.id,
    gsm: activeGsm,
    grade: activeGrade,
    angle,
    speed,
    wind: currentWind(),
    crosswind: currentCross(),
    foldQuality,
    foldEngineVersion: FOLD_ENGINE_VERSION,
    flightModelVersion: FLIGHT_MODEL_VERSION,
  });
  const activeChallenge: Challenge = isOfficialActive && activeMatch!.event !== 'accuracy' ? activeMatch!.event : challenge;
  accuracyTargetDisplay = career?.event === 'accuracy' ? career.targetLine : isOfficialActive && activeMatch?.event === 'accuracy' ? activeMatch.accuracyTarget : undefined;

  if (flightMode === 'competition' && !isOfficialActive) {
    compSetupPlayers[0].plane = compSetupPlayers[0].plane || plane;
    const previewWinds = generateRoundWinds(compSeed, 3);
    const pbDist = loadCompetitionPb('distance');
    const pbDur = loadCompetitionPb('duration');
    const pbAcc = loadCompetitionPb('accuracy');
    const planeOptions = (selected: PlaneId) =>
      Object.values(planes)
        .map(p => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${p.name}</option>`)
        .join('');
    const playersHtml = compSetupPlayers
      .slice(0, compPlayerCount)
      .map(
        (pl, idx) => `<div class="comp-player-card"><label class="mono">选手 ${idx + 1} 姓名<input type="text" data-comp-name="${idx}" value="${escapeHtml(pl.name)}" maxlength="16"></label><label class="mono">参赛机型<select data-comp-plane="${idx}">${planeOptions(pl.plane)}</select></label></div>`,
      )
      .join('');

    shell(
      `<section><div class="section-head"><div><p class="eyebrow">02 / 飞行赛场 · 正式比赛</p><h2>配置本地飞行锦标赛</h2><p>同场比赛锁定纸张、克重、材质与确定性风场种子；每人 3 投取最佳有效成绩，隐藏落地预演。</p></div><div class="flight-head-tools"><button id="change">返回折纸工坊</button></div></div><div class="mode-switch"><button type="button" id="mode-free">自由实验模式</button><button type="button" id="mode-comp" class="selected" aria-pressed="true">正式比赛模式</button></div><div class="comp-setup"><div class="comp-row"><span>比赛项目：</span><button type="button" id="comp-ev-distance" class="${compEvent === 'distance' ? 'selected' : ''}">距离赛（3 投最佳水平距离）</button><button type="button" id="comp-ev-duration" class="${compEvent === 'duration' ? 'selected' : ''}">滞空赛（3 投最佳滞空时间）</button><button type="button" id="comp-ev-accuracy" class="${compEvent === 'accuracy' ? 'selected' : ''}">精准赛（3 投最佳落靶偏差）</button></div><div class="comp-row"><span>参赛人数：</span>${([1, 2, 3, 4] as const).map(n => `<button type="button" data-comp-count="${n}" class="${compPlayerCount === n ? 'selected' : ''}">${n === 1 ? '单人挑战' : `${n} 人轮流赛`}</button>`).join('')}</div><div class="comp-row"><span>本场锁定环境：</span><span class="mono">${papers[paper].name} · ${gsm} gsm · ${paperGrade(grade).name} · ${compEvent === 'accuracy' ? `靶线 ${accuracyTargetFromSeed(compSeed).toFixed(1)} m · ` : ''}风场种子 #${compSeed}（${previewWinds.map((w, i) => `R${i + 1}:${w.head >= 0 ? '+' : ''}${w.head.toFixed(1)}±${w.cross.toFixed(1)}`).join(' / ')} m/s）</span><button type="button" id="comp-reroll-seed">换一组风场</button></div><div class="comp-row"><span>同场锁定材质：</span>${grades.map(g => `<button type="button" data-comp-grade="${g.id}" class="${grade === g.id ? 'selected' : ''}">${g.name}</button>`).join('')}</div><div class="comp-row"><span>正式赛个人最佳：</span><span class="mono">距离 ${pbDist ? `${pbDist.score.toFixed(1)} m (${escapeHtml(pbDist.playerName)})` : '暂无'} · 滞空 ${pbDur ? `${pbDur.score.toFixed(1)} s (${escapeHtml(pbDur.playerName)})` : '暂无'} · 精准 ${pbAcc ? `距靶 ${pbAcc.score.toFixed(2)} m (${escapeHtml(pbAcc.playerName)})` : '暂无'}</span></div><div class="comp-players">${playersHtml}</div><div class="actions"><span>开赛后将锁定机型与风场环境</span><button class="primary" id="comp-start">开始正式比赛 →</button></div></div></section>`,
    );

    document.querySelector<HTMLButtonElement>('#mode-free')!.onclick = () => {
      flightMode = 'free';
      flight = null;
      render();
    };
    document.querySelector<HTMLButtonElement>('#change')!.onclick = () => {
      gotoStage('paper');
      render();
    };
    document.querySelector<HTMLButtonElement>('#comp-ev-distance')!.onclick = () => {
      compEvent = 'distance';
      render();
    };
    document.querySelector<HTMLButtonElement>('#comp-ev-duration')!.onclick = () => {
      compEvent = 'duration';
      render();
    };
    document.querySelector<HTMLButtonElement>('#comp-ev-accuracy')!.onclick = () => {
      compEvent = 'accuracy';
      render();
    };
    document.querySelectorAll<HTMLButtonElement>('[data-comp-count]').forEach(
      el =>
        (el.onclick = () => {
          compPlayerCount = Number(el.dataset.compCount) as 1 | 2 | 3 | 4;
          render();
        }),
    );
    document.querySelector<HTMLButtonElement>('#comp-reroll-seed')!.onclick = () => {
      compSeed = Math.floor(100000 + Math.random() * 899999);
      render();
    };
    document.querySelectorAll<HTMLButtonElement>('[data-comp-grade]').forEach(
      el =>
        (el.onclick = () => {
          const id = el.dataset.compGrade;
          if (!isPaperGradeId(id)) return;
          grade = id;
          render();
        }),
    );
    document.querySelectorAll<HTMLInputElement>('[data-comp-name]').forEach(
      el =>
        (el.oninput = () => {
          const idx = Number(el.dataset.compName);
          compSetupPlayers[idx].name = el.value;
        }),
    );
    document.querySelectorAll<HTMLSelectElement>('[data-comp-plane]').forEach(
      el =>
        (el.onchange = () => {
          const idx = Number(el.dataset.compPlane);
          compSetupPlayers[idx].plane = el.value as PlaneId;
        }),
    );
    document.querySelector<HTMLButtonElement>('#comp-start')!.onclick = () => {
      activeMatch = createCompetitionMatch({
        event: compEvent,
        paper: papers[paper].id,
        gsm,
        grade,
        seed: compSeed,
        players: compSetupPlayers.slice(0, compPlayerCount).map((p, i) => ({
          id: `p${i + 1}`,
          name: p.name.trim() || `选手 ${i + 1}`,
          plane: p.plane,
        })),
      });
      compLastRecord = null;
      compThrowRecorded = false;
      compThrowFlights = new Map();
      compNewPb = false;
      flight = null;
      const firstPlane = planes[activeMatch.players[0].plane];
      angle = firstPlane.recommendation.angle;
      speed = firstPlane.recommendation.speed;
      render();
    };
    return;
  }

  // 自由设计机型:由设计台折序合成,仅限自由实验模式(正式比赛仍用预设机型)
  const designProgram = flightDesign ? designToSteps(flightDesign) : null;
  const activePlaneDef = designProgram
    ? {
        id: FREESTYLE_PLANE_ID as PlaneId,
        name: flightDesign!.name,
        steps: designProgram,
        description: '',
        recommendation: {angle: 20, speed: 15, note: '自由设计机型：建议先以 15°–20° 仰角、中速试探，再按弹道微调。'},
      }
    : planes[activePlaneId];
  // Phase 04:手折误差以折痕偏移进入真实几何;调校以翼面投影进入气动
  const adjustedSteps = isOfficialActive ? activePlaneDef.steps : adjustProgram(activePlaneDef.steps, creaseAdjustments);
  const foldState = replay(activeSheet, adjustedSteps.length, adjustedSteps);
  const aero = trimAero(extract(foldState, activeGsm), trim);
  lastViewFaces = foldState.viewFaces3d ?? foldState.massFaces3d ?? null;
  const metrics = aeroMetrics(aero);
  const wingSides = wingSideAnalysis(foldState);
  const stackInfo = foldStackStats(activeSheet, adjustedSteps, adjustedSteps.length);
  const structural = structuralStiffness(materialProfile(activeGrade, activeGsm), stackInfo.maxStackLayers);
  // v4:自由模式携带玩家手折的折痕质量;正式比赛用预设折序(完美折痕)。
  const foldQuality = isOfficialActive ? 1 : programFoldQuality(activePlaneDef.steps, foldScores);
  const options = simOptions(activeGrade, activeGsm, foldQuality);
  const launchConfig: ThrowConfig = buildThrowConfig();
  let preview = simulate(aero, {angle: launchConfig.angle, speed: launchConfig.speed, wind: launchConfig.wind, crosswind: launchConfig.crosswind}, options);
  const analysis = analyzeFlight(flight ?? preview, aero, launchConfig, previousFlight);
  const sharedMessage =
    !isOfficialActive && sharedResult
      ? `分享的成绩：${sharedResult.distance.toFixed(1)} m · ${sharedResult.duration.toFixed(1)} s · 最高 ${sharedResult.height.toFixed(1)} m。${preview.landed && matchesSharedResult(sharedResult, preview) ? '当前模型可复现。' : '当前模型结果不同，可能来自其他版本。'}`
      : '';

  const compBannerHtml = isOfficialActive
    ? reviewing
      ? `<div class="comp-banner"><div><strong>上一投结果 · 第 ${reviewing.round} 轮 · ${escapeHtml(reviewing.plane ? planes[reviewing.plane].name : '')}</strong><br><span>${reviewing.valid ? `有效成绩 ${reviewing.score!.toFixed(2)} ${activeMatch!.event === 'duration' ? 's' : 'm'}` : `无效:${reviewing.invalidReason}`} · 风场 ${reviewing.launch.wind >= 0 ? '+' : ''}${reviewing.launch.wind.toFixed(1)} / 侧风 ${reviewing.launch.crosswind ?? 0 >= 0 ? '+' : ''}${(reviewing.launch.crosswind ?? 0).toFixed(1)} m/s · 回放与诊断均使用该投掷的配置</span></div><button type="button" id="comp-review-next">${activeMatch!.status === 'finished' ? '查看冠军结算 →' : '下一位选手 →'}</button></div>`
      : activeTurn
      ? `<div class="comp-banner"><div><strong>第 ${activeTurn.round} / ${activeMatch!.rounds} 轮 · ${escapeHtml(activeTurn.player.name)}（${activePlaneDef.name}）</strong><br><span>${activeMatch!.event === 'distance' ? '距离赛' : activeMatch!.event === 'accuracy' ? `精准赛 · 靶线 ${activeMatch!.accuracyTarget?.toFixed(1) ?? '?'} m` : '滞空赛'} · 锁定环境 ${activeSheet.name} ${activeGsm}g ${paperGrade(activeGrade).name} · 本轮风场 ${activeTurn.wind >= 0 ? '+' : ''}${activeTurn.wind.toFixed(1)} / 侧风 ${activeTurn.crosswind >= 0 ? '+' : ''}${activeTurn.crosswind.toFixed(1)} m/s · 种子 #${activeMatch!.seed}</span></div><button type="button" id="comp-abort">中途退赛</button></div>`
      : `<div class="comp-banner"><div><strong>全部 ${activeMatch!.rounds} 轮投掷已完成！</strong><br><span>点击下方「查看冠军结算 →」进入排行榜与轨迹对比</span></div><button type="button" id="comp-abort">返回配置</button></div>`
    : '';

  const liveStandingsHtml = isOfficialActive
    ? `<div class="comp-board"><h3>当前实时排名</h3><table class="standings-table"><thead><tr><th>排名</th><th>选手</th><th>机型</th><th>已投</th><th>最佳有效成绩</th></tr></thead><tbody>${computeStandings(activeMatch!)
        .map(
          s =>
            `<tr class="${s.rank === 1 && s.bestScore !== null ? 'leader' : ''}"><td class="mono">${s.bestScore === null ? '—' : s.tied ? `T${s.rank}` : `#${s.rank}`}</td><td>${escapeHtml(s.player.name)}</td><td>${planes[s.player.plane].name}</td><td class="mono">${s.throws.length} / ${activeMatch!.rounds}</td><td class="mono">${s.bestScore !== null ? `${s.bestScore.toFixed(2)} ${activeMatch!.event === 'duration' ? 's' : 'm'}` : '—'}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : '';

  const nextTurnActionHtml =
    isOfficialActive && compThrowRecorded && activeMatch
      ? `<button class="primary" id="comp-next-turn">${activeMatch.status === 'finished' ? '查看冠军结算 →' : '下一位选手 / 下一投 →'}</button>`
      : `<button class="primary" id="throw">${flight ? (isOfficialActive ? '飞行中…' : '再次投掷 →') : '投掷纸飞机 →'}</button>`;

  shell(
    `<section><div class="section-head"><div><p class="eyebrow">02 / 飞行赛场${isOfficialActive ? ' · 正式比赛' : career ? ' · 生涯挑战' : ''}</p><h2>${isOfficialActive ? (activeTurn ? `${escapeHtml(activeTurn.player.name)} 上场投掷` : '本场比赛投掷结束') : career ? `生涯挑战 · ${career.title}` : '给它一次飞行'}</h2><p>${activeSheet.name} · ${activeGsm} gsm · ${paperGrade(activeGrade).name} · ${activePlaneDef.name}</p></div><div class="flight-head-tools"><button type="button" id="toggle-topview" class="${topView ? 'selected' : ''}" aria-pressed="${topView}">${topView ? '俯视：开' : '俯视：关'}</button><button type="button" id="toggle-3d" class="${use3D ? 'selected' : ''}" aria-pressed="${use3D}">${use3D ? '三维视图：开' : '三维视图：关'}</button><button type="button" id="toggle-camera" class="${followCamera ? 'selected' : ''}" aria-pressed="${followCamera}">${followCamera ? '跟随相机：开' : '跟随相机：关'}</button>${isOfficialActive ? '' : designProgram ? '<button id="design-return">返回设计台</button>' : '<button id="change">换纸重折</button>'}</div></div>${!isOfficialActive && !designProgram && !career ? `<div class="mode-switch"><button type="button" id="mode-free" class="selected" aria-pressed="true">自由实验模式</button><button type="button" id="mode-comp">正式比赛模式（1–4 人）</button></div>` : ''}${career ? `<div class="comp-banner"><div><strong>${career.title}</strong><br><span>${career.description} 目标：${career.event === 'accuracy' ? `距靶 ≤ ${career.target} m(靶线 ${career.targetLine} m)` : `${career.event === 'distance' ? '距离' : '滞空'} ≥ ${career.target}${career.event === 'duration' ? ' s' : ' m'}`} · ${planes[career.plane].name} · ${career.wind !== 0 ? `逆风 ${career.wind} m/s · ` : ''}${career.crosswind !== 0 ? `侧风 ${career.crosswind} m/s · ` : ''}${career.event === 'accuracy' && career.angle === undefined ? '角度与力度由你调整' : `投掷 ${career.angle}°/${career.speed} m/s`}</span></div><button type="button" id="career-exit">退出挑战</button></div>` : ''}${compBannerHtml}${!isOfficialActive && legacyMessage ? `<p class="legacy-share" role="status">${legacyMessage}</p>` : ''}${sharedMessage ? `<p class="shared-result">${sharedMessage}</p>` : ''}<div class="canvas-wrap"><canvas id="flight" class="${!flight ? 'interactive-fold' : ''} ${use3D ? 'hidden-canvas' : ''}" width="960" height="600" aria-label="飞行轨迹与试飞场"></canvas><canvas id="flight3d" class="${use3D ? '' : 'hidden-canvas'}" aria-label="三维飞行视图"></canvas><div class="confetti" aria-hidden="true">${Array.from({length: 24}, (_, i) => `<i style="--x:${(i * 41) % 100}%;--delay:${(i % 6) * 0.08}s;--colour:${['var(--paper)', 'var(--mark-red)', 'var(--ink)'][i % 3]}"></i>`).join('')}</div></div><p class="ghost-note">${isOfficialActive ? '正式比赛已隐藏落地预演虚线：在画布上向后下方拖动蓄力，松手即投掷。' : '在画布上向后下方拖动蓄力，松手即投掷；下方滑块可供精确实验微调。'}</p>${!isOfficialActive ? `<div class="challenge"><span>选择挑战</span><button id="distance-challenge" class="${challenge === 'distance' ? 'selected' : ''}" aria-pressed="${challenge === 'distance'}">距离赛 · 88.3 m 里程碑 / 98.4 m WR</button><button id="duration-challenge" class="${challenge === 'duration' ? 'selected' : ''}" aria-pressed="${challenge === 'duration'}">滞空赛 · 29.2 s 里程碑 / 31.2 s WR</button><p id="challenge-result">${flight ? '挑战结算将在落地后显示' : '调整投掷，挑战历史里程碑与世界纪录'}</p></div>` : `<p id="challenge-result" class="ghost-note">${compLastRecord ? (compLastRecord.valid ? `本投有效成绩：${compLastRecord.score!.toFixed(2)} ${activeMatch!.event === 'duration' ? 's' : 'm'}${activeMatch!.event === 'accuracy' ? '（距靶）' : ''}` : `本投无效：${compLastRecord.invalidReason}`) : activeMatch!.event === 'accuracy' ? `将落点投到朱红靶线（${activeMatch!.accuracyTarget?.toFixed(1) ?? '?'} m）附近，越近越好` : '请拖动蓄力或调整角度与力度后投掷'}</p>`}<div class="flight-status">${flight ? '试飞完成' : '准备起飞 · 拖动蓄力或调整滑块'} <span class="mono">${isOfficialActive ? (activeTurn ? `第 ${activeTurn.round}/${activeMatch!.rounds} 轮` : `全部 ${activeMatch!.rounds} 轮完成`) : designProgram ? `自由设计 · ${escapeHtml(flightDesign!.name)}` : `个人最佳 ${bestLabel()}`}</span></div><div class="results" aria-live="polite"><div><small>飞行距离</small><strong>${flight ? flight.distance.toFixed(1) : '—'} <em>m</em></strong></div><div><small>滞空时间</small><strong>${flight ? flight.duration.toFixed(1) : '—'} <em>s</em></strong></div><div><small>最高高度</small><strong>${flight ? flight.height.toFixed(1) : '—'} <em>m</em></strong></div></div>${liveStandingsHtml}${!isOfficialActive ? `<div class="controls trim-controls">${slider('trim-left', '左上反角', -10, 10, trim.dihedralLeft, '°')}${slider('trim-right', '右上反角', -10, 10, trim.dihedralRight, '°')}${slider('trim-te', '后缘上翘', -8, 8, trim.trailingEdge, '°')}</div>` : ''}<div class="controls">${slider('angle', '投掷角度', 0, 75, angle, '°', career?.angle !== undefined)}${slider('speed', '投掷力度', 6, 28, speed, ' m/s', career?.speed !== undefined)}${isOfficialActive || career ? `<label><span>锁定风速 <b class="mono">${activeWind >= 0 ? '+' : ''}${activeWind.toFixed(1)} m/s · 侧风 ${activeCross >= 0 ? '+' : ''}${activeCross.toFixed(1)} m/s</b></span><input id="wind" type="range" min="-4" max="4" step="0.5" value="${activeWind}" disabled></label>` : `${slider('wind', '风速（顺风为正）', -4, 4, wind, ' m/s')}${slider('crosswind', '侧风（右为正）', -4, 4, crosswind, ' m/s')}`}</div>${!isOfficialActive ? `<div class="wind-presets"><span>风场速设：</span>${[-3, 0, 3].map(w => `<button type="button" class="wind-preset ${wind === w ? 'selected' : ''}" data-wind="${w}">${w < 0 ? `逆风 ${w}` : w === 0 ? '无风 0' : `顺风 +${w}`} m/s</button>`).join('')}</div><div class="recommendation"><p><b>投掷起点：</b>${activePlaneDef.recommendation.note}</p><button id="apply-recommendation">采用建议角度与力度</button></div>` : ''}<div class="actions"><span>${isOfficialActive ? '正式赛同场环境已锁定' : designProgram ? '自由设计 · 成绩仅在本地记录' : '虚线为预演轨迹 · 正风速为顺风'}</span>${!isOfficialActive && !designProgram && !career ? '<button id="share">分享这次配置</button>' : ''}${career ? '<button id="career-exit">退出挑战</button>' : ''}${flight ? `<button id="pause-flight">${flightPaused ? '继续飞行' : '暂停'}</button><button id="slow-replay">慢动作回放 0.4×</button>` : ''}${nextTurnActionHtml}</div><details class="physics aero-deep-panel"><summary>高级分析：受力矢量、极曲线、轨迹诊断与几何参数</summary><div class="flight-head-tools" style="margin:10px 0"><button type="button" id="toggle-forces" class="${showForces ? 'selected' : ''}" aria-pressed="${showForces}">${showForces ? '受力矢量：开' : '受力矢量：关'}</button><button type="button" id="toggle-polar" class="${showPolar ? 'selected' : ''}" aria-pressed="${showPolar}">${showPolar ? '极曲线图：开' : '极曲线图：关'}</button></div><div class="flight-diagnostic" id="flight-diagnostic"><div class="diag-head"><span class="mono diag-regime">${analysis.regimeLabel}</span>${analysis.comparison ? `<span class="mono diag-compare">${analysis.comparison.summary}</span>` : ''}</div><p id="diag-verdict">${analysis.verdict}</p></div><div id="aero-deep-content">${renderAeroDeepHtml(flight ?? preview, aero, launchConfig, designProgram ? FREESTYLE_PLANE_ID : activePlaneId)}</div><div class="physics-grid" style="margin-top:12px"><span>材质 <b class="mono">${paperGrade(activeGrade).name}</b></span><span>厚度 <b class="mono">${(materialProfile(activeGrade, activeGsm).thickness * 1e6).toFixed(0)} µm</b></span><span>折痕利落度 <b class="mono">${(materialProfile(activeGrade, activeGsm).creaseCrispness * 100).toFixed(0)}%<small>（经验代理）</small></b></span><span>折痕质量 <b class="mono">${(foldQuality * 100).toFixed(0)}%<small>（诊断）</small></b></span><span>左翼面积 <b class="mono">${(wingSides.leftArea * 10000).toFixed(1)} cm²</b></span><span>右翼面积 <b class="mono">${(wingSides.rightArea * 10000).toFixed(1)} cm²</b></span><span>对称度 <b class="mono">${((1 - wingSides.asymmetry) * 100).toFixed(1)}%</b></span><span>峰值折层 <b class="mono">${stackInfo.maxStackLayers} 层</b></span><span>结构刚度 <b class="mono">${(structural.nominal * 1e3).toFixed(2)} mN·m<small>（估算 ${structural.slip.toExponential(1)}–${structural.bonded.toExponential(1)}）</small></b></span><span>质量 <b class="mono">${(aero.mass * 1000).toFixed(2)} g</b></span><span>翼展 <b class="mono">${(aero.span * 100).toFixed(1)} cm</b></span><span>翼面积 <b class="mono">${(aero.wingArea * 10000).toFixed(0)} cm²</b></span><span>展弦比 <b class="mono">${aero.aspectRatio.toFixed(2)}</b></span><span>重心（距机头） <b class="mono">${((aero.cg.y - aero.noseY) * 100).toFixed(1)} cm</b></span><span>静稳定余量 <b class="mono">${(metrics.staticMargin * 100).toFixed(1)}%</b></span><span>翼载荷 <b class="mono">${metrics.wingLoading.toFixed(2)} N/m²</b></span><span>龙骨深度 <b class="mono">${(metrics.keelDepth * 100).toFixed(1)} cm</b></span><span>基准滑翔速 <b class="mono">${metrics.nominalGlideSpeed.toFixed(1)} m/s</b></span></div></details></section>`,
  );
  drawFlight(preview, flight, aero, activeWind, activeChallenge, isOfficialActive, activeCross);

  const launchNow = (launchAngle: number, launchSpeed: number) => {
    if (isOfficialActive && compThrowRecorded) return;
    cancelAnimationFrame(animation);
    sound.activate();
    angle = launchAngle;
    speed = launchSpeed;
    sharedResult = undefined;
    landingSoundPlayed = false;
    celebrated = false;
    careerEvaluated = false;
    flightPaused = false;
    pausedElapsed = 0;
    chargeState = null;
    playbackRate = E2E_PLAYBACK_RATE;
    if (flight) previousFlight = flight;
    activeGhost = isOfficialActive || flightDesign ? null : getGhost(challenge);
    const launchCfg = buildThrowConfig();
    preview = simulate(aero, {angle: launchCfg.angle, speed: launchCfg.speed, wind: launchCfg.wind, crosswind: launchCfg.crosswind}, options);
    flight = preview;
    playStart = performance.now();
    render();
  };

  // Drag-to-charge slingshot throw on the flight canvas (desktop mouse + mobile touch)
  const flightCanvas = document.querySelector<HTMLCanvasElement>('#flight')!;
  let chargePointerId: number | null = null;
  let chargeAnchor: CanvasPoint = {x: 120, y: 420};
  const toFlightCanvasPt = (e: PointerEvent): CanvasPoint => {
    const rect = flightCanvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * 960,
      y: ((e.clientY - rect.top) / Math.max(1, rect.height)) * 600,
    };
  };
  flightCanvas.onpointerdown = e => {
    // Allow drag-to-charge when ready (no flight) or after previous flight has finished (in free mode)
    if (isOfficialActive && (flight !== null || compThrowRecorded)) return;
    const finished = !flight || reduced.matches || currentElapsed(flight) >= flight.duration;
    if (!finished || chargePointerId !== null) return;
    const pt = toFlightCanvasPt(e);
    if (pt.y > 530) return;
    sound.activate();
    if (flight) {
      flight = null;
      flightPaused = false;
      pausedElapsed = 0;
    }
    chargePointerId = e.pointerId;
    chargeAnchor = flightLaunchAnchor(preview, null, isOfficialActive ? null : getGhost(challenge), isOfficialActive);
    const anchor = Math.hypot(pt.x - chargeAnchor.x, pt.y - chargeAnchor.y) <= 90 ? chargeAnchor : pt;
    chargeAnchor = anchor;
    const res = mapDragToThrow(chargeAnchor, pt);
    chargeState = {anchor: chargeAnchor, pointer: pt, result: res};
    flightCanvas.classList.add('dragging');
    flightCanvas.setPointerCapture?.(e.pointerId);
    drawFlight(preview, null, aero, activeWind, activeChallenge, isOfficialActive, activeCross);
  };
  flightCanvas.onpointermove = e => {
    if (chargePointerId !== e.pointerId) return;
    const pt = toFlightCanvasPt(e);
    const res = mapDragToThrow(chargeAnchor, pt);
    chargeState = {anchor: chargeAnchor, pointer: pt, result: res};
    if (res.ready) {
      angle = res.angle;
      speed = res.speed;
      const dragCfg = buildThrowConfig();
      preview = simulate(aero, {angle: dragCfg.angle, speed: dragCfg.speed, wind: dragCfg.wind, crosswind: dragCfg.crosswind}, options);
      const angleInput = document.querySelector<HTMLInputElement>('#angle');
      const speedInput = document.querySelector<HTMLInputElement>('#speed');
      if (angleInput) {
        angleInput.value = String(angle);
        const b = angleInput.closest('label')?.querySelector('b');
        if (b) b.textContent = `${angle}°`;
      }
      if (speedInput) {
        speedInput.value = String(speed);
        const b = speedInput.closest('label')?.querySelector('b');
        if (b) b.textContent = `${speed} m/s`;
      }
    }
    drawFlight(preview, null, aero, activeWind, activeChallenge, isOfficialActive, activeCross);
  };
  const endCharge = (e: PointerEvent, cancelled: boolean) => {
    if (chargePointerId !== e.pointerId) return;
    chargePointerId = null;
    flightCanvas.classList.remove('dragging');
    const pt = toFlightCanvasPt(e);
    const res = mapDragToThrow(chargeAnchor, pt);
    chargeState = null;
    if (!cancelled && res.ready) {
      launchNow(res.angle, res.speed);
    } else {
      drawFlight(preview, flight, aero, activeWind, activeChallenge, isOfficialActive, activeCross);
    }
  };
  flightCanvas.onpointerup = e => endCharge(e, false);
  flightCanvas.onpointercancel = e => endCharge(e, true);

  const modeCompBtn = document.querySelector<HTMLButtonElement>('#mode-comp');
  if (modeCompBtn) {
    modeCompBtn.onclick = () => {
      sound.wind(0);
      flightMode = 'competition';
      compSetupPlayers[0].plane = plane;
      flight = null;
      render();
    };
  }
  const compAbortBtn = document.querySelector<HTMLButtonElement>('#comp-abort');
  if (compAbortBtn) {
    compAbortBtn.onclick = () => {
      sound.wind(0);
      if (activeMatch) activeMatch = abortCompetitionMatch(activeMatch);
      flight = null;
      compLastRecord = null;
      compThrowRecorded = false;
      render();
    };
  }
  // 回看横幅与操作行的“下一位”按钮共享同一处理器(治理 1.11:e2e 曾抓到重复 ID 死按钮)
  const nextTurnHandler = () => {
    sound.wind(0);
    if (!activeMatch) return;
    flight = null;
    compLastRecord = null;
    compThrowRecorded = false;
    if (activeMatch.status === 'finished') {
      gotoStage('settlement');
    } else {
      const nextT = currentTurn(activeMatch);
      if (nextT) {
        angle = planes[nextT.player.plane].recommendation.angle;
        speed = planes[nextT.player.plane].recommendation.speed;
      }
    }
    render();
  };
  document.querySelectorAll<HTMLButtonElement>('#comp-next-turn, #comp-review-next').forEach(btn => (btn.onclick = nextTurnHandler));

  const careerExitBtn = document.querySelector<HTMLButtonElement>('#career-exit');
  if (careerExitBtn) {
    careerExitBtn.onclick = () => {
      sound.wind(0);
      careerActive = null;
      flight = null;
      previousFlight = null;
      gotoStage('career');
      render();
    };
  }
  const designReturnBtn = document.querySelector<HTMLButtonElement>('#design-return');
  if (designReturnBtn) {
    designReturnBtn.onclick = () => {
      sound.wind(0);
      flight = null;
      previousFlight = null;
      gotoStage('design');
      render();
    };
  }
  const toggle3dBtn = document.querySelector<HTMLButtonElement>('#toggle-3d');
  if (toggle3dBtn) {
    toggle3dBtn.onclick = () => {
      use3D = !use3D;
      if (!use3D) {
        view3d?.ctrl.dispose();
        view3d = null;
        render();
        return;
      }
      // 首次开启:按需加载三维模块(代码分割),加载完成前保持 2D
      if (!flight3dModule) {
        toggle3dBtn.textContent = '三维视图：加载中…';
        import('./render/flight3d')
          .then(m => {
            flight3dModule = m;
            render();
          })
          .catch(() => {
            use3D = false;
            render();
          });
      } else {
        render();
      }
    };
  }
  const topViewBtn = document.querySelector<HTMLButtonElement>('#toggle-topview');
  if (topViewBtn) {
    topViewBtn.onclick = () => {
      topView = !topView;
      topViewBtn.classList.toggle('selected', topView);
      topViewBtn.setAttribute('aria-pressed', String(topView));
      topViewBtn.textContent = topView ? '俯视：开' : '俯视：关';
      cancelAnimationFrame(animation);
      drawFlight(preview, flight, aero, activeWind, activeChallenge, isOfficialActive, activeCross);
    };
  }
  const cameraBtn = document.querySelector<HTMLButtonElement>('#toggle-camera')!;
  cameraBtn.onclick = () => {
    followCamera = !followCamera;
    cameraBtn.classList.toggle('selected', followCamera);
    cameraBtn.setAttribute('aria-pressed', String(followCamera));
    cameraBtn.textContent = followCamera ? '跟随相机：开' : '跟随相机：关';
    cancelAnimationFrame(animation);
    drawFlight(preview, flight, aero, activeWind, activeChallenge, isOfficialActive, activeCross);
  };
  const forcesBtn = document.querySelector<HTMLButtonElement>('#toggle-forces');
  if (forcesBtn) {
    forcesBtn.onclick = () => {
      showForces = !showForces;
      forcesBtn.classList.toggle('selected', showForces);
      forcesBtn.setAttribute('aria-pressed', String(showForces));
      forcesBtn.textContent = showForces ? '受力矢量：开' : '受力矢量：关';
      cancelAnimationFrame(animation);
      drawFlight(preview, flight, aero, activeWind, activeChallenge, isOfficialActive, activeCross);
    };
  }
  const polarBtn = document.querySelector<HTMLButtonElement>('#toggle-polar');
  if (polarBtn) {
    polarBtn.onclick = () => {
      showPolar = !showPolar;
      polarBtn.classList.toggle('selected', showPolar);
      polarBtn.setAttribute('aria-pressed', String(showPolar));
      polarBtn.textContent = showPolar ? '极曲线图：开' : '极曲线图：关';
      cancelAnimationFrame(animation);
      drawFlight(preview, flight, aero, activeWind, activeChallenge, isOfficialActive, activeCross);
    };
  }
  document.querySelectorAll<HTMLButtonElement>('[data-wind]').forEach(
    el =>
      (el.onclick = () => {
        if (isOfficialActive) return;
        wind = Number(el.dataset.wind);
        sharedResult = undefined;
        legacyMessage = '';
        flight = null;
        activeGhost = null;
        sound.wind(0);
        render();
      }),
  );
  const applyRecBtn = document.querySelector<HTMLButtonElement>('#apply-recommendation');
  if (applyRecBtn) {
    applyRecBtn.onclick = () => {
      angle = activePlaneDef.recommendation.angle;
      speed = activePlaneDef.recommendation.speed;
      sharedResult = undefined;
      legacyMessage = '';
      flight = null;
      activeGhost = null;
      render();
      document.querySelector<HTMLButtonElement>('#apply-recommendation')?.focus();
    };
  }
  for (const mode of ['distance', 'duration'] as const) {
    const modeBtn = document.querySelector<HTMLButtonElement>('#' + mode + '-challenge');
    if (modeBtn) {
      modeBtn.onclick = () => {
        challenge = mode;
        flight = null;
        activeGhost = null;
        sound.wind(0);
        render();
      };
    }
  }
  for (const id of ['angle', 'speed', 'wind', 'crosswind', 'trim-left', 'trim-right', 'trim-te']) {
    const el = document.querySelector<HTMLInputElement>('#' + id);
    if (!el || el.disabled) continue;
    el.oninput = () => {
      if (id === 'angle') angle = +el.value;
      if (id === 'speed') speed = +el.value;
      if (id === 'wind') wind = +el.value;
      if (id === 'crosswind') crosswind = +el.value;
      if (id === 'trim-left') { trim = validateTrim({...trim, dihedralLeft: +el.value}); flight = null; render(); return; }
      if (id === 'trim-right') { trim = validateTrim({...trim, dihedralRight: +el.value}); flight = null; render(); return; }
      if (id === 'trim-te') { trim = validateTrim({...trim, trailingEdge: +el.value}); flight = null; render(); return; }
      sharedResult = undefined;
      legacyMessage = '';
      if (!isOfficialActive) {
        flight = null;
        activeGhost = null;
      }
      sound.wind(0);
      const value = el.closest('label')?.querySelector('b');
      if (value) value.textContent = el.value + (id === 'angle' ? '°' : ' m/s');
      document.querySelector('.shared-result')?.remove();
      document.querySelector('.legacy-share')?.remove();
      document.querySelector('#flight')?.parentElement?.classList.remove('celebrate');
      const status = document.querySelector('.flight-status');
      if (status && !isOfficialActive) {
        status.innerHTML = '准备起飞 · 拖动蓄力或调整滑块，查看虚线预演 <span class="mono">个人最佳 ' + bestLabel() + '</span>';
      }
      const result = document.querySelector('#challenge-result');
      if (result && !isOfficialActive) result.textContent = '调整投掷，挑战历史成绩';
      if (!isOfficialActive) {
        document.querySelectorAll('.results strong').forEach((node, i) => {
          node.innerHTML = '— <em>' + ['m', 's', 'm'][i] + '</em>';
        });
      }
      const launch = document.querySelector<HTMLButtonElement>('#throw');
      if (launch && !isOfficialActive) launch.textContent = '投掷纸飞机 →';
      const share = document.querySelector<HTMLButtonElement>('#share');
      if (share) share.textContent = '分享这次配置';
      const cfg = buildThrowConfig();
      preview = simulate(aero, {angle: cfg.angle, speed: cfg.speed, wind: cfg.wind, crosswind: cfg.crosswind}, options);
      const liveAnalysis = analyzeFlight(preview, aero, cfg, previousFlight);
      const diagRegime = document.querySelector('.diag-regime');
      if (diagRegime) diagRegime.textContent = liveAnalysis.regimeLabel;
      const diagVerdict = document.querySelector('#diag-verdict');
      if (diagVerdict) diagVerdict.textContent = liveAnalysis.verdict;
      const deepContent = document.querySelector('#aero-deep-content');
      if (deepContent) deepContent.innerHTML = renderAeroDeepHtml(preview, aero, buildThrowConfig(), designProgram ? FREESTYLE_PLANE_ID : activePlaneId);
      drawFlight(preview, isOfficialActive ? flight : null, aero, activeWind, activeChallenge, isOfficialActive);
    };
  }
  const throwBtn = document.querySelector<HTMLButtonElement>('#throw');
  if (throwBtn) {
    throwBtn.onclick = () => {
      launchNow(angle, speed);
    };
  }
  const pauseBtn = document.querySelector<HTMLButtonElement>('#pause-flight');
  if (pauseBtn) {
    pauseBtn.onclick = () => {
      if (!flight) return;
      const cur = currentElapsed(flight);
      if (cur >= flight.duration) return;
      if (!flightPaused) {
        pausedElapsed = cur;
        flightPaused = true;
        cancelAnimationFrame(animation);
        sound.wind(0);
      } else {
        flightPaused = false;
        playStart = performance.now() - (pausedElapsed / playbackRate) * 1000;
      }
      pauseBtn.textContent = flightPaused ? '继续飞行' : '暂停';
      drawFlight(preview, flight, aero, activeWind, activeChallenge, isOfficialActive, activeCross);
    };
  }
  const slowBtn = document.querySelector<HTMLButtonElement>('#slow-replay');
  if (slowBtn) {
    slowBtn.onclick = () => {
      if (!flight) return;
      cancelAnimationFrame(animation);
      sound.activate();
      landingSoundPlayed = false;
      flightPaused = false;
      pausedElapsed = 0;
      playbackRate = 0.4; // 慢动作回放显式半速以下,与 e2e 提速互斥
      playStart = performance.now();
      render();
    };
  }
  const shareBtn = document.querySelector<HTMLButtonElement>('#share');
  if (shareBtn) {
    shareBtn.onclick = () => {
      const score = resultForShare(
        flight,
        !!flight && (reduced.matches || currentElapsed(flight) >= flight.duration),
        sharedResult,
      );
      const hash = encodeFlight({
        version: 1,
        plane,
        paper: papers[paper].id,
        gsm: gsm as 70 | 80 | 100,
        grade,
        angle,
        speed,
        wind,
        ...(crosswind !== 0 ? {crosswind} : {}),
        ...(Object.keys(creaseAdjustments).length ? {creases: creaseAdjustments} : {}),
        ...(trim.dihedralLeft !== 0 || trim.dihedralRight !== 0 || trim.trailingEdge !== 0 || trim.winglet !== 0 ? {trim} : {}),
        step: currentPlane().steps.length,
        challenge,
        ...(score ? {result: score} : {}),
      });
      history.replaceState(null, '', hash);
      (navigator.clipboard?.writeText(location.href) ?? Promise.reject()).then(
        () => (shareBtn.textContent = '链接已复制'),
        () => (shareBtn.textContent = '请复制地址栏链接'),
      );
    };
  }
  const changeBtn = document.querySelector<HTMLButtonElement>('#change');
  if (changeBtn) {
    changeBtn.onclick = () => {
      sound.wind(0);
      sharedResult = undefined;
      legacyMessage = '';
      flight = null;
      previousFlight = null;
      gotoStage('paper');
      render();
    };
  }
}



function advance() {
  sound.activate();
  const program = currentPlane().steps;
  if (animating || foldHistory.cursor.step >= program.length) {
    auto = false;
    render();
    return;
  }
  const animateSingleSubOp = manualFoldMode && !auto && foldHistory.cursor.subOp > 0;
  animating = true;
  render();
  const start = performance.now();
  const duration = reduced.matches ? 0 : animateSingleSubOp ? 500 : 800;
  function tick(now: number) {
    const p = duration ? Math.min(1, (now - start) / duration) : 1;
    drawFold(p, !animateSingleSubOp);
    if (p < 1) {
      animation = requestAnimationFrame(tick);
    } else {
      sound.fold();
      // 自动演示/按钮推进的子操作按设计完成,计满分(v4 折痕质量通道)。
      foldScores.set(`${foldHistory.cursor.step}:${foldHistory.cursor.subOp}`, 1);
      const targetCursor = animateSingleSubOp
        ? nextCursor(foldHistory.cursor, program)
        : {step: foldHistory.cursor.step + 1, subOp: 0};
      foldHistory = pushHistory(foldHistory, targetCursor);
      step = foldHistory.cursor.step;
      foldHint = false;
      dragStatus = 'idle';
      dragProgress = 0;
      animating = false;
      if (step >= program.length) auto = false;
      render();
      if (auto && step < program.length) {
        setTimeout(() => {
          if (auto && stage === 'fold') advance();
        }, 250);
      }
    }
  }
  animation = requestAnimationFrame(tick);
}

function drawFold(progress = 0, forceFullStepAnim = false) {
  const canvas = document.querySelector<HTMLCanvasElement>('#fold');
  if (!canvas) return;
  const program = currentPlane().steps;
  const target =
    foldViewMode === 'folded' && foldHistory.cursor.step < program.length
      ? resolveInteractiveTarget(papers[paper], program, foldHistory.cursor)
      : null;
  renderFoldCanvas(canvas, papers[paper], program, foldHistory.cursor.step, progress, gsm, foldViewMode, {
    subOp: forceFullStepAnim ? 0 : foldHistory.cursor.subOp,
    manualMode: manualFoldMode && !forceFullStepAnim,
    showHint: foldHint,
    dragStatus,
    target,
  });
}

/** 自由设计台画布:完成态渲染 + 已画折痕叠加 + 待完成折痕的起点标记。 */
function drawDesignCanvas() {
  const canvas = document.querySelector<HTMLCanvasElement>('#fold');
  if (!canvas || !design) return;
  const sheet = papers[paper];
  const program = designToSteps(design);
  renderFoldCanvas(canvas, sheet, program, program.length, 0, gsm, 'folded', {
    subOp: 0,
    manualMode: false,
    showHint: false,
    dragStatus: 'idle',
    target: null,
  });
  const c = canvas.getContext('2d')!;
  const vp = foldViewport(sheet);
  const toCanvas = (x: number, y: number) => vp.toCanvas(x, y);
  for (const crease of design.creases) {
    const [ax, ay] = crease.a;
    const p1 = toCanvas(ax * sheet.width, ay * sheet.height);
    const p2 = toCanvas(crease.b[0] * sheet.width, crease.b[1] * sheet.height);
    c.save();
    c.strokeStyle = crease.kind === 'valley' ? '#1F3A5F' : '#D9482B';
    c.setLineDash(crease.kind === 'valley' ? [7, 6] : [10, 4, 2, 4]);
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(p1.x, p1.y);
    c.lineTo(p2.x, p2.y);
    c.stroke();
    c.restore();
  }
  if (designPending) {
    const p = toCanvas(designPending.x, designPending.y);
    c.save();
    c.strokeStyle = '#C9A227';
    c.lineWidth = 2.5;
    c.beginPath();
    c.arc(p.x, p.y, 9, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = '#C9A227';
    c.beginPath();
    c.arc(p.x, p.y, 3, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
}



function currentElapsed(actual: Flight): number {
  if (reduced.matches) return actual.duration;
  if (flightPaused) return Math.min(actual.duration, pausedElapsed);
  return Math.min(actual.duration, ((performance.now() - playStart) / 1000) * playbackRate);
}

function drawFlight(
  preview: Flight,
  actual: Flight | null,
  aero?: Aero,
  activeWind = wind,
  activeChallenge: Challenge = challenge,
  hidePreview = false,
  activeCross = crosswind,
) {
  const canvas = document.querySelector<HTMLCanvasElement>('#flight');
  if (!canvas) return;
  const ghost = hidePreview || flightDesign ? null : actual ? activeGhost : getGhost(activeChallenge);
  const elapsed = actual ? currentElapsed(actual) : 0;
  if (use3D) {
    // 三维视图:独立 canvas,WebGL 不可用时回退 2D
    const canvas3d = document.querySelector<HTMLCanvasElement>('#flight3d');
    if (canvas3d) {
      if (!view3d || view3d.canvas !== canvas3d) {
        view3d?.ctrl.dispose();
        const ctrl = flight3dModule?.createFlight3DView(canvas3d) ?? null;
        view3d = ctrl ? {canvas: canvas3d, ctrl} : null;
      }
      if (view3d) {
        view3d.ctrl.setPlane(lastViewFaces ?? []);
        view3d.ctrl.setTrajectory(actual, preview, ghost, elapsed);
      } else {
        canvas.classList.remove('hidden-canvas');
      }
    }
  } else {
    renderFlightCanvas(
      canvas,
      preview,
      actual,
      ghost,
      activeChallenge,
      elapsed,
      {angle, speed, wind: activeWind, crosswind: activeCross},
      aero,
      showForces,
      showPolar,
      {followCamera, chargeState, paused: flightPaused, hidePreview, topView, accuracyTarget: accuracyTargetDisplay},
    );
  }
  if (actual) {
    updateFlightFeedback(actual, elapsed, activeWind, hidePreview);
    if (elapsed < actual.duration && !flightPaused) {
      animation = requestAnimationFrame(() =>
        drawFlight(preview, actual, aero, activeWind, activeChallenge, hidePreview, activeCross),
      );
    }
  }
}

// 治理 1.10:页面转入后台时暂停飞行回放并停风声;恢复后保持暂停由玩家继续
document.addEventListener('visibilitychange', () => {
  if (document.hidden && stage === 'flight' && flight && !flightPaused && !reduced.matches) {
    pausedElapsed = currentElapsed(flight);
    flightPaused = true;
    cancelAnimationFrame(animation);
    sound.wind(0);
    const btn = document.querySelector<HTMLButtonElement>('#pause-flight');
    if (btn) btn.textContent = '继续飞行';
  }
});

// 启动时读取生涯存档(未知版本提示重置,不静默改档)
{
  const migrated = migrateCareer(localStorage.getItem(careerStorageKey));
  if (migrated.state) careerState = migrated.state;
  careerNeedsReset = migrated.needsReset;
}

render();

function updateFlightFeedback(actual: Flight, elapsed: number, activeWind = wind, isOfficial = false) {
  const frame = playback(actual, elapsed);
  const done = frame.finished;
  sound.wind(done ? 0 : airSpeedAt(actual.samples, elapsed, activeWind));
  if (done && actual.landed && !landingSoundPlayed) {
    sound.land();
    landingSoundPlayed = true;
  }

  // Commit official competition throw once upon landing
  if (done && isOfficial && activeMatch && activeMatch.status === 'in-progress' && !compThrowRecorded) {
    const turn = currentTurn(activeMatch);
    if (turn) {
      const committed = recordCompetitionThrow(activeMatch, {angle, speed, wind: turn.wind, crosswind: turn.crosswind}, actual);
      activeMatch = committed.match;
      compLastRecord = committed.record;
      compThrowRecorded = true;
      compThrowFlights.set(`${turn.player.id}-${turn.round}`, actual);
      if (activeMatch.status === 'finished') {
        compNewPb = saveCompetitionPbIfBetter(activeMatch);
      }
      render();
      return;
    }
  }

  if (!isOfficial && done && actual.landed && !celebrated && challengeResult(challenge, actual).beaten) {
    celebrated = true;
    if (!reduced.matches) document.querySelector('#flight')?.parentElement?.classList.add('celebrate');
  }
  if (!isOfficial && !flightDesign && done && actual.landed) {
    const key = ghostStorageKey(plane, challenge);
    const old = getGhost(challenge);
    const updated = bestFlight(challenge, old, actual);
    if (updated && updated !== old) {
      ghosts[key] = updated;
      try {
        localStorage.setItem(key, encodeGhost(challenge, updated));
      } catch {}
    }
  }
  // 生涯结算:达标写入存档并庆祝,未达标给出差距提示
  if (done && careerActive && actual.landed && !careerEvaluated) {
    careerEvaluated = true;
    const c = careerActive;
    const score = c.event === 'distance' ? actual.distance : c.event === 'duration' ? actual.duration : accuracyMiss(actual.distance, actual.drift, c.targetLine ?? 0);
    const unit = c.event === 'duration' ? ' s' : ' m';
    const goal = c.event === 'accuracy' ? `≤ ${c.target}${unit}(距靶)` : `≥ ${c.target}${unit}`;
    const resultEl = document.querySelector('#challenge-result');
    if (isChallengeMet(c, actual.landed, score)) {
      careerState = completeChallenge(careerState, c, score);
      try {
        localStorage.setItem(careerStorageKey, encodeCareer(careerState));
        careerSaveFailed = false;
      } catch {
        careerSaveFailed = true;
      }
      if (!reduced.matches) document.querySelector('#flight')?.parentElement?.classList.add('celebrate');
      if (resultEl) resultEl.textContent = `关卡完成!本次 ${score.toFixed(2)}${unit}${c.event === 'accuracy' ? '(距靶)' : ''},目标 ${goal} · 已写入生涯进度,回生涯页继续下一关`;
    } else if (resultEl) {
      resultEl.textContent = `未达标:本次 ${score.toFixed(2)}${unit}${c.event === 'accuracy' ? '(距靶)' : ''},目标 ${goal} · 调整后再试`;
    }
  }
  const result = document.querySelector('#challenge-result');
  if (result && !isOfficial && !careerActive) {
    const c = challengeResult(challenge, actual);
    result.textContent = done
      ? !actual.landed
        ? '模拟达到时限，未计入纪录'
        : c.beaten
          ? '超过历史目标！'
          : '距离历史目标还差 ' + Math.max(0, c.target - c.value).toFixed(1) + ' ' + c.unit
      : '飞行中 · 落地后结算挑战';
  }
  const status = document.querySelector('.flight-status');
  if (status && !isOfficial) {
    status.innerHTML =
      (done
        ? actual.landed
          ? '试飞完成 · 调整参数，再挑战一次'
          : '模拟达到时限 · 重新调整参数'
        : playbackRate < 1
          ? '慢动作回放中 (0.4×) · 观察升阻矢量与迎角变化'
          : '飞行中 · 观察它的姿态与轨迹') +
      ' <span class="mono">个人最佳 ' +
      bestLabel() +
      '</span>';
  }
  const numbers = document.querySelectorAll('.results strong');
  // v5:距离显示含侧向漂移(与结算口径一致的水平距离)
  [Math.hypot(frame.sample.x, frame.sample.z ?? 0), frame.sample.t, frame.height].forEach((n, i) => {
    if (numbers[i]) numbers[i].innerHTML = n.toFixed(1) + ' <em>' + ['m', 's', 'm'][i] + '</em>';
  });
  const launch = document.querySelector<HTMLButtonElement>('#throw');
  if (launch) {
    launch.disabled = !done || (isOfficial && compThrowRecorded);
    launch.textContent = done ? (isOfficial ? '已计分' : '再次投掷 →') : '飞行中…';
  }
  const pauseBtn = document.querySelector<HTMLButtonElement>('#pause-flight');
  if (pauseBtn) pauseBtn.disabled = done;
  const slowBtn = document.querySelector<HTMLButtonElement>('#slow-replay');
  if (slowBtn) slowBtn.disabled = !done;
  document.querySelectorAll<HTMLInputElement>('.controls input').forEach(el => {
    if (el.id === 'wind' && (isOfficial || careerActive)) el.disabled = true;
    else if (el.id === 'crosswind' && careerActive) el.disabled = true;
    else if ((el.id === 'angle' && careerActive?.angle !== undefined) || (el.id === 'speed' && careerActive?.speed !== undefined)) el.disabled = true;
    else el.disabled = !done || (isOfficial && compThrowRecorded);
  });
  document.querySelectorAll<HTMLButtonElement>('.challenge button, .recommendation button, .wind-presets button, #share').forEach(
    el => (el.disabled = !done),
  );
}
