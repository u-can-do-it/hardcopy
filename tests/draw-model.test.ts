import { describe, expect, it } from "vitest";

import {
  coverAreas,
  DEFAULT_TEXT_WIDTH_PX,
  DRAW_ALL_TOOLS,
  DRAW_COLORS,
  DRAW_WIDTHS,
  FILL_OPACITY,
  HIGHLIGHT_WIDTH_SCALE,
  isDegenerate,
  isFreehand,
  MIN_SHAPE_PX,
  nextPinIndex,
  shapeId,
} from "@/lib/draw/model";
import type { Shape, SymbolShape } from "@/lib/draw/model";
import { coveredRuns } from "@/lib/dom/cover";
import type { Box, InkInset } from "@/lib/dom/cover";

/** A `ShapeBase` filled in, so each case below shows only what it is testing. */
const pen = { id: shapeId(0), color: DRAW_COLORS[0]!, width: 4 } as const;

function pin(index: number): SymbolShape {
  return { ...pen, kind: "symbol", symbol: "pin", rect: rect(20, 20), index };
}

function rect(width: number, height: number) {
  return { x: 100, y: 200, width, height };
}

/**
 * A label's box, at the width a click makes one and a line tall.
 *
 * A plausible `layoutText` answer rather than a special one: nothing in this
 * module reads a `TextShape`'s box - `isDegenerate` asks `text`, and
 * `nextPinIndex` counts pins - so the fixtures below only have to be boxes a
 * real label could have been laid out into.
 */
function textRect() {
  return { x: 10, y: 20, width: DEFAULT_TEXT_WIDTH_PX, height: 22.4 };
}

describe("the pen tables", () => {
  it("offers five colours, the first of which is the default pen", () => {
    // DEFAULT_DRAW_PREFS (contracts §7) reads DRAW_COLORS[0], so an empty or
    // reordered table would silently change the default pen.
    expect(DRAW_COLORS).toHaveLength(5);
    expect(DRAW_COLORS[0]).toBe("#dc2626");
    for (const color of DRAW_COLORS) expect(color).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(DRAW_COLORS).size).toBe(5);
  });

  it("offers the three stroke widths, ascending", () => {
    expect(DRAW_WIDTHS).toEqual([2, 4, 8]);
  });

  it("scales the highlighter wide enough to cover a line of body text", () => {
    // The default 4px pen has to end up fat enough to sit over 16px text; a
    // scale of 1 would make the highlighter indistinguishable from the pencil.
    expect(HIGHLIGHT_WIDTH_SCALE * 4).toBeGreaterThanOrEqual(16);
    expect(HIGHLIGHT_WIDTH_SCALE).toBeGreaterThan(1);
  });

  it("creates a text box wide enough to wrap a phrase into", () => {
    // Pinned, because it is the width every label is wrapped to until somebody
    // drags an edge (contracts §19.3): a smaller box breaks a sentence into a
    // column of single words, and a non-positive one turns wrapping off
    // entirely (`wrapLines`). 240 is contracts §19.3.
    expect(DEFAULT_TEXT_WIDTH_PX).toBe(240);
    expect(DEFAULT_TEXT_WIDTH_PX).toBeGreaterThan(0);
  });

  it("tints a shape at the alpha that makes a tint visibly not a redaction", () => {
    // Pinned here because this is the constant's own module; what it *does* to
    // a spec is tests/draw-render.test.ts. 0.35 is contracts §19.3, and the
    // range is the product decision for the one mode it governs: at 1 a
    // `"tint"` is an opaque bar that hides a password from the eye while
    // leaving every word underneath selectable in the PDF, and at 0 it draws no
    // interior at all. An opaque block is `"cover"`, which is honest because
    // the covered text is removed from the export rather than because of any
    // alpha (`.plan/design.md` §17-§19) - so this range is not a rule about
    // fills in general.
    const why = 'FILL_OPACITY governs "tint" alone - see .plan/design.md §17-§19';
    expect(FILL_OPACITY, why).toBe(0.35);
    expect(FILL_OPACITY, why).toBeGreaterThan(0);
    expect(FILL_OPACITY, why).toBeLessThan(1);
  });
});

