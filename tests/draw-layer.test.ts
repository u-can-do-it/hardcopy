import { describe, expect, it } from "vitest";
import { Z_INDEX } from "@/lib/draw/css";
import { FRAME_HANDLE_PX, FRAME_RESIZE_ZONES, frameHandles } from "@/lib/draw/frame";
import { FRAME_STROKE, frameSpec, layerBoxStyle, markSpec } from "@/lib/draw/layer";
import { DRAW_COLORS, HIGHLIGHT_WIDTH_SCALE } from "@/lib/draw/model";
import { shapeToSpec } from "@/lib/draw/render";

import type {
  DrawRect,
  EllipseShape,
  LineShape,
  RectShape,
  Shape,
  StrokeShape,
  SymbolShape,
  TextShape,
} from "@/lib/draw/model";
import type { NodeSpec } from "@/lib/draw/render";

/**
 * The pure half of lib/draw/layer.ts, which is pure so that the properties the
 * whole feature rests on are guarded by an assertion rather than by a comment
 * (`.plan/design.md` §4.1, plus point 4 in layer.ts's own header):
 *
 * - `position: absolute`, because Chrome repaints a fixed element on *every*
 *   printed sheet - README Deviation 7, and the reason lib/dom/hide-fixed.ts
 *   exists - so a fixed layer would stamp one arrow onto all 14 pages.
 * - `overflow: clip` on a wrapper sized to exactly the document, because a
 *   stroke dragged past the bottom edge must not grow `scrollHeight`. That
 *   number is the paper size, via `planPageFromDocument()` and
 *   `session.getStableContentSize()`. `clip` and not `hidden`: `hidden` clips
 *   the same but also makes the box a scroll container, which the older CSS
 *   fragmentation rules call monolithic - a wrapper that will not break across
 *   sheets, the same class of bug as the one below.
 * - one small `<svg>` per mark, each holding its own bounding box, because an
 *   `<svg>` root in HTML is a replaced element and a replaced element cannot be
 *   split across two printed sheets. One document-sized `<svg>` would put every
 *   mark below the first sheet nowhere at all.
 *
 * The mount half is not here: this repo runs vitest with `environment: "node"`
 * and no DOM harness, on purpose (`CLAUDE.md`), so mounting is covered by
 * `pnpm compile` and by the Manual check in `.plan/tasks/10-draw-layer.md`.
 */

/** One declaration per entry, whitespace trimmed, empties dropped. */
function declarations(style: string): string[] {
  return style
    .split(";")
    .map((decl) => decl.trim())
    .filter((decl) => decl !== "");
}

/** The value of one property, `!important` stripped; `undefined` if unset. */
function valueOf(style: string, property: string): string | undefined {
  for (const decl of declarations(style)) {
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    if (decl.slice(0, colon).trim() !== property) continue;
    return decl
      .slice(colon + 1)
      .replace(/!important$/, "")
      .trim();
  }
  return undefined;
}

/** A long article at a typical window width, and no anchor correction needed. */
const SIZE = { width: 1280, height: 8421 };
const ORIGIN = { x: 0, y: 0 };

