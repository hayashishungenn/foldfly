import {foldFrame, unfoldFrame, wingOpeningFrame} from './animate';
import {apply, line, replay, splitFold, type FoldState, type Sheet} from './engine';
import {area, reflect, type Point, type Polygon} from './geometry';
import type {FoldOperation, FoldStep} from './types';

export type FoldCursor = {
  step: number;
  subOp: number;
};

export type DragStatus = 'idle' | 'dragging' | 'snapping' | 'wrong-direction';

export type InteractiveFoldTarget = {
  cursor: FoldCursor;
  stepDef: FoldStep;
  op: FoldOperation;
  subOpCount: number;
  isUnfold: boolean;
  isFlip: boolean;
  isWingOpen: boolean;
  crease: [Point, Point] | null;
  movingPolygons: Polygon[];
  grabPoint: Point;
  targetPoint: Point;
  grabRadius: number;
  snapDistance: number;
  hintText: string;
};

export type DragEvaluation = {
  progress: number;
  shouldCommit: boolean;
  status: DragStatus;
};

export type FoldHistory = {
  cursor: FoldCursor;
  undoStack: FoldCursor[];
  redoStack: FoldCursor[];
};

export function createFoldHistory(step = 0, subOp = 0): FoldHistory {
  return {
    cursor: {step, subOp},
    undoStack: [],
    redoStack: [],
  };
}

export function cursorsEqual(a: FoldCursor, b: FoldCursor): boolean {
  return a.step === b.step && a.subOp === b.subOp;
}

/** Return the list of atomic operations belonging to a FoldStep. */
export function stepOperations(step: FoldStep): readonly FoldOperation[] {
  if (step.unfold) return [step];
  return step.operations ?? [step];
}

/** Advance a cursor by one sub-operation (or commit the step if it was the last sub-op). */
export function nextCursor(cursor: FoldCursor, program: readonly FoldStep[]): FoldCursor {
  if (cursor.step >= program.length) return {step: program.length, subOp: 0};
  const ops = stepOperations(program[cursor.step]);
  if (cursor.subOp + 1 < ops.length) {
    return {step: cursor.step, subOp: cursor.subOp + 1};
  }
  return {step: cursor.step + 1, subOp: 0};
}

/** Push a new cursor onto history, clearing the redo stack. */
export function pushHistory(history: FoldHistory, next: FoldCursor): FoldHistory {
  if (cursorsEqual(history.cursor, next)) return history;
  return {
    cursor: next,
    undoStack: [...history.undoStack, history.cursor],
    redoStack: [],
  };
}

/** Undo to the previous cursor (or previous full step if undo stack is empty). */
export function undoHistory(history: FoldHistory): FoldHistory {
  if (history.undoStack.length > 0) {
    const prev = history.undoStack[history.undoStack.length - 1];
    return {
      cursor: prev,
      undoStack: history.undoStack.slice(0, -1),
      redoStack: [...history.redoStack, history.cursor],
    };
  }
  if (history.cursor.subOp > 0) {
    return {
      cursor: {step: history.cursor.step, subOp: history.cursor.subOp - 1},
      undoStack: [],
      redoStack: [...history.redoStack, history.cursor],
    };
  }
  if (history.cursor.step > 0) {
    return {
      cursor: {step: history.cursor.step - 1, subOp: 0},
      undoStack: [],
      redoStack: [...history.redoStack, history.cursor],
    };
  }
  return history;
}

/** Redo a previously undone cursor. */
export function redoHistory(history: FoldHistory): FoldHistory {
  if (history.redoStack.length === 0) return history;
  const next = history.redoStack[history.redoStack.length - 1];
  return {
    cursor: next,
    undoStack: [...history.undoStack, history.cursor],
    redoStack: history.redoStack.slice(0, -1),
  };
}

/**
 * Reconstruct the exact FoldState at any (step, subOp) cursor by replaying
 * from the initial sheet. Guarantees area & mass conservation and exact
 * equivalence with standard `replay()` at every step boundary.
 */
