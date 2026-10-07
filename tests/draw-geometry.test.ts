import { describe, expect, it } from "vitest";

import { rectFromPoints } from "@/lib/capture/plan";
import {
  anchorCorrection,
  arrowHead,
  BAR_MARGIN_PX,
  clampToViewport,
  constrainSquare,
  dropSide,
  normalizeRect,
  POPOVER_GAP_PX,
  snapAngle,
  SNAP_STEP_DEG,
  toDocument,
} from "@/lib/draw/geometry";
import type { Vec2 } from "@/lib/draw/model";

/** Degrees of the vector `from` -> `to`, the way `atan2` measures it. */
function degOf(from: Vec2, to: Vec2): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

function lenOf(from: Vec2, to: Vec2): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/** A point `length` away from `from` at `deg`. The inverse of the two above. */
function at(from: Vec2, deg: number, length: number): Vec2 {
  const rad = (deg * Math.PI) / 180;
  return { x: from.x + Math.cos(rad) * length, y: from.y + Math.sin(rad) * length };
}

/** Fold an angle into (-180, 180], so 350deg and -10deg compare equal. */
function wrapDeg(deg: number): number {
  return (((deg + 180) % 360) + 360) % 360 - 180;
}

describe("toDocument", () => {
  it("adds the scroll it was given", () => {
    expect(toDocument({ x: 12, y: 34 }, { x: 0, y: 900 })).toEqual({ x: 12, y: 934 });
    expect(toDocument({ x: 12, y: 34 }, { x: 40, y: 900 })).toEqual({ x: 52, y: 934 });
    expect(toDocument({ x: 12, y: 34 }, { x: 0, y: 0 })).toEqual({ x: 12, y: 34 });
  });

  it("handles a client point above the fold, which a drag can produce", () => {
    // pointermove fires with negative clientY once the pointer leaves the top
    // of the viewport during a drag.
    expect(toDocument({ x: 5, y: -20 }, { x: 0, y: 100 })).toEqual({ x: 5, y: 80 });
  });

  it("gives the same client point different answers as the page scrolls", () => {
    // The point of taking the scroll per event: a stroke that runs past the
    // fold keeps its samples where the pointer was (.plan/design.md §4.5).
    const client = { x: 100, y: 400 };
    expect(toDocument(client, { x: 0, y: 0 })).toEqual({ x: 100, y: 400 });
    expect(toDocument(client, { x: 0, y: 2_500 })).toEqual({ x: 100, y: 2_900 });
  });
});