describe("layerBoxStyle", () => {
  it("is position: absolute, and never fixed", () => {
    const style = layerBoxStyle(SIZE, ORIGIN);
    expect(style).toContain("position:absolute");
    expect(valueOf(style, "position")).toBe("absolute");
    // The one value this string may never contain, at any specificity.
    expect(style).not.toMatch(/position\s*:\s*fixed/);
  });

  it("clips, so a stroke past the bottom edge cannot change the paper size", () => {
    const style = layerBoxStyle(SIZE, ORIGIN);
    expect(style).toContain("overflow:clip");
    expect(valueOf(style, "overflow")).toBe("clip");
    // `clip` and never `hidden`: `hidden` clips just the same, and keeps
    // scrollable overflow off the ancestors just the same, but it also makes
    // the wrapper a *scroll container* - which the older CSS fragmentation
    // rules treat as monolithic, so the wrapper itself may refuse to break
    // across printed sheets. That is the same class of bug as the one-<svg>-per
    // -document case below, and `clip` is the one-word way not to bet on it.
    expect(style).not.toMatch(/overflow\s*:\s*hidden/);
    // Content-box sizing plus a page's `* { padding: 8px }` would make the box
    // larger than the extent it was measured from, which is the same bug from
    // the other end.
    expect(valueOf(style, "box-sizing")).toBe("border-box");
    expect(valueOf(style, "padding")).toBe("0");
    expect(valueOf(style, "border")).toBe("0");
    expect(valueOf(style, "margin")).toBe("0");
  });

  it("keeps pointer-events inline, where setInteractive can still toggle it", () => {
    // lib/draw/css.ts leaves pointer-events out of LAYER_CSS for this reason:
    // an `!important` rule there would beat the inline value and the region
    // selector could never take the pointer back.
    const style = layerBoxStyle(SIZE, ORIGIN);
    expect(style).toContain("pointer-events");
    // Mounted interactive - drawing is what the layer is for.
    expect(valueOf(style, "pointer-events")).toBe("auto");
  });

  it("is exactly the size it was asked for", () => {
    const style = layerBoxStyle(SIZE, ORIGIN);
    expect(valueOf(style, "width")).toBe("1280px");
    expect(valueOf(style, "height")).toBe("8421px");
  });

  it("is exactly the offset it was asked for, negative and fractional included", () => {
    // What `anchorCorrection()` hands back on a page that put `position:
    // relative` and a margin on `html` - the case the measurement exists for.
    const style = layerBoxStyle(SIZE, { x: -8, y: -16.5 });
    expect(valueOf(style, "left")).toBe("-8px");
    expect(valueOf(style, "top")).toBe("-16.5px");
    // And the size is still the document's, with the correction nowhere in it.
    // Asserted *here*, at the only offset that is not (0, 0), because that is
    // where a `width: size.width + offset.x` would hide: the correction is
    // non-zero on exactly the page it exists for, and a box inflated by it is
    // larger than the document - which is the invariant above, failing on that
    // one page with the suite green.
    expect(valueOf(style, "width")).toBe("1280px");
    expect(valueOf(style, "height")).toBe("8421px");
  });

  it("writes a plain zero, never -0px", () => {
    // `anchorCorrection` goes out of its way to return `0` rather than `-0`;
    // this is the other end of that promise.
    const style = layerBoxStyle({ width: 0, height: 0 }, { x: -0, y: -0 });
    expect(valueOf(style, "left")).toBe("0px");
    expect(valueOf(style, "top")).toBe("0px");
    expect(style).not.toContain("-0px");
  });

  it("falls back to 0px rather than emitting a length the parser drops", () => {
    // A `width: NaNpx` declaration is discarded, which on an empty absolutely
    // positioned div leaves a box 0 wide - or, after a resize, whatever the
    // previous pass left behind. Visibly nothing beats invisibly stale.
    const style = layerBoxStyle(
      { width: Number.NaN, height: Number.POSITIVE_INFINITY },
      { x: Number.NaN, y: Number.NEGATIVE_INFINITY },
    );
    expect(valueOf(style, "width")).toBe("0px");
    expect(valueOf(style, "height")).toBe("0px");
    expect(valueOf(style, "left")).toBe("0px");
    expect(valueOf(style, "top")).toBe("0px");
    expect(style).not.toMatch(/NaN|Infinity/);
  });

  it("sits above every z-index a page can name", () => {
    // Pinned to css.ts so a change there cannot leave the layer behind the
    // page's own furniture.
    expect(valueOf(layerBoxStyle(SIZE, ORIGIN), "z-index")).toBe(String(Z_INDEX));
    expect(Z_INDEX).toBe(2_147_483_647);
  });

  it("declares everything !important - it is an overlay in someone else's CSS", () => {
    // `[data-pagepdf-draw]` in LAYER_CSS carries one attribute of specificity,
    // and a page's own `div.wrap { margin: 0 !important }` outranks it. Inline
    // `!important` outranks both.
    const style = layerBoxStyle(SIZE, ORIGIN);
    const decls = declarations(style);
    expect(decls.length).toBeGreaterThan(6);
    for (const decl of decls) expect(decl.endsWith("!important")).toBe(true);
  });

  it("never resets with `all`", () => {
    // The house pattern from select-area.ts's makeHost(), and wrong here:
    // inline `all: initial !important` would also reset print-color-adjust,
    // beating LAYER_CSS's forced `exact` and washing the marks out on exactly
    // the setting that exists to keep them saturated.
    expect(layerBoxStyle(SIZE, ORIGIN)).not.toMatch(/(^|;)\s*all\s*:/);
  });

  it("is one inline declaration block, not a stylesheet", () => {
    // It is assigned to `style.cssText`, so a selector or an at-rule in here
    // would not fail loudly - the whole string would simply be dropped.
    const style = layerBoxStyle(SIZE, ORIGIN);
    expect(style).not.toMatch(/[{}]/);
    expect(style).not.toMatch(/@media|@page/);
  });
});

// ---------------------------------------------------------------------------
// markSpec: one <svg> per mark, at the mark's own box
// ---------------------------------------------------------------------------

const COLOR = "#dc2626";

/** A five-sample scribble a long way down a long document. */
const PEN_POINTS = [
  { x: 420.5, y: 6180, pressure: 0.5 },
  { x: 448, y: 6188.25, pressure: 0.62 },
  { x: 470, y: 6175, pressure: 0.7 },
  { x: 502.75, y: 6202, pressure: 0.55 },
  { x: 540, y: 6190.5, pressure: 0.5 },
];

const PEN: StrokeShape = {
  kind: "stroke",
  id: "pagepdf-mark-1",
  color: COLOR,
  width: 4,
  highlight: false,
  points: PEN_POINTS,
};

const HIGHLIGHTER: StrokeShape = {
  ...PEN,
  id: "pagepdf-mark-2",
  width: 8,
  highlight: true,
};

const LINE: LineShape = {
  kind: "line",
  id: "pagepdf-mark-3",
  color: COLOR,
  width: 8,
  from: { x: 100, y: 4000 },
  to: { x: 340.5, y: 4048 },
};

const RECT: RectShape = {
  kind: "rect",
  id: "pagepdf-mark-4",
  color: COLOR,
  width: 8,
  // Required on the shape, and no business of `markBox` in any of its three
  // modes: a fill paints inside the path, and the outline it is inside is
  // already what the box is padded out from. An opaque `"cover"` reaches no
  // further than a translucent `"tint"` does.
  fill: "none",
  rect: { x: 200, y: 900, width: 160, height: 60 },
};

