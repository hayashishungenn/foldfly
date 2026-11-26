import {describe, it, expect} from 'vitest';
import {
  createFoldHistory,
  evaluateDrag,
  interactiveFoldFrame,
  isGrabHit,
  nextCursor,
  pushHistory,
  redoHistory,
  resolveInteractiveTarget,
  stateAtCursor,
  undoHistory,
} from '../src/fold/interact';
import {replay} from '../src/fold/engine';
import {area} from '../src/fold/geometry';
import {papers} from '../src/paper/papers';
import {planes} from '../src/fold/planes';
import {extract} from '../src/aero/extract';

describe('手动折纸交互引擎 (interact)', () => {
  const a4 = papers[0];
  const dartSteps = planes.dart.steps;

  it('经典尖头机能通过逐个手动拖动动作从展开纸完整折成飞机，且每步几何与标准 replay 一致', () => {
    let history = createFoldHistory(0, 0);
    let actions = 0;

    while (history.cursor.step < dartSteps.length) {
      const target = resolveInteractiveTarget(a4, dartSteps, history.cursor);
      expect(target).not.toBeNull();
      // Grab hit on grabPoint succeeds
      expect(isGrabHit(target!, target!.grabPoint)).toBe(true);
      // Dragging directly to targetPoint commits
      const evalOk = evaluateDrag(target!, target!.grabPoint, target!.targetPoint);
      expect(evalOk.shouldCommit).toBe(true);
      expect(evalOk.status).toBe('snapping');
      expect(evalOk.progress).toBeCloseTo(1, 5);

      // Mid-fold frame produces valid polygons
      const midFrame = interactiveFoldFrame(a4, dartSteps, history.cursor, 0.5);
      expect(midFrame.length).toBeGreaterThan(0);

      const next = nextCursor(history.cursor, dartSteps);
      history = pushHistory(history, next);
      actions++;

      // Whenever a full step boundary is reached, geometry must match standard replay()
      if (history.cursor.subOp === 0) {
        const manualState = stateAtCursor(a4, dartSteps, history.cursor);
        const standardState = replay(a4, history.cursor.step, dartSteps);
        expect(manualState).toEqual(standardState);
        const totalArea = manualState.layers.reduce((sum, poly) => sum + area(poly), 0);
        expect(totalArea).toBeCloseTo(a4.width * a4.height, 8);
      }
    }

    // Dart has 6 steps, with Steps 2 & 3 split into 2 symmetric sub-ops -> 8 manual actions total
    expect(actions).toBe(8);
    expect(history.cursor).toEqual({step: dartSteps.length, subOp: 0});

    // Aerodynamic extraction matches standard replay identically
    const manualAero = extract(stateAtCursor(a4, dartSteps, history.cursor), 80);
    const stdAero = extract(replay(a4, dartSteps.length, dartSteps), 80);
    expect(manualAero).toEqual(stdAero);
  });

  it('错误方向拖动与半途松手不会提交折叠，支持取消重试', () => {
    const target = resolveInteractiveTarget(a4, dartSteps, {step: 0, subOp: 0})!;
    // Dragging opposite to the fold direction triggers wrong-direction feedback
    const opposite = {
      x: target.grabPoint.x - (target.targetPoint.x - target.grabPoint.x) * 0.5,
      y: target.grabPoint.y - (target.targetPoint.y - target.grabPoint.y) * 0.5,
    };
    const wrong = evaluateDrag(target, target.grabPoint, opposite);
    expect(wrong.status).toBe('wrong-direction');
    expect(wrong.shouldCommit).toBe(false);
    expect(wrong.progress).toBe(0);

    // Partial drag (30%) stays in dragging state and does not commit on release
    const partial = {
      x: target.grabPoint.x + (target.targetPoint.x - target.grabPoint.x) * 0.3,
      y: target.grabPoint.y + (target.targetPoint.y - target.grabPoint.y) * 0.3,
    };
    const mid = evaluateDrag(target, target.grabPoint, partial);
    expect(mid.status).toBe('dragging');
    expect(mid.shouldCommit).toBe(false);
    expect(mid.progress).toBeGreaterThan(0.2);
    expect(mid.progress).toBeLessThan(0.5);
  });

  it('撤销与重做保持纸层顺序、总面积和质量守恒', () => {
    let history = createFoldHistory(0, 0);
    const snapshots: {step: number; subOp: number; layersCount: number; mass: number}[] = [];

    for (let i = 0; i < 6; i++) {
      const next = nextCursor(history.cursor, dartSteps);
      history = pushHistory(history, next);
      const st = stateAtCursor(a4, dartSteps, history.cursor);
      const totalArea = st.layers.reduce((sum, p) => sum + area(p), 0);
      expect(totalArea).toBeCloseTo(a4.width * a4.height, 8);
      snapshots.push({
        step: history.cursor.step,
        subOp: history.cursor.subOp,
        layersCount: st.layers.length,
        mass: totalArea * 0.08,
      });
    }

    // Undo 3 actions
    for (let i = 0; i < 3; i++) {
      history = undoHistory(history);
      const st = stateAtCursor(a4, dartSteps, history.cursor);
      expect(st.layers.reduce((sum, p) => sum + area(p), 0)).toBeCloseTo(a4.width * a4.height, 8);
    }
    expect(history.cursor).toEqual({step: snapshots[2].step, subOp: snapshots[2].subOp});
    expect(history.redoStack.length).toBe(3);

    // Redo 3 actions restores exact state & layer order
    for (let i = 0; i < 3; i++) {
      history = redoHistory(history);
    }
    expect(history.cursor).toEqual({step: snapshots[5].step, subOp: snapshots[5].subOp});
    expect(history.redoStack.length).toBe(0);
    const restored = stateAtCursor(a4, dartSteps, history.cursor);
    expect(restored.layers.length).toBe(snapshots[5].layersCount);
  });

  it('所有预设机型（含翻面与多操作步骤）均能解析有效交互目标并完成全流程', () => {
    for (const p of Object.values(planes)) {
      let cursor = {step: 0, subOp: 0};
      let guard = 0;
      while (cursor.step < p.steps.length && guard < 40) {
        const target = resolveInteractiveTarget(a4, p.steps, cursor);
        expect(target).not.toBeNull();
        expect(Number.isFinite(target!.grabPoint.x)).toBe(true);
        expect(Number.isFinite(target!.targetPoint.x)).toBe(true);
        cursor = nextCursor(cursor, p.steps);
        guard++;
      }
      expect(cursor.step).toBe(p.steps.length);
      expect(stateAtCursor(a4, p.steps, cursor)).toEqual(replay(a4, p.steps.length, p.steps));
    }
  });
});
