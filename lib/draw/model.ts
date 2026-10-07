/**
 * The shape model: what a mark *is*, before anything knows how to draw it.
 *
 * Everything here is plain JSON and pure functions - no DOM, no chrome.*, and
 * nothing but **types** imported, from `../types` and from `../dom/cover`. That
 * is deliberate: a `Shape[]` is the whole state of the drawing layer, so the
 * undo stack (lib/draw/history.ts), the renderer (lib/draw/render.ts) and the
 * injected entrypoint can all be reasoned about - and unit-tested - without a
 * document in sight. `../dom/cover` is a directory this one would not normally
 * reach into; the import is type-only, so it adds nothing to any bundle, and
 * that module's pure half imports nothing at all, so no cycle is possible
 * (`.plan/contracts.md` §29.2).
 *
 * Coordinates are **document** coordinates in CSS px, matching the layer that
 * carries them (`.plan/design.md` §4.1): the origin is the top of the page, not
 * the top of the viewport, so a stroke keeps its place when the page scrolls.
 *
 * Covered by tests/draw-model.test.ts.
 */

import type { Cover, CoverKind } from "../dom/cover";
import type { DrawTool, FillMode, StrokeWidth, SymbolKind } from "../types";

export interface Vec2 {
  x: number;
  y: number;
}

/** One pointer sample. `pressure` is 0..1; 0.5 for a mouse. */
export interface StrokePoint extends Vec2 {
  pressure: number;
}

/**
 * A rectangle in *document* coordinates, CSS px. Not rounded - SVG is happy
 * with fractions.
 *
 * Structurally a `CaptureRect` (../types) and still its own type: that one is
 * rounded to whole pixels on the way into `Page.captureScreenshot`'s clip, and
 * rounding a mark would nudge it off whatever it was drawn around.
 */
export interface DrawRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShapeBase {
  id: string;
  /** CSS colour. */
  color: string;
  width: StrokeWidth;
}

export interface StrokeShape extends ShapeBase {
  kind: "stroke";
  points: StrokePoint[];
  /** The highlighter: fat width plus `mix-blend-mode: multiply`. */
  highlight: boolean;
}
export interface LineShape extends ShapeBase {
  kind: "line";
  from: Vec2;
  to: Vec2;
}
export interface RectShape extends ShapeBase {
  kind: "rect";
  rect: DrawRect;
  /**
   * `"none"`, `"tint"` or `"cover"` - see `FillMode` in ../types.
   *
   * Was a `boolean` in tasks 26/27; the third member is what the user asked
   * for, and a boolean cannot hold it. `"cover"` is the mode whose meaning
   * reaches outside the renderer: `entrypoints/annotate.ts` collects the
   * painted areas of every `"cover"` shape (`coverAreas`) and hands them to
   * `hideTextUnder` for the duration of an export (`.plan/design.md` §20).
   */
  fill: FillMode;
}
export interface EllipseShape extends ShapeBase {
  kind: "ellipse";
  rect: DrawRect;
  /** As `RectShape.fill`. */
  fill: FillMode;
}
export interface SymbolShape extends ShapeBase {
  kind: "symbol";
  symbol: SymbolKind;
  rect: DrawRect;
  /** 1, 2, 3... for `symbol: "pin"`; absent for every other symbol. */
  index?: number;
}
export interface TextShape extends ShapeBase {
  kind: "text";
  /**
   * The label's box, in document coordinates. `x`/`y` is its top-left, which
   * is what `at` already meant - the renderer sets
   * `dominant-baseline: text-before-edge` so the text starts at the top of the
   * box rather than one line-height above it.
   *
   * `width` is what the text was wrapped to. `height` is
   * `max(what the user dragged, what the lines need)` - see `layoutText`.
   */
  rect: DrawRect;
  /** The label as typed. `\n` for a hard break. The source of truth. */
  text: string;
  /**
   * The label as laid out, one entry per rendered line.
   *
   * A **layout cache**, and `layoutText` (lib/draw/wrap.ts) is its only
   * producer. Duplicating `text` is unavoidable: wrapping needs advance widths,
   * advance widths need a font, and `render.ts` is pure and runs without a
   * document. So the measuring happens once on the side of the seam that has a
   * document, and the answer travels here.
   */
  lines: readonly string[];
  /** CSS px. */
  fontSize: number;
}

