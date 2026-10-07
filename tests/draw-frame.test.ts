import { describe, expect, it } from "vitest";

import {
  FRAME_HANDLE_PX,
  FRAME_RESIZE_ZONES,
  frameHandles,
  frameZoneAt,
  MIN_TEXT_HEIGHT_PX,
  MIN_TEXT_WIDTH_PX,
  moveFrame,
  resizeFrame,
} from "@/lib/draw/frame";
import type { FrameZone } from "@/lib/draw/frame";
import type { DrawRect, Vec2 } from "@/lib/draw/model";

/**
 * The frame's geometry, asserted without a document - task 22 draws what this
 * module measures, and task 24 feeds it deltas, so everything here is four
 * functions over plain numbers (`CLAUDE.md`).
 *
 * Two things are pinned deliberately rather than incidentally:
 *
 * - **the order of `FRAME_RESIZE_ZONES`**, because `frameZoneAt` returns the
 *   first handle a press is inside, so that array is where "corners beat edges"
 *   is decided;
 * - **all eight cases of `resizeFrame`**, one assertion each. Four of the eight
 *   move a leading edge, where the offset shrinks as the extent grows; a sign
 *   transposed there passes any test that only exercises `se`.
 */

/** The reference box: 200x100 at (100, 50), so no two handles can overlap. */
const BOX: DrawRect = { x: 100, y: 50, width: 200, height: 100 };

/** The same box described by a drag that ran north-west. */
const REVERSED: DrawRect = { x: 300, y: 150, width: -200, height: -100 };

/**
 * A box that arrived under both minimums, which `resizeFrame` has to grow on
 * whichever axis the drag did not name.
 *
 * The third rect the postcondition is checked against, because `BOX` is over
 * both minimums and so never reaches the `Math.max(trail + …, lead + floor)`
 * side of the clamp at all.
 */
const SUB_MIN: DrawRect = { x: 10, y: 10, width: 5, height: 5 };

const MIN = { width: MIN_TEXT_WIDTH_PX, height: MIN_TEXT_HEIGHT_PX };

/** The handle a zone names, as a `{ zone, rect }` entry. */
function handle(rect: DrawRect, zone: FrameZone): DrawRect {
  const found = frameHandles(rect).find((h) => h.zone === zone);
  if (found === undefined) throw new Error(`no handle for ${zone}`);
  return found.rect;
}