export function stateAtCursor(sheet: Sheet, program: readonly FoldStep[], cursor: FoldCursor): FoldState {
  const clampedStep = Math.max(0, Math.min(cursor.step, program.length));
  let state = replay(sheet, clampedStep, program);
  if (clampedStep >= program.length || cursor.subOp <= 0) return state;
  const stepDef = program[clampedStep];
  if (stepDef.unfold) return state;
  const ops = stepOperations(stepDef);
  const subCount = Math.min(cursor.subOp, ops.length);
  for (let i = 0; i < subCount; i++) {
    state = apply(state, sheet, {...stepDef, ...ops[i], operations: undefined});
  }
  return state;
}

/** Point-in-convex-polygon test using signed cross products. */
function pointInConvexPolygon(pt: Point, poly: Polygon): boolean {
  if (poly.length < 3) return false;
  let pos = 0;
  let neg = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x);
    if (cross > 1e-7) pos++;
    else if (cross < -1e-7) neg++;
    if (pos > 0 && neg > 0) return false;
  }
  return true;
}

function distToLine(pt: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return Math.hypot(pt.x - a.x, pt.y - a.y);
  return Math.abs((pt.x - a.x) * dy - (pt.y - a.y) * dx) / len;
}

/** Find the furthest vertex of moving polygons from the crease — the natural corner/edge to drag. */
function pickDragHandle(polys: readonly Polygon[], a: Point, b: Point): Point {
  let best: Point | null = null;
  let bestDist = -1;
  for (const poly of polys) {
    for (const v of poly) {
      const d = distToLine(v, a, b);
      if (d > bestDist + 1e-6) {
        bestDist = d;
        best = v;
      } else if (Math.abs(d - bestDist) <= 1e-6 && best && v.y < best.y) {
        // Tie-break toward upper edge (e.g. rectangle side fold)
        best = {x: (best.x + v.x) / 2, y: (best.y + v.y) / 2};
      }
    }
  }
  if (best) return best;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  return {x: mx, y: my};
}

/**
 * Derive the interactive drag target (grab handle, target point, crease, moving
 * faces, and guidance text) for the current (step, subOp) cursor.
 */
