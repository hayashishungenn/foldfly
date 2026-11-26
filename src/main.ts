import {encodeFlight, decodeFlight, matchesSharedResult, resultForShare, type SharedResult} from './game/share';
import {playback, airSpeedAt} from './game/playback';
import {Sound} from './audio/sound';
import {challengeResult, type Challenge} from './game/challenge';
import {bestFlight, decodeGhost, encodeGhost, ghostStorageKey} from './game/ghost';
import {mapDragToThrow, type CanvasPoint, type DragThrowResult} from './game/throw-control';
import {
  abortCompetitionMatch,
  competitionPbKey,
  computeStandings,
  createCompetitionMatch,
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
import './style.css';
import {papers, weights, weightHints} from './paper/papers';
import {grades, materialProfile, paperGrade, isPaperGradeId, type PaperGradeId} from './paper/material';
import {planes, archives, type PlaneId} from './fold/planes';
import {replay, FOLD_ENGINE_VERSION} from './fold/engine';
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

const app = document.querySelector<HTMLDivElement>('#app')!;
const sound = new Sound();
let landingSoundPlayed = false;
let celebrated = false;
let paper = 0;
let gsm: (typeof weights)[number] = 80;
let grade: PaperGradeId = 'copy';
let step = 0;
let foldHistory: FoldHistory = createFoldHistory(0, 0);
/** 手动折叠每条子操作的折痕精度(v4 折痕质量通道);自动/跳过的子操作视为按设计完成。 */
let foldScores = new Map<string, number>();
let manualFoldMode = true;
let foldHint = false;
let dragStatus: DragStatus = 'idle';
let dragProgress = 0;
let stage: 'paper' | 'fold' | 'flight' | 'settlement' = 'paper';
let foldViewMode: FoldViewMode = 'folded';
let auto = false;
let animating = false;
let flight: Flight | null = null;
let previousFlight: Flight | null = null;
let showForces = false;
let showPolar = false;
let followCamera = true;
let flightPaused = false;
let pausedElapsed = 0;
let chargeState: {anchor: CanvasPoint; pointer: CanvasPoint; result: DragThrowResult} | null = null;
let playbackRate = 1;
let playStart = 0;
let animation = 0;
let angle = 20;
let speed = 15;
let wind = 0;
let challenge: Challenge = 'distance';
let plane: PlaneId = 'dart';

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
  if (existing && existing.score >= top.bestScore) return false;
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

const shared = decodeFlight(location.hash);
const invalidShare = location.hash.startsWith('#flight=') && !shared;
let sharedResult: SharedResult | undefined = shared?.result;
if (shared) {
  paper = papers.findIndex(p => p.id === shared.paper);
  gsm = shared.gsm;
  if (shared.grade) grade = shared.grade;
  angle = shared.angle;
  speed = shared.speed;
  wind = shared.wind;
  plane = shared.plane;
  step = currentPlane().steps.length;
  stage = 'flight';
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
  const workshopActive = stage === 'paper' || stage === 'fold';
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
        return `<button class="plane-choice ${plane === p.id ? 'selected' : ''}" data-plane="${p.id}" aria-pressed="${plane === p.id}">
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
        </button>`;
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
      `<section><div class="section-head"><div><p class="eyebrow">01 / 选择纸张</p><h2>从一张纸开始</h2><p>纸张的大小、克重和材质，会改变飞机的几何比例、翼载荷与飞行表现。</p></div></div>${invalidShare ? '<p role="status">分享链接无效或来自旧版折序，请重新选择配置。</p>' : ''}<h3>纸张规格</h3><div class="cards">${papers.map((p, i) => `<button class="card ${paper === i ? 'selected' : ''}" data-paper="${i}" aria-pressed="${paper === i}"><span class="paper-icon ${p.id}"></span><strong>${p.name}</strong><span class="mono">${Number((p.width * 1000).toFixed(1))} × ${Number((p.height * 1000).toFixed(1))} mm</span><small>${p.hint}</small></button>`).join('')}</div><h3>纸张克重 <small>g / m²</small></h3><div class="weights">${weights.map(w => `<button class="${gsm === w ? 'selected' : ''}" data-weight="${w}" aria-pressed="${gsm === w}">${w} gsm</button>`).join('')}</div><p class="weight-hint">${weightHints[gsm]}</p><h3>纸张材质</h3><div class="weights">${grades.map(g => `<button class="${grade === g.id ? 'selected' : ''}" data-grade="${g.id}" aria-pressed="${grade === g.id}">${g.name}</button>`).join('')}</div>${renderMaterialInfo(grade, gsm)}<h3>选择机型 <small>（下方蓝图与参数随当前所选纸张实时重算）</small></h3><div class="plane-choices">${planeCardsHtml}</div><div class="archive"><h3>经典机型图鉴</h3><p>从童年的尖头机开始，认识人类纸飞机纪录史上的三座里程碑。</p><div class="archive-grid">${archiveCardsHtml}</div><p class="archive-note">注：气动参数（质量、重心、翼面积、展弦比、静稳定度）全部由折后纸层几何实时计算；材料厚度、挺度等为经验参数库估算，非实测。</p></div><div class="actions"><span>已选 ${papers[paper].name} · ${gsm} gsm · ${paperGrade(grade).name} · ${currentPlane().name}</span><button class="primary" id="start">开始折纸 →</button></div></section>`,
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
      stage = 'fold';
      foldHistory = createFoldHistory(0, 0);
      foldScores = new Map();
      step = 0;
      foldHint = false;
      dragStatus = 'idle';
      dragProgress = 0;
      foldViewMode = 'folded';
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
        stage = 'flight';
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
    const unit = activeMatch.event === 'distance' ? 'm' : 's';
    const eventLabel = activeMatch.event === 'distance' ? '距离赛' : '滞空赛';
    const matchPaper = papers.find(p => p.id === activeMatch!.paper) ?? papers[0];
    const champions = standings.filter(s => s.rank === 1 && s.bestScore !== null);
    const pb = loadCompetitionPb(activeMatch.event);
    const champTitle =
      champions.length === 0
        ? '本场无有效成绩'
        : champions.length === 1
          ? `冠军：${champions[0].player.name}（${champions[0].bestScore!.toFixed(2)} ${unit}）`
          : `并列冠军：${champions.map(c => c.player.name).join(' / ')}（${champions[0].bestScore!.toFixed(2)} ${unit}）`;

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
        return `<tr class="${s.rank === 1 && s.bestScore !== null ? 'leader' : ''}"><td class="mono">${rankText}</td><td>${s.player.name}</td><td>${planes[s.player.plane].name}</td><td class="mono">${fmtRound(r1)}</td><td class="mono">${fmtRound(r2)}</td><td class="mono">${fmtRound(r3)}</td><td class="mono"><b>${s.bestScore !== null ? `${s.bestScore.toFixed(2)} ${unit}` : '无有效成绩'}</b></td></tr>`;
      })
      .join('');

    shell(
      `<section><div class="section-head"><div><p class="eyebrow">03 / 比赛结算 · ${eventLabel}</p><h2>正式比赛排行榜</h2><p>${matchPaper.name} · ${activeMatch.gsm} gsm · ${paperGrade(activeMatch.grade ?? 'copy').name} · 风场种子 #${activeMatch.seed} · 物理模型 v${activeMatch.modelVersion}</p></div><div class="flight-head-tools"><button id="comp-rematch" class="primary">再来一场 →</button><button id="comp-back-free">返回自由实验</button></div></div><div class="champion-banner"><div><h3>${champTitle}</h3><p>每轮锁定风场：${activeMatch.roundWinds.map((w, i) => `R${i + 1} ${w >= 0 ? '+' : ''}${w.toFixed(1)}m/s`).join(' · ')}</p></div>${compNewPb ? '<span class="pb-tag mono">★ 刷新正式赛个人最佳！</span>' : pb ? `<span class="pb-tag mono">正式赛个人最佳 ${pb.score.toFixed(2)} ${unit} (${pb.playerName})</span>` : ''}</div><div class="canvas-wrap"><canvas id="comp-compare" width="960" height="600" aria-label="选手最佳轨迹对比"></canvas></div><div class="comp-board"><h3>三回合详细成绩</h3><table class="standings-table"><thead><tr><th>排名</th><th>选手</th><th>机型</th><th>第 1 投</th><th>第 2 投</th><th>第 3 投</th><th>最佳有效成绩</th></tr></thead><tbody>${rowsHtml}</tbody></table></div><div class="actions"><button id="comp-reconfig">重新配置赛制与选手</button><button id="comp-go-workshop">返回折纸工坊</button><span class="spacer"></span><button class="primary" id="comp-rematch-bottom">原班人马再来一场 →</button></div></section>`,
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
        label: `#${s.rank} ${s.player.name} (${planes[s.player.plane].name})`,
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
      stage = 'flight';
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
      stage = 'flight';
      render();
    };
    document.querySelector<HTMLButtonElement>('#comp-back-free')!.onclick = () => {
      flightMode = 'free';
      activeMatch = null;
      flight = null;
      stage = 'flight';
      render();
    };
    document.querySelector<HTMLButtonElement>('#comp-go-workshop')!.onclick = () => {
      activeMatch = null;
      flight = null;
      stage = 'paper';
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
  const activeSheet = isOfficialActive ? (papers.find(p => p.id === activeMatch!.paper) ?? papers[paper]) : papers[paper];
  const activeGsm = isOfficialActive ? activeMatch!.gsm : gsm;
  const activeGrade: PaperGradeId = isOfficialActive ? activeMatch!.grade ?? 'copy' : grade;
  const activePlaneId: PlaneId = activeTurn ? activeTurn.player.plane : lastCompPlayer ? lastCompPlayer.plane : plane;
  const activePlaneDef = planes[activePlaneId];
  const activeWind = activeTurn ? activeTurn.wind : compLastRecord ? compLastRecord.launch.wind : wind;
  const activeChallenge: Challenge = isOfficialActive ? activeMatch!.event : challenge;

  if (flightMode === 'competition' && !isOfficialActive) {
    compSetupPlayers[0].plane = compSetupPlayers[0].plane || plane;
    const previewWinds = generateRoundWinds(compSeed, 3);
    const pbDist = loadCompetitionPb('distance');
    const pbDur = loadCompetitionPb('duration');
    const planeOptions = (selected: PlaneId) =>
      Object.values(planes)
        .map(p => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${p.name}</option>`)
        .join('');
    const playersHtml = compSetupPlayers
      .slice(0, compPlayerCount)
      .map(
        (pl, idx) => `<div class="comp-player-card"><label class="mono">选手 ${idx + 1} 姓名<input type="text" data-comp-name="${idx}" value="${pl.name}" maxlength="16"></label><label class="mono">参赛机型<select data-comp-plane="${idx}">${planeOptions(pl.plane)}</select></label></div>`,
      )
      .join('');

    shell(
      `<section><div class="section-head"><div><p class="eyebrow">02 / 飞行赛场 · 正式比赛</p><h2>配置本地飞行锦标赛</h2><p>同场比赛锁定纸张、克重、材质与确定性风场种子；每人 3 投取最佳有效成绩，隐藏落地预演。</p></div><div class="flight-head-tools"><button id="change">返回折纸工坊</button></div></div><div class="mode-switch"><button type="button" id="mode-free">自由实验模式</button><button type="button" id="mode-comp" class="selected" aria-pressed="true">正式比赛模式</button></div><div class="comp-setup"><div class="comp-row"><span>比赛项目：</span><button type="button" id="comp-ev-distance" class="${compEvent === 'distance' ? 'selected' : ''}">距离赛（3 投最佳水平距离）</button><button type="button" id="comp-ev-duration" class="${compEvent === 'duration' ? 'selected' : ''}">滞空赛（3 投最佳滞空时间）</button></div><div class="comp-row"><span>参赛人数：</span>${([1, 2, 3, 4] as const).map(n => `<button type="button" data-comp-count="${n}" class="${compPlayerCount === n ? 'selected' : ''}">${n === 1 ? '单人挑战' : `${n} 人轮流赛`}</button>`).join('')}</div><div class="comp-row"><span>本场锁定环境：</span><span class="mono">${papers[paper].name} · ${gsm} gsm · ${paperGrade(grade).name} · 风场种子 #${compSeed}（${previewWinds.map((w, i) => `R${i + 1}:${w >= 0 ? '+' : ''}${w.toFixed(1)}`).join(' / ')} m/s）</span><button type="button" id="comp-reroll-seed">换一组风场</button></div><div class="comp-row"><span>同场锁定材质：</span>${grades.map(g => `<button type="button" data-comp-grade="${g.id}" class="${grade === g.id ? 'selected' : ''}">${g.name}</button>`).join('')}</div><div class="comp-row"><span>正式赛个人最佳：</span><span class="mono">距离 ${pbDist ? `${pbDist.score.toFixed(1)} m (${pbDist.playerName})` : '暂无'} · 滞空 ${pbDur ? `${pbDur.score.toFixed(1)} s (${pbDur.playerName})` : '暂无'}</span></div><div class="comp-players">${playersHtml}</div><div class="actions"><span>开赛后将锁定机型与风场环境</span><button class="primary" id="comp-start">开始正式比赛 →</button></div></div></section>`,
    );

    document.querySelector<HTMLButtonElement>('#mode-free')!.onclick = () => {
      flightMode = 'free';
      flight = null;
      render();
    };
    document.querySelector<HTMLButtonElement>('#change')!.onclick = () => {
      stage = 'paper';
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

  const aero = extract(replay(activeSheet, activePlaneDef.steps.length, activePlaneDef.steps), activeGsm);
  const metrics = aeroMetrics(aero);
  // v4:自由模式携带玩家手折的折痕质量;正式比赛用预设折序(完美折痕)。
  const foldQuality = isOfficialActive ? 1 : programFoldQuality(activePlaneDef.steps, foldScores);
  const options = simOptions(activeGrade, activeGsm, foldQuality);
  let preview = simulate(aero, {angle, speed, wind: activeWind}, options);
  const analysis = analyzeFlight(flight ?? preview, aero, {angle, speed, wind: activeWind}, previousFlight);
  const sharedMessage =
    !isOfficialActive && sharedResult
      ? `分享的成绩：${sharedResult.distance.toFixed(1)} m · ${sharedResult.duration.toFixed(1)} s · 最高 ${sharedResult.height.toFixed(1)} m。${preview.landed && matchesSharedResult(sharedResult, preview) ? '当前模型可复现。' : '当前模型结果不同，可能来自其他版本。'}`
      : '';

  const compBannerHtml = isOfficialActive
    ? activeTurn
      ? `<div class="comp-banner"><div><strong>第 ${activeTurn.round} / ${activeMatch!.rounds} 轮 · ${activeTurn.player.name}（${activePlaneDef.name}）</strong><br><span>${activeMatch!.event === 'distance' ? '距离赛' : '滞空赛'} · 锁定环境 ${activeSheet.name} ${activeGsm}g ${paperGrade(activeGrade).name} · 本轮风场 ${activeTurn.wind >= 0 ? '+' : ''}${activeTurn.wind.toFixed(1)} m/s · 种子 #${activeMatch!.seed}</span></div><button type="button" id="comp-abort">中途退赛</button></div>`
      : `<div class="comp-banner"><div><strong>全部 ${activeMatch!.rounds} 轮投掷已完成！</strong><br><span>点击下方「查看冠军结算 →」进入排行榜与轨迹对比</span></div><button type="button" id="comp-abort">返回配置</button></div>`
    : '';

  const liveStandingsHtml = isOfficialActive
    ? `<div class="comp-board"><h3>当前实时排名</h3><table class="standings-table"><thead><tr><th>排名</th><th>选手</th><th>机型</th><th>已投</th><th>最佳有效成绩</th></tr></thead><tbody>${computeStandings(activeMatch!)
        .map(
          s =>
            `<tr class="${s.rank === 1 && s.bestScore !== null ? 'leader' : ''}"><td class="mono">${s.bestScore === null ? '—' : s.tied ? `T${s.rank}` : `#${s.rank}`}</td><td>${s.player.name}</td><td>${planes[s.player.plane].name}</td><td class="mono">${s.throws.length} / ${activeMatch!.rounds}</td><td class="mono">${s.bestScore !== null ? `${s.bestScore.toFixed(2)} ${activeMatch!.event === 'distance' ? 'm' : 's'}` : '—'}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : '';

  const nextTurnActionHtml =
    isOfficialActive && compThrowRecorded && activeMatch
      ? `<button class="primary" id="comp-next-turn">${activeMatch.status === 'finished' ? '查看冠军结算 →' : '下一位选手 / 下一投 →'}</button>`
      : `<button class="primary" id="throw">${flight ? (isOfficialActive ? '飞行中…' : '再次投掷 →') : '投掷纸飞机 →'}</button>`;

  shell(
    `<section><div class="section-head"><div><p class="eyebrow">02 / 飞行赛场${isOfficialActive ? ' · 正式比赛' : ''}</p><h2>${isOfficialActive ? (activeTurn ? `${activeTurn.player.name} 上场投掷` : '本场比赛投掷结束') : '给它一次飞行'}</h2><p>${activeSheet.name} · ${activeGsm} gsm · ${paperGrade(activeGrade).name} · ${activePlaneDef.name}</p></div><div class="flight-head-tools"><button type="button" id="toggle-camera" class="${followCamera ? 'selected' : ''}" aria-pressed="${followCamera}">${followCamera ? '跟随相机：开' : '跟随相机：关'}</button>${!isOfficialActive ? '<button id="change">换纸重折</button>' : ''}</div></div>${!isOfficialActive ? `<div class="mode-switch"><button type="button" id="mode-free" class="selected" aria-pressed="true">自由实验模式</button><button type="button" id="mode-comp">正式比赛模式（1–4 人）</button></div>` : ''}${compBannerHtml}${!isOfficialActive && legacyMessage ? `<p class="legacy-share" role="status">${legacyMessage}</p>` : ''}${sharedMessage ? `<p class="shared-result">${sharedMessage}</p>` : ''}<div class="canvas-wrap"><canvas id="flight" class="${!flight ? 'interactive-fold' : ''}" width="960" height="600" aria-label="飞行轨迹与试飞场"></canvas><div class="confetti" aria-hidden="true">${Array.from({length: 24}, (_, i) => `<i style="--x:${(i * 41) % 100}%;--delay:${(i % 6) * 0.08}s;--colour:${['var(--paper)', 'var(--mark-red)', 'var(--ink)'][i % 3]}"></i>`).join('')}</div></div><p class="ghost-note">${isOfficialActive ? '正式比赛已隐藏落地预演虚线：在画布上向后下方拖动蓄力，松手即投掷。' : '在画布上向后下方拖动蓄力，松手即投掷；下方滑块可供精确实验微调。'}</p>${!isOfficialActive ? `<div class="challenge"><span>选择挑战</span><button id="distance-challenge" class="${challenge === 'distance' ? 'selected' : ''}" aria-pressed="${challenge === 'distance'}">距离赛 · 88.3 m 里程碑 / 98.4 m WR</button><button id="duration-challenge" class="${challenge === 'duration' ? 'selected' : ''}" aria-pressed="${challenge === 'duration'}">滞空赛 · 29.2 s 里程碑 / 31.2 s WR</button><p id="challenge-result">${flight ? '挑战结算将在落地后显示' : '调整投掷，挑战历史里程碑与世界纪录'}</p></div>` : `<p id="challenge-result" class="ghost-note">${compLastRecord ? (compLastRecord.valid ? `本投有效成绩：${compLastRecord.score!.toFixed(2)} ${activeMatch!.event === 'distance' ? 'm' : 's'}` : `本投无效：${compLastRecord.invalidReason}`) : '请拖动蓄力或调整角度与力度后投掷'}</p>`}<div class="flight-status">${flight ? '试飞完成' : '准备起飞 · 拖动蓄力或调整滑块'} <span class="mono">${isOfficialActive ? (activeTurn ? `第 ${activeTurn.round}/${activeMatch!.rounds} 轮` : `全部 ${activeMatch!.rounds} 轮完成`) : `个人最佳 ${bestLabel()}`}</span></div><div class="results" aria-live="polite"><div><small>飞行距离</small><strong>${flight ? flight.distance.toFixed(1) : '—'} <em>m</em></strong></div><div><small>滞空时间</small><strong>${flight ? flight.duration.toFixed(1) : '—'} <em>s</em></strong></div><div><small>最高高度</small><strong>${flight ? flight.height.toFixed(1) : '—'} <em>m</em></strong></div></div>${liveStandingsHtml}<div class="controls">${slider('angle', '投掷角度', 0, 75, angle, '°')}${slider('speed', '投掷力度', 6, 28, speed, ' m/s')}${isOfficialActive ? `<label><span>本轮锁定风速 <b class="mono">${activeWind >= 0 ? '+' : ''}${activeWind.toFixed(1)} m/s</b></span><input id="wind" type="range" min="-4" max="4" step="0.5" value="${activeWind}" disabled></label>` : slider('wind', '风速', -4, 4, wind, ' m/s')}</div>${!isOfficialActive ? `<div class="wind-presets"><span>风场速设：</span>${[-3, 0, 3].map(w => `<button type="button" class="wind-preset ${wind === w ? 'selected' : ''}" data-wind="${w}">${w < 0 ? `逆风 ${w}` : w === 0 ? '无风 0' : `顺风 +${w}`} m/s</button>`).join('')}</div><div class="recommendation"><p><b>投掷起点：</b>${activePlaneDef.recommendation.note}</p><button id="apply-recommendation">采用建议角度与力度</button></div>` : ''}<div class="actions"><span>${isOfficialActive ? '正式赛同场环境已锁定' : '虚线为预演轨迹 · 正风速为顺风'}</span>${!isOfficialActive ? '<button id="share">分享这次配置</button>' : ''}${flight ? `<button id="pause-flight">${flightPaused ? '继续飞行' : '暂停'}</button><button id="slow-replay">慢动作回放 0.4×</button>` : ''}${nextTurnActionHtml}</div><details class="physics aero-deep-panel"><summary>高级分析：受力矢量、极曲线、轨迹诊断与几何参数</summary><div class="flight-head-tools" style="margin:10px 0"><button type="button" id="toggle-forces" class="${showForces ? 'selected' : ''}" aria-pressed="${showForces}">${showForces ? '受力矢量：开' : '受力矢量：关'}</button><button type="button" id="toggle-polar" class="${showPolar ? 'selected' : ''}" aria-pressed="${showPolar}">${showPolar ? '极曲线图：开' : '极曲线图：关'}</button></div><div class="flight-diagnostic" id="flight-diagnostic"><div class="diag-head"><span class="mono diag-regime">${analysis.regimeLabel}</span>${analysis.comparison ? `<span class="mono diag-compare">${analysis.comparison.summary}</span>` : ''}</div><p id="diag-verdict">${analysis.verdict}</p></div><div id="aero-deep-content">${renderAeroDeepHtml(flight ?? preview, aero, {angle, speed, wind: activeWind}, activePlaneId)}</div><div class="physics-grid" style="margin-top:12px"><span>材质 <b class="mono">${paperGrade(activeGrade).name}</b></span><span>厚度 <b class="mono">${(materialProfile(activeGrade, activeGsm).thickness * 1e6).toFixed(0)} µm</b></span><span>折痕利落度 <b class="mono">${(materialProfile(activeGrade, activeGsm).creaseCrispness * 100).toFixed(0)}%<small>（经验代理）</small></b></span><span>折痕质量 <b class="mono">${(foldQuality * 100).toFixed(0)}%</b></span><span>质量 <b class="mono">${(aero.mass * 1000).toFixed(2)} g</b></span><span>翼展 <b class="mono">${(aero.span * 100).toFixed(1)} cm</b></span><span>翼面积 <b class="mono">${(aero.wingArea * 10000).toFixed(0)} cm²</b></span><span>展弦比 <b class="mono">${aero.aspectRatio.toFixed(2)}</b></span><span>重心（距机头） <b class="mono">${((aero.cg.y - aero.noseY) * 100).toFixed(1)} cm</b></span><span>静稳定余量 <b class="mono">${(metrics.staticMargin * 100).toFixed(1)}%</b></span><span>翼载荷 <b class="mono">${metrics.wingLoading.toFixed(2)} N/m²</b></span><span>龙骨深度 <b class="mono">${(metrics.keelDepth * 100).toFixed(1)} cm</b></span><span>基准滑翔速 <b class="mono">${metrics.nominalGlideSpeed.toFixed(1)} m/s</b></span></div></details></section>`,
  );
  drawFlight(preview, flight, aero, activeWind, activeChallenge, isOfficialActive);

  const launchNow = (launchAngle: number, launchSpeed: number) => {
    if (isOfficialActive && compThrowRecorded) return;
    cancelAnimationFrame(animation);
    sound.activate();
    angle = launchAngle;
    speed = launchSpeed;
    sharedResult = undefined;
    landingSoundPlayed = false;
    celebrated = false;
    flightPaused = false;
    pausedElapsed = 0;
    chargeState = null;
    playbackRate = 1;
    if (flight) previousFlight = flight;
    activeGhost = isOfficialActive ? null : getGhost(challenge);
    preview = simulate(aero, {angle, speed, wind: activeWind}, options);
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
    drawFlight(preview, null, aero, activeWind, activeChallenge, isOfficialActive);
  };
  flightCanvas.onpointermove = e => {
    if (chargePointerId !== e.pointerId) return;
    const pt = toFlightCanvasPt(e);
    const res = mapDragToThrow(chargeAnchor, pt);
    chargeState = {anchor: chargeAnchor, pointer: pt, result: res};
    if (res.ready) {
      angle = res.angle;
      speed = res.speed;
      preview = simulate(aero, {angle, speed, wind: activeWind}, options);
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
    drawFlight(preview, null, aero, activeWind, activeChallenge, isOfficialActive);
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
      drawFlight(preview, flight, aero, activeWind, activeChallenge, isOfficialActive);
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
  const compNextTurnBtn = document.querySelector<HTMLButtonElement>('#comp-next-turn');
  if (compNextTurnBtn) {
    compNextTurnBtn.onclick = () => {
      sound.wind(0);
      if (!activeMatch) return;
      flight = null;
      compLastRecord = null;
      compThrowRecorded = false;
      if (activeMatch.status === 'finished') {
        stage = 'settlement';
      } else {
        const nextT = currentTurn(activeMatch);
        if (nextT) {
          angle = planes[nextT.player.plane].recommendation.angle;
          speed = planes[nextT.player.plane].recommendation.speed;
        }
      }
      render();
    };
  }

  const cameraBtn = document.querySelector<HTMLButtonElement>('#toggle-camera')!;
  cameraBtn.onclick = () => {
    followCamera = !followCamera;
    cameraBtn.classList.toggle('selected', followCamera);
    cameraBtn.setAttribute('aria-pressed', String(followCamera));
    cameraBtn.textContent = followCamera ? '跟随相机：开' : '跟随相机：关';
    cancelAnimationFrame(animation);
    drawFlight(preview, flight, aero, activeWind, activeChallenge, isOfficialActive);
  };
  const forcesBtn = document.querySelector<HTMLButtonElement>('#toggle-forces');
  if (forcesBtn) {
    forcesBtn.onclick = () => {
      showForces = !showForces;
      forcesBtn.classList.toggle('selected', showForces);
      forcesBtn.setAttribute('aria-pressed', String(showForces));
      forcesBtn.textContent = showForces ? '受力矢量：开' : '受力矢量：关';
      cancelAnimationFrame(animation);
      drawFlight(preview, flight, aero, activeWind, activeChallenge, isOfficialActive);
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
      drawFlight(preview, flight, aero, activeWind, activeChallenge, isOfficialActive);
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
  for (const id of ['angle', 'speed', 'wind']) {
    const el = document.querySelector<HTMLInputElement>('#' + id);
    if (!el || el.disabled) continue;
    el.oninput = () => {
      if (id === 'angle') angle = +el.value;
      if (id === 'speed') speed = +el.value;
      if (id === 'wind') wind = +el.value;
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
      preview = simulate(aero, {angle, speed, wind: activeWind}, options);
      const liveAnalysis = analyzeFlight(preview, aero, {angle, speed, wind: activeWind}, previousFlight);
      const diagRegime = document.querySelector('.diag-regime');
      if (diagRegime) diagRegime.textContent = liveAnalysis.regimeLabel;
      const diagVerdict = document.querySelector('#diag-verdict');
      if (diagVerdict) diagVerdict.textContent = liveAnalysis.verdict;
      const deepContent = document.querySelector('#aero-deep-content');
      if (deepContent) deepContent.innerHTML = renderAeroDeepHtml(preview, aero, {angle, speed, wind: activeWind}, activePlaneId);
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
      drawFlight(preview, flight, aero, activeWind, activeChallenge, isOfficialActive);
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
      playbackRate = 0.4;
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
      stage = 'paper';
      render();
    };
  }
}

function slider(id: string, label: string, min: number, max: number, value: number, unit: string) {
  return `<label><span>${label} <b class="mono">${value}${unit}</b></span><input id="${id}" type="range" min="${min}" max="${max}" step="1" value="${value}"></label>`;
}

/** Material parameter block under the grade selector (Phase 01: display only, no physics coupling yet). */
function renderMaterialInfo(id: PaperGradeId, gsm: number): string {
  const p = materialProfile(id, gsm);
  return `<p class="weight-hint">${p.grade.hint}</p><p class="weight-hint mono">厚度 ${(p.thickness * 1e6).toFixed(0)} µm · 挺度 MD ${(p.bendingStiffnessMD * 1e3).toFixed(2)} / CD ${(p.bendingStiffnessCD * 1e3).toFixed(2)} mN·m · 各向异性 ${p.anisotropy.toFixed(2)} · 最小折痕半径 ${(p.minFoldRadius * 1000).toFixed(2)} mm · 折痕利落度 ${(p.creaseCrispness * 100).toFixed(0)}% <small>（经验参数库估算，非实测）</small></p>`;
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

const DESIGNER_TRIM_NOTES: Record<PlaneId, {source: string; trim: string}> = {
  dart: {
    source: 'Smithsonian NASM《How Things Fly》& Stengel (Princeton)',
    trim: '窄三角翼（AR≈1.14）依赖 Polhamus 前缘分离涡提供非线性升力；机翼保持微弱正上反角（Y 型约 4°）防滚转，后缘无需大幅上翘，适合 15°–25° 中速平顺投出。',
  },
  suzanne: {
    source: 'John Collins《The New World Champion Paper Airplane Book》& Make:',
    trim: '宽弦高饱满度机翼（0.761）零升阻力极低；出厂调校需将双翼调成轻微正上反角，并在机翼后缘内侧做极微弱上翘配平（Reflex Trim），以 0°–5° 平射冲刺，切忌高仰角猛抛导致纸翼张开失速。',
  },
  mach5: {
    source: 'Dillon Ruble / Garrett Jensen (Boeing 工程师团队 · AIAA 访谈)',
    trim: '灵感源自 NASA X-43A 乘波体，机头多层集中折叠令静稳定余量达 12.4%、抗弯刚度极高；需在后缘赋予微量升降舵上翘（Up-Elevator Trim）平衡重机头，以约 40° 仰角全力高抛，在 13 m 顶点自动压头转入滑翔。',
  },
  skyking: {
    source: '户田拓夫 (Takuo Toda · 日本折纸飞机协会 Oriplane)',
    trim: '平头锁扣将重心前移，展弦比达 1.71、沉降率仅 0.09 m/s；调校核心是赋予明显正上反角（约 6°–8°）与后缘柔和微翘，以约 20° 仰角轻柔送出（~8 m/s），避免高速气流冲散宽翼弧度。',
  },
  nakamura: {
    source: '中村英二（Eiji Nakamura）& 红牛纸飞机世界锦标赛（Red Bull Paper Wings）',
    trim: '独特的倒三角锁扣（The Lock）牢固锁定两侧翼层，机翼自平稳能力极强；两翼轻微上抬赋予 4°–6° 上反角，后缘保持平整，以 15° 仰角中速轻快送出，可画出优雅平直的自稳滑翔弹道。',
  },
  blackburn: {
    source: 'Ken Blackburn《The World Record Paper Airplane Book》',
    trim: '前缘多重卷折打造极高刚度的防形变配重梁，宽平直机翼翼载荷极低；需赋予机翼略微上反角并在后缘施加微量升降舵上翘，以 20°–25° 仰角全力高抛，飞机冲至最高点后将自动俯冲改平长久滑翔。',
  },
};

function renderAeroDeepHtml(
  targetFlight: Flight,
  aero: Aero,
  launch: Throw,
  planeId: PlaneId = plane,
): string {
  const polar = computeAeroPolar(aero, launch.wind);
  const phases = analyzeTrajectoryPhases(targetFlight, aero, launch);
  const sweep = sweepLaunchAngles(aero, launch.speed, launch.wind);
  const trimNote = DESIGNER_TRIM_NOTES[planeId];

  const phaseCards = phases.phases
    .map(
      p => `<div class="phase-card"><div class="phase-head"><strong>${p.label}</strong><span class="mono">${p.startTime.toFixed(1)}s → ${p.endTime.toFixed(1)}s · ${p.startX.toFixed(1)}m → ${p.endX.toFixed(1)}m（占 ${p.distanceShare.toFixed(0)}%）</span></div><p>${p.summary}</p></div>`,
    )
    .join('');

  return `<p class="aero-deep-intro">基于薄翼升阻极曲线 CL(CD)、Polhamus 前缘涡升力模型与 Stengel 纵向动力学实时解算：</p><div class="phase-list">${phaseCards}</div><div class="physics-grid aero-polar-grid"><span>最大滑翔比 <b class="mono">${polar.bestGlide.ld.toFixed(2)} (@ ${polar.bestGlide.alphaDeg.toFixed(1)}°, ${polar.bestGlide.speed.toFixed(1)} m/s)</b></span><span>最小沉降率 <b class="mono">${polar.minSink.sinkRate.toFixed(2)} m/s (@ ${polar.minSink.alphaDeg.toFixed(1)}°, ${polar.minSink.speed.toFixed(1)} m/s)</b></span><span>临界失速点 <b class="mono">α=${polar.stallAngleDeg.toFixed(1)}° (CL=${polar.clMax.toFixed(2)}, V_s=${polar.stallSpeed.toFixed(1)} m/s)</b></span><span>短周期俯仰模态 <b class="mono">T_sp=${polar.stability.shortPeriodPeriod.toFixed(2)} s (ζ=${polar.stability.shortPeriodDamping.toFixed(2)})</b></span><span>长周期 Phugoid <b class="mono">T_ph=${polar.stability.phugoidPeriod.toFixed(2)} s (ζ=${polar.stability.phugoidDamping.toFixed(3)})</b></span><span>当前力度最佳角 <b class="mono">距离 ${sweep.bestDistance.angle}° (${sweep.bestDistance.distance.toFixed(1)}m) · 滞空 ${sweep.bestDuration.angle}° (${sweep.bestDuration.duration.toFixed(1)}s)</b></span><span>配平弦雷诺数 <b class="mono">Re ≈ ${(polar.reynoldsAtBestGlide / 1000).toFixed(1)}×10³ (低雷诺数层流区)</b></span><span>Polhamus 前缘涡升 <b class="mono">占总升力 ${polar.vortexLiftSharePct.toFixed(1)}% (@ 配平攻角)</b></span><span>近地效应区高度 <b class="mono">h &lt; ${(aero.span * 100).toFixed(1)} cm (McCormick 减阻垫升)</b></span></div><div class="trim-note-box"><small class="mono">设计者调校手记 · ${trimNote.source}</small><p>${trimNote.trim}</p></div>`;
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
) {
  const canvas = document.querySelector<HTMLCanvasElement>('#flight');
  if (!canvas) return;
  const ghost = hidePreview ? null : actual ? activeGhost : getGhost(activeChallenge);
  const elapsed = actual ? currentElapsed(actual) : 0;
  renderFlightCanvas(
    canvas,
    preview,
    actual,
    ghost,
    activeChallenge,
    elapsed,
    {angle, speed, wind: activeWind},
    aero,
    showForces,
    showPolar,
    {followCamera, chargeState, paused: flightPaused, hidePreview},
  );
  if (actual) {
    updateFlightFeedback(actual, elapsed, activeWind, hidePreview);
    if (elapsed < actual.duration && !flightPaused) {
      animation = requestAnimationFrame(() =>
        drawFlight(preview, actual, aero, activeWind, activeChallenge, hidePreview),
      );
    }
  }
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
      const committed = recordCompetitionThrow(activeMatch, {angle, speed, wind: turn.wind}, actual);
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
  if (!isOfficial && done && actual.landed) {
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
  const result = document.querySelector('#challenge-result');
  if (result && !isOfficial) {
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
  [frame.sample.x, frame.sample.t, frame.height].forEach((n, i) => {
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
    if (el.id === 'wind' && isOfficial) el.disabled = true;
    else el.disabled = !done || (isOfficial && compThrowRecorded);
  });
  document.querySelectorAll<HTMLButtonElement>('.challenge button, .recommendation button, .wind-presets button, #share').forEach(
    el => (el.disabled = !done),
  );
}