describe("DRAW_ALL_TOOLS", () => {
  it("is every tool, in the order the bar draws them", () => {
    // The plain marks in `TOOL_GROUP`'s order (lib/draw/bar.ts), then the two
    // that are groups of their own further along the bar. Written out, because
    // this is the list `mergeDrawPrefs` validates a stored tool against
    // (tests/draw-prefs.test.ts iterates it and leaves the pinning to here).
    expect(DRAW_ALL_TOOLS).toEqual([
      "pencil",
      "highlighter",
      "line",
      "rect",
      "ellipse",
      "symbol",
      "text",
    ]);
  });

  it("has no filled tool left to put anywhere", () => {
    // `rect-fill` and `ellipse-fill` were members for one pass and are gone
    // again: the user asked for one menu common to both shapes, so a fill is
    // `DrawPrefs.fill` now and not a tool (`.plan/design.md` §18). Asserted as
    // strings against the runtime list rather than as types, because the type is
    // what a stale `DrawTool` member would still satisfy - and because a stored
    // pen holding one of these names is exactly what `mergeDrawPrefs` has to
    // answer with the pencil.
    for (const gone of ["rect-fill", "ellipse-fill"]) {
      expect(DRAW_ALL_TOOLS, gone).not.toContain(gone);
    }
    // Seven members. The count is the drift guard: `DrawTool` went to nine and
    // back, and the tables that have to move with it are exhaustive `Record`s
    // that tsc keeps honest.
    expect(DRAW_ALL_TOOLS).toHaveLength(7);
  });
});

describe("isFreehand", () => {
  it("names exactly the two sampled tools", () => {
    // Pinned as a set, not as a pair of `===`: `entrypoints/annotate.ts` samples
    // a point per pointer event for exactly these tools (`track`) and builds a
    // `StrokeShape` out of those samples for exactly these tools (`dragShape`),
    // so a tool that arrives in one half and not the other commits a one-sample
    // stroke. Whoever adds the third freehand tool has to come here, and the
    // note on `isFreehand` says what happens if they only add the shape.
    expect(DRAW_ALL_TOOLS.filter(isFreehand)).toEqual(["pencil", "highlighter"]);
  });

  it("keeps both box tools cornered, whatever fill is armed", () => {
    // Two corners, not a list of samples, and the fill cannot change that: it is
    // a pen setting that says what the box is painted with, never how it is
    // dragged (`.plan/design.md` §18). That is what let the two filled tools
    // leave `DRAW_TOOL_FREEHAND` rather than be answered in it. Freehand by
    // mistake and every box drag would commit the lone `pointerdown` sample as
    // a stroke - see the note on `isFreehand`.
    expect(isFreehand("rect")).toBe(false);
    expect(isFreehand("ellipse")).toBe(false);
  });

  it("classifies every tool in the table, one way or the other", () => {
    // `Record<DrawTool, boolean>` makes tsc the first line of defence: an
    // eighth `DrawTool` will not compile until it is classified. This is the
    // second - it fails on the runtime hole a cast or a stale table leaves,
    // where a missing entry reads as "not freehand" and the new pen silently
    // stops sampling instead of erroring.
    const sampled = DRAW_ALL_TOOLS.filter((tool) => isFreehand(tool) === true);
    const cornered = DRAW_ALL_TOOLS.filter((tool) => isFreehand(tool) === false);
    expect(sampled.length + cornered.length).toBe(DRAW_ALL_TOOLS.length);
  });
});