export type Shape =
  | StrokeShape
  | LineShape
  | RectShape
  | EllipseShape
  | SymbolShape
  | TextShape;

/**
 * Red, amber, green, blue, near-black. Five is enough; the sixth is the colour
 * input.
 *
 * Mid-tone rather than pure: `#ff0000` on a white page prints muddy and reads
 * as an error state, and pure black is indistinguishable from body text at
 * 2px. The near-black is the same slate as the bar's own background in
 * lib/draw/css.ts, so a mark and the tool that made it are visibly one thing.
 * `DRAW_COLORS[0]` is the default pen (§7, `DEFAULT_DRAW_PREFS`).
 */
export const DRAW_COLORS: readonly string[] = [
  "#dc2626", // red
  "#f59e0b", // amber - the highlighter's natural colour
  "#16a34a", // green
  "#2563eb", // blue
  "#0f172a", // near-black
];

/** The three pen widths, in CSS px. See `StrokeWidth` in ../types for why three. */
export const DRAW_WIDTHS: readonly StrokeWidth[] = [2, 4, 8];

/**
 * The highlighter is the pencil at this multiple of the selected width.
 *
 * 6x puts the default 4px pen at 24px, which covers a 16px line of body text
 * with a little bleed above and below - the way a real highlighter sits over a
 * line. The thin pen becomes a 12px marker for small print and the fat one a
 * 48px band for a heading or a whole paragraph, so the width control keeps
 * meaning something instead of collapsing into one highlighter size.
 */
export const HIGHLIGHT_WIDTH_SCALE: number = 6;

/**
 * The alpha of a **`"tint"`** interior, and of nothing else. The outline stays
 * solid.
 *
 * One of the three `FillMode`s reads this constant: `"none"` paints no interior
 * to be translucent, and `"cover"` is opaque by definition, so "translucent" is
 * this number and this number is only ever about a tint
 * (`.plan/design.md` §18 is the table of all three).
 *
 * Sibling of `HIGHLIGHT_OPACITY` (render.ts) and for the same reason: a tint is
 * a read-through block - the mark for pointing at a region of a chart - and at
 * full alpha a dark one is a bar over a line of text that *looks* like a
 * redaction while removing nothing, because the text runs under it are still in
 * the exported PDF and still searchable. At 0.35 you can read through it, which
 * is what makes it obvious to the person drawing it that nothing was taken out.
 *
 * **This does not forbid the mode beside it.** `"cover"` is deliberately
 * opaque, and what makes a cover honest is not its alpha - it is that the
 * characters underneath are hidden from the print, so there is nothing left in
 * the text layer to find (`lib/dom/cover.ts`, `.plan/design.md` §17 and §19).
 * So this is not a safety mechanism to be raised into a redaction: at 0 a tint
 * draws no interior at all and is indistinguishable from `"none"`, and towards
 * 1 it starts claiming what only a cover delivers. When the text has to go, the
 * answer is `"cover"`, not a change here.
 *
 * Applied as SVG `fill-opacity`, never `opacity`, so the stroke is unaffected.
 */
export const FILL_OPACITY: number = 0.35;

/**
 * The width a text box is created at, in CSS px. `DEFAULT_DRAW_PREFS.textWidth`.
 *
 * A label is placed by a click and sized by its handles (`.plan/design.md`
 * §13.6), so this is the width every label starts at and the width the wrap is
 * measured against until somebody drags an edge. At the default 16px label and
 * the half-em-per-character the wrap tests use as their fake, 240px is a line
 * of roughly thirty characters - a phrase, which is what an annotation is -
 * and it is narrow enough that a box placed near the right-hand edge of the
 * text still sits over the page rather than off the side of it.
 */