/** The same rectangle, dragged up and to the left. */
const RECT_BACKWARDS: RectShape = {
  ...RECT,
  id: "pagepdf-mark-5",
  rect: { x: 360, y: 960, width: -160, height: -60 },
};

const ELLIPSE: EllipseShape = {
  kind: "ellipse",
  id: "pagepdf-mark-6",
  color: COLOR,
  width: 8,
  fill: "none",
  rect: { x: 200, y: 900, width: 160, height: 60 },
};

/**
 * A wide, flat arrow - the case an arrowhead's barbs leave the rect on. The
 * barbs sit `min(length * 0.28, 28)` from the tip at 30 degrees off the shaft,
 * so on a 240x6 drag they hang ~14px above and below the six rows of pixels the
 * rect itself covers.
 */
const ARROW: SymbolShape = {
  kind: "symbol",
  id: "pagepdf-mark-7",
  color: COLOR,
  width: 4,
  symbol: "arrow",
  rect: { x: 100, y: 5000, width: 240, height: 6 },
};

const ARROW_DOUBLE: SymbolShape = { ...ARROW, id: "pagepdf-mark-8", symbol: "arrow-double" };

const STAR: SymbolShape = {
  kind: "symbol",
  id: "pagepdf-mark-9",
  color: COLOR,
  width: 8,
  symbol: "star",
  rect: { x: 100, y: 200, width: 64, height: 64 },
};

const PIN: SymbolShape = {
  kind: "symbol",
  id: "pagepdf-mark-10",
  color: COLOR,
  width: 2,
  symbol: "pin",
  rect: { x: 640, y: 7200, width: 32, height: 32 },
  index: 12,
};

const CHECK: SymbolShape = {
  kind: "symbol",
  id: "pagepdf-mark-11",
  color: COLOR,
  width: 8,
  symbol: "check",
  rect: { x: 12, y: 24, width: 40, height: 40 },
};

const BANG: SymbolShape = {
  kind: "symbol",
  id: "pagepdf-mark-12",
  color: COLOR,
  width: 8,
  symbol: "bang",
  rect: { x: 12, y: 24, width: 40, height: 96 },
};

const TEXT: TextShape = {
  kind: "text",
  id: "pagepdf-mark-13",
  color: COLOR,
  width: 2,
  // The box the label was laid out in, `x`/`y` being its top-left - what `at`
  // used to be. 22.4 is one line at 16px (`TEXT_LINE_HEIGHT`), and 240 is the
  // width a click makes a box (`DEFAULT_TEXT_WIDTH_PX`).
  rect: { x: 120, y: 3000, width: 240, height: 22.4 },
  text: "see figure 3",
  lines: ["see figure 3"],
  fontSize: 16,
};

const EVERY_KIND: readonly Shape[] = [
  PEN,
  HIGHLIGHTER,
  LINE,
  RECT,
  RECT_BACKWARDS,
  ELLIPSE,
  ARROW,
  ARROW_DOUBLE,
  STAR,
  PIN,
  CHECK,
  BANG,
  TEXT,
];

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The `<g>` that carries the translation. */
function groupOf(mark: NodeSpec): NodeSpec {
  const group = mark.children?.[0];
  if (group === undefined) throw new Error("mark has no <g>");
  return group;
}

/** The shape itself, which must be `shapeToSpec` output and nothing else. */
function shapeOf(mark: NodeSpec): NodeSpec {
  const shape = groupOf(mark).children?.[0];
  if (shape === undefined) throw new Error("mark has no shape");
  return shape;
}

/** The four numbers of the mark's own box, from its inline style. */
function boxOf(mark: NodeSpec): Box {
  const style = mark.attrs.style ?? "";
  const length = (property: string): number => {
    const value = valueOf(style, property);
    expect(value, `${property} in ${style}`).toMatch(/^-?\d+(\.\d+)?px$/);
    return Number.parseFloat(String(value));
  };
  return {
    left: length("left"),
    top: length("top"),
    width: length("width"),
    height: length("height"),
  };
}

interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const EMPTY: Extent = {
  minX: Number.POSITIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
  maxX: Number.NEGATIVE_INFINITY,
  maxY: Number.NEGATIVE_INFINITY,
};

function include(extent: Extent, x: number, y: number): Extent {
  return {
    minX: Math.min(extent.minX, x),
    minY: Math.min(extent.minY, y),
    maxX: Math.max(extent.maxX, x),
    maxY: Math.max(extent.maxY, y),
  };
}

function attr(spec: NodeSpec, name: string): number {
  return Number.parseFloat(spec.attrs[name] ?? "0");
}

/**
 * Where a spec tree actually paints, re-derived from the attributes
 * `shapeToSpec` produced rather than from anything in layer.ts.
 *
 * That independence is the point: `markBox` computes the box from the *shape*,
 * and this walks the *rendered geometry*, so an assertion that one contains the
 * other catches a box too tight to hold its own mark - which clips the mark's
 * edge, the one bug worse than the pagination bug the boxes exist to fix.
 *
 * Stroke width is added by the caller, from whichever element carries it (a
 * symbol puts it on the group, every other kind on the shape).
 */