export function resolveInteractiveTarget(
  sheet: Sheet,
  program: readonly FoldStep[],
  cursor: FoldCursor,
): InteractiveFoldTarget | null {
  if (cursor.step < 0 || cursor.step >= program.length) return null;
  const stepDef = program[cursor.step];
  const ops = stepOperations(stepDef);
  const subOp = Math.max(0, Math.min(cursor.subOp, ops.length - 1));
  const op = ops[subOp];
  const grabRadius = Math.max(0.032, Math.min(sheet.width, sheet.height) * 0.17);

  if (op.flip) {
    const grabPoint = {x: sheet.width * 0.82, y: sheet.height * 0.5};
    const targetPoint = {x: sheet.width * 0.18, y: sheet.height * 0.5};
    const current = stateAtCursor(sheet, program, cursor);
    return {
      cursor: {step: cursor.step, subOp},
      stepDef,
      op,
      subOpCount: ops.length,
      isUnfold: false,
      isFlip: true,
      isWingOpen: false,
      crease: [
        {x: sheet.width / 2, y: 0},
        {x: sheet.width / 2, y: sheet.height},
      ],
      movingPolygons: current.layers,
      grabPoint,
      targetPoint,
      grabRadius: grabRadius * 1.4,
      snapDistance: sheet.width * 0.2,
      hintText: '水平拖动纸面将整张纸翻面',
    };
  }

  if (stepDef.unfold && cursor.step > 0) {
    const beforePrev = replay(sheet, cursor.step - 1, program);
    const prevStep = program[cursor.step - 1];
    const prevOps = stepOperations(prevStep);
    const prevOp = prevOps[prevOps.length - 1];
    const [a, b] = line(prevOp, sheet);
    const groups = beforePrev.layerGroups ?? beforePrev.layers.map((_, i) => i);
    const {moving} = splitFold(beforePrev.layers, groups, sheet, prevOp);
    const origPolys = moving.map(m => m.polygon);
    const origHandle = pickDragHandle(origPolys, a, b);
    const foldedPolys = origPolys.map(p => p.map(v => reflect(v, a, b)));
    const grabPoint = reflect(origHandle, a, b);
    const targetPoint = origHandle;
    const travel = Math.max(0.03, Math.hypot(targetPoint.x - grabPoint.x, targetPoint.y - grabPoint.y));
    return {
      cursor: {step: cursor.step, subOp: 0},
      stepDef,
      op: prevOp,
      subOpCount: 1,
      isUnfold: true,
      isFlip: false,
      isWingOpen: false,
      crease: [a, b],
      movingPolygons: foldedPolys,
      grabPoint,
      targetPoint,
      grabRadius,
      snapDistance: travel * 0.25,
      hintText: '拖动折好的纸边向反方向展开',
    };
  }

  const current = stateAtCursor(sheet, program, {step: cursor.step, subOp});
  const groups = current.layerGroups ?? current.layers.map((_, i) => i);
  const {moving} = splitFold(current.layers, groups, sheet, op);
  const movingPolygons = moving.map(m => m.polygon).filter(p => p.length >= 3 && area(p) > 1e-12);
  const [a, b] = line(op, sheet);
  const grabPoint = pickDragHandle(movingPolygons, a, b);
  const targetPoint = reflect(grabPoint, a, b);
  const travel = Math.max(0.03, Math.hypot(targetPoint.x - grabPoint.x, targetPoint.y - grabPoint.y));
  const subLabel = ops.length > 1 ? `（第 ${subOp + 1}/${ops.length} 侧）` : '';

  return {
    cursor: {step: cursor.step, subOp},
    stepDef,
    op,
    subOpCount: ops.length,
    isUnfold: false,
    isFlip: false,
    isWingOpen: stepDef.openToStep !== undefined && subOp === ops.length - 1,
    crease: [a, b],
    movingPolygons,
    grabPoint,
    targetPoint,
    grabRadius,
    snapDistance: travel * 0.25,
    hintText:
      stepDef.openToStep !== undefined
        ? `拖动机翼外缘沿折痕折下并展开双翼${subLabel}`
        : op.kind === 'mountain'
          ? `拖动高亮纸边向背面山折对折${subLabel}`
          : `拖动高亮纸角/纸边至金色目标点${subLabel}`,
  };
}

/** Check whether a pointer press in sheet coordinates grabs the active foldable region. */
export function isGrabHit(target: InteractiveFoldTarget, pointer: Point): boolean {
  if (Math.hypot(pointer.x - target.grabPoint.x, pointer.y - target.grabPoint.y) <= target.grabRadius) {
    return true;
  }
  return target.movingPolygons.some(poly => pointInConvexPolygon(pointer, poly));
}

/**
 * Map a pointer drag from `dragStart` to `pointer` into normalized fold progress [0, 1],
 * snap eligibility, and wrong-direction error feedback.
 */
export function evaluateDrag(
  target: InteractiveFoldTarget,
  dragStart: Point,
  pointer: Point,
): DragEvaluation {
  const dx = target.targetPoint.x - target.grabPoint.x;
  const dy = target.targetPoint.y - target.grabPoint.y;
  const travel = Math.max(0.02, Math.hypot(dx, dy));
  const ux = dx / travel;
  const uy = dy / travel;

  const mvx = pointer.x - dragStart.x;
  const mvy = pointer.y - dragStart.y;
  const along = mvx * ux + mvy * uy;
  const perp = Math.abs(-mvx * uy + mvy * ux);

  const rawProgress = along / travel;
  const distToTarget = Math.hypot(pointer.x - target.targetPoint.x, pointer.y - target.targetPoint.y);
  const directProgress = 1 - distToTarget / travel;

  if (rawProgress < -0.14 || (along > 0.008 && perp > travel * 0.72 && distToTarget > target.snapDistance * 1.6)) {
    return {
      progress: 0,
      shouldCommit: false,
      status: 'wrong-direction',
    };
  }

  const progress = Math.max(0, Math.min(1, Math.max(rawProgress, directProgress * 0.92)));
  const shouldCommit = progress >= 0.68 || distToTarget <= target.snapDistance;

  return {
    progress,
    shouldCommit,
    status: shouldCommit ? 'snapping' : 'dragging',
  };
}