export const DEFAULT_TEXT_WIDTH_PX: number = 240;

/**
 * Every `DrawTool`, in the order the bar draws them: the plain marks in
 * `TOOL_GROUP`'s order (lib/draw/bar.ts), then symbols and text labels, which
 * are groups of their own further along the bar. The list `mergeDrawPrefs`
 * validates a stored tool against (lib/draw/prefs.ts).
 *
 * Seven, and it went to nine and back: `rect-fill` and `ellipse-fill` were
 * tools for one pass, until the fill stopped being a tool at all
 * (`.plan/design.md` §18) and became `DrawPrefs.fill`, one menu serving both
 * shapes.
 *
 * No tier split lives here. Draw mode is Pro as a whole, gated once at the door
 * (`handleAnnotate`, entrypoints/background.ts), and every tool is on the bar
 * whenever the bar is up.
 */
export const DRAW_ALL_TOOLS: readonly DrawTool[] = [
  "pencil",
  "highlighter",
  "line",
  "rect",
  "ellipse",
  "symbol",
  "text",
];

/**
 * Which kind of drag each tool is: a list of samples, or two corners.
 *
 * A table rather than a pair of `===` so that it is exhaustive - an eighth
 * `DrawTool` fails `pnpm compile` until somebody says which kind it is, which
 * is the whole point of the classification living here.
 */
const DRAW_TOOL_FREEHAND: Record<DrawTool, boolean> = {
  pencil: true,
  highlighter: true,
  line: false,
  // Two corners whatever `DrawPrefs.fill` is armed: the fill is a pen setting
  // and changes what the box is painted with, never how it is dragged. That is
  // the whole reason the two filled tools could be deleted from this table
  // rather than answered in it (`.plan/design.md` §18).
  rect: false,
  ellipse: false,
  symbol: false,
  text: false,
};

/**
 * Is this tool the pen - a drag that is a list of samples rather than two
 * corners?
 *
 * The single place that answers it, because two places in
 * `entrypoints/annotate.ts` have to agree: `track` collects a sample per
 * pointer event for exactly these tools, and `dragShape` builds a
 * `StrokeShape` out of `points` for exactly these tools. It names the
 * highlighter already, ahead of the `dragShape` case that task 16 gives it,
 * because the highlighter *is* the pencil - at `HIGHLIGHT_WIDTH_SCALE` times
 * the width.
 *
 * A freehand tool taught to build a shape without being taught to sample
 * commits the lone `pointerdown` sample sitting in `points`, and
 * `isDegenerate` does not save you from that: with one sample
 * `points.length < 2` always holds and the bounding box is zero, so the
 * verdict rests entirely on `strokeSpan`, which is then `inkWidth` alone. For
 * the highlighter that is `width * HIGHLIGHT_WIDTH_SCALE` - 12, 24 or 48px -
 * always at or over `MIN_SHAPE_PX`, so a highlighter tap is *always* kept and
 * the symptom is a fat dot at the start of every drag, however long, rather
 * than a mark that quietly went missing. Only the 2px pencil's dot is thin
 * enough to be discarded, one of the six freehand width-and-tool
 * combinations.
 *
 * The set that comes out is pinned in tests/draw-model.test.ts, so a tool
 * classified as freehand cannot arrive without somebody reading the paragraph
 * above.
 */
export function isFreehand(tool: DrawTool): boolean {
  return DRAW_TOOL_FREEHAND[tool];
}

/**
 * Monotonic within one annotate session; only has to be unique in the layer.
 *
 * The prefix is not for collision avoidance - the marks live in a closed
 * shadow root, where nothing on the page can see these ids - it is so that an
 * id read in devtools says whose it is. It also keeps the value from starting
 * with a digit, which an `id` used in a selector may not do.
 */
export function shapeId(seq: number): string {
  return `pagepdf-mark-${seq}`;
}