describe("shapeId", () => {
  it("is unique per sequence number and stable for one", () => {
    const ids = new Set([0, 1, 2, 3].map(shapeId));
    expect(ids.size).toBe(4);
    expect(shapeId(7)).toBe(shapeId(7));
  });

  it("never starts with a digit, so it is usable as an id in a selector", () => {
    expect(shapeId(0)).toMatch(/^[A-Za-z][\w-]*$/);
  });
});

describe("nextPinIndex", () => {
  it("starts at 1", () => {
    expect(nextPinIndex([])).toBe(1);
  });

  it("still starts at 1 when nothing on the page is a pin", () => {
    const shapes: Shape[] = [
      { ...pen, kind: "rect", rect: rect(80, 40), fill: "none" },
      { ...pen, kind: "symbol", symbol: "star", rect: rect(20, 20) },
      { ...pen, kind: "text", rect: textRect(), text: "note", lines: ["note"], fontSize: 16 },
    ];
    expect(nextPinIndex(shapes)).toBe(1);
  });

  it("counts pins only, ignoring the other six symbols", () => {
    const shapes: Shape[] = [
      pin(1),
      { ...pen, kind: "symbol", symbol: "arrow", rect: rect(30, 30) },
      pin(2),
      { ...pen, kind: "symbol", symbol: "check", rect: rect(30, 30) },
      pin(3),
    ];
    expect(nextPinIndex(shapes)).toBe(4);
  });

  it("hands the number back after an undo, because it counts rather than maxes", () => {
    const shapes = [pin(1), pin(2), pin(3)];
    expect(nextPinIndex(shapes.slice(0, -1))).toBe(3);
  });
});

