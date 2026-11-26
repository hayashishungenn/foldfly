/**
 * 纯 UI 模板(治理 1.9):从 main.ts 按职责迁出的字符串构建器与静态数据。
 * 不操作 DOM、不持状态;localStorage 读取仅出现在聚合入口(与游戏层一致)。
 */
import {computeAeroPolar, analyzeTrajectoryPhases, sweepLaunchAngles} from '../aero/polar';
import type {Aero} from '../aero/extract';
import type {Flight, Throw} from '../aero/integrator';
import {planes, type PlaneId} from '../fold/planes';
import {FREESTYLE_PLANE_ID} from '../fold/freestyle';
import type {FoldStep} from '../fold/planes/dart';
import {papers, weights} from '../paper/papers';
import {paperGrade, materialProfile, grades, type PaperGradeId} from '../paper/material';
import {escapeHtml} from './safe';
import {ghostStorageKey, decodeGhost} from '../game/ghost';
import {achievements, collectAchievementContext, evaluateAchievements} from '../game/achievements';
import {careerChallenges, careerProgress} from '../game/career';
import {replay} from '../fold/engine';
import {extract} from '../aero/extract';
import {simulate} from '../aero/integrator';

/** 各机型设计者调校手记(静态数据);自由设计条目由模板内置回退。 */
export const DESIGNER_TRIM_NOTES: Record<PlaneId, {source: string; trim: string}> = {
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
  zerofighter: {
    source: '户田拓夫 (Takuo Toda · Oriplane 公开教学 · 工程近似)',
    trim: '零战与 Sky King 同源:更浅的机头带让配重更靠前、静稳定余量更低,配合稍短的展弦比。调校要点是赋予双翼明显正上反角(约 6°–8°)与后缘柔和微翘,以约 20° 仰角轻柔送出(~8 m/s),让宽弦机翼在顶点平缓进入低沉降率滑翔;原机锁扣结构在本作中简化。',
  },
  blackburn: {
    source: 'Ken Blackburn《The World Record Paper Airplane Book》',
    trim: '前缘多重卷折打造极高刚度的防形变配重梁，宽平直机翼翼载荷极低；需赋予机翼略微上反角并在后缘施加微量升降舵上翘，以 20°–25° 仰角全力高抛，飞机冲至最高点后将自动俯冲改平长久滑翔。',
  },
};