function geometryExtent(spec: NodeSpec): Extent {
  let extent = EMPTY;

  const d = spec.attrs.d;
  if (d !== undefined && d !== "") {
    // Only `M`/`L` (and a closing `Z`) pair up as plain x,y - an arc's radii
    // and flags would be read as coordinates. `strokePath`'s one-tap `dotPath`
    // is the only arc the renderer emits, and it is asserted on its own below.
    expect(d, "path uses a command this helper cannot read").not.toMatch(/[^MLZ\d\s.,-]/);
    const numbers = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      extent = include(extent, Number(numbers[i]), Number(numbers[i + 1]));
    }
  }

  if (spec.tag === "rect") {
    extent = include(extent, attr(spec, "x"), attr(spec, "y"));
    extent = include(
      extent,
      attr(spec, "x") + attr(spec, "width"),
      attr(spec, "y") + attr(spec, "height"),
    );
  }

  if (spec.tag === "ellipse") {
    extent = include(extent, attr(spec, "cx") - attr(spec, "rx"), attr(spec, "cy") - attr(spec, "ry"));
    extent = include(extent, attr(spec, "cx") + attr(spec, "rx"), attr(spec, "cy") + attr(spec, "ry"));
  }

  if (spec.tag === "circle") {
    extent = include(extent, attr(spec, "cx") - attr(spec, "r"), attr(spec, "cy") - attr(spec, "r"));
    extent = include(extent, attr(spec, "cx") + attr(spec, "r"), attr(spec, "cy") + attr(spec, "r"));
  }

  // `<text>` is deliberately absent: an advance width needs a font, and this
  // suite has none - so a label's painted extent is the one thing this walker
  // cannot re-derive, and the label's box is asserted against the `rect` it was
  // wrapped to instead ("boxes a label at the rect it was wrapped to", below).
  for (const child of spec.children ?? []) {
    const inner = geometryExtent(child);
    if (Number.isFinite(inner.minX)) {
      extent = include(extent, inner.minX, inner.minY);
      extent = include(extent, inner.maxX, inner.maxY);
    }
  }

  return extent;
}

/** The geometry, grown by the half of `stroke-width` that falls outside it. */
function paintedExtent(spec: NodeSpec): Extent {
  const extent = geometryExtent(spec);
  const half = attr(spec, "stroke-width") / 2;
  return {
    minX: extent.minX - half,
    minY: extent.minY - half,
    maxX: extent.maxX + half,
    maxY: extent.maxY + half,
  };
}