/**
 * 1 + however many pins are already down.
 *
 * Counted, not `max(index) + 1`: undo takes the last pin off the list, and the
 * next pin should get its number back rather than leaving a gap. Deleting a
 * pin from the *middle* would repeat a number, but selecting an existing mark
 * is phase 3 (.plan/design.md §8) - when it lands, so does a re-numbering
 * pass, and this becomes its business rather than a silent bug here.
 */
export function nextPinIndex(shapes: readonly Shape[]): number {
  let pins = 0;
  for (const shape of shapes) {
    if (shape.kind === "symbol" && shape.symbol === "pin") pins += 1;
  }
  return pins + 1;
}

/**
 * The smallest mark worth keeping, in CSS px, in either axis.
 *
 * A pointerdown-pointerup pair a couple of pixels apart is a click on a link
 * that the drawing layer swallowed, not a mark. 4px is under the size of
 * anything drawn on purpose and over the jitter of a mouse click or a
 * trackpad tap.
 */
export const MIN_SHAPE_PX: number = 4;

/** The width a stroke actually paints with: the highlighter is much fatter. */
function inkWidth(shape: StrokeShape): number {
  return shape.highlight ? shape.width * HIGHLIGHT_WIDTH_SCALE : shape.width;
}

/**
 * How far a stroke reaches, painted width included.
 *
 * The ink matters because a one-sample stroke has a zero-size bounding box and
 * is still a visible dot - an 8px pen tapped once leaves an 8px blob, which is
 * a mark somebody meant to make. No samples at all leaves no ink anywhere, so
 * that spans nothing.
 */
function strokeSpan(shape: StrokeShape): number {
  if (shape.points.length === 0) return 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of shape.points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return Math.max(maxX - minX, maxY - minY, inkWidth(shape));
}

/**
 * A rect with both extents positive, the box unmoved.
 *
 * The same four lines as the private `positiveBox` in lib/draw/layer.ts,
 * frame.ts and symbols.ts, and this is the fourth copy. frame.ts's comment
 * justifies its copy by that module importing types only while the copy it
 * would share is private to a module that mounts DOM - and that argument
 * **inverts** here rather than carrying over: this is the types-only module,
 * the one layer.ts, frame.ts and symbols.ts already import from, so it is the
 * single place a shared copy could live and be exported to all three. It is not
 * exported only because nothing has yet asked for it, and four private copies of
 * four lines is a smaller thing to carry than a fifth name in the module every
 * other one depends on. Consolidating is a decision somebody may take; this
 * comment exists so it is taken knowingly. `normalizeRect` in geometry.ts is
 * still not it - that takes two points, not a rect.
 */
