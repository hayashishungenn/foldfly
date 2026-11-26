import {extract, aeroMetrics} from '../aero/extract';
import {foldFrame, unfoldFrame, wingOpeningFrame} from '../fold/animate';
import {analyzeCreaseTopology, extractCreasePattern, foldStackStats} from '../fold/crease-pattern';
import {line, replay, type Sheet} from '../fold/engine';
import type {Point, Polygon} from '../fold/geometry';
import {
  interactiveFoldFrame,
  stateAtCursor,
  type DragStatus,
  type InteractiveFoldTarget,
} from '../fold/interact';
import type {FoldStep} from '../fold/types';

export type FoldViewMode = 'folded' | 'cp';

export type FoldInteractionOverlay = {
  subOp: number;
  manualMode: boolean;
  showHint: boolean;
  dragStatus: DragStatus;
  target: InteractiveFoldTarget | null;
};

export function foldViewport(sheet: Sheet) {
  const scale = Math.min(440 / sheet.height, 480 / sheet.width);
  const ox = 480 - (sheet.width * scale) / 2;
  const oy = 62;
  return {
    scale,
    ox,
    oy,
    toSheet: (canvasX: number, canvasY: number): Point => ({
      x: (canvasX - ox) / scale,
      y: (canvasY - oy) / scale,
    }),
    toCanvas: (sheetX: number, sheetY: number): Point => ({
      x: ox + sheetX * scale,
      y: oy + sheetY * scale,
    }),
  };
}

/**
 * Darken a base paper color (--paper #FAF6EE or --paper-back #E8E2D4) by 8% per
 * stacked layer depth to convey physical paper thickness and shadow.
 */