describe("coverAreas", () => {
  /**
   * A box mark of the given kind and fill, somewhere harmless.
   *
   * `pen.width` is 4, so every expectation below is the rect grown by **2** on
   * each side - half the stroke, because SVG centres a stroke on its path.
   */
  const box = (
    kind: "rect" | "ellipse",
    fill: "none" | "tint" | "cover",
    over = rect(80, 40),
  ): Shape => ({ ...pen, kind, rect: over, fill });

  it("returns nothing for a page with no marks on it", () => {
    expect(coverAreas([])).toEqual([]);
  });

  it('picks the "cover" marks and leaves the other two fills alone', () => {
    // The whole tier of meaning between the three modes (.plan/design.md §18):
    // `"none"` and `"tint"` paint over text and leave every word of it in the
    // exported PDF - a tint is a read-through block on purpose - so a rect that
    // arrives here by mistake would delete text nobody asked to remove.
    const covering = box("rect", "cover", { x: 10, y: 20, width: 30, height: 40 });
    const shapes: Shape[] = [box("rect", "none"), box("rect", "tint"), covering];
    expect(coverAreas(shapes)).toEqual([
      { kind: "rect", box: { x: 8, y: 18, width: 34, height: 44 } },
    ]);
  });

  it("says which shape each cover is, so the ellipse is tested as an ellipse", () => {
    // The kind travels with the box because a bounding box is about 27% larger
    // than the ellipse inside it, and `render.ts` paints the ellipse: a
    // character in a corner lobe tested against the box is hidden from the
    // export with nothing painted over it - the word is gone from the PDF and
    // the space where it was is blank (.plan/contracts.md §29). `coversBox` in
    // lib/dom/cover.ts is what reads this field, and tests/cover.test.ts holds
    // the geometry; here it only has to arrive, and arrive in the order drawn.
    const first = { x: 0, y: 0, width: 50, height: 50 };
    const second = { x: 200, y: 300, width: 20, height: 10 };
    expect(coverAreas([box("rect", "cover", first), box("ellipse", "cover", second)])).toEqual([
      { kind: "rect", box: { x: -2, y: -2, width: 54, height: 54 } },
      { kind: "ellipse", box: { x: 198, y: 298, width: 24, height: 14 } },
    ]);
  });

  it("covers with nothing but the two box kinds - a stroke included", () => {
    // This function is the one place that decides which kinds can cover, and
    // the answer for everything else is no: `"cover"` on a stroke would be a
    // mask rather than a box (.plan/design.md §22), and `coversBox` takes a box
    // and a shape to fill it with. A highlighter over a password is a
    // highlighter.
    const shapes: Shape[] = [
      { ...pen, kind: "stroke", highlight: true, points: [{ x: 0, y: 0, pressure: 0.5 }] },
      { ...pen, kind: "line", from: { x: 0, y: 0 }, to: { x: 90, y: 0 } },
      { ...pen, kind: "symbol", symbol: "star", rect: rect(20, 20) },
      { ...pen, kind: "text", rect: textRect(), text: "note", lines: ["note"], fontSize: 16 },
    ];
    expect(coverAreas(shapes)).toEqual([]);
  });

  it("widens the box by half the stroke, because the outline paints outside it", () => {
    // SVG centres a stroke on its path, so an 8px outline puts 4px of solid pen
    // colour beyond the rect on every side. The characters hidden have to be
    // the characters the block is over: a glyph under that sliver is painted
    // over and, without this, still in the exported PDF's text layer - the
    // exact leak the feature exists to close, at the one place a user is most
    // likely to look, the edge of the block.
    const over = { x: 100, y: 200, width: 80, height: 40 };
    const fat: Shape = { ...pen, width: 8, kind: "rect", rect: over, fill: "cover" };
    expect(coverAreas([fat])[0]!.box).toEqual({ x: 96, y: 196, width: 88, height: 48 });

    // It scales with the pen, rather than being one fudge factor: the thin pen
    // grows the box by 1 on each side, the fat one by 4.
    const thin: Shape = { ...pen, width: 2, kind: "ellipse", rect: over, fill: "cover" };
    expect(coverAreas([thin])[0]!.box).toEqual({ x: 99, y: 199, width: 82, height: 42 });
  });

  it("normalises a cover dragged up and to the left, then widens it", () => {
    // A drag that ends above and left of where it started has negative extents,
    // and every one of `intersects`' comparisons reads that as a box with no
    // area - so an un-normalised cover would hide nothing at all while painting
    // a solid block over the words it was drawn to remove. The most dangerous
    // possible failure of this feature, and it is four lines of `Math.abs`.
    const dragged = coverAreas([box("rect", "cover", { x: 100, y: 200, width: -40, height: -20 })]);
    expect(dragged).toEqual([{ kind: "rect", box: { x: 58, y: 178, width: 44, height: 24 } }]);
    // The box does not move: it is the same area, described from its min corner,
    // plus the 2px of stroke that paints beyond each edge.
    expect(dragged[0]!.box.x + dragged[0]!.box.width).toBe(102);
    expect(dragged[0]!.box.y + dragged[0]!.box.height).toBe(200 + 2);
  });

  it("leaves an already-positive rect where it was, and only grows it", () => {
    const asDrawn = { x: 12.5, y: 33.25, width: 40.5, height: 19.75 };
    expect(coverAreas([box("ellipse", "cover", asDrawn)])).toEqual([
      { kind: "ellipse", box: { x: 10.5, y: 31.25, width: 44.5, height: 23.75 } },
    ]);
  });
});

/**
 * `coverAreas` composed with `coveredRuns`, which is the pair the user's export
 * actually runs and which nothing in this repo put together before.
 *
 * It is the composition that produced the report: `coverAreas` widens a cover by
 * half the pen, and `coveredRuns` decides which characters that widened block
 * takes. Each was tested alone and each was right alone - the widening is the
 * paint, and the greedy rule is §19.1 - and between them a cover dropped in the
 * empty leading between two lines took every word of the line above it
 * (`.plan/contracts.md` §31.1). That is why this suite lives here rather than
 * either half being asked about itself again.
 *
 * The fixture is the reported page's vertical geometry, from §31.1's
 * measurements: 18px Roboto at `line-height: 26px`, so a character's `Range` box
 * is the 21px font box, the lines are 26px apart, and there is a 5px gap of
 * leading between the box of a character on one line and the one below it. The
 * ink inside that box leaves 3.5px empty at the top and, for a line with no
 * descender in it, 3.82px at the bottom (`INK`); for a line that does descend,
 * 0.16px (`INK_DESCENDERS`). `tests/cover.test.ts` holds the same constants and
 * the rest of the rule.
 *
 * Which of the two a character gets is the amendment this suite is now about
 * (§31.4): the walker measures one inset per **line**, so `perLine` is what a
 * paragraph with a descender on its second line really hands `coveredRuns`, and
 * `nodeWide` is the single-inset-per-node measurement §31.4 rejects - kept here
 * because the difference between the two rows is the fix.
 */