describe("markSpec", () => {
  it("is one <svg> per mark, never one <svg> for the document", () => {
    // The reason this module was restructured: an <svg> root in HTML is a
    // replaced element, and a replaced element is monolithic - CSS
    // fragmentation cannot split it over two printed sheets. A document-sized
    // <svg> is laid out on one fragmentainer and clipped, so every mark below
    // the first sheet disappears.
    for (const shape of EVERY_KIND) {
      const mark = markSpec(shape);
      expect(mark.tag).toBe("svg");
      expect(mark.children).toHaveLength(1);
      expect(groupOf(mark).tag).toBe("g");
      expect(groupOf(mark).children).toHaveLength(1);
      // Sized to the mark, not to the page: 8421px is the document in SIZE.
      const box = boxOf(mark);
      expect(box.width).toBeLessThan(SIZE.height);
      expect(box.height).toBeLessThan(SIZE.height);
    }
  });

  it("leaves the geometry in document coordinates, untouched", () => {
    // The translation lives on the wrapper, so `lib/draw/render.ts` never has
    // to know marks are boxed and a mark's `d` in devtools still reads in the
    // coordinates the model stores.
    for (const shape of EVERY_KIND) {
      expect(shapeOf(markSpec(shape))).toEqual(shapeToSpec(shape));
    }
  });

  it("translates by exactly the box, so the mark lands where it was drawn", () => {
    for (const shape of EVERY_KIND) {
      const mark = markSpec(shape);
      const box = boxOf(mark);
      // The box is whole pixels, so the translate is exact - no rounding to
      // disagree with `left`/`top`.
      expect(Number.isInteger(box.left)).toBe(true);
      expect(Number.isInteger(box.top)).toBe(true);
      expect(groupOf(mark).attrs.transform).toBe(`translate(${-box.left} ${-box.top})`);
    }
  });

  it("prefers a <g> translate to a viewBox, which would scale and can disable", () => {
    // A viewBox divides by the box's own extent: zero for either disables
    // rendering of the element outright, and the ratio against a used width
    // Chrome snapped to 1/64px would put every mark a hair off the word it was
    // drawn around.
    for (const shape of EVERY_KIND) {
      const mark = markSpec(shape);
      expect(mark.attrs.viewBox).toBeUndefined();
      expect(mark.attrs.preserveAspectRatio).toBeUndefined();
      expect(groupOf(mark).attrs.transform).toMatch(/^translate\(-?\d+(\.\d+)? -?\d+(\.\d+)?\)$/);
    }
  });

  it("positions every mark absolutely, and never fixed", () => {
    // Point 1 one level down: a fixed mark repeats itself on all 14 sheets just
    // as a fixed wrapper would.
    for (const shape of EVERY_KIND) {
      const style = markSpec(shape).attrs.style ?? "";
      expect(valueOf(style, "position")).toBe("absolute");
      expect(style).not.toMatch(/position\s*:\s*fixed/);
    }
  });

  it("leaves a mark's own overflow visible - the wrapper is what clips", () => {
    // Deliberately the opposite of `layerBoxStyle`. The wrapper's clip is
    // inline `!important` inside a closed shadow root, so nothing can beat it
    // and the document cannot grow; a second clip on the mark could only shave
    // the edge off a mark whose box is padded arithmetic - and it is the whole
    // of what still covers a label whose glyphs paint past the box they were
    // wrapped to, now that layer.ts's `TEXT_EM_*` bounds are retired.
    for (const shape of EVERY_KIND) {
      expect(valueOf(markSpec(shape).attrs.style ?? "", "overflow")).toBe("visible");
    }
  });

  it("contains everything the mark actually paints", () => {
    // The assertion that matters: the extent is re-derived from the rendered
    // geometry (see `geometryExtent`), so a box too tight for its own mark
    // fails here rather than clipping an arrowhead in the exported PDF.
    for (const shape of EVERY_KIND) {
      if (shape.kind === "text") continue; // No font, no advance width.
      const mark = markSpec(shape);
      const box = boxOf(mark);
      const shapeSpec = shapeOf(mark);
      const ink = paintedExtent(shapeSpec);
      expect(Number.isFinite(ink.minX), `${shape.id} paints nothing`).toBe(true);
      expect(box.left, `${shape.id} left`).toBeLessThanOrEqual(ink.minX);
      expect(box.top, `${shape.id} top`).toBeLessThanOrEqual(ink.minY);
      expect(box.left + box.width, `${shape.id} right`).toBeGreaterThanOrEqual(ink.maxX);
      expect(box.top + box.height, `${shape.id} bottom`).toBeGreaterThanOrEqual(ink.maxY);
    }
  });

  it("pads a stroke by its ink, not by half of it - the `d` is already an outline", () => {
    // A stroke is a filled outline (`stroke: none`), and perfect-freehand
    // swells it past `width / 2` where the pointer moved slowly or pressed
    // hard: measured at up to 0.70x the size, and 1.24x for the 2px pen on a
    // tiny stroke. So the padding is the *whole* ink width, and a highlighter
    // is six times a pen.
    const pen = boxOf(markSpec(PEN));
    const highlighter = boxOf(markSpec(HIGHLIGHTER));
    const samples = { minX: 420.5, minY: 6175, maxX: 540, maxY: 6202 };

    expect(samples.minX - pen.left).toBeGreaterThanOrEqual(PEN.width);
    expect(pen.left + pen.width - samples.maxX).toBeGreaterThanOrEqual(PEN.width);
    expect(samples.minY - pen.top).toBeGreaterThanOrEqual(PEN.width);
    expect(pen.top + pen.height - samples.maxY).toBeGreaterThanOrEqual(PEN.width);

    const ink = HIGHLIGHTER.width * HIGHLIGHT_WIDTH_SCALE;
    expect(ink).toBe(48);
    expect(samples.minY - highlighter.top).toBeGreaterThanOrEqual(ink);
    expect(highlighter.height).toBeGreaterThan(pen.height);
  });

  it("keeps a one-sample tap's blob inside its box", () => {
    // `strokePath` renders a tap as `dotPath(at, width / 2)`, whose arc is the
    // one path this suite's extent walker cannot read - so it is asserted
    // directly: an 8px pen tapped once is an 8px blob, and the box has to hold
    // all of it.
    const tap: StrokeShape = { ...PEN, id: "pagepdf-mark-14", width: 8, points: [PEN_POINTS[0]!] };
    const box = boxOf(markSpec(tap));
    const at = PEN_POINTS[0]!;
    expect(at.x - box.left).toBeGreaterThanOrEqual(tap.width / 2);
    expect(box.left + box.width - at.x).toBeGreaterThanOrEqual(tap.width / 2);
    expect(at.y - box.top).toBeGreaterThanOrEqual(tap.width / 2);
    expect(box.top + box.height - at.y).toBeGreaterThanOrEqual(tap.width / 2);
  });

  it("holds an arrowhead's barbs, which are the one part of a mark outside its rect", () => {
    // A 240x6 drag: the barbs sit ~14px above and below the rect. This is the
    // assertion behind `ARROW_HEAD_PX`, which is a copy of `HEAD_MAX_PX` in
    // symbols.ts - if that cap grows, this is what says so.
    for (const arrow of [ARROW, ARROW_DOUBLE]) {
      const mark = markSpec(arrow);
      const box = boxOf(mark);
      const ink = paintedExtent(shapeOf(mark));
      expect(ink.minY).toBeLessThan(arrow.rect.y); // The barbs really do leave.
      expect(box.top).toBeLessThanOrEqual(ink.minY);
      expect(box.top + box.height).toBeGreaterThanOrEqual(ink.maxY);
    }
  });

  it("normalises a backwards drag rather than emitting a negative box", () => {
    // A rect dragged up and to the left arrives with negative extents;
    // `left: -160px` past its own corner would put the box somewhere else
    // entirely and clip the mark to nothing.
    const forwards = boxOf(markSpec(RECT));
    const backwards = boxOf(markSpec(RECT_BACKWARDS));
    expect(backwards).toEqual(forwards);
    expect(backwards.width).toBeGreaterThan(0);
    expect(backwards.height).toBeGreaterThan(0);
  });

  it("boxes a label at the rect it was wrapped to, and nothing more", () => {
    // The bound is *retired*, not loosened (.plan/design.md §13.4): a label
    // carries the box `layoutText` fitted its lines to, so this case is the
    // same one line as `rect` and `ellipse` - the rect, padded by
    // `MARK_PAD_PX`, rounded outward to whole pixels. No em estimate anywhere:
    // 120 - 2 floors to 118, and 3000 + 22.4 + 2 ceils to 3025.
    const box = boxOf(markSpec(TEXT));
    expect(box).toEqual({ left: 118, top: 2998, width: 244, height: 27 });

    // Which is to say: it contains the rect, `rect.x`/`rect.y` being the
    // top-left because the renderer sets `dominant-baseline: text-before-edge`.
    expect(box.left).toBeLessThanOrEqual(TEXT.rect.x);
    expect(box.top).toBeLessThanOrEqual(TEXT.rect.y);
    expect(box.left + box.width).toBeGreaterThanOrEqual(TEXT.rect.x + TEXT.rect.width);
    expect(box.top + box.height).toBeGreaterThanOrEqual(TEXT.rect.y + TEXT.rect.height);

    // And nothing more: `MARK_PAD_PX` is 2, plus at most a pixel of outward
    // rounding on each edge. The retired `TEXT_EM_ADVANCE` bound made this box
    // 196px wide for a 12-character label at 16px, and 532px for the 33-
    // character one below (33 x 16 + 2 x MARK_PAD_PX) - 2.2x the 240px the text
    // was actually wrapped to, and it grew with every further character.
    const slack = 3;
    expect(TEXT.rect.x - box.left).toBeLessThanOrEqual(slack);
    expect(TEXT.rect.y - box.top).toBeLessThanOrEqual(slack);
    expect(box.left + box.width - (TEXT.rect.x + TEXT.rect.width)).toBeLessThanOrEqual(slack);
    expect(box.top + box.height - (TEXT.rect.y + TEXT.rect.height)).toBeLessThanOrEqual(slack);
  });

  it("boxes a label from its rect alone - the text and the lines do not move it", () => {
    // The whole of what §13.4 changed. Same box, wrapped to the same 240px, and
    // three lines of it: a shape a session can actually produce, because
    // `layoutText` is the only producer of `lines` and it never disagrees with
    // `text`. The old em bound grew with `text.length`; this one cannot.
    const wrapped: TextShape = {
      ...TEXT,
      id: "pagepdf-mark-16",
      rect: { ...TEXT.rect, height: 67.2 },
      text: "see figure 3 and the one below it",
      lines: ["see figure 3 and the", "one below it"],
    };
    const box = boxOf(markSpec(wrapped));
    // Two lines wrapped into a box the user dragged three lines tall: the box
    // follows the rect, not the lines.
    expect(box).toEqual({ left: 118, top: 2998, width: 244, height: 72 });

    // A longer string in the *same* rect is the same box, which is the
    // assertion the em estimate could never have passed.
    const longer: TextShape = { ...wrapped, text: `${wrapped.text} and the two after that` };
    expect(boxOf(markSpec(longer))).toEqual(box);
  });

  it("normalises a label dragged up and to the left", () => {
    // A resize handle dragged past the opposite edge is `resizeFrame`'s job to
    // clamp, but nothing in the model promises `markBox` a positive extent -
    // and `left: -240px` past its own corner would put the box somewhere else
    // entirely and clip the label to nothing.
    const backwards: TextShape = {
      ...TEXT,
      id: "pagepdf-mark-17",
      rect: {
        x: TEXT.rect.x + TEXT.rect.width,
        y: TEXT.rect.y + TEXT.rect.height,
        width: -TEXT.rect.width,
        height: -TEXT.rect.height,
      },
    };
    expect(boxOf(markSpec(backwards))).toEqual(boxOf(markSpec(TEXT)));
  });

  it("degrades a non-finite coordinate to 0, in the box and in the translate alike", () => {
    // `coord()` emits `0` rather than an exponent that would truncate the whole
    // `d`, so a mark with a garbage coordinate paints at the origin - and its
    // box has to agree, or the two end up in different places.
    const broken: LineShape = {
      ...LINE,
      id: "pagepdf-mark-15",
      from: { x: Number.NaN, y: 4000 },
      to: { x: Number.POSITIVE_INFINITY, y: Number.NEGATIVE_INFINITY },
    };
    const mark = markSpec(broken);
    const style = mark.attrs.style ?? "";
    expect(style).not.toMatch(/NaN|Infinity/);
    expect(valueOf(style, "left")).toBe("0px");
    expect(valueOf(style, "width")).toBe("0px");
    expect(groupOf(mark).attrs.transform).toBe("translate(0 0)");
  });

  it("is one inline declaration block per mark, not a stylesheet", () => {
    for (const shape of EVERY_KIND) {
      const style = markSpec(shape).attrs.style ?? "";
      expect(style).not.toMatch(/[{}]/);
      expect(style).not.toMatch(/@media|@page/);
    }
  });
});

