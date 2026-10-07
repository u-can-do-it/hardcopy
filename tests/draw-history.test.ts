import { describe, expect, it } from "vitest";

import { createHistory, HISTORY_LIMIT } from "@/lib/draw/history";
import { shapeId } from "@/lib/draw/model";
import type { DrawHistory } from "@/lib/draw/history";
import type { LineShape, Shape } from "@/lib/draw/model";

/** A cheap, non-degenerate mark. `n` makes it identifiable in an assertion. */
function line(n: number): LineShape {
  return {
    id: shapeId(n),
    color: "#dc2626",
    width: 2,
    kind: "line",
    from: { x: n, y: 0 },
    to: { x: n + 20, y: 20 },
  };
}

/** The ids of what is on the page right now, in order. */
function ids(history: DrawHistory): string[] {
  return history.shapes().map((s) => s.id);
}

/** How many times `undo` can still move. Also the depth the limit bounds. */
function undoAll(history: DrawHistory): number {
  let steps = 0;
  while (history.undo()) steps += 1;
  return steps;
}

describe("HISTORY_LIMIT", () => {
  it("is 100 snapshots", () => {
    // Pinned to the number, not just to itself: everything below is written
    // against HISTORY_LIMIT, so without this the value could drift silently.
    expect(HISTORY_LIMIT).toBe(100);
  });
});

describe("a fresh history", () => {
  it("starts empty, with nothing to undo or redo", () => {
    const history = createHistory();
    expect(history.shapes()).toEqual([]);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(history.version()).toBe(0);
  });

  it("refuses to undo and changes nothing while refusing", () => {
    const history = createHistory();
    expect(history.undo()).toBe(false);
    expect(history.redo()).toBe(false);
    expect(history.shapes()).toEqual([]);
    // A no-op must not bump the version, or the layer re-renders on every
    // stray Ctrl+Z.
    expect(history.version()).toBe(0);
  });

  it("takes an initial list as the baseline, which undo cannot reach past", () => {
    const history = createHistory([line(1), line(2)]);
    expect(ids(history)).toEqual([shapeId(1), shapeId(2)]);
    expect(history.canUndo()).toBe(false);
    expect(history.undo()).toBe(false);
    expect(ids(history)).toEqual([shapeId(1), shapeId(2)]);
  });

  it("copies the initial list instead of holding on to the caller's array", () => {
    const caller: Shape[] = [line(1)];
    const history = createHistory(caller);
    caller.push(line(2));
    expect(ids(history)).toEqual([shapeId(1)]);
  });
});

describe("push, undo, redo", () => {
  it("round-trips: push, undo, redo returns the shape", () => {
    const history = createHistory();
    history.push(line(1));
    history.push(line(2));
    expect(ids(history)).toEqual([shapeId(1), shapeId(2)]);

    expect(history.undo()).toBe(true);
    expect(ids(history)).toEqual([shapeId(1)]);

    expect(history.redo()).toBe(true);
    expect(ids(history)).toEqual([shapeId(1), shapeId(2)]);
  });

  it("undoes every push in turn, back to empty", () => {
    const history = createHistory();
    history.push(line(1));
    history.push(line(2));
    history.push(line(3));

    expect(undoAll(history)).toBe(3);
    expect(history.shapes()).toEqual([]);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
  });

  it("drops the redo tail when a push follows an undo", () => {
    const history = createHistory();
    history.push(line(1));
    history.push(line(2));
    history.undo();
    expect(history.canRedo()).toBe(true);

    history.push(line(3));

    expect(ids(history)).toEqual([shapeId(1), shapeId(3)]);
    expect(history.canRedo()).toBe(false);
    expect(history.redo()).toBe(false);
    // The abandoned branch is gone for good, not parked one step further up.
    expect(ids(history)).toEqual([shapeId(1), shapeId(3)]);
  });

  it("refuses to redo at the top of the stack", () => {
    const history = createHistory();
    history.push(line(1));
    expect(history.redo()).toBe(false);
    expect(ids(history)).toEqual([shapeId(1)]);
  });

  it("survives a long undo/redo walk without losing or duplicating shapes", () => {
    const history = createHistory();
    for (let n = 1; n <= 5; n += 1) history.push(line(n));

    for (let i = 0; i < 3; i += 1) history.undo();
    expect(ids(history)).toEqual([shapeId(1), shapeId(2)]);
    for (let i = 0; i < 3; i += 1) history.redo();
    expect(ids(history)).toEqual([1, 2, 3, 4, 5].map(shapeId));
  });
});