export function renderAeroDeepHtml(
  targetFlight: Flight,
  aero: Aero,
  launch: Throw,
  planeId: PlaneId | typeof FREESTYLE_PLANE_ID,
): string {
  const polar = computeAeroPolar(aero, launch.wind);
  const phases = analyzeTrajectoryPhases(targetFlight, aero, launch);
  const sweep = sweepLaunchAngles(aero, launch.speed, launch.wind);
  const trimNote: {source: string; trim: string} =
    planeId === FREESTYLE_PLANE_ID
      ? {
          source: '自由设计台',
          trim: '自定义折序:升阻特性完全由折叠几何实时提取。建议从 15°–20° 仰角、中速开始试探;若爬升后扎头,把重心前移(多折几道机头配重折);若下沉过快,尝试加大翼展(展翼折痕更靠外)。',
        }
      : DESIGNER_TRIM_NOTES[planeId as PlaneId];

  const phaseCards = phases.phases
    .map(
      p => `<div class="phase-card"><div class="phase-head"><strong>${p.label}</strong><span class="mono">${p.startTime.toFixed(1)}s → ${p.endTime.toFixed(1)}s · ${p.startX.toFixed(1)}m → ${p.endX.toFixed(1)}m（占 ${p.distanceShare.toFixed(0)}%）</span></div><p>${p.summary}</p></div>`,
    )
    .join('');

  return `<p class="aero-deep-intro">基于薄翼升阻极曲线 CL(CD)、Polhamus 前缘涡升力模型与 Stengel 纵向动力学实时解算：</p><div class="phase-list">${phaseCards}</div><div class="physics-grid aero-polar-grid"><span>最大滑翔比 <b class="mono">${polar.bestGlide.ld.toFixed(2)} (@ ${polar.bestGlide.alphaDeg.toFixed(1)}°, ${polar.bestGlide.speed.toFixed(1)} m/s)</b></span><span>最小沉降率 <b class="mono">${polar.minSink.sinkRate.toFixed(2)} m/s (@ ${polar.minSink.alphaDeg.toFixed(1)}°, ${polar.minSink.speed.toFixed(1)} m/s)</b></span><span>临界失速点 <b class="mono">α=${polar.stallAngleDeg.toFixed(1)}° (CL=${polar.clMax.toFixed(2)}, V_s=${polar.stallSpeed.toFixed(1)} m/s)</b></span><span>短周期俯仰模态 <b class="mono">T_sp=${polar.stability.shortPeriodPeriod.toFixed(2)} s (ζ=${polar.stability.shortPeriodDamping.toFixed(2)})</b></span><span>长周期 Phugoid <b class="mono">T_ph=${polar.stability.phugoidPeriod.toFixed(2)} s (ζ=${polar.stability.phugoidDamping.toFixed(3)})</b></span><span>当前力度最佳角 <b class="mono">距离 ${sweep.bestDistance.angle}° (${sweep.bestDistance.distance.toFixed(1)}m) · 滞空 ${sweep.bestDuration.angle}° (${sweep.bestDuration.duration.toFixed(1)}s)</b></span><span>配平弦雷诺数 <b class="mono">Re ≈ ${(polar.reynoldsAtBestGlide / 1000).toFixed(1)}×10³ (低雷诺数层流区)</b></span><span>Polhamus 前缘涡升 <b class="mono">占总升力 ${polar.vortexLiftSharePct.toFixed(1)}% (@ 配平攻角)</b></span><span>近地效应区高度 <b class="mono">h &lt; ${(aero.span * 100).toFixed(1)} cm (McCormick 减阻垫升)</b></span></div><div class="trim-note-box"><small class="mono">设计者调校手记 · ${trimNote.source}</small><p>${trimNote.trim}</p></div>`;
}