describe("anchorCorrection", () => {
  it("corrects nothing for a host already at the document origin", () => {
    expect(anchorCorrection({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("still corrects nothing when that host is measured on a scrolled page", () => {
    // Scrolled 900px down, a host at document 0 has a client y of -900.
    expect(anchorCorrection({ x: 0, y: -900 }, { x: 0, y: 900 })).toEqual({ x: 0, y: 0 });
  });

  it("is the exact negation for a host displaced by an html margin", () => {
    // `html { margin: 8px }` plus `position: relative` - the case the whole
    // function exists for.
    expect(anchorCorrection({ x: 8, y: 8 }, { x: 0, y: 0 })).toEqual({ x: -8, y: -8 });
    // 40px margin and a 1px border, measured 900px down the page.
    expect(anchorCorrection({ x: 41, y: -859 }, { x: 0, y: 900 })).toEqual({ x: -41, y: -41 });
    // Fractional, because a page may size `html` in ems or percentages.
    expect(anchorCorrection({ x: 12.5, y: -0.5 }, { x: 0, y: 0 })).toEqual({ x: -12.5, y: 0.5 });
  });

  it("puts the host at document (0, 0) once applied", () => {
    // The property the two functions have to agree on: correct the host by
    // this, and where it lands in document space is the origin.
    const cases: Array<[Vec2, Vec2]> = [
      [{ x: 0, y: 0 }, { x: 0, y: 0 }],
      [{ x: 8, y: 8 }, { x: 0, y: 0 }],
      [{ x: 41, y: -859 }, { x: 0, y: 900 }],
      [{ x: -6, y: -1_200.25 }, { x: 30, y: 1_200 }],
    ];
    for (const [hostRect, scroll] of cases) {
      const fix = anchorCorrection(hostRect, scroll);
      const landed = toDocument(hostRect, scroll);
      expect({ x: landed.x + fix.x, y: landed.y + fix.y }).toEqual({ x: 0, y: 0 });
    }
  });

  it("reports a zero correction as 0, never -0", () => {
    // `-0` would reach the DOM as `left: -0px` and compares unequal to 0 under
    // Object.is, which is a confusing thing to find in devtools.
    const fix = anchorCorrection({ x: 0, y: -900 }, { x: 0, y: 900 });
    expect(Object.is(fix.x, -0)).toBe(false);
    expect(Object.is(fix.y, -0)).toBe(false);
  });
});

describe("normalizeRect", () => {
  const a = { x: 100, y: 100 };

  it("normalises a drag made in any of the four directions", () => {
    const want = { x: 100, y: 100, width: 200, height: 150 };
    expect(normalizeRect(a, { x: 300, y: 250 })).toEqual(want); // down-right
    expect(normalizeRect({ x: 300, y: 250 }, a)).toEqual(want); // up-left
    expect(normalizeRect({ x: 100, y: 250 }, { x: 300, y: 100 })).toEqual(want); // up-right
    expect(normalizeRect({ x: 300, y: 100 }, { x: 100, y: 250 })).toEqual(want); // down-left
  });

  it("keeps fractions, because SVG takes them and a rounded mark drifts", () => {
    const from = { x: 10.5, y: 20.25 };
    const to = { x: 30.75, y: 40.5 };
    expect(normalizeRect(from, to)).toEqual({ x: 10.5, y: 20.25, width: 20.25, height: 20.25 });

    // The contrast that makes the choice deliberate: lib/capture/plan.ts's
    // rectFromPoints rounds the same drag outwards, because that rectangle is
    // a capture clip and must never shave the edge off the content.
    expect(rectFromPoints(from, to)).toEqual({ x: 10, y: 20, width: 21, height: 21 });
  });

  it("gives a zero-size rect for a click that never moved", () => {
    // Kept rather than special-cased: `isDegenerate` (model.ts) is the one
    // place that decides a mark is not worth having.
    expect(normalizeRect(a, { ...a })).toEqual({ x: 100, y: 100, width: 0, height: 0 });
  });

  it("works across the origin, where a drag can produce negative coordinates", () => {
    expect(normalizeRect({ x: -40, y: -10 }, { x: 60, y: 30 })).toEqual({
      x: -40,
      y: -10,
      width: 100,
      height: 40,
    });
  });
});

describe("constrainSquare", () => {
  const from = { x: 100, y: 100 };

  it("keeps the drag's sign in both axes", () => {
    expect(constrainSquare(from, { x: 300, y: 150 })).toEqual({ x: 300, y: 300 }); // right, down
    expect(constrainSquare(from, { x: 300, y: 50 })).toEqual({ x: 300, y: -100 }); // right, up
    expect(constrainSquare(from, { x: -100, y: 150 })).toEqual({ x: -100, y: 300 }); // left, down
    expect(constrainSquare(from, { x: -100, y: 50 })).toEqual({ x: -100, y: -100 }); // left, up
  });

  it("produces an actual square whichever way the drag went", () => {
    for (const to of [
      { x: 340, y: 118 },
      { x: 118, y: 340 },
      { x: -212.5, y: 61 },
      { x: 61, y: -212.5 },
    ]) {
      const corner = constrainSquare(from, to);
      const rect = normalizeRect(from, corner);
      expect(rect.width).toBe(rect.height);
      expect(rect.width).toBeGreaterThan(0);
    }
  });

  it("is sized by the longer drag, so the corner still reaches the pointer", () => {
    // Mostly horizontal: x follows the pointer exactly and y is extended.
    const wide = constrainSquare(from, { x: 500, y: 130 });
    expect(wide.x).toBe(500);
    expect(wide.y).toBe(500);
    // Mostly vertical: the other way round.
    const tall = constrainSquare(from, { x: 130, y: 500 });
    expect(tall.y).toBe(500);
    expect(tall.x).toBe(500);
  });

  it("still squares a drag that moved in only one axis", () => {
    // Straight down with no x movement: the square is built down and to the
    // right rather than coming back zero-width and being discarded.
    expect(constrainSquare(from, { x: 100, y: 300 })).toEqual({ x: 300, y: 300 });
    expect(constrainSquare(from, { x: 300, y: 100 })).toEqual({ x: 300, y: 300 });
  });

  it("leaves a drag that has not moved where it is", () => {
    expect(constrainSquare(from, { ...from })).toEqual({ x: 100, y: 100 });
  });
});

describe("snapAngle", () => {
  const from = { x: 100, y: 100 };

  it("snaps to 15deg", () => {
    // Pinned, not derived: every case below is written relative to the step,
    // so without this the value could drift with the suite green - and it is
    // the difference between the diagonals being reachable and not.
    // contracts.md §4 names 15.
    expect(SNAP_STEP_DEG).toBe(15);
    expect(360 % SNAP_STEP_DEG).toBe(0);
  });

  it("snaps 43deg to 45deg", () => {
    const snapped = snapAngle(from, at(from, 43, 200));
    expect(degOf(from, snapped)).toBeCloseTo(45, 10);
  });

  it("leaves an exact multiple of the step alone", () => {
    for (const deg of [0, 15, 30, 90, 180, -45, -120]) {
      const to = at(from, deg, 150);
      const snapped = snapAngle(from, to);
      expect(snapped.x).toBeCloseTo(to.x, 10);
      expect(snapped.y).toBeCloseTo(to.y, 10);
    }
  });

  it("lands on a multiple of the step from any angle, and rounds to the nearest", () => {
    for (const deg of [1, 7.4, 22, 43, 74.9, 88, 91, 179, -37, -100.5]) {
      const snapped = snapAngle(from, at(from, deg, 120));
      const result = degOf(from, snapped);
      // On a stop: the distance to the nearest multiple is zero. Written as a
      // distance rather than `result % 15`, which reports 14.999... for an
      // angle that came back a whisker under a stop.
      const nearest = Math.round(result / SNAP_STEP_DEG) * SNAP_STEP_DEG;
      expect(wrapDeg(result - nearest)).toBeCloseTo(0, 9);
      // Nearest: never further away than half a step.
      expect(Math.abs(wrapDeg(result - deg))).toBeLessThanOrEqual(SNAP_STEP_DEG / 2 + 1e-9);
    }
    // Either side of the half-step boundary, explicitly.
    expect(degOf(from, snapAngle(from, at(from, 7.4, 120)))).toBeCloseTo(0, 9);
    expect(degOf(from, snapAngle(from, at(from, 7.6, 120)))).toBeCloseTo(15, 9);
  });

  it("preserves the length, so shift straightens a line without resizing it", () => {
    for (const deg of [3, 43, 128, -61]) {
      for (const length of [8, 137.5, 4_000]) {
        expect(lenOf(from, snapAngle(from, at(from, deg, length)))).toBeCloseTo(length, 8);
      }
    }
  });

  it("honours a caller-supplied step", () => {
    // 90deg: the four axes only.
    expect(degOf(from, snapAngle(from, at(from, 43, 100), 90))).toBeCloseTo(0, 9);
    expect(degOf(from, snapAngle(from, at(from, 46, 100), 90))).toBeCloseTo(90, 9);
    // 45deg: the axes plus the diagonals, and 43 is no longer on a stop.
    expect(degOf(from, snapAngle(from, at(from, 43, 100), 45))).toBeCloseTo(45, 9);
  });

  it("returns `to` unchanged for a zero-length drag", () => {
    // atan2(0, 0) is 0, so without the guard a line would snap to horizontal
    // the moment it was started.
    expect(snapAngle({ x: 50, y: 50 }, { x: 50, y: 50 })).toEqual({ x: 50, y: 50 });
    expect(snapAngle({ x: -3.5, y: 7.25 }, { x: -3.5, y: 7.25 })).toEqual({ x: -3.5, y: 7.25 });
  });

  it("returns `to` unchanged rather than NaN for a step of zero", () => {
    const to = at(from, 43, 200);
    expect(snapAngle(from, to, 0)).toEqual(to);
    expect(snapAngle(from, to, -15)).toEqual(to);
  });
});

describe("arrowHead", () => {
  /** The invariants the contract states, checked at whatever angle. */
  function expectSymmetricHead(from: Vec2, to: Vec2, size: number): [Vec2, Vec2] {
    const barbs = arrowHead(from, to, size);

    for (const barb of barbs) {
      expect(lenOf(to, barb)).toBeCloseTo(size, 10);
    }

    // Symmetric about the line: equal and opposite angles off the shaft, so
    // the midpoint of the barbs sits on the shaft itself.
    const backDeg = degOf(to, from);
    const offsets = barbs.map((barb) => wrapDeg(degOf(to, barb) - backDeg));
    expect(offsets[0]).toBeCloseTo(-offsets[1]!, 10);
    expect(Math.abs(offsets[0]!)).toBeCloseTo(30, 10);

    return barbs;
  }

  it("puts both barbs `size` from the tip, symmetric about the line", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 0 };
    const barbs = expectSymmetricHead(from, to, 10);

    // Real numbers, so the 60deg included angle is pinned rather than merely
    // consistent: 10px at 30deg off a horizontal shaft is 8.66 back and 5 out.
    const ys = barbs.map((b) => b.y).sort((m, n) => m - n);
    expect(ys[0]).toBeCloseTo(-5, 10);
    expect(ys[1]).toBeCloseTo(5, 10);
    for (const barb of barbs) expect(barb.x).toBeCloseTo(91.339746, 6);
  });

  it("keeps the head behind the tip at every angle, pointing back down the shaft", () => {
    const from = { x: 10, y: 20 };
    for (const deg of [0, 37, 90, 143, 180, -90, -132.5]) {
      const to = at(from, deg, 260);
      const barbs = expectSymmetricHead(from, to, 24);
      // "Behind" the tip: each barb is nearer `from` than the tip is.
      for (const barb of barbs) expect(lenOf(from, barb)).toBeLessThan(lenOf(from, to));
    }
  });

  it("scales with `size` and nothing else", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 0, y: 300 }; // straight down
    const small = expectSymmetricHead(from, to, 6);
    const large = expectSymmetricHead(from, to, 36);
    for (const i of [0, 1]) {
      expect(lenOf(to, large[i]!) / lenOf(to, small[i]!)).toBeCloseTo(6, 10);
    }
  });

  it("stays finite for a line with no length", () => {
    // No direction to work from; the numbers still have to be usable, because
    // a `NaN` in a path attribute draws nothing at all.
    const p = { x: 40, y: 40 };
    const barbs = arrowHead(p, { ...p }, 12);
    for (const barb of barbs) {
      expect(Number.isFinite(barb.x)).toBe(true);
      expect(Number.isFinite(barb.y)).toBe(true);
      expect(lenOf(p, barb)).toBeCloseTo(12, 10);
    }
  });
});

describe("clampToViewport", () => {
  const size = { width: 320, height: 44 };
  const viewport = { width: 1_200, height: 800 };

  it("keeps the bar 8px from an edge by default", () => {
    // Pinned: the cases below are relative to the constant, and it is the one
    // number that decides whether the bar looks docked or floating.
    // contracts.md §4 names 8.
    expect(BAR_MARGIN_PX).toBe(8);
    expect(clampToViewport({ x: 0, y: 0 }, size, viewport)).toEqual(
      clampToViewport({ x: 0, y: 0 }, size, viewport, BAR_MARGIN_PX),
    );
  });

  it("leaves a bar that is already inside where it is", () => {
    expect(clampToViewport({ x: 100, y: 100 }, size, viewport)).toEqual({ x: 100, y: 100 });
    // Exactly on the margin, and exactly on the far edge: both legal.
    expect(clampToViewport({ x: 8, y: 8 }, size, viewport)).toEqual({ x: 8, y: 8 });
    expect(clampToViewport({ x: 872, y: 748 }, size, viewport)).toEqual({ x: 872, y: 748 });
  });

  it("respects the margin on all four edges", () => {
    // left / top
    expect(clampToViewport({ x: 0, y: 0 }, size, viewport)).toEqual({ x: 8, y: 8 });
    expect(clampToViewport({ x: -900, y: -900 }, size, viewport)).toEqual({ x: 8, y: 8 });
    // right: 1200 - 320 - 8. bottom: 800 - 44 - 8.
    expect(clampToViewport({ x: 5_000, y: 100 }, size, viewport)).toEqual({ x: 872, y: 100 });
    expect(clampToViewport({ x: 100, y: 5_000 }, size, viewport)).toEqual({ x: 100, y: 748 });
    expect(clampToViewport({ x: 5_000, y: 5_000 }, size, viewport)).toEqual({ x: 872, y: 748 });
  });

  it("takes a caller-supplied margin", () => {
    expect(clampToViewport({ x: 0, y: 0 }, size, viewport, 24)).toEqual({ x: 24, y: 24 });
    // right: 1200 - 320 - 24. bottom: 800 - 44 - 24.
    expect(clampToViewport({ x: 5_000, y: 5_000 }, size, viewport, 24)).toEqual({ x: 856, y: 732 });
    // Zero is a legal margin: flush against the edge.
    expect(clampToViewport({ x: 5_000, y: -5 }, size, viewport, 0)).toEqual({ x: 880, y: 0 });
  });

  it("pins a bar wider than the viewport to the margin rather than going negative", () => {
    // 320 - 400 - 8 would be -88: the bar would hang off the *left*, taking
    // its own drag grip with it.
    const narrow = { width: 320, height: 800 };
    expect(clampToViewport({ x: 0, y: 100 }, { width: 400, height: 44 }, narrow)).toEqual({
      x: 8,
      y: 100,
    });
    expect(clampToViewport({ x: 5_000, y: 100 }, { width: 400, height: 44 }, narrow)).toEqual({
      x: 8,
      y: 100,
    });
  });

  it("pins a bar taller than the viewport the same way", () => {
    const short = { width: 1_200, height: 60 };
    expect(clampToViewport({ x: 100, y: 5_000 }, { width: 320, height: 300 }, short)).toEqual({
      x: 100,
      y: 8,
    });
  });

  it("survives a viewport of nothing, which is what a minimised window measures", () => {
    expect(clampToViewport({ x: 40, y: 40 }, size, { width: 0, height: 0 })).toEqual({
      x: 8,
      y: 8,
    });
  });
});

/**
 * The other end of `clampToViewport`, and the reason it is in this file.
 *
 * That function is free to park the bar at `viewportHeight - barHeight - 8`,
 * and `.root` is `position: fixed`: a panel that only ever hung below the bar
 * opened *outside* the viewport for a bar dragged to the bottom of the screen,
 * where a fixed subtree cannot be scrolled to. The symbols palette - the whole
 * Pro vocabulary - was unreachable, with nothing on screen to say why. The two
 * functions are asserted together below, so the case that produced it is the
 * case that pins the fix.
 */
describe("dropSide", () => {
  const bar = { width: 320, height: 44 };
  const viewport = { width: 1_200, height: 800 };
  /** The bar's top and bottom, given where `clampToViewport` put it. */
  const at = (y: number): { top: number; bottom: number } => ({
    top: y,
    bottom: y + bar.height,
  });

  it("hangs below a bar with room under it", () => {
    expect(dropSide(at(100), 200, viewport.height)).toBe("below");
  });

  it("flips above a bar clampToViewport has parked at the bottom", () => {
    // The bug, in the two calls that produce it: the lowest position the clamp
    // allows, and the symbols panel's height at that position.
    const parked = clampToViewport({ x: 100, y: 5_000 }, bar, viewport);
    expect(parked.y).toBe(748); // 800 - 44 - 8

    expect(dropSide(at(parked.y), 200, viewport.height)).toBe("above");
    // Not a special case of "near the bottom": even a one-line panel does not
    // fit in the 8px margin left under a parked bar.
    expect(dropSide(at(parked.y), 36, viewport.height)).toBe("above");
  });

  it("counts the gap between the bar and the panel", () => {
    // 6px, and it is the offset BAR_CSS actually applies - interpolated into
    // both `top: calc(100% + Npx)` rules from this constant, so the arithmetic
    // and the stylesheet cannot drift (tests/draw-css.test.ts checks that end).
    expect(POPOVER_GAP_PX).toBe(6);
    // 800 - 8 = 792 of room below a bar whose bottom is at 592: 200 exactly
    // fits, 200 + the gap does not.
    expect(dropSide({ top: 548, bottom: 592 }, 194, 792 + 8)).toBe("below");
    expect(dropSide({ top: 548, bottom: 592 }, 195, 792 + 8)).toBe("above");
  });

  it("defaults to the bar's own margin", () => {
    const box = at(600);
    expect(dropSide(box, 150, viewport.height)).toBe(
      dropSide(box, 150, viewport.height, BAR_MARGIN_PX),
    );
    // A margin of 0 buys BAR_MARGIN_PX of room back, which is the difference
    // for a bar 16px off the bottom: 8 + the 6px gap fits under it, 8 + 8 + 6
    // does not.
    expect(dropSide(at(740), 8, 800)).toBe("above");
    expect(dropSide(at(740), 8, 800, 0)).toBe("below");
  });

  it("prefers below on a tie, so a menu does not change sides on a nudge", () => {
    // Equal room on both sides: below is where the trigger's caret points and
    // where the panel has always opened.
    expect(dropSide({ top: 300, bottom: 500 }, 100, 800)).toBe("below");
    expect(dropSide({ top: 300, bottom: 500 }, 292 - POPOVER_GAP_PX, 800)).toBe("below");
  });

  it("takes the larger side when the panel fits on neither", () => {
    // Nothing to be done for a panel taller than the window - but half of it
    // reachable beats none of it, and this is a 200% page zoom, not a fantasy.
    expect(dropSide({ top: 40, bottom: 84 }, 900, 400)).toBe("below");
    expect(dropSide({ top: 300, bottom: 344 }, 900, 400)).toBe("above");
  });

  it("survives a viewport of nothing, which is what a minimised window measures", () => {
    // Same guard as clampToViewport's: no room either way, and it still has to
    // return one of the two sides rather than NaN or undefined.
    expect(["above", "below"]).toContain(dropSide({ top: 0, bottom: 0 }, 100, 0));
  });
});