// ---------------------------------------------------------------------------
// frameSpec: the open editor's frame, which is chrome and must never print
// ---------------------------------------------------------------------------

/**
 * A one-line label at the default 240px width - the box a click makes - and the
 * same box handed over backwards.
 */
const FRAME_RECT: DrawRect = { x: 120, y: 3000, width: 240, height: 22.4 };
const FRAME_BACKWARDS: DrawRect = { x: 360, y: 3022.4, width: -240, height: -22.4 };

/** The smallest box a drag can reach: MIN_TEXT_WIDTH_PX x MIN_TEXT_HEIGHT_PX. */
const FRAME_TINY: DrawRect = { x: 40, y: 60, width: 40, height: 20 };

const EVERY_FRAME: readonly DrawRect[] = [FRAME_RECT, FRAME_BACKWARDS, FRAME_TINY];

/** Everything inside the frame's `<g>`, in document order. */
function partsOf(frame: NodeSpec): NodeSpec[] {
  return groupOf(frame).children ?? [];
}

/** The eight handles: the parts that carry a zone. */
function handlesOf(frame: NodeSpec): NodeSpec[] {
  return partsOf(frame).filter((part) => Object.hasOwn(part.attrs, "data-zone"));
}

/** The dashed box: the one part that does not. */
function dashedOf(frame: NodeSpec): NodeSpec {
  const boxes = partsOf(frame).filter((part) => !Object.hasOwn(part.attrs, "data-zone"));
  expect(boxes, "the frame should have exactly one box rect").toHaveLength(1);
  return boxes[0]!;
}