function positiveBox(rect: DrawRect): DrawRect {
  return {
    x: Math.min(rect.x, rect.x + rect.width),
    y: Math.min(rect.y, rect.y + rect.height),
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

/**
 * Is this mark one of the two box tools - the only kinds that carry a
 * `FillMode`, and so the only kinds that can cover at all?
 *
 * A `switch` rather than a pair of `===` so that it is exhaustive: a seventh
 * `Shape` fails `pnpm compile` until somebody says whether it is a box, which
 * is the whole point of the classification living in one place.
 *
 * It narrows, and - because it asks about the *kind* alone - it narrows
 * **soundly in both directions**: `!isBoxShape(s)` really does leave a stroke,
 * a line, a symbol or a label. A single predicate answering "does this cover?"
 * could not promise that. A `RectShape` with `fill: "none"` is not a cover and
 * is still a rect, so its `false` would let a caller writing
 * `if (!coversText(s))` narrow `s` to exclude rects and ellipses, which is
 * simply untrue. Hence two questions and two steps: the kind test here narrows,
 * and `coverAreas` checks the fill afterwards, where a `false` means only what
 * it says.
 */
function isBoxShape(shape: Shape): shape is RectShape | EllipseShape {
  switch (shape.kind) {
    case "rect":
    case "ellipse":
      return true;
    case "stroke":
    case "line":
    case "symbol":
    case "text":
      // Only the two box tools carry a `FillMode` at all, and that is the
      // decision rather than an accident of the type: `"cover"` on a stroke
      // would be a mask rather than a box, and `coversBox` takes a box and a
      // shape to fill it with (`.plan/design.md` §22).
      return false;
  }
}

/**
 * A normalised box grown by half a stroke width on every side: the area the
 * mark actually **paints**, rather than the path it was drawn along.
 *
 * SVG centres a stroke on its path, so an 8px outline puts 4px of solid pen
 * colour outside the rect and 4px inside it. The characters hidden have to be
 * the characters the block is over, and that sliver beyond the rect is block -
 * a glyph under it would otherwise be painted over and still in the exported
 * PDF's text layer, which is the leak the whole feature exists to close.
 *
 * Normalising first is not optional: a drag that ended above and left of where
 * it started has negative extents, which `intersects` reads as no area at all
 * (lib/dom/cover.ts), so an un-normalised cover would paint a solid block and
 * hide nothing under it.
 */
function paintedBox(rect: DrawRect, strokeWidth: number): DrawRect {
  const box = positiveBox(rect);
  const half = strokeWidth / 2;
  return {
    x: box.x - half,
    y: box.y - half,
    width: box.width + strokeWidth,
    height: box.height + strokeWidth,
  };
}

/**
 * The covering marks, as painted areas, in document coordinates.
 *
 * Here rather than in the entrypoint because it is a fact about a `Shape[]`,
 * and because it is the one place that decides which kinds can cover -
 * `"cover"` on a stroke would be a mask rather than a box
 * (`.plan/design.md` §22).
 *
 * Each cover carries **which shape it is** as well as where it is, because the
 * hit test is exact about an ellipse (`coversBox`, lib/dom/cover.ts) and a
 * bounding box is about 27% larger than the ellipse inside it. Handing over the
 * box alone would hide the characters in the four corner lobes with nothing
 * painted over them - words missing from the export with no block where they
 * were (`.plan/contracts.md` §29).
 *
 * Each box is normalised and then widened by half the stroke width - see
 * `paintedBox` for both halves of that.
 */
export function coverAreas(shapes: readonly Shape[]): Cover[] {
  const covers: Cover[] = [];
  for (const shape of shapes) {
    if (!isBoxShape(shape) || shape.fill !== "cover") continue;
    // `shape.kind` is `"rect" | "ellipse"`, which is exactly `CoverKind`.
    // Annotated rather than inferred so that a third box tool reaching `Shape`
    // without reaching `CoverKind` fails `pnpm compile` here, in front of
    // somebody already reading about covers, rather than in the DOM half.
    const kind: CoverKind = shape.kind;
    covers.push({ kind, box: paintedBox(shape.rect, shape.width) });
  }
  return covers;
}

/**
 * A click that made nothing: a zero-length line, a rect with no area, an empty
 * label, a stroke of one sample from a stray click. Discarded rather than
 * pushed onto the history, so undo never appears to do nothing.
 */
export function isDegenerate(shape: Shape): boolean {
  switch (shape.kind) {
    case "stroke":
      // Two thresholds, both required: a real stroke has samples to spare, and
      // a single sample is only discarded when it painted almost nothing.
      return shape.points.length < 2 && strokeSpan(shape) < MIN_SHAPE_PX;
    case "line":
      return Math.hypot(shape.to.x - shape.from.x, shape.to.y - shape.from.y) < MIN_SHAPE_PX;
    case "rect":
    case "ellipse":
    case "symbol":
      // Either axis: a 400x1px rect is a drag that never left the line it
      // started on. `abs` because nothing here promises a normalised rect.
      return Math.abs(shape.rect.width) < MIN_SHAPE_PX || Math.abs(shape.rect.height) < MIN_SHAPE_PX;
    case "text":
      // Committed by clicking away or pressing Esc, so an untouched caret and
      // a label of spaces both arrive here.
      return shape.text.trim() === "";
  }
}