export function layerFillColor(back: boolean, layerIndex: number): string {
  const base = back ? [0xe8, 0xe2, 0xd4] : [0xfa, 0xf6, 0xee];
  const depth = Math.min(3, Math.max(0, layerIndex));
  const factor = 1 - depth * 0.08;
  const [r, g, b] = base.map(ch => Math.round(ch * factor));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Generate an inline SVG blueprint preview of a plane's folded top-view planform
 * and CG / AC locations for the Stage 1 plane selector cards.
 */
export function renderPlaneBlueprintSvg(sheet: Sheet, program: readonly FoldStep[], gsm = 80): string {
  const state = replay(sheet, program.length, program);
  const aero = extract(state, gsm);
  const layers = state.wingLayers ?? state.layers;
  const pad = 0.018;
  const vbW = sheet.width + pad * 2;
  const vbH = sheet.height + pad * 2;
  const polys = layers
    .filter(p => p.length >= 3)
    .map((poly, i) => {
      const pts = poly.map(v => `${(v.x + pad).toFixed(4)},${(v.y + pad).toFixed(4)}`).join(' ');
      const fill = i % 2 === 1 ? '#E8E2D4' : '#FAF6EE';
      return `<polygon points="${pts}" fill="${fill}" stroke="#1F3A5F" stroke-width="0.0032" stroke-linejoin="round" />`;
    })
    .join('');
  const cx = (state.bodyAxisX ?? sheet.width / 2) + pad;
  const cgY = aero.cg.y + pad;
  const acY = aero.aerodynamicCenter.y + pad;
  return `<svg class="plane-blueprint" viewBox="0 0 ${vbW.toFixed(4)} ${vbH.toFixed(4)}" aria-hidden="true" focusable="false">
    ${polys}
    <line x1="${cx.toFixed(4)}" y1="${(aero.noseY + pad).toFixed(4)}" x2="${cx.toFixed(4)}" y2="${(aero.noseY + aero.chord + pad).toFixed(4)}" stroke="#1F3A5F" stroke-width="0.0022" stroke-dasharray="0.006 0.004" />
    <circle cx="${cx.toFixed(4)}" cy="${cgY.toFixed(4)}" r="0.0075" fill="#D9482B" />
    <circle cx="${cx.toFixed(4)}" cy="${acY.toFixed(4)}" r="0.0065" fill="none" stroke="#1F3A5F" stroke-width="0.0028" />
  </svg>`;
}

export function renderFoldCanvas(
  canvas: HTMLCanvasElement,
  sheet: Sheet,
  program: readonly FoldStep[],
  step: number,
  progress = 0,
  gsm = 80,
  viewMode: FoldViewMode = 'folded',
  interaction?: FoldInteractionOverlay,
): void {
  const c = canvas.getContext('2d')!;
  const {scale, ox, oy} = foldViewport(sheet);
  const subOp = interaction?.subOp ?? 0;
  const op = program[step];
  const state = stateAtCursor(sheet, program, {step, subOp});
  const stats = foldStackStats(sheet, program, step);

  c.clearRect(0, 0, 960, 600);

  // Workbench millimeter rulers & centerline reference ticks around the sheet
  drawWorkbenchRulers(c, sheet, ox, oy, scale, stats);

  if (viewMode === 'cp') {
    drawCreasePatternView(c, sheet, program, step, ox, oy, scale);
    return;
  }

  c.save();
  c.translate(ox, oy);
  c.scale(scale, scale);

  // Subtle drop shadow beneath the active paper stack
  const activePolys = state.wingLayers ?? state.layers;
  c.save();
  c.fillStyle = 'rgba(31, 58, 95, 0.08)';
  const shadowDx = 3 / scale;
  const shadowDy = 4 / scale;
  for (const poly of activePolys) {
    if (poly.length < 3) continue;
    c.beginPath();
    poly.forEach((v, j) => (j ? c.lineTo(v.x + shadowDx, v.y + shadowDy) : c.moveTo(v.x + shadowDx, v.y + shadowDy)));
    c.closePath();
    c.fill();
  }
  c.restore();

  const polygon = (poly: Polygon, back: boolean, layerIndex = 0, groupDepth = layerIndex) => {
    if (poly.length < 3) return;
    const offset = (Math.min(5, layerIndex) * 0.45) / scale;
    c.beginPath();
    poly.forEach((v, j) => (j ? c.lineTo(v.x + offset, v.y + offset) : c.moveTo(v.x + offset, v.y + offset)));
    c.closePath();
    c.fillStyle = layerFillColor(back, groupDepth);
    c.fill();
    c.strokeStyle = '#1F3A5F';
    c.lineWidth = 1.5 / scale;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.setLineDash([]);
    c.stroke();
  };

  if (progress > 0 && op) {
    if (interaction?.manualMode || subOp > 0) {
      const parts = interactiveFoldFrame(sheet, program, {step, subOp}, progress);
      parts.forEach((part, i) => {
        c.globalAlpha = part.opacity;
        polygon(part.polygon, part.back, i, Math.min(3, Math.floor(i / 2)));
      });
      c.globalAlpha = 1;
    } else if (op.unfold && step > 0) {
      const base = replay(sheet, step - 1, program);
      unfoldFrame(base, sheet, program[step - 1], progress).forEach((part, i) =>
        polygon(part.polygon, part.back, i, Math.min(3, Math.floor(i / 2))),
      );
    } else {
      const opened = op.openToStep === undefined ? undefined : replay(sheet, step + 1, program).wingLayers;
      const parts = opened
        ? wingOpeningFrame(state, sheet, op, opened, progress)
        : foldFrame(state, sheet, op, progress).map(part => ({...part, opacity: 1}));
      parts.forEach((part, i) => {
        c.globalAlpha = part.opacity;
        polygon(part.polygon, part.back, i, Math.min(3, Math.floor(i / 2)));
      });
      c.globalAlpha = 1;
    }
  } else {
    const groups = state.layerGroups;
    const uniqueGroups = groups ? Array.from(new Set(groups)) : [];
    activePolys.forEach((p, i) => {
      const groupIdx = groups ? Math.max(0, uniqueGroups.indexOf(groups[i])) : Math.floor(i / 2);
      polygon(p, i % 2 === 1, i, groupIdx);
    });
  }

  // Soft moving-region highlight when user requests a hint or is hovering/dragging in manual mode
  if (interaction?.manualMode && interaction.target && progress === 0 && (interaction.showHint || interaction.dragStatus === 'wrong-direction')) {
    c.save();
    c.fillStyle = interaction.dragStatus === 'wrong-direction' ? 'rgba(217, 72, 43, 0.14)' : 'rgba(143, 199, 232, 0.24)';
    for (const poly of interaction.target.movingPolygons) {
      if (poly.length < 3) continue;
      c.beginPath();
      poly.forEach((v, j) => (j ? c.lineTo(v.x, v.y) : c.moveTo(v.x, v.y)));
      c.closePath();
      c.fill();
    }
    c.restore();
  }

  // Clip each historical crease & subtle paper fiber grain (inspired by TaoweNlin/paperfold-lab)
  // to the visible paper projection.
  for (const paperFace of progress > 0 ? [] : activePolys) {
    if (paperFace.length < 3) continue;
    c.save();
    c.beginPath();
    paperFace.forEach((v, j) => (j ? c.lineTo(v.x, v.y) : c.moveTo(v.x, v.y)));
    c.closePath();
    c.clip();

    drawPaperFiberGrain(c, sheet, scale);

    for (let i = 0; i < step; i++) {
      for (const crease of program[i].operations ?? [program[i]]) {
        if (crease.flip) continue;
        const [a, b] = line(crease, sheet);
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.strokeStyle = '#C9DCEB';
        c.lineWidth = 1.2 / scale;
        c.setLineDash([5 / scale, 5 / scale]);
        c.stroke();
      }
    }
    c.restore();
  }

  const operations = op?.operations ?? (op ? [op] : []);
  const marker = interaction?.target && !interaction.target.isFlip
    ? interaction.target.op
    : operations.length
      ? operations[Math.min(operations.length - 1, subOp)] ??
        operations.find(o => !o.flip && progress === 0) ??
        operations[Math.min(operations.length - 1, Math.floor(Math.max(0, Math.min(1, progress)) * operations.length))]
      : undefined;
  if (marker && !marker.flip) {
    const [a, b] = line(marker, sheet);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.strokeStyle = marker.kind === 'valley' ? '#1F3A5F' : '#D9482B';
    c.setLineDash(marker.kind === 'valley' ? [8 / scale, 6 / scale] : [10 / scale, 4 / scale, 2 / scale, 4 / scale]);
    c.lineWidth = 2 / scale;
    c.stroke();
    c.setLineDash([]);

    const sign = op?.unfold ? -marker.sign : marker.sign;
    const nx = (-dy / len) * sign;
    const ny = (dx / len) * sign;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const from = {x: mx + (nx * 35) / scale, y: my + (ny * 35) / scale};
    const to = {x: mx - (nx * 18) / scale, y: my - (ny * 18) / scale};
    const left = {
      x: to.x + (nx * 12) / scale - ((dx / len) * 7) / scale,
      y: to.y + (ny * 12) / scale - ((dy / len) * 7) / scale,
    };
    const right = {
      x: to.x + (nx * 12) / scale + ((dx / len) * 7) / scale,
      y: to.y + (ny * 12) / scale + ((dy / len) * 7) / scale,
    };
    c.beginPath();
    c.moveTo(from.x, from.y);
    c.lineTo(to.x, to.y);
    c.stroke();
    c.beginPath();
    c.moveTo(to.x, to.y);
    c.lineTo(left.x, left.y);
    c.lineTo(right.x, right.y);
    c.closePath();
    if (marker.kind === 'mountain') {
      c.fillStyle = '#D9482B';
      c.fill();
    } else {
      c.fillStyle = '#FAF6EE';
      c.fill();
      c.stroke();
    }
  }

  // Interactive manual fold handles: grab point, drag path, and snap target
  if (interaction?.manualMode && interaction.target && step < program.length) {
    const t = interaction.target;
    const accent = t.op.kind === 'mountain' ? '#D9482B' : '#1F3A5F';
    const isSnapping = interaction.dragStatus === 'snapping';
    const isWrong = interaction.dragStatus === 'wrong-direction';

    // Dashed guide line from grab corner to target landing spot
    c.save();
    c.strokeStyle = isWrong ? '#D9482B' : isSnapping ? '#C9A227' : accent;
    c.lineWidth = (interaction.showHint ? 2.4 : 1.6) / scale;
    c.setLineDash([6 / scale, 5 / scale]);
    c.beginPath();
    c.moveTo(t.grabPoint.x, t.grabPoint.y);
    c.lineTo(t.targetPoint.x, t.targetPoint.y);
    c.stroke();
    c.setLineDash([]);

    // Snap target ring
    const targetRadius = (isSnapping ? 13 : 10) / scale;
    c.fillStyle = isWrong ? 'rgba(217, 72, 43, 0.16)' : isSnapping ? 'rgba(201, 162, 39, 0.25)' : 'rgba(250, 246, 238, 0.85)';
    c.strokeStyle = isWrong ? '#D9482B' : '#C9A227';
    c.lineWidth = (isSnapping ? 2.4 : 1.8) / scale;
    c.beginPath();
    c.arc(t.targetPoint.x, t.targetPoint.y, targetRadius, 0, Math.PI * 2);
    c.fill();
    c.stroke();

    // Target crosshair dot
    c.fillStyle = isWrong ? '#D9482B' : '#C9A227';
    c.beginPath();
    c.arc(t.targetPoint.x, t.targetPoint.y, 3.2 / scale, 0, Math.PI * 2);
    c.fill();

    // Draggable grab handle (only shown before snap completes)
    if (progress < 0.98) {
      const gx = t.grabPoint.x + (t.targetPoint.x - t.grabPoint.x) * progress;
      const gy = t.grabPoint.y + (t.targetPoint.y - t.grabPoint.y) * progress;
      c.fillStyle = isWrong ? 'rgba(217, 72, 43, 0.18)' : 'rgba(31, 58, 95, 0.12)';
      c.beginPath();
      c.arc(gx, gy, (interaction.showHint ? 18 : 14) / scale, 0, Math.PI * 2);
      c.fill();

      c.fillStyle = '#FAF6EE';
      c.strokeStyle = isWrong ? '#D9482B' : accent;
      c.lineWidth = 2.2 / scale;
      c.beginPath();
      c.arc(gx, gy, 8 / scale, 0, Math.PI * 2);
      c.fill();
      c.stroke();

      c.fillStyle = isWrong ? '#D9482B' : accent;
      c.beginPath();
      c.arc(gx, gy, 3 / scale, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }
  c.restore();

  // Bottom interactive status banner in manual mode
  if (interaction?.manualMode && interaction.target && step < program.length) {
    c.save();
    const msg =
      interaction.dragStatus === 'wrong-direction'
        ? '方向偏了，请沿虚线指向拖动至金色目标点（松手可取消重试）'
        : interaction.dragStatus === 'snapping'
          ? '✓ 已进入吸附区，松手即完成本步折叠'
          : `手动折纸：${interaction.target.hintText}`;
    c.font = "12px 'IBM Plex Mono', monospace";
    const textW = Math.min(680, c.measureText(msg).width + 28);
    const bx = 480 - textW / 2;
    const by = 554;
    c.fillStyle = 'rgba(250, 246, 238, 0.94)';
    c.strokeStyle =
      interaction.dragStatus === 'wrong-direction'
        ? '#D9482B'
        : interaction.dragStatus === 'snapping'
          ? '#C9A227'
          : '#1F3A5F';
    c.lineWidth = 1.2;
    c.fillRect(bx, by, textW, 28);
    c.strokeRect(bx, by, textW, 28);
    c.fillStyle = interaction.dragStatus === 'wrong-direction' ? '#D9482B' : '#1F3A5F';
    c.textAlign = 'center';
    c.fillText(msg, 480, by + 18);
    c.restore();
  }

  // If the current step includes a sheet flip operation, display a clear callout badge
  if (operations.some(o => o.flip)) {
    c.save();
    c.font = "12px 'IBM Plex Mono', monospace";
    c.fillStyle = '#FAF6EE';
    c.strokeStyle = '#D9482B';
    c.lineWidth = 1.5;
    c.fillRect(28, 42, 162, 26);
    c.strokeRect(28, 42, 162, 26);
    c.fillStyle = '#D9482B';
    c.fillText('↻ 本步含翻面操作', 40, 59);
    c.restore();
  }

  // When folding is complete, render the engineering blueprint inspection overlay
  if (step >= program.length && progress === 0) {
    drawCompletedFoldBlueprint(c, sheet, state, ox, oy, scale, gsm);
  }
}

/**
 * Procedural paper fiber grain strokes adapted from TaoweNlin/paperfold-lab's
 * makePaperTexture('fiber') implementation, using deterministic LCG seeding.
 */
function drawPaperFiberGrain(c: CanvasRenderingContext2D, sheet: Sheet, scale: number): void {
  let seed = Math.round(sheet.width * 10000 + sheet.height * 1000);
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  c.save();
  c.strokeStyle = '#E8E2D4';
  c.lineWidth = 0.9 / scale;
  c.globalAlpha = 0.45;
  c.setLineDash([]);
  for (let i = 0; i < 42; i++) {
    const x = rand() * sheet.width;
    const y = rand() * sheet.height;
    const dx = ((rand() - 0.5) * 18) / scale;
    const dy = ((rand() - 0.5) * 8) / scale;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + dx, y + dy);
    c.stroke();
  }
  c.restore();
}

/**
 * Render the unfolded Crease Pattern (CP) view showing all mountain, valley, and
 * auxiliary pre-creases accumulated up to `step`, inspired by OrigamiSimulator & paperfold-lab.
 */
function drawCreasePatternView(
  c: CanvasRenderingContext2D,
  sheet: Sheet,
  program: readonly FoldStep[],
  step: number,
  ox: number,
  oy: number,
  scale: number,
): void {
  const creases = extractCreasePattern(sheet, program, step);
  c.save();
  c.translate(ox, oy);
  c.scale(scale, scale);

  // Unfolded flat paper sheet
  c.fillStyle = '#FAF6EE';
  c.strokeStyle = '#1F3A5F';
  c.lineWidth = 1.8 / scale;
  c.fillRect(0, 0, sheet.width, sheet.height);
  drawPaperFiberGrain(c, sheet, scale);
  c.strokeRect(0, 0, sheet.width, sheet.height);

  // Crease lines
  for (const seg of creases) {
    c.beginPath();
    c.moveTo(seg.start.x, seg.start.y);
    c.lineTo(seg.end.x, seg.end.y);
    if (seg.precrease) {
      c.strokeStyle = '#C9DCEB';
      c.lineWidth = 1.4 / scale;
      c.setLineDash([4 / scale, 4 / scale]);
    } else if (seg.kind === 'mountain') {
      c.strokeStyle = '#D9482B';
      c.lineWidth = 1.8 / scale;
      c.setLineDash([9 / scale, 4 / scale, 2 / scale, 4 / scale]);
    } else {
      c.strokeStyle = '#1F3A5F';
      c.lineWidth = 1.8 / scale;
      c.setLineDash([7 / scale, 5 / scale]);
    }
    c.stroke();
    c.setLineDash([]);

    // Endpoint nodes
    for (const pt of [seg.start, seg.end]) {
      c.fillStyle = seg.kind === 'mountain' ? '#D9482B' : '#1F3A5F';
      c.beginPath();
      c.arc(pt.x, pt.y, 2.6 / scale, 0, Math.PI * 2);
      c.fill();
    }
  }

  // Interior crease intersection vertices (--gold #C9A227) per Kawasaki/Maekawa origametry
  const topo = analyzeCreaseTopology(sheet, program, step || program.length);
  for (const v of topo.interiorVertices) {
    c.fillStyle = '#FAF6EE';
    c.strokeStyle = '#C9A227';
    c.lineWidth = 1.6 / scale;
    c.beginPath();
    c.arc(v.x, v.y, 3.6 / scale, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }
  c.restore();

  // Step number badges in screen coordinates along each crease
  c.save();
  c.font = "11px 'IBM Plex Mono', monospace";
  c.textAlign = 'center';
  creases.forEach((seg, idx) => {
    const t = 0.35 + ((idx % 3) - 1) * 0.14;
    const mx = ox + (seg.start.x + (seg.end.x - seg.start.x) * t) * scale;
    const my = oy + (seg.start.y + (seg.end.y - seg.start.y) * t) * scale;
    c.fillStyle = '#FAF6EE';
    c.strokeStyle = seg.kind === 'mountain' ? '#D9482B' : '#1F3A5F';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(mx, my, 9, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.fillStyle = seg.kind === 'mountain' ? '#D9482B' : '#1F3A5F';
    c.fillText(`${seg.stepIndex + 1}`, mx, my + 3.5);
  });

  c.textAlign = 'left';
  c.fillStyle = '#6B7280';
  c.fillText(
    `折痕图 (CP) · 永久谷折 V=${topo.activeValleyCount} / 山折 M=${topo.activeMountainCount} / 预折 P=${topo.precreaseCount} · 内交点 ${topo.interiorVertexCount} 个 · 总长 ${(topo.totalLengthM * 100).toFixed(0)} cm · ${topo.mirrorSymmetric ? '左右镜像对称' : '非对称'}`,
    28,
    578,
  );
  c.restore();
}

function drawWorkbenchRulers(
  c: CanvasRenderingContext2D,
  sheet: Sheet,
  ox: number,
  oy: number,
  scale: number,
  stats: ReturnType<typeof foldStackStats>,
): void {
  const widthMm = Math.round(sheet.width * 1000);
  const heightMm = Math.round(sheet.height * 1000);
  const pw = sheet.width * scale;
  const ph = sheet.height * scale;

  c.save();
  // Faint outline of the original unfolded sheet footprint
  c.strokeStyle = '#C9DCEB';
  c.lineWidth = 1;
  c.setLineDash([4, 4]);
  c.strokeRect(ox, oy, pw, ph);

  // Centerline axis tick at top and bottom
  const midX = ox + pw / 2;
  c.beginPath();
  c.moveTo(midX, oy - 10);
  c.lineTo(midX, oy + ph + 10);
  c.stroke();
  c.setLineDash([]);

  // Top horizontal millimeter ruler
  c.strokeStyle = '#6B7280';
  c.fillStyle = '#6B7280';
  c.font = "11px 'IBM Plex Mono', monospace";
  c.textAlign = 'center';
  for (let mm = 0; mm <= widthMm; mm += 10) {
    const x = ox + (mm / 1000) * scale;
    const major = mm % 50 === 0;
    c.beginPath();
    c.moveTo(x, oy - 6);
    c.lineTo(x, oy - (major ? 14 : 10));
    c.stroke();
    if (major && mm <= widthMm - 15) {
      c.fillText(`${mm}`, x, oy - 18);
    }
  }
  c.fillText(`${widthMm} mm`, ox + pw, oy - 18);

  // Left vertical millimeter ruler
  c.textAlign = 'right';
  for (let mm = 0; mm <= heightMm; mm += 10) {
    const y = oy + (mm / 1000) * scale;
    const major = mm % 50 === 0;
    c.beginPath();
    c.moveTo(ox - 6, y);
    c.lineTo(ox - (major ? 14 : 10), y);
    c.stroke();
    if (major && mm > 0 && mm <= heightMm - 15) {
      c.fillText(`${mm}`, ox - 18, y + 4);
    }
  }
  c.fillText(`${heightMm} mm`, ox - 18, oy + ph + 4);

  // Top-left stack & crease telemetry badge (inspired by TaoweNlin/paperfold-lab)
  c.textAlign = 'left';
  c.fillStyle = '#6B7280';
  c.fillText(
    `叠层峰值 ${stats.maxStackLayers} 层 · 机头 ${stats.noseLayers} 层 · 折痕 ${stats.creaseCount} 道 (谷 ${stats.valleyCount} / 山 ${stats.mountainCount})`,
    28,
    28,
  );

  // Paper badge in top-right corner
  c.textAlign = 'right';
  c.fillStyle = '#6B7280';
  c.fillText(`展开尺寸 ${widthMm} × ${heightMm} mm`, 932, 28);
  c.restore();
}

function drawCompletedFoldBlueprint(
  c: CanvasRenderingContext2D,
  sheet: Sheet,
  state: ReturnType<typeof replay>,
  ox: number,
  oy: number,
  scale: number,
  gsm: number,
): void {
  const aero = extract(state, gsm);
  const metrics = aeroMetrics(aero);
  const axisX = ox + (state.bodyAxisX ?? sheet.width / 2) * scale;
  const cgY = oy + aero.cg.y * scale;
  const acY = oy + aero.aerodynamicCenter.y * scale;
  const noseY = oy + aero.noseY * scale;
  const tailY = oy + (aero.noseY + aero.chord) * scale;

  c.save();
  // 1. Centerline spine & CG / AC markers on the top-view planform
  c.strokeStyle = '#1F3A5F';
  c.lineWidth = 1.2;
  c.setLineDash([6, 4]);
  c.beginPath();
  c.moveTo(axisX, noseY - 12);
  c.lineTo(axisX, tailY + 12);
  c.stroke();
  c.setLineDash([]);

  // CG marker (--mark-red #D9482B)
  c.fillStyle = '#D9482B';
  c.strokeStyle = '#FAF6EE';
  c.lineWidth = 1.5;
  c.beginPath();
  c.arc(axisX, cgY, 6, 0, Math.PI * 2);
  c.fill();
  c.stroke();

  c.font = "12px 'IBM Plex Mono', monospace";
  c.fillStyle = '#D9482B';
  c.textAlign = 'left';
  c.fillText(`⊕ CG 重心 (${((aero.cg.y - aero.noseY) * 100).toFixed(1)} cm)`, axisX + 12, cgY - 3);

  // AC marker (--ink #1F3A5F)
  c.strokeStyle = '#1F3A5F';
  c.fillStyle = '#FAF6EE';
  c.lineWidth = 2;
  c.beginPath();
  c.arc(axisX, acY, 5.5, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.fillStyle = '#1F3A5F';
  c.fillText(`◎ AC 焦点 (SM ${(metrics.staticMargin * 100).toFixed(1)}%)`, axisX + 12, acY + 13);

  // Wingspan dimension callout below tail
  const halfSpanPx = (aero.span / 2) * scale;
  const dimY = Math.min(578, tailY + 26);
  c.strokeStyle = '#1F3A5F';
  c.lineWidth = 1.2;
  c.beginPath();
  c.moveTo(axisX - halfSpanPx, dimY - 5);
  c.lineTo(axisX - halfSpanPx, dimY + 5);
  c.moveTo(axisX + halfSpanPx, dimY - 5);
  c.lineTo(axisX + halfSpanPx, dimY + 5);
  c.moveTo(axisX - halfSpanPx, dimY);
  c.lineTo(axisX + halfSpanPx, dimY);
  c.stroke();
  c.textAlign = 'center';
  c.fillStyle = '#1F3A5F';
  c.fillText(`翼展 b = ${(aero.span * 100).toFixed(1)} cm · AR ${aero.aspectRatio.toFixed(2)}`, axisX, dimY + 15);

  // 2. Side-Profile Keel & Ballast Inset (bottom-right)
  if (state.bodySideLayers && state.bodySideLayers.length > 0) {
    const boxX = 684;
    const boxY = 416;
    const boxW = 252;
    const boxH = 160;
    c.fillStyle = '#FAF6EE';
    c.strokeStyle = '#1F3A5F';
    c.lineWidth = 1.2;
    c.fillRect(boxX, boxY, boxW, boxH);
    c.strokeRect(boxX, boxY, boxW, boxH);

    c.fillStyle = '#6B7280';
    c.textAlign = 'left';
    c.font = "11px 'IBM Plex Mono', monospace";
    c.fillText('侧视龙骨剖面 (机头 ← → 机尾)', boxX + 10, boxY + 18);

    const maxKeel = Math.max(0.02, metrics.keelDepth, ...state.bodySideLayers.flat().map(pt => pt.x));
    const sideScale = Math.min((boxW - 36) / Math.max(0.08, aero.chord), (boxH - 64) / maxKeel);
    const sideOx = boxX + 18;
    const sideOy = boxY + 40;

    state.bodySideLayers.forEach((poly, idx) => {
      if (poly.length < 3) return;
      c.beginPath();
      poly.forEach((pt, j) => {
        const sx = sideOx + (pt.y - aero.noseY) * sideScale;
        const sy = sideOy + pt.x * sideScale;
        if (j) c.lineTo(sx, sy);
        else c.moveTo(sx, sy);
      });
      c.closePath();
      c.fillStyle = layerFillColor(idx % 2 === 1, Math.min(3, Math.floor(idx / 2)));
      c.fill();
      c.strokeStyle = '#1F3A5F';
      c.lineWidth = 1;
      c.stroke();
    });

    // Mark CG and AC along the side profile
    const sideCgX = sideOx + (aero.cg.y - aero.noseY) * sideScale;
    const sideCgY = sideOy + aero.cgDepth * sideScale;
    c.fillStyle = '#D9482B';
    c.beginPath();
    c.arc(sideCgX, sideCgY, 3.5, 0, Math.PI * 2);
    c.fill();

    c.fillStyle = '#6B7280';
    c.fillText(
      `龙骨高 ${(maxKeel * 100).toFixed(1)} cm · 层数 ${state.layers.length}`,
      boxX + 10,
      boxY + boxH - 10,
    );
  }

  // 3. Front Cross-Section & Spec Inset (bottom-left)
  {
    const boxX = 24;
    const boxY = 416;
    const boxW = 244;
    const boxH = 160;
    c.fillStyle = '#FAF6EE';
    c.strokeStyle = '#1F3A5F';
    c.lineWidth = 1.2;
    c.fillRect(boxX, boxY, boxW, boxH);
    c.strokeRect(boxX, boxY, boxW, boxH);

    c.fillStyle = '#6B7280';
    c.textAlign = 'left';
    c.font = "11px 'IBM Plex Mono', monospace";
    c.fillText('正视剖面与气动快览', boxX + 10, boxY + 18);

    // Draw T / V cross-section schematic proportional to span & keelDepth
    const cx = boxX + boxW / 2;
    const topY = boxY + 50;
    const crossScale = Math.min((boxW - 48) / Math.max(0.08, aero.span), 52 / Math.max(0.02, metrics.keelDepth));
    const halfW = (aero.span / 2) * crossScale;
    const keelH = Math.max(8, metrics.keelDepth * crossScale);

    c.strokeStyle = '#1F3A5F';
    c.lineWidth = 2.2;
    c.beginPath();
    // Left and right wings with slight dihedral lift
    c.moveTo(cx - halfW, topY - 4);
    c.lineTo(cx, topY);
    c.lineTo(cx + halfW, topY - 4);
    // Central vertical keel
    c.moveTo(cx, topY);
    c.lineTo(cx, topY + keelH);
    c.stroke();

    c.fillStyle = '#1F3A5F';
    c.fillText(`质量 ${(aero.mass * 1000).toFixed(2)} g · 翼载 ${metrics.wingLoading.toFixed(2)} N/m²`, boxX + 10, boxY + 124);
    c.fillText(`基准滑翔速 ~${metrics.nominalGlideSpeed.toFixed(1)} m/s`, boxX + 10, boxY + 144);
  }
  c.restore();
}