describe("a cover dropped in the leading between two lines", () => {
  const FONT_H = 21;
  const LINE_PITCH = 26;
  const CHAR_W = 7;
  const INK: InkInset = { top: 3.5, bottom: 3.82 };
  const INK_DESCENDERS: InkInset = { top: 3.5, bottom: 0.16 };
  /** §31.1's own sweep resolution, and the unit its shares are quoted in. */
  const STEP = 0.25;

  /** One text node wrapped into two lines: characters 0-4, then 5-9. */
  const boxes: Box[] = [0, LINE_PITCH].flatMap((top) =>
    [0, 1, 2, 3, 4].map((i) => ({ x: i * CHAR_W, y: top, width: CHAR_W, height: FONT_H })),
  );

  /** One inset across the whole node: a node measured whole. */
  const nodeWide = (inset: InkInset): InkInset[] => new Array<InkInset>(10).fill(inset);

  /** Line 1's inset then line 2's: a node measured one line at a time. */
  const perLine = (first: InkInset, second: InkInset): InkInset[] => [
    ...new Array<InkInset>(5).fill(first),
    ...new Array<InkInset>(5).fill(second),
  ];

  /** A cover dragged from `top`, over line 2 and down, at one of the three pens. */
  const drawn = (top: number, width: (typeof DRAW_WIDTHS)[number]): Shape => ({
    ...pen,
    width,
    kind: "rect",
    rect: { x: -50, y: top, width: 600, height: 40 },
    fill: "cover",
  });

  /** Every position in the 5px gap of leading, at §31.1's resolution. */
  function gap(): number[] {
    const tops: number[] = [];
    for (let top = FONT_H; top <= LINE_PITCH; top += STEP) tops.push(top);
    return tops;
  }

  /**
   * How much of that gap still takes the line above, in px, swept as §31.1 swept
   * it: the count of positions that take line 1, times the 0.25px step.
   */
  function unsafeShare(
    width: (typeof DRAW_WIDTHS)[number],
    insets?: readonly InkInset[],
  ): number {
    const taken = gap().filter((top) => {
      const runs = coveredRuns(boxes, coverAreas([drawn(top, width)]), insets);
      return runs.some(([start]) => start < 5);
    });
    return taken.length * STEP;
  }

  it("leaves the line above alone unless the pen itself paints across its ink", () => {
    // The sweep, with the half-stroke widening in the picture. The expectation
    // is computed from the painted edge rather than asserted flat, because at
    // the 8px pen it is not flat and saying otherwise would be a fiction: 8px of
    // outline puts 4px of solid pen colour above the edge the user dragged, and
    // at the very top of a 5px gap that ink really does land on the line above.
    // Hiding it there is the greedy rule doing its job. Everywhere else in the
    // gap the block paints over neither line, and neither line may be touched.
    //
    // **This test's oracle is the implementation's own rule restated** -
    // `painted <= inkBottom` is what `inkBox` and `intersects` compute between
    // them - so on its own it is close to a tautology, and it is not what carries
    // the claim. What carries it is the flat assertions below: three swept
    // numbers per row, written down rather than derived, that change if the rule
    // moves in either direction. This one is here for the per-position message
    // when one of those rows goes red.
    const inkBottom = FONT_H - INK.bottom;
    for (const width of DRAW_WIDTHS) {
      for (const top of gap()) {
        const covers = coverAreas([drawn(top, width)]);
        const painted = covers[0]!.box.y;
        const reaches = painted <= inkBottom;
        const why = `${width}px pen dragged from ${top}: paints from ${painted}, line 1's ink ends at ${inkBottom}`;
        const insets = perLine(INK, INK_DESCENDERS);
        expect(coveredRuns(boxes, covers, insets), why).toEqual(reaches ? [[0, 10]] : [[5, 10]]);
      }
    }
  });

  it("reproduces §31.1's measured trap when there is no inset to shrink by", () => {
    // §31.1 swept the shipped code at 0.25px and found the unsafe share of the
    // 5px gap to be 1.25px at the 2px pen, 2.25px at 4px and 4.25px at 8px -
    // "where there is effectively nowhere between two lines to put an edge".
    //
    // **These three numbers do not validate the fixture**, and an earlier
    // version of this comment claimed they did. They are a function of
    // `DRAW_WIDTHS`, the 0.25px step and the sweep being anchored at the font-box
    // bottom - half a pen plus one step, three times over - so any two-line
    // fixture with a gap of 4px or more reproduces them, whatever its ink. The
    // fixture's constants are copied from §31.1 and §31.1 is the only thing that
    // vouches for them.
    //
    // What this is, and it is worth keeping: the regression guard on the
    // contract's stated default. `insets` omitted must behave exactly as the
    // module shipped, so these three numbers must not move.
    expect(DRAW_WIDTHS.map((width) => unsafeShare(width))).toEqual([1.25, 2.25, 4.25]);
  });

  it("closes that trap at the two thinner pens and all but closes it at the fattest", () => {
    // The same sweep with the inset the walker now measures for this paragraph -
    // line 1 has no descender, line 2 does: nothing left at 2px or 4px, the
    // default pen included, which is the one the report was drawn with. The one
    // 0.25px position left at 8px is where the pen's own 4px of overhang reaches
    // line 1's ink and the block genuinely paints over it.
    expect(DRAW_WIDTHS.map((width) => unsafeShare(width, perLine(INK, INK_DESCENDERS)))).toEqual([
      0, 0, 0.25,
    ]);
  });

  it("leaves 1px, 2px and 4px of the trap open when the node is measured whole", () => {
    // §31.4, in the unit §31.1 swept in, and the reason this round exists. One
    // inset for the node is the union over its glyphs, so line 2's descender
    // collapses line 1's bottom inset from 3.82px to 0.16px and line 1 is
    // treated as inked to within a sixth of a pixel of a font box it stops well
    // short of. A quarter-pixel off each pen is all that buys: 1 < 1.25,
    // 2 < 2.25, 4 < 4.25 - better, and not a fix.
    //
    // The middle number is the reported cover's own: 2px of the 4px pen's gap
    // still take a line nothing is painted over. Per line, that row is
    // [0, 0, 0.25].
    const wholeNode = DRAW_WIDTHS.map((width) => unsafeShare(width, nodeWide(INK_DESCENDERS)));
    expect(wholeNode).toEqual([1, 2, 4]);
    const perLineRow = DRAW_WIDTHS.map((width) => unsafeShare(width, perLine(INK, INK_DESCENDERS)));
    for (let i = 0; i < wholeNode.length; i += 1) expect(perLineRow[i]!).toBeLessThan(wholeNode[i]!);
  });

  it("clears the reported cover by 3.8px per line where measuring whole cleared it by 0.16", () => {
    // The user's own case, at the pen it was drawn with and one step inside the
    // window a node-wide measurement leaves open. §31.1's block paints from the
    // bottom of line 1's font box; §31.4 takes the next sweep position down - a
    // 4px pen dragged from 22.75, which paints from 20.75, 3.57px below line 1's
    // last ink at 17.18 and over nothing of line 1 at all.
    //
    // Measured whole, the whole line goes anyway. Measured per line it does not,
    // and this pair of assertions is the round's entire claim.
    const reported = coverAreas([drawn(22.75, 4)]);
    expect(reported[0]!.box.y).toBe(20.75);
    expect(coveredRuns(boxes, reported, nodeWide(INK_DESCENDERS))).toEqual([[0, 10]]);
    expect(coveredRuns(boxes, reported, perLine(INK, INK_DESCENDERS))).toEqual([[5, 10]]);

    // How much room each measurement leaves, in the px §31.4 quotes: 3.82 below
    // line 1's font box per line, 0.16 - less than one sweep step - whole.
    expect(FONT_H - (FONT_H - INK.bottom)).toBeCloseTo(3.82, 10);
    expect(FONT_H - (FONT_H - INK_DESCENDERS.bottom)).toBeCloseTo(0.16, 10);
    expect(INK_DESCENDERS.bottom).toBeLessThan(STEP);
  });

  it("still hides the line the block is drawn over, at every pen", () => {
    // The leak-prevention half, unchanged: a cover dragged over line 2 takes
    // every character of it whatever the pen, and the inset is not an excuse to
    // hide less than the block paints over.
    for (const width of DRAW_WIDTHS) {
      const covers = coverAreas([drawn(LINE_PITCH + 5, width)]);
      expect(coveredRuns(boxes, covers, perLine(INK, INK_DESCENDERS)), `${width}px pen`).toEqual([
        [5, 10],
      ]);
    }
  });
});