describe("clear", () => {
  it("empties the page and hands everything back on undo", () => {
    // The reason this module is a stack of snapshots at all: clear without
    // undo would be worse than freehand without undo (contracts §8).
    const history = createHistory();
    history.push(line(1));
    history.push(line(2));
    history.push(line(3));

    history.clear();
    expect(history.shapes()).toEqual([]);
    expect(history.canUndo()).toBe(true);

    expect(history.undo()).toBe(true);
    expect(ids(history)).toEqual([shapeId(1), shapeId(2), shapeId(3)]);
  });

  it("clears the initial baseline too, and gives that back as well", () => {
    const history = createHistory([line(1), line(2)]);
    history.clear();
    expect(history.shapes()).toEqual([]);
    expect(history.undo()).toBe(true);
    expect(ids(history)).toEqual([shapeId(1), shapeId(2)]);
    expect(history.canUndo()).toBe(false);
  });

  it("is one step, however many shapes it wiped", () => {
    const history = createHistory();
    for (let n = 1; n <= 4; n += 1) history.push(line(n));
    history.clear();
    // 4 pushes + 1 clear = 5 steps back to empty.
    expect(undoAll(history)).toBe(5);
  });

  it("can be redone", () => {
    const history = createHistory();
    history.push(line(1));
    history.clear();
    history.undo();
    expect(history.redo()).toBe(true);
    expect(history.shapes()).toEqual([]);
  });

  it("does nothing when there is nothing to clear", () => {
    // An undo step that visibly does nothing is the trap `isDegenerate`
    // exists to avoid, so an empty clear must not push one - and it must not
    // throw away a redo tail either.
    const history = createHistory();
    history.push(line(1));
    history.undo();
    const version = history.version();

    history.clear();

    expect(history.version()).toBe(version);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
    expect(history.redo()).toBe(true);
    expect(ids(history)).toEqual([shapeId(1)]);
  });
});

describe("canUndo / canRedo", () => {
  it("track where in the stack the present is", () => {
    const history = createHistory();
    expect([history.canUndo(), history.canRedo()]).toEqual([false, false]);

    history.push(line(1));
    expect([history.canUndo(), history.canRedo()]).toEqual([true, false]);

    history.undo();
    expect([history.canUndo(), history.canRedo()]).toEqual([false, true]);

    history.redo();
    expect([history.canUndo(), history.canRedo()]).toEqual([true, false]);

    history.clear();
    expect([history.canUndo(), history.canRedo()]).toEqual([true, false]);
  });

  it("agree with what undo and redo actually do", () => {
    const history = createHistory();
    history.push(line(1));
    history.push(line(2));
    for (let i = 0; i < 6; i += 1) {
      const expected = i % 2 === 0 ? history.canUndo() : history.canRedo();
      const moved = i % 2 === 0 ? history.undo() : history.redo();
      expect(moved).toBe(expected);
    }
  });
});