function centreOf(rect: DrawRect): Vec2 {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function contains(rect: DrawRect, at: Vec2): boolean {
  return (
    at.x >= rect.x && at.x <= rect.x + rect.width && at.y >= rect.y && at.y <= rect.y + rect.height
  );
}

/**
 * Every `FrameZone`, as a compile-time-exhaustive list: a tenth zone added to
 * the union stops this file compiling rather than quietly going untested.
 */
const ALL_ZONES: Record<FrameZone, true> = {
  move: true,
  n: true,
  s: true,
  e: true,
  w: true,
  ne: true,
  nw: true,
  se: true,
  sw: true,
};

type ResizeZone = Exclude<FrameZone, "move">;

describe("the constants", () => {
  it("are the ones contracts.md §21 names", () => {
    // Pinned because each is a judgement call whose reasoning is in the doc
    // comment on it: 10px is a hit target that still leaves the midpoint handle
    // reachable on a 40px-wide box, and 40x20 is the smallest box that is still
    // a text box you can grab back.
    expect(FRAME_HANDLE_PX).toBe(10);
    expect(MIN_TEXT_WIDTH_PX).toBe(40);
    expect(MIN_TEXT_HEIGHT_PX).toBe(20);
  });

  it("lists the eight resize zones, and no `move`", () => {
    expect(FRAME_RESIZE_ZONES).toHaveLength(8);
    expect(FRAME_RESIZE_ZONES).not.toContain("move");
    expect([...FRAME_RESIZE_ZONES].sort()).toEqual(
      Object.keys(ALL_ZONES)
        .filter((zone) => zone !== "move")
        .sort(),
    );
  });

  it("lists the corners first, which is what makes corners beat edges", () => {
    // `frameZoneAt` scans in this order and returns the first hit, so this is
    // not cosmetic: reorder it and the hit test changes.
    expect(FRAME_RESIZE_ZONES.slice(0, 4)).toEqual(["nw", "ne", "se", "sw"]);
    expect(FRAME_RESIZE_ZONES.slice(4)).toEqual(["n", "e", "s", "w"]);
  });
});

describe("frameHandles", () => {
  it("returns one square handle per resize zone, in that order", () => {
    const handles = frameHandles(BOX);

    expect(handles).toHaveLength(FRAME_RESIZE_ZONES.length);
    expect(handles.map((h) => h.zone)).toEqual([...FRAME_RESIZE_ZONES]);
    for (const h of handles) {
      expect(h.rect.width).toBe(FRAME_HANDLE_PX);
      expect(h.rect.height).toBe(FRAME_HANDLE_PX);
    }
  });

  it("centres each handle on the corner or edge midpoint it names", () => {
    // Centred, not inset: half of each handle hangs outside the box, which is
    // what makes a one-line label grabbable.
    const expected: Record<ResizeZone, Vec2> = {
      nw: { x: 100, y: 50 },
      ne: { x: 300, y: 50 },
      se: { x: 300, y: 150 },
      sw: { x: 100, y: 150 },
      n: { x: 200, y: 50 },
      e: { x: 300, y: 100 },
      s: { x: 200, y: 150 },
      w: { x: 100, y: 100 },
    };

    for (const h of frameHandles(BOX)) {
      expect(centreOf(h.rect)).toEqual(expected[h.zone as ResizeZone]);
    }
  });

  it("normalises a negative extent, so no handle lands on the wrong side", () => {
    // A drag that ran north-west describes the same box with negative extents.
    // Without the normalisation, `nw` would sit on the south-east corner and
    // every resize would then pull the wrong edge.
    expect(frameHandles(REVERSED)).toEqual(frameHandles(BOX));
    expect(centreOf(handle(REVERSED, "nw"))).toEqual({ x: 100, y: 50 });
  });

  it("gives a zero-size box eight handles stacked on one point", () => {
    // Degenerate, and finite: `MIN_TEXT_*` is what keeps a *drag* from getting
    // here, but `frameHandles` takes any `DrawRect` and must not hand back NaN.
    const handles = frameHandles({ x: 10, y: 10, width: 0, height: 0 });
    for (const h of handles) {
      expect(centreOf(h.rect)).toEqual({ x: 10, y: 10 });
    }
  });
});

describe("frameZoneAt", () => {
  it("returns each handle's own zone at its centre", () => {
    for (const h of frameHandles(BOX)) {
      expect(frameZoneAt(BOX, centreOf(h.rect))).toBe(h.zone);
    }
  });

  it("hit-tests a reversed rect the same way", () => {
    for (const h of frameHandles(BOX)) {
      expect(frameZoneAt(REVERSED, centreOf(h.rect))).toBe(h.zone);
    }
  });

  it("lets a corner beat the edge handle it overlaps", () => {
    // The handles only overlap on a box narrower than two of them, which a
    // 12px box is - and which a drag can reach on the way to the minimum.
    const narrow: DrawRect = { x: 0, y: 0, width: 12, height: 12 };

    const northWest = { x: 3, y: 0 };
    expect(contains(handle(narrow, "nw"), northWest)).toBe(true);
    expect(contains(handle(narrow, "n"), northWest)).toBe(true);
    expect(frameZoneAt(narrow, northWest)).toBe("nw");

    // The other diagonal, so the preference is not an artefact of `nw` simply
    // being first in the array.
    const southEast = { x: 12, y: 9 };
    expect(contains(handle(narrow, "se"), southEast)).toBe(true);
    expect(contains(handle(narrow, "e"), southEast)).toBe(true);
    expect(frameZoneAt(narrow, southEast)).toBe("se");
  });

  it("is `move` anywhere inside the box that is not a handle", () => {
    expect(frameZoneAt(BOX, { x: 200, y: 100 })).toBe("move");
    // Including on the border, away from a midpoint: the dashed frame itself
    // moves the box.
    expect(frameZoneAt(BOX, { x: 140, y: 50 })).toBe("move");
    // And including the interior a caret is in: a press on the label you are
    // typing moves it, it does not commit it (contracts.md §21).
    expect(frameZoneAt(BOX, { x: 110, y: 60 })).toBe("move");
  });

  it("is `null` outside the frame", () => {
    expect(frameZoneAt(BOX, { x: 1_000, y: 1_000 })).toBeNull();
    // Just outside: the handles reach half their side past the box, so 6px
    // beyond the north-west corner is already nothing.
    expect(frameZoneAt(BOX, { x: 100, y: 44 })).toBeNull();
    expect(frameZoneAt(BOX, { x: 94, y: 100 })).toBeNull();
    // And a point beside the box, level with an edge handle's centre.
    expect(frameZoneAt(BOX, { x: 306, y: 100 })).toBeNull();
  });
});

describe("moveFrame", () => {
  it("translates and changes nothing else", () => {
    expect(moveFrame(BOX, { x: -10, y: 25 })).toEqual({
      x: 90,
      y: 75,
      width: 200,
      height: 100,
    });
    expect(moveFrame(BOX, { x: 0, y: 0 })).toEqual(BOX);
  });

  it("passes a negative extent through rather than normalising it", () => {
    // "No clamping - the layer clips", and no tidying either: the caller gets
    // its own box back, where it put it.
    expect(moveFrame(REVERSED, { x: 5, y: 5 })).toEqual({
      x: 305,
      y: 155,
      width: -200,
      height: -100,
    });
  });

  it("does not clamp a box off the top of the document", () => {
    expect(moveFrame(BOX, { x: -500, y: -500 })).toEqual({
      x: -400,
      y: -450,
      width: 200,
      height: 100,
    });
  });
});

describe("resizeFrame", () => {
  it("moves the edges each of the eight zones names", () => {
    // One drag, +30 east and +20 south, applied to every zone. The box is
    // (100, 50) to (300, 150), so an unmoved edge is visible in the expected
    // numbers: `n` keeps `y + height === 150`, `w` keeps `x + width === 300`.
    const delta = { x: 30, y: 20 };
    const expected: Record<ResizeZone, DrawRect> = {
      n: { x: 100, y: 70, width: 200, height: 80 },
      s: { x: 100, y: 50, width: 200, height: 120 },
      e: { x: 100, y: 50, width: 230, height: 100 },
      w: { x: 130, y: 50, width: 170, height: 100 },
      nw: { x: 130, y: 70, width: 170, height: 80 },
      ne: { x: 100, y: 70, width: 230, height: 80 },
      se: { x: 100, y: 50, width: 230, height: 120 },
      sw: { x: 130, y: 50, width: 170, height: 120 },
    };

    for (const zone of FRAME_RESIZE_ZONES) {
      expect(resizeFrame(BOX, zone, delta, MIN)).toEqual(expected[zone as ResizeZone]);
    }
  });

  it("touches only the axes a zone names", () => {
    // The other half of the table above, said as a rule: an edge handle moves
    // one axis and leaves the other's numbers alone.
    const delta = { x: 30, y: 20 };

    const north = resizeFrame(BOX, "n", delta, MIN);
    expect(north.x).toBe(BOX.x);
    expect(north.width).toBe(BOX.width);

    const east = resizeFrame(BOX, "e", delta, MIN);
    expect(east.y).toBe(BOX.y);
    expect(east.height).toBe(BOX.height);
  });

  it("normalises a reversed rect, so a resize pulls the edge it named", () => {
    expect(resizeFrame(REVERSED, "e", { x: 30, y: 0 }, MIN)).toEqual({
      x: 100,
      y: 50,
      width: 230,
      height: 100,
    });
  });

  it("pins the opposite edge when a drag passes the minimum", () => {
    // Dragging the west handle far east: the east edge stays where it was and
    // the box stops at the minimum width, rather than flipping inside out and
    // leaving the handles mirrored.
    const west = resizeFrame(BOX, "w", { x: 500, y: 0 }, MIN);
    expect(west.width).toBe(MIN_TEXT_WIDTH_PX);
    expect(west.x + west.width).toBe(BOX.x + BOX.width);
    expect(west.x).toBe(260);

    // And the same drag from the other side pins the west edge.
    const east = resizeFrame(BOX, "e", { x: -500, y: 0 }, MIN);
    expect(east.width).toBe(MIN_TEXT_WIDTH_PX);
    expect(east.x).toBe(BOX.x);

    const north = resizeFrame(BOX, "n", { x: 0, y: 500 }, MIN);
    expect(north.height).toBe(MIN_TEXT_HEIGHT_PX);
    expect(north.y + north.height).toBe(BOX.y + BOX.height);

    const south = resizeFrame(BOX, "s", { x: 0, y: -500 }, MIN);
    expect(south.height).toBe(MIN_TEXT_HEIGHT_PX);
    expect(south.y).toBe(BOX.y);

    // A corner clamps both axes at once, each against its own edge.
    expect(resizeFrame(BOX, "nw", { x: 500, y: 500 }, MIN)).toEqual({
      x: 260,
      y: 130,
      width: MIN_TEXT_WIDTH_PX,
      height: MIN_TEXT_HEIGHT_PX,
    });
  });

  it("is never mirrored and never negative, whatever the drag", () => {
    // Every rect the module can be handed, crossed with every zone and both
    // delta directions on each axis. One rect is not enough: `sign < 0` clamps
    // through `Math.min(lead + move, trail - floor)` and `sign >= 0` through
    // `Math.max(trail + …, lead + floor)`, `BOX` is already over both minimums
    // so it never exercises the second, and `REVERSED` proves the normalisation
    // runs before either of them.
    const rects: readonly { label: string; rect: DrawRect }[] = [
      { label: "normal", rect: BOX },
      { label: "reversed", rect: REVERSED },
      { label: "sub-minimum", rect: SUB_MIN },
    ];
    const deltas: Vec2[] = [
      { x: 0, y: 0 },
      { x: 1_000, y: 1_000 },
      { x: -1_000, y: -1_000 },
      { x: 1_000, y: -1_000 },
      { x: -1_000, y: 1_000 },
      // Small enough that a rect over the minimum stays over it, so the
      // unclamped arithmetic is in here too.
      { x: 30, y: 20 },
      { x: -30, y: -20 },
    ];

    for (const { label, rect } of rects) {
      for (const zone of FRAME_RESIZE_ZONES) {
        for (const delta of deltas) {
          const out = resizeFrame(rect, zone, delta, MIN);
          const where = `${label} ${zone} by (${delta.x}, ${delta.y})`;
          expect(out.width, where).toBeGreaterThanOrEqual(MIN.width);
          expect(out.height, where).toBeGreaterThanOrEqual(MIN.height);
        }
      }
    }
  });

  it("keeps the box positive even when handed a minimum of zero", () => {
    // contracts.md §21 promises a positive `width` and `height` for every
    // input, which a `min` of zero cannot honour as given - and a box dragged to
    // nothing has no edge left to grab it back by. The module's own minimum
    // stands in.
    const out = resizeFrame(BOX, "w", { x: 1_000, y: 0 }, { width: 0, height: 0 });
    expect(out.width).toBe(MIN_TEXT_WIDTH_PX);
    expect(out.x + out.width).toBe(BOX.x + BOX.width);
  });

  it("grows a box that arrived under the minimum", () => {
    const out = resizeFrame(SUB_MIN, "e", { x: 0, y: 0 }, MIN);
    expect(out).toEqual({
      x: 10,
      y: 10,
      width: MIN_TEXT_WIDTH_PX,
      height: MIN_TEXT_HEIGHT_PX,
    });
  });

  it("is a no-op for `move`", () => {
    // `moveFrame` is that zone's function. A caller that forgets to branch
    // moves nothing rather than resizing by a whole diagonal.
    expect(resizeFrame(BOX, "move", { x: 50, y: 50 }, MIN)).toEqual(BOX);
    // Ahead of the normalisation, too: "unchanged" means unchanged - a
    // sub-minimum box is not grown and a negative extent is not tidied, which is
    // the one place this module does not honour §21's blanket postcondition (see
    // the note on `resizeFrame`).
    expect(resizeFrame(REVERSED, "move", { x: 50, y: 50 }, MIN)).toEqual(REVERSED);
    expect(resizeFrame(SUB_MIN, "move", { x: 50, y: 50 }, MIN)).toEqual(SUB_MIN);
  });

  it("returns a copy for `move`, not the caller's own rect", () => {
    // Unchanged, not aliased: every other path returns a fresh object, and a
    // caller that mutated this one would be mutating the editor's rect.
    const out = resizeFrame(BOX, "move", { x: 50, y: 50 }, MIN);
    expect(out).toEqual(BOX);
    expect(out).not.toBe(BOX);
  });
});