describe("isDegenerate", () => {
  it("puts the smallest keepable mark at 4px", () => {
    // Pinned, not derived: every threshold case below is written relative to
    // MIN_SHAPE_PX, so without this the value can drift with the suite green.
    // It moves user-visible behaviour both ways - raise it and deliberate small
    // marks vanish, lower it and a swallowed link-click leaves a speck in the
    // PDF. contracts.md §3 names 4.
    expect(MIN_SHAPE_PX).toBe(4);
  });

  it("discards a line shorter than MIN_SHAPE_PX and keeps a real one", () => {
    const at = (x: number, y: number) => ({ ...pen, kind: "line" as const, from: { x: 0, y: 0 }, to: { x, y } });
    expect(isDegenerate(at(0, 0))).toBe(true);
    expect(isDegenerate(at(2, 2))).toBe(true); // ~2.8px: a click that slipped
    expect(isDegenerate(at(0, 120))).toBe(false);
    expect(isDegenerate(at(MIN_SHAPE_PX, 0))).toBe(false); // the threshold itself counts
  });

  it("discards a rect or ellipse flat in either axis", () => {
    // `fill` is a required `FillMode` on both kinds and no part of this
    // measurement: a mark is worth keeping for its size, not for what is
    // painted inside it - a cover included.
    for (const kind of ["rect", "ellipse"] as const) {
      const at = (w: number, h: number): Shape => ({
        ...pen,
        kind,
        rect: rect(w, h),
        fill: "none",
      });
      expect(isDegenerate(at(0, 0))).toBe(true);
      expect(isDegenerate(at(400, 1))).toBe(true);
      expect(isDegenerate(at(1, 400))).toBe(true);
      expect(isDegenerate(at(400, 200))).toBe(false);
    }
  });

  it("measures a rect drawn right-to-left the same way", () => {
    expect(isDegenerate({ ...pen, kind: "rect", rect: rect(-400, -200), fill: "none" })).toBe(
      false,
    );
    expect(isDegenerate({ ...pen, kind: "rect", rect: rect(-400, -1), fill: "none" })).toBe(true);
  });

  it("discards a symbol too small to read", () => {
    expect(isDegenerate({ ...pen, kind: "symbol", symbol: "arrow", rect: rect(2, 2) })).toBe(true);
    expect(isDegenerate({ ...pen, kind: "symbol", symbol: "arrow", rect: rect(24, 24) })).toBe(false);
    expect(isDegenerate(pin(1))).toBe(false);
  });

  it("discards a label with nothing in it, whitespace included", () => {
    const label = (text: string): Shape => ({
      ...pen,
      kind: "text",
      rect: textRect(),
      text,
      // A layout cache of `text`, and `layoutText` is its only real producer
      // (contracts §19.1). A fixture only has to be consistent with its own
      // text, which for these is one line per hard break.
      lines: text.split("\n"),
      fontSize: 16,
    });
    expect(isDegenerate(label(""))).toBe(true);
    expect(isDegenerate(label("   \n\t "))).toBe(true);
    expect(isDegenerate(label("see §4"))).toBe(false);
  });

  it("reads a label's text and not its lines, which are derived", () => {
    // Contracts §19.1 in one assertion: `text` is the source of truth and
    // `lines` is a cache of how it was laid out, so a box wrapped into two
    // lines of spaces is still an empty label, and a real label with a cache
    // that has not caught up is still a label. Reading `lines` here would make
    // "is this worth keeping?" depend on the box it happened to be typed into.
    const label = { ...pen, kind: "text" as const, rect: textRect(), fontSize: 16 };
    expect(isDegenerate({ ...label, text: "  ", lines: ["  ", "  "] })).toBe(true);
    expect(isDegenerate({ ...label, text: "see §4", lines: [] })).toBe(false);
  });

  it("keeps a deliberate dot: one sample from a pen fatter than MIN_SHAPE_PX", () => {
    // A one-sample stroke has a zero-size bounding box, so the ink it lays
    // down is the only thing that can make it a mark. An 8px pen tapped once
    // leaves an 8px blob, which somebody meant.
    const dot = { ...pen, kind: "stroke" as const, highlight: false, points: [{ x: 50, y: 60, pressure: 0.5 }] };
    expect(isDegenerate({ ...dot, width: 8 })).toBe(false);
    expect(isDegenerate({ ...dot, width: 8, points: [] })).toBe(true); // no samples, no ink
    expect(isDegenerate({ ...dot, width: 2 })).toBe(true); // a 2px speck: a stray click
    // The highlighter is 6x wide, so even its thin pen leaves a real mark.
    expect(isDegenerate({ ...dot, width: 2, highlight: true })).toBe(false);
  });

  it("keeps a one-sample highlighter at every width, and drops only the thinnest pencil", () => {
    // The failure mode behind `isFreehand`'s note, held as a test rather than
    // asserted in a comment: with one sample `points.length < 2` always holds
    // and the bounding box is zero, so the verdict is `inkWidth` alone. The
    // highlighter's 6x scale clears MIN_SHAPE_PX at all three widths, so an
    // unsampled highlighter would leave a fat dot on every drag - never a
    // silently dropped mark. The 2px pencil is the one combination that goes.
    const tap = (width: (typeof DRAW_WIDTHS)[number], highlight: boolean): Shape => ({
      ...pen,
      kind: "stroke",
      width,
      highlight,
      points: [{ x: 50, y: 60, pressure: 0.5 }],
    });
    for (const width of DRAW_WIDTHS) {
      expect(width * HIGHLIGHT_WIDTH_SCALE).toBeGreaterThanOrEqual(MIN_SHAPE_PX);
      expect(isDegenerate(tap(width, true))).toBe(false);
    }
    expect(DRAW_WIDTHS.filter((width) => isDegenerate(tap(width, false)))).toEqual([2]);
  });

  it("keeps any stroke with two or more samples", () => {
    const points = [
      { x: 10, y: 10, pressure: 0.5 },
      { x: 11, y: 10, pressure: 0.5 },
    ];
    expect(isDegenerate({ ...pen, kind: "stroke", highlight: false, width: 2, points })).toBe(false);
  });
});
