/** 折叠会话序列化(Phase 03 / 3.13):确定性、版本化、可恢复。 */
import {createFoldHistory, type FoldCursor, type FoldHistory} from './interact';

export const FOLD_SESSION_VERSION = 1;

export type FoldSession = {
  version: typeof FOLD_SESSION_VERSION;
  cursor: FoldCursor;
  undoStack: FoldCursor[];
  redoStack: FoldCursor[];
};

export function encodeFoldSession(history: FoldHistory): string {
  return JSON.stringify({version: FOLD_SESSION_VERSION, ...history});
}

const validCursor = (c: unknown): c is FoldCursor =>
  Boolean(c) && typeof c === 'object' && Number.isInteger((c as FoldCursor).step) && (c as FoldCursor).step >= 0 &&
  Number.isInteger((c as FoldCursor).subOp) && (c as FoldCursor).subOp >= 0;

export function decodeFoldSession(raw: string | null, programLength?: number): FoldHistory | null {
  try {
    if (!raw || raw.length > 100000) return null;
    const data = JSON.parse(raw) as Partial<FoldSession>;
    if (data.version !== FOLD_SESSION_VERSION) return null;
    if (!validCursor(data.cursor) || !Array.isArray(data.undoStack) || !Array.isArray(data.redoStack)) return null;
    if (!data.undoStack.every(validCursor) || !data.redoStack.every(validCursor)) return null;
    if (programLength !== undefined && (data.cursor.step > programLength || data.undoStack.some(c => c.step > programLength))) return null;
    return {cursor: {...data.cursor}, undoStack: data.undoStack.map(c => ({...c})), redoStack: data.redoStack.map(c => ({...c}))};
  } catch {
    return null;
  }
}

export {createFoldHistory};
