/**
 * Undo, redo and clear over the shape list.
 *
 * A stack of **snapshots**, not of operations (`.plan/contracts.md` §8). A
 * shape list is a handful of small JSON objects, so keeping a whole copy per
 * edit costs nothing measurable - and it buys the one behaviour that matters
 * most here: `clear()` is undoable for one line of code, because wiping the
 * marks is just another snapshot. Clear without undo would be worse than
 * freehand without undo.
 *
 * An operation log would need an inverse per tool, and the inverse of "clear"
 * is "put these 40 shapes back in this order" - i.e. a snapshot, arrived at
 * the long way round.
 *
 * Pure: no DOM, no chrome.*. Covered by tests/draw-history.test.ts.
 */

import type { Shape } from "./model";

/** Snapshots kept. A long session cannot grow without bound. */
export const HISTORY_LIMIT: number = 100;

export interface DrawHistory {
  shapes(): readonly Shape[];
  push(shape: Shape): void;
  /** Returns whether anything moved. */
  undo(): boolean;
  redo(): boolean;
  /** Wipes the marks and *is undoable* - see below. */
  clear(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Bumps on every change, so the layer can skip a re-render it does not need. */
  version(): number;
}

/**
 * Frozen on the way in, so `shapes()` can hand out the history's own list
 * without handing out the ability to edit it. The alternative - a defensive
 * copy per call - would allocate on every render frame to protect against a
 * caller that has to cast away `readonly` first.
 */
function snapshot(shapes: readonly Shape[]): readonly Shape[] {
  return Object.freeze(shapes.slice());
}

/** Shared: every empty snapshot is the same immutable empty list. */
const EMPTY: readonly Shape[] = Object.freeze([] as Shape[]);

export function createHistory(initial?: readonly Shape[]): DrawHistory {
  // Index 0 is the baseline the session started from, so `undo` can never
  // remove a shape that was there before the user drew anything.
  const stack: Array<readonly Shape[]> = [
    initial && initial.length > 0 ? snapshot(initial) : EMPTY,
  ];
  let index = 0;
  let version = 0;

  const current = (): readonly Shape[] => stack[index] as readonly Shape[];

  /**
   * Make `next` the present.
   *
   * The redo tail goes first, as in every editor: drawing after an undo is a
   * new branch, and the abandoned one is unreachable. That ordering is also
   * why eviction below never loses a redoable snapshot - by the time the limit
   * is checked there is nothing after `index` left to lose.
   */
  const commit = (next: readonly Shape[]): void => {
    stack.length = index + 1;
    stack.push(next);
    if (stack.length > HISTORY_LIMIT) stack.splice(0, stack.length - HISTORY_LIMIT);
    index = stack.length - 1;
    version += 1;
  };

  return {
    shapes: current,

    push(shape: Shape): void {
      commit(snapshot([...current(), shape]));
    },

    undo(): boolean {
      if (index === 0) return false;
      index -= 1;
      version += 1;
      return true;
    },

    redo(): boolean {
      if (index >= stack.length - 1) return false;
      index += 1;
      version += 1;
      return true;
    },

    clear(): void {
      // Clearing nothing changes nothing: no snapshot, no version bump, and
      // the redo tail survives. Committing here would leave an undo step that
      // visibly does nothing, which is the same trap `isDegenerate` (model.ts)
      // exists to avoid.
      if (current().length === 0) return;
      commit(EMPTY);
    },

    canUndo: () => index > 0,
    canRedo: () => index < stack.length - 1,
    version: () => version,
  };
}