describe("version", () => {
  it("bumps once per change", () => {
    const history = createHistory();
    expect(history.version()).toBe(0);

    history.push(line(1));
    expect(history.version()).toBe(1);
    history.push(line(2));
    expect(history.version()).toBe(2);
    history.undo();
    expect(history.version()).toBe(3);
    history.redo();
    expect(history.version()).toBe(4);
    history.clear();
    expect(history.version()).toBe(5);
  });

  it("does not bump on a no-op undo or redo", () => {
    const history = createHistory();
    history.push(line(1));
    const afterPush = history.version();

    expect(history.redo()).toBe(false);
    expect(history.version()).toBe(afterPush);

    history.undo();
    const afterUndo = history.version();
    expect(history.undo()).toBe(false);
    expect(history.version()).toBe(afterUndo);
  });

  it("never goes backwards, so a stale render is always detectable", () => {
    const history = createHistory();
    let previous = history.version();
    const steps = [
      () => history.push(line(1)),
      () => history.undo(),
      () => history.redo(),
      () => history.undo(),
      () => history.clear(),
      () => history.push(line(2)),
    ];
    for (const step of steps) {
      step();
      expect(history.version()).toBeGreaterThanOrEqual(previous);
      previous = history.version();
    }
  });
});

describe("the bound", () => {
  it("keeps the newest snapshots and never grows past HISTORY_LIMIT", () => {
    const pushes = HISTORY_LIMIT + 50;
    const history = createHistory();
    for (let n = 1; n <= pushes; n += 1) history.push(line(n));

    // Snapshots, not operations: the present still holds every shape drawn,
    // even the ones whose snapshot has been evicted.
    expect(history.shapes()).toHaveLength(pushes);
    expect(ids(history)[pushes - 1]).toBe(shapeId(pushes));

    // The stack holds HISTORY_LIMIT snapshots, one of which is the present,
    // so exactly HISTORY_LIMIT - 1 undo steps remain.
    expect(undoAll(history)).toBe(HISTORY_LIMIT - 1);

    // The oldest surviving snapshot is the newest one that fitted: the state
    // after push number (pushes - 99), not an empty page.
    const oldest = ids(history);
    expect(oldest).toHaveLength(pushes - (HISTORY_LIMIT - 1));
    expect(oldest[0]).toBe(shapeId(1));
    expect(oldest[oldest.length - 1]).toBe(shapeId(pushes - (HISTORY_LIMIT - 1)));
  });

  it("counts a clear against the same bound", () => {
    const history = createHistory();
    for (let n = 1; n <= HISTORY_LIMIT * 2; n += 1) history.push(line(n));
    history.clear();
    expect(history.shapes()).toEqual([]);
    expect(undoAll(history)).toBe(HISTORY_LIMIT - 1);
  });

  it("evicts from the old end, so redo is never what gets thrown away", () => {
    // A push drops the redo tail before the limit is checked, so eviction can
    // only ever reach the oldest undo step.
    const history = createHistory();
    for (let n = 1; n <= HISTORY_LIMIT + 10; n += 1) history.push(line(n));
    history.undo();
    history.undo();
    expect(history.canRedo()).toBe(true);

    history.push(line(999));

    expect(history.canRedo()).toBe(false);
    expect(ids(history)[history.shapes().length - 1]).toBe(shapeId(999));
    // Full at HISTORY_LIMIT, then two snapshots left with the redo tail and
    // one arrived with the push - so the stack is one short of full and
    // nothing was evicted to make room for it.
    expect(undoAll(history)).toBe(HISTORY_LIMIT - 2);
  });
});

describe("shapes()", () => {
  it("hands out a list the caller cannot use to edit the history", () => {
    const history = createHistory([line(1)]);
    const escaped = history.shapes() as Shape[];
    const version = history.version();

    // Frozen, so this throws under a module's strict mode; a defensive copy
    // would not throw. Either way what the history holds is out of reach.
    try {
      escaped.push(line(2));
    } catch {
      /* expected */
    }
    try {
      escaped.length = 0;
    } catch {
      /* expected */
    }

    expect(ids(history)).toEqual([shapeId(1)]);
    expect(history.version()).toBe(version);
    expect(history.canUndo()).toBe(false);
  });

  it("leaves an earlier read describing the state it was read at", () => {
    const history = createHistory();
    history.push(line(1));
    const present = history.shapes();
    history.push(line(2));
    // The list handed out earlier still describes the state it was read at.
    expect(present.map((s) => s.id)).toEqual([shapeId(1)]);
  });
});