/** The four numbers off a `<rect>`'s own attributes. */
function rectOf(spec: NodeSpec): DrawRect {
  return {
    x: attr(spec, "x"),
    y: attr(spec, "y"),
    width: attr(spec, "width"),
    height: attr(spec, "height"),
  };
}

describe("frameSpec", () => {
  it("is a dashed box and eight handles, and nothing else", () => {
    for (const rect of EVERY_FRAME) {
      const frame = frameSpec(rect);
      expect(frame.tag).toBe("svg");
      expect(frame.children).toHaveLength(1);
      expect(groupOf(frame).tag).toBe("g");
      const parts = partsOf(frame);
      // Eight handles and one box. Nine, never ten: a tenth would be a handle
      // `frameZoneAt` does not know about, i.e. one you can see and cannot grab.
      expect(parts).toHaveLength(9);
      for (const part of parts) expect(part.tag).toBe("rect");
      expect(handlesOf(frame)).toHaveLength(8);
      // The box first, so a handle paints over the dashes it sits on.
      expect(parts[0]).toBe(dashedOf(frame));
    }
  });

  it("puts every handle at the exact rect frameHandles reports, zone and all", () => {
    // The point of exporting `frameHandles` (lib/draw/frame.ts): the handle you
    // can see and the handle you can grab are one function's answer. If these
    // two ever disagree, a corner resizes from somewhere other than where it is
    // drawn.
    for (const rect of EVERY_FRAME) {
      const handles = handlesOf(frameSpec(rect));
      const expected = frameHandles(rect);
      expect(handles).toHaveLength(expected.length);
      handles.forEach((handle, index) => {
        const want = expected[index]!;
        expect(handle.attrs["data-zone"]).toBe(want.zone);
        expect(rectOf(handle)).toEqual(want.rect);
        expect(rectOf(handle).width).toBe(FRAME_HANDLE_PX);
        expect(rectOf(handle).height).toBe(FRAME_HANDLE_PX);
      });
      // Corners first, then edges - `FRAME_RESIZE_ZONES`' order, which is what
      // decides that a corner beats the edge handle it abuts.
      expect(handles.map((handle) => handle.attrs["data-zone"])).toEqual([...FRAME_RESIZE_ZONES]);
    }
  });

  it("boxes the frame outside its rect, so no handle is clipped", () => {
    // The handles are *centred* on the edges, so half of each hangs outside the
    // rect: a box padded like a mark's would cut every one of them in half, and
    // the mark's `<svg>` is the element `overflow: visible` is set on for
    // exactly the case this makes sure cannot arise.
    for (const rect of EVERY_FRAME) {
      const frame = frameSpec(rect);
      const box = boxOf(frame);
      for (const handle of handlesOf(frame)) {
        const at = rectOf(handle);
        const zone = handle.attrs["data-zone"];
        expect(box.left, `${zone} left`).toBeLessThanOrEqual(at.x);
        expect(box.top, `${zone} top`).toBeLessThanOrEqual(at.y);
        expect(box.left + box.width, `${zone} right`).toBeGreaterThanOrEqual(at.x + at.width);
        expect(box.top + box.height, `${zone} bottom`).toBeGreaterThanOrEqual(at.y + at.height);
      }
      // And the box is the rect grown by a whole handle, which is the padding
      // `frameSpec` asks `outwardBox` for - a handle's worth on each side, with
      // half of it to spare.
      expect(box.width).toBeGreaterThanOrEqual(Math.abs(rect.width) + 2 * FRAME_HANDLE_PX);
      expect(box.height).toBeGreaterThanOrEqual(Math.abs(rect.height) + 2 * FRAME_HANDLE_PX);
    }
  });

  it("draws the dashed rect on the box itself, and fills it with nothing", () => {
    // `fill: none` is the whole of it: a filled frame is an opaque rectangle
    // over the label the user is typing. It is a presentation attribute on the
    // element rather than a rule in LAYER_SHADOW_CSS because a CSS declaration
    // beats a presentation attribute, so a later `rect { fill: ... }` there
    // would silently paint over the text.
    for (const rect of EVERY_FRAME) {
      const dashed = dashedOf(frameSpec(rect));
      expect(dashed.attrs.fill).toBe("none");
      // On the rect itself, not on the padded box: the frame has to read as the
      // edge of the text box, because that is the edge a resize moves.
      expect(rectOf(dashed)).toEqual({
        x: Math.min(rect.x, rect.x + rect.width),
        y: Math.min(rect.y, rect.y + rect.height),
        width: Math.abs(rect.width),
        height: Math.abs(rect.height),
      });
    }
  });

  it("gives each handle its own cursor, diagonal at the corners", () => {
    // The cursor is the only thing `data-zone` and this style are for: the
    // elements are never hit-tested, `frameZoneAt` is the authority on what a
    // press hit, and a handle that does not change the pointer does not look
    // like something you can drag.
    const wanted: Record<string, string> = {
      nw: "nwse-resize",
      se: "nwse-resize",
      ne: "nesw-resize",
      sw: "nesw-resize",
      n: "ns-resize",
      s: "ns-resize",
      e: "ew-resize",
      w: "ew-resize",
    };
    for (const handle of handlesOf(frameSpec(FRAME_RECT))) {
      const style = handle.attrs.style ?? "";
      const zone = handle.attrs["data-zone"];
      expect(valueOf(style, "cursor"), zone).toBe(wanted[zone]);
      // Nothing else in the string. `pointer-events` in particular: it is
      // inherited from the host, which is what lets `setInteractive(false)`
      // hand the pointer to the region selector in one declaration.
      expect(declarations(style)).toHaveLength(1);
      expect(style).not.toMatch(/pointer-events/);
    }
  });

  it("is positioned absolutely and never fixed, like every other box here", () => {
    // The frame lives inside the clipping wrapper, so it is bound by the same
    // invariant: a fixed element repaints on every printed sheet. The frame
    // must never print at all - which is two other mechanisms' job
    // (.plan/design.md §13.5) - but it may not be fixed on the way there.
    for (const rect of EVERY_FRAME) {
      const style = frameSpec(rect).attrs.style ?? "";
      expect(valueOf(style, "position")).toBe("absolute");
      expect(style).not.toMatch(/position\s*:\s*fixed/);
      expect(style).not.toMatch(/[{}]/);
      expect(style).not.toMatch(/@media|@page/);
    }
  });

  it("translates by exactly its box, so the frame lands on the rect it belongs to", () => {
    for (const rect of EVERY_FRAME) {
      const frame = frameSpec(rect);
      const box = boxOf(frame);
      expect(Number.isInteger(box.left)).toBe(true);
      expect(Number.isInteger(box.top)).toBe(true);
      expect(groupOf(frame).attrs.transform).toBe(`translate(${-box.left} ${-box.top})`);
      expect(frame.attrs.viewBox).toBeUndefined();
    }
  });

  it("normalises a backwards rect rather than emitting a negative box", () => {
    // A resize dragged past the opposite edge is `resizeFrame`'s to clamp, but
    // nothing promises this function a positive extent - and a negative
    // `width` on an SVG rect is an error, which draws nothing at all.
    expect(frameSpec(FRAME_BACKWARDS)).toEqual(frameSpec(FRAME_RECT));
  });

  it("degrades a non-finite rect to zero rather than emitting NaN", () => {
    // Same promise `markSpec` makes: a NaN width is an SVG error and paints
    // nothing, so the frame would vanish while the editor it belongs to is
    // still open and taking keystrokes.
    const broken = frameSpec({
      x: Number.NaN,
      y: 3000,
      width: Number.POSITIVE_INFINITY,
      height: Number.NEGATIVE_INFINITY,
    });
    expect(JSON.stringify(broken)).not.toMatch(/NaN|Infinity/);
    expect(valueOf(broken.attrs.style ?? "", "left")).toBe("0px");
    expect(groupOf(broken).attrs.transform).toBe("translate(0 0)");
  });
});