export function slider(id: string, label: string, min: number, max: number, value: number, unit: string, disabled = false) {
  return `<label><span>${label} <b class="mono">${value}${unit}</b></span><input id="${id}" type="range" min="${min}" max="${max}" step="1" value="${value}"${disabled ? ' disabled' : ''}></label>`;
}
/** Material parameter block under the grade selector (Phase 01: display only, no physics coupling yet). */
export function renderMaterialInfo(id: PaperGradeId, gsm: number): string {
  const p = materialProfile(id, gsm);
  return `<p class="weight-hint">${p.grade.hint}</p><p class="weight-hint mono">厚度 ${(p.thickness * 1e6).toFixed(0)} µm · 挺度 MD ${(p.bendingStiffnessMD * 1e3).toFixed(2)} / CD ${(p.bendingStiffnessCD * 1e3).toFixed(2)} mN·m · 各向异性 ${p.anisotropy.toFixed(2)} · 最小折痕半径 ${(p.minFoldRadius * 1000).toFixed(2)} mm · 折痕利落度 ${(p.creaseCrispness * 100).toFixed(0)}% <small>（经验参数库估算，非实测）</small></p>`;
}
/** 纪录墙:自由挑战纪录 + 正式赛 PB + 生涯进度 + 成就(数据全部来自本地存档聚合)。 */
export function renderRecordsWall(): string {
  const ctx = collectAchievementContext();
  const unlocked = evaluateAchievements(ctx);
  const planeRows = Object.values(planes)
    .map(p => {
      const g = ctx.ghosts[p.id];
      return `<tr><td>${p.name}</td><td class="mono">${g?.distance ? g.distance.toFixed(1) + ' m' : '—'}</td><td class="mono">${g?.duration ? g.duration.toFixed(1) + ' s' : '—'}</td></tr>`;
    })
    .join('');
  const pbRow = (event: 'distance' | 'duration' | 'accuracy', label: string) => {
    const pb = ctx.competitionPbs[event];
    const unit = event === 'duration' ? ' s' : ' m';
    return `<tr><td>${label}</td><td class="mono">${pb ? pb.score.toFixed(2) + unit : '—'}</td><td class="mono">${pb?.playerName ? escapeHtml(pb.playerName) : '—'}</td></tr>`;
  };
  const badges = achievements
    .map(a => `<div class="achievement ${unlocked[a.id] ? 'unlocked' : ''}"><strong>${a.title}</strong><small>${a.description}</small></div>`)
    .join('');
  const progress = ctx.career ? careerProgress(ctx.career) : {done: 0, total: careerChallenges.length};
  return `<details class="records-wall"><summary>🏆 纪录墙与成就 <span class="mono">${unlocked[achievements[0].id] !== undefined ? Object.values(unlocked).filter(Boolean).length : 0}/${achievements.length} 成就</span></summary><div class="wall-grid"><div><h4>自由挑战纪录</h4><table class="detail-table"><thead><tr><th>机型</th><th>距离</th><th>滞空</th></tr></thead><tbody>${planeRows}</tbody></table><small class="mono">来自本机自由挑战幽灵存档</small></div><div><h4>正式赛个人最佳</h4><table class="detail-table"><thead><tr><th>项目</th><th>成绩</th><th>选手</th></tr></thead><tbody>${pbRow('distance', '距离赛')}${pbRow('duration', '滞空赛')}${pbRow('accuracy', '精准赛')}</tbody></table><small class="mono">生涯进度 ${progress.done}/${progress.total} 关</small></div><div><h4>成就</h4><div class="achievement-grid">${badges}</div></div></div></details>`;
}
/** 单机型本机个人最佳(距离/滞空,来自本地幽灵存档)。 */
export function planeBest(planeId: PlaneId): {distance: number | null; duration: number | null} {
  const out: {distance: number | null; duration: number | null} = {distance: null, duration: null};
  for (const mode of ['distance', 'duration'] as const) {
    try {
      const raw = localStorage.getItem(ghostStorageKey(planeId, mode));
      const flight = raw ? decodeGhost(raw, mode) : null;
      if (flight) out[mode] = mode === 'distance' ? flight.distance : flight.duration;
    } catch {}
  }
  return out;
}
/** 图鉴详情:折序列表 + 纸张克重×成绩对照(当前材质)+ 本机 PB。 */
export function renderPlaneDetail(planeId: PlaneId, gsmValue: (typeof weights)[number], grade: PaperGradeId): string {
  const def = planes[planeId];
  const best = planeBest(planeId);
  const rows = weights
    .map(w => {
      try {
        const a = extract(replay(papers[0], def.steps.length, def.steps), w);
        const f = simulate(a, {angle: def.recommendation.angle, speed: def.recommendation.speed, wind: 0});
        return `<tr><td class="mono">A4 · ${w}g</td><td class="mono">${f.landed ? f.distance.toFixed(1) + ' m' : '未落地'}</td><td class="mono">${f.landed ? f.duration.toFixed(1) + ' s' : '—'}</td></tr>`;
      } catch {
        return `<tr><td class="mono">A4 · ${w}g</td><td colspan="2" class="mono">折序无法完成</td></tr>`;
      }
    })
    .join('');
  return `<details class="plane-detail"><summary>详情 · 折序清单与克重对照</summary><ol class="plane-steps">${def.steps.map(st => `<li>${st.title}</li>`).join('')}</ol><table class="detail-table"><thead><tr><th>纸张（${paperGrade(grade as PaperGradeId).name}）</th><th>距离</th><th>滞空</th></tr></thead><tbody>${rows}</tbody></table><p class="mono detail-pb">本机最佳：${best.distance !== null ? `距离 ${best.distance.toFixed(1)} m` : '距离 —'} · ${best.duration !== null ? `滞空 ${best.duration.toFixed(1)} s` : '滞空 —'} <small>（对照为示例投掷 ${def.recommendation.angle}°/${def.recommendation.speed} m/s，非实测纪录条件）</small></p></details>`;
}