/**
 * 一次提交的折痕精度评分 ∈ [0,1](v4 折痕质量通道的数据来源):
 * 以松手落点与目标点的距离归一化——精确落在目标点为 1,偏差达到整段行程为 0。
 * 翻面与展开步骤不产生折痕,不应计分。
 */
export function foldAccuracy(target: InteractiveFoldTarget, dragStart: Point, pointer: Point): number {
  const ev = evaluateDrag(target, dragStart, pointer);
  if (!ev.shouldCommit || target.isFlip || target.isUnfold) return 0;
  const miss = Math.hypot(pointer.x - target.targetPoint.x, pointer.y - target.targetPoint.y);
  const travel = Math.max(0.02, Math.hypot(target.targetPoint.x - target.grabPoint.x, target.targetPoint.y - target.grabPoint.y));
  return Math.max(0, Math.min(1, 1 - miss / travel));
}

/**
 * 折序整体折痕质量(v4)∈ [0,1]:对折序中每条真实折痕的评分取平均;
 * 未手动折叠的子操作视为按设计完成(1)。跳过教学仍保留已折步骤的误差。
 * 翻面与展开步骤不是折痕,不参与评分。
 */
export function programFoldQuality(program: readonly FoldStep[], scores: ReadonlyMap<string, number>): number {
  let total = 0;
  let count = 0;
  for (let step = 0; step < program.length; step++) {
    const stepDef = program[step];
    if (stepDef.unfold) continue;
    const ops = stepOperations(stepDef);
    ops.forEach((op, subOp) => {
      if (op.flip) return;
      const score = scores.get(`${step}:${subOp}`);
      total += score === undefined ? 1 : Math.max(0, Math.min(1, score));
      count++;
    });
  }
  return count === 0 ? 1 : total / count;
}

/**
 * Render geometry for a single interactive sub-operation at `progress` in [0, 1],
 * preserving rotation, front/back shading, occlusion, and wing opening.
 */
export function interactiveFoldFrame(
  sheet: Sheet,
  program: readonly FoldStep[],
  cursor: FoldCursor,
  progress: number,
): {polygon: Polygon; back: boolean; opacity: number}[] {
  const clampedStep = Math.max(0, Math.min(cursor.step, program.length));
  if (clampedStep >= program.length) {
    const done = replay(sheet, program.length, program);
    return (done.wingLayers ?? done.layers).map((polygon, i) => ({polygon, back: i % 2 === 1, opacity: 1}));
  }

  const stepDef = program[clampedStep];
  const p = Math.max(0, Math.min(1, progress));

  if (stepDef.unfold && clampedStep > 0) {
    const base = replay(sheet, clampedStep - 1, program);
    return unfoldFrame(base, sheet, program[clampedStep - 1], p).map(part => ({...part, opacity: 1}));
  }

  const ops = stepOperations(stepDef);
  const subOp = Math.max(0, Math.min(cursor.subOp, ops.length - 1));
  const state = stateAtCursor(sheet, program, {step: clampedStep, subOp});
  const singleStep: FoldStep = {...stepDef, ...ops[subOp], operations: undefined};

  if (stepDef.openToStep !== undefined && subOp === ops.length - 1) {
    const opened = replay(sheet, clampedStep + 1, program).wingLayers;
    if (opened) {
      return wingOpeningFrame(state, sheet, singleStep, opened, p);
    }
  }
  return foldFrame(state, sheet, singleStep, p).map(part => ({...part, opacity: 1}));
}