// ---------------------------------------------------------------------------
// FRAME_STROKE: the frame's ink, which may not be any pen's
// ---------------------------------------------------------------------------

describe("FRAME_STROKE", () => {
  it("is no member of DRAW_COLORS, so a frame never comes out in the user's ink", () => {
    // The only guard there is. The frame is chrome: it is `display: none`
    // whenever the layer is not interactive and the editor commits before every
    // capture, so it never reaches a PDF - which also means no manual check,
    // Ctrl+P included, can ever show a frame drawn in the colour the pen is
    // holding. The near miss is a selection blue: `#2563eb` is `DRAW_COLORS[3]`.
    //
    // `DRAW_COLORS` is imported rather than copied so this cannot go stale: a
    // sixth swatch, or a re-tuned blue, fails here instead of quietly colliding.
    const hex6 = /^#[0-9a-f]{6}$/;
    const frame = FRAME_STROKE.toLowerCase();
    // Both sides in the same notation, or `#fff` and `#ffffff` would be one
    // colour and two strings and the comparison below would mean nothing.
    expect(frame).toMatch(hex6);
    for (const color of DRAW_COLORS) {
      expect(color.toLowerCase(), `${color} is not written as #rrggbb`).toMatch(hex6);
      expect(color.toLowerCase(), `${color} is also the frame's ink`).not.toBe(frame);
    }
  });
});
