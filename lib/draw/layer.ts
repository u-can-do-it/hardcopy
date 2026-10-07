/**
 * The drawing layer: one clipping wrapper in *document* coordinates, holding
 * one small `<svg>` per mark.
 *
 * `.plan/design.md` §4.1 is most of this module's reason for existing, and it
 * comes down to four things - the design's three, and a fourth the design got
 * wrong by omission:
 *
 * 1. **`position: absolute`, never `fixed`.** Chrome repaints fixed elements on
 *    every printed sheet - that is what `lib/dom/hide-fixed.ts` exists to undo -
 *    so a fixed layer would stamp one arrow onto all 14 pages instead of putting
 *    it on the sheet its content landed on.
 * 2. **`overflow: clip`, on a wrapper sized to exactly the document's own
 *    `scrollWidth x scrollHeight`.** A stroke dragged past the bottom edge must
 *    not grow `scrollHeight`: that number *is* the paper size, via
 *    `planPageFromDocument()` and `session.getStableContentSize()`, so an
 *    unclipped layer would quietly change the shape of the exported page. The
 *    clip is on the wrapper because the wrapper is every mark's containing
 *    block, so it clips all of them however far past the edge they reach.
 *    `clip` rather than `hidden` because `hidden` also makes the box a **scroll
 *    container**, and a scroll container is monolithic under the older CSS
 *    fragmentation rules - so the wrapper itself might refuse to break across
 *    sheets, which is the same class of bug point 4 fixes one level down.
 *    `clip` clips identically and still keeps scrollable overflow from
 *    propagating to an ancestor, so the invariant above is untouched, but the
 *    box is not a scroll container. `clip` is Chrome 90+ and
 *    `minimum_chrome_version` in `wxt.config.ts` is 109.
 * 3. **The anchor is measured, not assumed.** `position: absolute` resolves
 *    against the nearest positioned ancestor, and a page is free to put
 *    `position: relative` plus a margin on `html` - so the host is appended at
 *    `left/top: 0`, measured once, and corrected by `anchorCorrection()`.
 * 4. **One `<svg>` per mark, and never one `<svg>` for the document.** An
 *    `<svg>` root inside HTML is a **replaced element**, and a replaced element
 *    is monolithic: CSS fragmentation cannot split it over two printed sheets.
 *    A single `<svg>` covering an 8,000px document is therefore laid out on one
 *    fragmentainer and clipped, and *every mark below the first sheet
 *    disappears* - which is the entire feature, and the one thing §1 of the
 *    design claims comes for free. So each mark gets its own absolutely
 *    positioned `<svg>`, sized and offset to that mark's own bounding box in
 *    document coordinates, with the mark's geometry translated into the box's
 *    local space. A 40px box does not straddle a page boundary except by
 *    accident of where it landed, so Chrome puts it on the sheet its
 *    coordinates fall on.
 *
 * `layerBoxStyle()` and `markSpec()` are the pure halves, which is why (1),
 * (2) and (4) are covered by assertions in `tests/draw-layer.test.ts` rather
 * than by this comment.
 *
 * ## What still cannot fragment
 *
 * Point 4 shrinks the unfragmentable box from the whole document to one mark;
 * it does not abolish it. A mark whose own box crosses a sheet boundary is
 * clipped at that boundary rather than continued on the next sheet, so **one
 * long vertical drag taller than a printed sheet loses everything below the
 * first break**. Splitting a single shape's geometry per sheet is the only
 * thing that would fix it, and it is not worth what it costs: one `<svg>` per
 * mark is already the smallest box each mark can be given. Step 5 of the
 * Manual check in `.plan/tasks/10-draw-layer.md` is where that gets looked at.
 *
 * The wrapper used to carry its own copy of the same question, and no longer
 * does. `overflow: hidden` made it a scroll container, and a scroll container
 * is monolithic under the older fragmentation rules - so the wrapper itself
 * might have refused to break across sheets, on top of whatever its contents
 * did. `overflow: clip` (point 2) clips the same and propagates the same, but
 * is not a scroll container, so that bet is simply gone.
 *
 * What remains is the bet no declaration can spell away: every mark is an
 * absolutely positioned descendant of the wrapper, so each one resolves against
 * a containing block Chrome has fragmented, and per `CLAUDE.md` that is exactly
 * the kind of claim a unit test and a headless render will both answer wrongly.
 * Step 4 of the Manual check settles it with a real print dialog and a document
 * several sheets long.
 *
 * ## The shadow root
 *
 * The host hangs off `documentElement` behind a **closed** shadow root, the same
 * shape as `entrypoints/select-area.ts`. Two consequences worth knowing:
 *
 * - `hideFixedElements` walks `document.querySelectorAll("body *")`, so a later
 *   pre-processing pass cannot reach the layer. It will not hide it for us
 *   either, which is the point: the layer is not fixed, and the marks belong on
 *   the paper.
 * - A page stylesheet cannot style anything *inside* a shadow root. So
 *   `LAYER_CSS`'s `[LAYER_ATTR] svg` rules never match our marks - and a site's
 *   `* { display: none !important }` never reaches them either. What does cross
 *   the boundary is **inheritance**, which is how `print-color-adjust: exact` on
 *   the host reaches the marks; anything non-inherited that the shadow tree
 *   wants forced has to be said inside it, in `LAYER_SHADOW_CSS`.
 */

import { injectUnconditionalCss } from "../dom/print-css";
import { LAYER_ATTR, LAYER_CSS, Z_INDEX } from "./css";
import { FRAME_HANDLE_PX, frameHandles } from "./frame";
import { anchorCorrection } from "./geometry";
import { HIGHLIGHT_WIDTH_SCALE } from "./model";
import { shapeToSpec, specToElement } from "./render";
import { coord } from "./stroke";

import type { FrameZone } from "./frame";
import type { DrawRect, Shape, StrokeShape, Vec2 } from "./model";
import type { NodeSpec } from "./render";

export interface LayerSize {
  width: number;
  height: number;
}

/**
 * The frame's ink: the dashes and the outline of every handle.
 *
 * A magenta, so the box around the label you are typing reads as *chrome* and
 * not as another mark - the frame is the one thing in this shadow root that must
 * never come out in a PDF. Chosen against the whole of `DRAW_COLORS`
 * (lib/draw/model.ts) rather than against one member of it: converted to CIE Lab
 * and compared, the nearest palette colour is the blue pen at dE76 50, and in
 * hue the nearest is the red pen 67 degrees away - no preset is in the same hue
 * family. The obvious alternative, a selection blue, is the thing to avoid: the
 * chrome blue anyone reaches for is `#2563eb`, which is `DRAW_COLORS[3]` to the
 * byte, so a user drawing with the blue pen would get a frame in their own ink -
 * the one collision that matters. This also stays clear of what a page brings:
 * dE76 51 from the default link blue and 107 from black body text, at 4.7:1 on
 * white and 4.5:1 on black, so the dashes are legible either way round.
 *
 * A value of its own rather than an import from `DRAW_COLORS`, and that is the
 * point: the frame must not track the pen. The sixth swatch is a free colour
 * input, so a user can always type this exact magenta and no constant can stop
 * them; what is guaranteed is that none of the five presets is it. The frame
 * never prints, so no manual check can catch a collision here - the assertion in
 * `tests/draw-layer.test.ts` imports `DRAW_COLORS` and is the only guard.
 */
export const FRAME_STROKE = "#c026d3";

/**
 * Inside the layer's own closed shadow root.
 *
 * Short on purpose: nothing outside can reach in here, so nothing needs
 * `!important` to win an argument. It says only what the outer sheet cannot -
 * `LAYER_CSS` selects on the host, and a descendant selector does not cross a
 * shadow boundary.
 *
 * A mark's *box* is not here, because there is one per mark: `markBoxStyle()`
 * puts `position`, `left`, `top`, `width`, `height` and `overflow` in the
 * element's own inline style, which is also what makes them testable.
 *
 * `visibility` is the one exception to "nothing can reach in": it is inherited,
 * so a page rule that beat `LAYER_CSS` on the host would carry `hidden` across
 * the boundary. Saying `visible` on the `<svg>` takes it back, which is
 * something `visibility` allows and `display` and `opacity` do not.
 *
 * `pointer-events` is deliberately absent, here and in `LAYER_CSS`: it is
 * inherited too, which is exactly what makes `setInteractive(false)` on the
 * host disable the whole subtree in one inline declaration. A value here would
 * break that - including on the frame's own handles, whose only job is a
 * cursor.
 *
 * The two `.frame-*` rules are the editor frame's paint, and nothing else here
 * may grow a bare `rect` selector: the dashed box's `fill: none` is a
 * *presentation attribute* on the element (`frameSpec`), any CSS declaration
 * beats a presentation attribute, and a filled frame covers the label it is
 * drawn around. Which is also why the fill below names `.frame-handle` and not
 * `rect`.
 */
const LAYER_SHADOW_CSS = `
svg {
  display: block;
  visibility: visible;
}
.frame-box {
  stroke: ${FRAME_STROKE};
  stroke-width: 1;
  stroke-dasharray: 4 3;
}
.frame-handle {
  fill: #fff;
  stroke: ${FRAME_STROKE};
  stroke-width: 1;
}
`;

/**
 * A CSS length, or `0px` when the number is not one.
 *
 * `NaN` and `Infinity` serialise into a declaration the CSS parser throws away,
 * which for `width` on an empty absolutely-positioned div means a box 0 wide -
 * the marks silently gone - or worse, a stale value left over from the previous
 * `resize()`. `0px` is visibly nothing rather than invisibly something.
 *
 * Finite values are passed through unrounded: `scrollWidth`/`scrollHeight` are
 * whole pixels anyway, and the correction from `anchorCorrection()` is not.
 */
function px(value: number): string {
  return `${Number.isFinite(value) ? value : 0}px`;
}

/**
 * The wrapper's inline style.
 *
 * Pure so the two load-bearing properties are covered by a test and not by a
 * comment: `position: absolute` (a `fixed` layer repaints on every printed
 * sheet - see lib/dom/hide-fixed.ts) and `overflow: clip` (a stroke dragged
 * past the bottom edge must not grow `scrollHeight` and change the paper size
 * the one-click path measures).
 *
 * Every declaration is `!important`, because an injected overlay lives in
 * someone else's stylesheet: `[data-pagepdf-draw]` in `LAYER_CSS` has one
 * attribute of specificity, and a page's own `div.wrap { margin: 0 !important }`
 * outranks it. An inline `!important` is the top of the author cascade and
 * outranks both.
 *
 * What it deliberately does **not** say is `all: initial` - the house pattern
 * from `select-area.ts`, and wrong here. Inline, `all: initial !important`
 * would also reset `print-color-adjust`, beating `LAYER_CSS`'s forced `exact`
 * and washing the marks out on precisely the setting that exists to keep them
 * saturated. Every property `all` would have reset that actually matters to the
 * box is listed below instead.
 */
export function layerBoxStyle(size: LayerSize, offset: Vec2): string {
  return [
    // Point 1. Never `fixed`.
    "position:absolute",
    // Point 3: where the measured correction lands the box at document (0, 0).
    `left:${px(offset.x)}`,
    `top:${px(offset.y)}`,
    // Point 2: exactly the document, so the document cannot grow.
    `width:${px(size.width)}`,
    `height:${px(size.height)}`,
    // `clip`, not `hidden`. Both clip to the padding box, and both stop
    // scrollable overflow propagating to an ancestor - so the load-bearing
    // half is unchanged: a stroke dragged past the bottom edge still cannot
    // grow `documentElement.scrollHeight` and change the paper size the
    // one-click path measures. What differs is that `hidden` *also* makes this
    // box a scroll container, and a scroll container is monolithic under the
    // older CSS fragmentation rules - so the wrapper itself could refuse to
    // break across printed sheets, which is the same class of bug the per-mark
    // `<svg>` restructure (point 4) fixed one level down. Every mark is an
    // abspos descendant of this box, so `hidden` had the layer making two
    // separate bets on how Chrome fragments; `clip` retires the first for a
    // one-word change and leaves only the abspos one. `clip` is Chrome 90+ and
    // `minimum_chrome_version` in `wxt.config.ts` is 109, so it is safe here.
    "overflow:clip",
    // Toggled in place by `setInteractive()`, so the region selector can have
    // the pointer. Inline, and never in a stylesheet, or an `!important` rule
    // would beat the toggle (see the note in lib/draw/css.ts).
    "pointer-events:auto",
    // Content-box sizing plus a page's `* { padding: 8px }` would make the box
    // bigger than the size that was measured - which is point 2 again.
    "box-sizing:border-box",
    "padding:0",
    "border:0",
    // The margin is already baked into the measured correction; zeroing it
    // keeps a margin *box* from reaching past the content the width and height
    // were measured from.
    "margin:0",
    "display:block",
    `z-index:${Z_INDEX}`,
  ]
    .map((decl) => `${decl}!important`)
    .join(";");
}

/**
 * Slack on every side of every mark's box, in CSS px.
 *
 * Small, and it only has to cover what the arithmetic below cannot see: a miter
 * join reaching a hair past the corner it was measured from, `coord()`'s
 * hundredth-of-a-pixel rounding inside the geometry, and a glyph with a
 * negative left side bearing. The per-kind padding does the real work.
 */
const MARK_PAD_PX = 2;

/**
 * How far a pen stroke's *outline* reaches past its samples, as a multiple of
 * the ink width.
 *
 * A stroke is not a stroked line - it is a **filled outline** whose `d` already
 * contains its own width (`strokePath`, lib/draw/stroke.ts), so there is no
 * `stroke-width` to halve here. The question is instead how fat
 * perfect-freehand made that outline, and the answer is not `width / 2`:
 * `STROKE_OPTIONS.thinning` swells the stroke where the pointer moved slowly or
 * pressed hard.
 *
 * Measured against perfect-freehand 1.2.3 with `STROKE_OPTIONS`, sweeping
 * pressure 0..1, sample spacing 0.25..400px, 2..400 samples, and the four
 * `StrokeWidth`-derived sizes plus the three highlighter sizes (2, 4, 8, 12,
 * 24, 48): the outline settles at **0.70x** the size and never exceeds it -
 * except for the 2px pen on a stroke a couple of pixels across, where a 2.48px
 * reach is 1.24x. So 1.0x plus `MARK_PAD_PX` clears every case measured: by
 * 1.5px at the worst of them and by 14px at size 48. Re-measure if
 * `STROKE_OPTIONS` or the library version changes.
 */
const STROKE_OUTLINE_SCALE = 1;

/**
 * How far an arrowhead's barbs can sit past the rect the arrow was drawn in.
 *
 * `arrowHead()` (lib/draw/geometry.ts) puts each barb exactly `size` from the
 * tip, and the tip is a corner of the rect - so on a wide, flat drag the barbs
 * hang a long way above and below the two rows of pixels the rect covers.
 * `symbols.ts` caps `size` at 28px (`HEAD_MAX_PX`), so 28px is the whole of the
 * overshoot an arrow of any length can have.
 *
 * A copy of that cap rather than an import, because `symbols.ts` exports its
 * palette and not its tuning. It is the one number in this file that is not
 * derivable from the shape itself, so if the cap there ever grows, this pads
 * too little - which is what the assertion in `tests/draw-layer.test.ts` is
 * for: it re-derives the barbs from the symbol's own `d`.
 */
const ARROW_HEAD_PX = 28;

/**
 * The width a stroke actually paints with: the highlighter is much fatter.
 *
 * The same expression as the private `inkWidth` in `lib/draw/model.ts` and the
 * one in `lib/draw/render.ts`, and private in both of them. If the three ever
 * disagree, a highlighter is measured at the pen's width and its box clips six
 * sevenths of the ink away.
 */
function inkWidth(shape: StrokeShape): number {
  return shape.highlight ? shape.width * HIGHLIGHT_WIDTH_SCALE : shape.width;
}

/** The min corner plus a positive extent, as `render.ts` and `symbols.ts` do. */
function positiveBox(rect: DrawRect): DrawRect {
  return {
    x: Math.min(rect.x, rect.x + rect.width),
    y: Math.min(rect.y, rect.y + rect.height),
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

/** The box two points span, in either order. */
function spanBox(a: Vec2, b: Vec2): DrawRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** The box a list of samples spans. An empty list spans nothing, at the origin. */
function samplesBox(points: readonly Vec2[]): DrawRect {
  const first = points[0];
  if (first === undefined) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Grow a box by `pad` on all four sides, then out to whole CSS pixels.
 *
 * Outward, so rounding can only ever make the box bigger - a box that is too
 * tight shaves the edge off the mark inside it, which is a worse bug than the
 * pagination one this file exists to avoid. Whole pixels, so `left`/`top` land
 * on the pixel grid and the `translate()` that undoes them is exact: Chrome
 * lays out on a 1/64px grid, and a fractional `left` paired with a
 * `coord()`-rounded translate would put the mark a hundredth of a pixel off the
 * word it was drawn around.
 */
function outwardBox(box: DrawRect, pad: number): DrawRect {
  const x = Math.floor(box.x - pad);
  const y = Math.floor(box.y - pad);
  return {
    x,
    y,
    width: Math.ceil(box.x + box.width + pad) - x,
    height: Math.ceil(box.y + box.height + pad) - y,
  };
}

/**
 * The box one mark's `<svg>` occupies, in document coordinates.
 *
 * Every kind is padded, and what for differs by kind, which is the whole of
 * this function:
 *
 * - `stroke` is a filled outline, so its `d` already carries its own width -
 *   see `STROKE_OUTLINE_SCALE`, which is measured rather than assumed.
 * - `line`, `rect`, `ellipse` and `symbol` are **stroked**, and a stroke is
 *   centred on the path: half the `stroke-width` falls outside the geometry the
 *   attributes describe. `stroke-linecap: round` puts that half-width past both
 *   ends of a line too, and a 90-degree miter join reaches exactly the same
 *   half-width diagonally past a rect's corner.
 * - an arrow's barbs are the one part of a mark that leaves its own rect - see
 *   `ARROW_HEAD_PX`.
 * - `text` is its own `rect` and nothing else: `layoutText` (lib/draw/wrap.ts)
 *   fitted the lines to that box with a font in hand, so the one kind this
 *   module could not measure is a measurement like the rest.
 *
 * A non-finite coordinate collapses the box to nothing at the document origin,
 * which is exactly where `coord()` puts such geometry as well (it emits `0`
 * rather than an exponent that would truncate the whole `d`), so the mark and
 * its box stay in agreement even when the numbers are garbage.
 */
function markBox(shape: Shape): DrawRect {
  switch (shape.kind) {
    case "stroke":
      return outwardBox(
        samplesBox(shape.points),
        inkWidth(shape) * STROKE_OUTLINE_SCALE + MARK_PAD_PX,
      );

    case "line":
      return outwardBox(spanBox(shape.from, shape.to), shape.width / 2 + MARK_PAD_PX);

    case "rect":
    case "ellipse":
      return outwardBox(positiveBox(shape.rect), shape.width / 2 + MARK_PAD_PX);

    case "symbol": {
      const barbs = shape.symbol === "arrow" || shape.symbol === "arrow-double";
      return outwardBox(
        positiveBox(shape.rect),
        shape.width / 2 + (barbs ? ARROW_HEAD_PX : 0) + MARK_PAD_PX,
      );
    }

    case "text":
      // `rect.x`/`rect.y` is the top-left of the label, not a baseline: the
      // renderer sets `dominant-baseline: text-before-edge` so a label appears
      // where the caret was rather than one line-height above it. No
      // `shape.width` term - a label is filled glyphs, not a stroked path.
      //
      // The rect and nothing else, so a glyph that paints past the box it was
      // wrapped to spills out of this box too. That is covered by `overflow:
      // visible` on the mark's own `<svg>` (`markBoxStyle`) and by nothing here:
      // all this box has to get right is which sheet the label prints on.
      return outwardBox(positiveBox(shape.rect), MARK_PAD_PX);

    default:
      return unsupported(shape);
  }
}

/**
 * One mark's `<svg>` box, as an inline style.
 *
 * Inline rather than in `LAYER_SHADOW_CSS` for `left`/`top`/`width`/`height`
 * because they are per mark, and inline for the other two because that is what
 * makes them assertions in `tests/draw-layer.test.ts` instead of comments:
 *
 * - `position: absolute` is point 1 again, one level down. A `fixed` mark would
 *   repeat itself on all 14 sheets exactly as a fixed wrapper would.
 * - `overflow: visible` is deliberate, and it is the *opposite* of the
 *   wrapper's. The wrapper's clip is what keeps the document from growing
 *   (point 2) and it is inline `!important` on an element inside a closed
 *   shadow root, so nothing can beat it - which makes a second clip on the mark
 *   itself pure downside: the mark's box is padded arithmetic, and a box a hair
 *   too tight would shave the edge off the mark rather than off the document.
 *   It is also the whole of what covers a label whose glyphs paint past the
 *   `rect` they were wrapped to - a run of U+FDFD, an Arabic ligature many ems
 *   wide - because `markBox`'s `text` case pads that rect and nothing else.
 *
 * No `!important`: page CSS cannot reach inside a closed shadow root, and this
 * string already outranks `LAYER_SHADOW_CSS`.
 */
function markBoxStyle(box: DrawRect): string {
  return [
    "position:absolute",
    `left:${px(box.x)}`,
    `top:${px(box.y)}`,
    `width:${px(box.width)}`,
    `height:${px(box.height)}`,
    "overflow:visible",
  ].join(";");
}

/**
 * What moves a mark's document coordinates into its own box.
 *
 * A `<g transform>` rather than a `viewBox` on the `<svg>`, and the choice
 * matters twice:
 *
 * - A `viewBox` divides by the box's own width and height. Zero for either
 *   *disables rendering of the element* per the SVG spec, so a mark whose box
 *   collapsed - a degenerate shape, a non-finite coordinate - would vanish
 *   completely instead of merely being clipped.
 * - A `viewBox` also scales, by the ratio between its extent and the used width
 *   of the box. Those come from the same numbers here, but Chrome resolves a
 *   used width onto a 1/64px grid, so the ratio would be 1 plus an epsilon and
 *   every mark would be a hair off the word it was drawn around. `translate()`
 *   cannot scale.
 *
 * `coord()` rather than plain interpolation, for the reason it exists: the SVG
 * number grammar has no room for `4e-7`, and a `NaN` in a transform list
 * invalidates the whole list - which would drop the mark back to document
 * coordinates inside a 40px box, i.e. nowhere near where it was drawn. `coord`
 * also turns `-0` into a plain `0`. The box is whole pixels (`outwardBox`), so
 * nothing is lost to its rounding.
 */
function markTransform(box: DrawRect): string {
  return `translate(${coord(-box.x)} ${coord(-box.y)})`;
}

/**
 * One mark: `<svg>` at the mark's own box, `<g>` translating document
 * coordinates into it, and the shape itself untouched inside.
 *
 * Pure, and exported for the same reason `layerBoxStyle` is: it is the half of
 * point 4 that an assertion can reach. `tests/draw-layer.test.ts` re-derives
 * each kind's painted extent from the `d` and the attributes `shapeToSpec`
 * produced and checks the box contains it - which is the check that a box too
 * tight to hold its own mark cannot pass. Contracts §10's four members are
 * unchanged; this is an addition beside them, not a change to any of them.
 *
 * The geometry is *not* rewritten on the way in. `shapeToSpec(shape)` goes in
 * exactly as it comes out, in document coordinates, and the translation lives
 * entirely on the wrapper - so a mark's `d` in devtools still reads in the same
 * coordinates the model stores, and `lib/draw/render.ts` never has to know that
 * marks are boxed at all.
 */
export function markSpec(shape: Shape): NodeSpec {
  const box = markBox(shape);
  return {
    tag: "svg",
    attrs: { style: markBoxStyle(box) },
    children: [
      {
        tag: "g",
        attrs: { transform: markTransform(box) },
        children: [shapeToSpec(shape)],
      },
    ],
  };
}

/**
 * Unreachable while `markBox`'s `switch` names every member of `Shape`, which
 * is the point: add a kind to the union and this stops compiling.
 */
function unsupported(shape: never): never {
  const kind = (shape as { kind?: unknown }).kind;
  throw new Error(`markBox: unsupported shape kind ${String(kind)}`);
}

/**
 * The pointer cursor for each zone, and *only* the cursor.
 *
 * `frameZoneAt` (lib/draw/frame.ts) stays the sole authority on what a press
 * hit - these elements are never hit-tested, and nothing reads `data-zone` back
 * out of the DOM. The attribute is here so a frame in devtools says which
 * handle is which, and the cursor is here because a resize handle that does not
 * change the pointer does not look draggable.
 *
 * A `Record<FrameZone, string>` for the reason `ZONE_EDGES` is one: a ninth
 * zone fails `pnpm compile` until somebody says what it points at. `"move"` is
 * not a handle - `frameHandles` never returns it - but it is a zone, so it is
 * named here rather than making this a partial map.
 */
const FRAME_CURSOR: Record<FrameZone, string> = {
  move: "move",
  nw: "nwse-resize",
  ne: "nesw-resize",
  se: "nwse-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  e: "ew-resize",
  s: "ns-resize",
  w: "ew-resize",
};

/**
 * The open editor's frame: a dashed box with eight handles, as one `<svg>`.
 *
 * Pure and exported for the reason `markSpec` is - it is the half of the frame
 * an assertion can reach, so `tests/draw-layer.test.ts` can check that every
 * handle here is at the exact rect `frameHandles` puts it at. The handle you
 * can see and the handle `frameZoneAt` says you grabbed come from that one
 * function, so they cannot drift.
 *
 * Boxed exactly like a mark, `markBoxStyle` and `markTransform` and all: the
 * frame is `position: absolute` inside the clipping wrapper and never `fixed`
 * (point 1), and its box is whole pixels so the translate that undoes it is
 * exact (`outwardBox`). The padding is `FRAME_HANDLE_PX` rather than
 * `MARK_PAD_PX` because the handles are *centred* on the box's edges, so half
 * of each hangs outside the rect; a full handle of padding is the same number
 * with 5px to spare.
 *
 * **This is not a mark.** It is not in the history, `shapeToSpec` never sees
 * it, and it must never reach a PDF or a screenshot - which is what the two
 * independent mechanisms in `.plan/design.md` §13.5 are for, neither of them
 * here: the editor commits before every capture, and the container this renders
 * into is `display: none` whenever the layer is not `interactive`.
 */
export function frameSpec(rect: DrawRect): NodeSpec {
  const inner = positiveBox(rect);
  const box = outwardBox(inner, FRAME_HANDLE_PX);

  // `coord()` for every number, as the renderer does: a NaN width on an SVG
  // `<rect>` is an error and the browser draws nothing, so a frame around a
  // garbage rect degrades to a box at the origin rather than disappearing while
  // the editor it belongs to is still open.
  const rectAttrs = (r: DrawRect): Record<string, string> => ({
    x: coord(r.x),
    y: coord(r.y),
    width: coord(r.width),
    height: coord(r.height),
  });

  return {
    tag: "svg",
    attrs: { class: "frame", style: markBoxStyle(box) },
    children: [
      {
        tag: "g",
        attrs: { transform: markTransform(box) },
        children: [
          {
            tag: "rect",
            attrs: {
              class: "frame-box",
              ...rectAttrs(inner),
              // On the element and never in `LAYER_SHADOW_CSS`: a filled frame
              // covers the label it is drawn around, and this is the half of
              // that an assertion can reach.
              fill: "none",
            },
          },
          // After the box, so a handle paints over the dashes it sits on, and
          // in `FRAME_RESIZE_ZONES` order - corners first - so the DOM reads
          // the way the hit test resolves.
          ...frameHandles(inner).map((handle) => ({
            tag: "rect",
            attrs: {
              class: "frame-handle",
              "data-zone": handle.zone,
              ...rectAttrs(handle.rect),
              // Inline, because it is per handle. Nothing else may go in this
              // string: `pointer-events` here would defeat `setInteractive`.
              style: `cursor:${FRAME_CURSOR[handle.zone]}`,
            },
          })),
        ],
      },
    ],
  };
}

export interface DrawLayer {
  /** Re-render every committed shape. */
  render(shapes: readonly Shape[]): void;
  /** The shape being dragged right now, updated in place; `null` clears it. */
  setLive(shape: Shape | null): void;
  /**
   * The open editor's frame, or `null` for none.
   *
   * A third container in the shadow root, after `committed` and `live`. Not in
   * `live`: that takes a `Shape`, and the frame is chrome - it is not in the
   * history, it is not a mark, and it must never reach a PDF or a screenshot.
   *
   * Two independent mechanisms keep it out of the output (`.plan/design.md`
   * §13.5), and they must not share a boolean: the editor commits before every
   * capture, which clears this; and the container is `display: none` whenever
   * the layer is not `interactive`, which covers the region selector and the
   * one-click capture on their own. A `media="print"` rule is not an option -
   * the one-click path emulates screen media (README Deviation 11).
   */
  setFrame(rect: DrawRect | null): void;
  /** `false` drops pointer-events so the region selector can have the pointer. */
  setInteractive(on: boolean): void;
  /**
   * The pointer over the layer, as a whole CSS `cursor` value - `toolCursor`
   * (lib/draw/cursor.ts) for whichever tool is armed. Set on the host and
   * inherited by every mark under it; the frame's handles keep their own.
   */
  setCursor(value: string): void;
  /** Re-measure the document and resize the wrapper. For resize and re-layout. */
  resize(): void;
  /** The surface pointer handlers attach to. */
  surface(): HTMLElement;
  unmount(): void;
}

/**
 * The layer this module last mounted, so a second `mountLayer()` replaces it
 * rather than stacking a second surface over the first.
 *
 * The same move as `cancelActive?.("restarted")` in `entrypoints/select-area.ts`.
 * `entrypoints/annotate.ts` guards double installation with
 * `__pagepdfAnnotateInstalled` (contracts §14) so this should never fire; if it
 * does, one live layer and a stale handle pointing at a detached host is a much
 * better failure than two layers both eating the pointer.
 */
let current: DrawLayer | null = null;

/** Appends the host to `documentElement`, measures, corrects, returns the handle. */
export function mountLayer(): DrawLayer {
  current?.unmount();

  const doc = document;
  const host = doc.createElement("div");
  host.setAttribute(LAYER_ATTR, "");

  const shadow = host.attachShadow({ mode: "closed" });
  const style = doc.createElement("style");
  style.textContent = LAYER_SHADOW_CSS;

  // Three anchors rather than one parent, so `setLive()` on every pointer move
  // can replace the shape being dragged without touching the committed ones,
  // and `setFrame()` can replace the editor's frame without touching either.
  // All three are ordinary static `<div>`s holding nothing but absolutely
  // positioned `<svg>`s, so all three are 0 tall and none has any say in the
  // host's height - the host's height is point 2's measured number and nothing
  // else. Order is paint order: the shape under the pointer paints over the
  // committed marks, and `frame` is last because it is the chrome around
  // whatever is being edited.
  //
  // `frame` is separate from `live` and not a fourth kind of mark: `setLive`
  // takes a `Shape`, the frame is not one, and it is the container's own
  // `display` that keeps the frame out of every capture (`.plan/design.md`
  // §13.5, and `applyInteractive` below).
  const committed = doc.createElement("div");
  const live = doc.createElement("div");
  const frame = doc.createElement("div");
  shadow.append(style, committed, live, frame);

  const undoCss = injectUnconditionalCss(LAYER_CSS);

  let size: LayerSize = { width: 0, height: 0 };
  let offset: Vec2 = { x: 0, y: 0 };
  let interactive = true;
  let cursor = "";
  let unmounted = false;

  /**
   * Everything `interactive` controls, in one place and on two elements.
   *
   * `pointer-events` on the host is inherited by the whole subtree, so `false`
   * hands the pointer to whatever else wants it (the region selector).
   *
   * `display` on the frame's container is the *second* of §13.5's two
   * mechanisms for keeping the frame out of a capture, and the two are
   * deliberately independent: the other one is the editor committing before
   * every capture, which empties this container instead of hiding it. They
   * share this function, but they do not share a boolean - a capture that
   * forgot to commit is still frameless, and a frame hidden here is still a
   * frame when the pointer comes back.
   */
  const applyInteractive = (): void => {
    host.style.setProperty("pointer-events", interactive ? "auto" : "none", "important");
    frame.style.display = interactive ? "block" : "none";
  };

  /**
   * Inline and `!important`, for the reason every declaration in
   * `layerBoxStyle` is: a page's `* { cursor: none !important }` beats an
   * inline value that is not, and an inline one that is beats every stylesheet.
   */
  const applyCursor = (): void => {
    if (cursor === "") host.style.removeProperty("cursor");
    else host.style.setProperty("cursor", cursor, "important");
  };

  const applyBox = (): void => {
    host.style.cssText = layerBoxStyle(size, offset);
    // The assignment above replaced the whole declaration block, so the
    // interactive state and the cursor have to be put back on top of it.
    applyInteractive();
    applyCursor();
  };

  /**
   * Size and anchor the box from the document as it stands. One forced reflow.
   *
   * The box is collapsed to nothing *first*, which buys both measurements at
   * once: `scrollWidth`/`scrollHeight` come back without our own box in them,
   * so `resize()` cannot ratchet the document a little larger every time it is
   * called, and the host's rect is then the origin of whatever containing block
   * it actually landed in. Nothing is painted in between - this runs to
   * completion inside one task.
   *
   * `documentElement`'s own scroll extent, deliberately not
   * `measureContentSize()`'s `max` with `body`: a body that is taller than the
   * documentElement (`body { height: 100px; overflow: hidden }` over long
   * content) would hand us a height that, mounted, *does* grow the document.
   * The layer's job is to fit the page, not to describe it.
   */
  const remeasure = (): void => {
    size = { width: 0, height: 0 };
    offset = { x: 0, y: 0 };
    applyBox();

    const root = doc.documentElement;
    const measured: LayerSize = { width: root.scrollWidth, height: root.scrollHeight };
    const rect = host.getBoundingClientRect();
    offset = anchorCorrection(
      { x: rect.x, y: rect.y },
      { x: window.scrollX, y: window.scrollY },
    );
    size = measured;
    applyBox();
  };

  applyBox();
  doc.documentElement.append(host);
  remeasure();

  const layer: DrawLayer = {
    render(shapes: readonly Shape[]): void {
      if (unmounted) return;
      // Before the committed marks go in, not after: `specToElement` gives
      // every shape element `id: shape.id`, so the shape that has just been
      // committed is about to arrive carrying the id its live copy still holds.
      live.replaceChildren();
      committed.replaceChildren(
        ...shapes.map((shape) => specToElement(markSpec(shape), doc)),
      );
    },

    setLive(shape: Shape | null): void {
      if (unmounted) return;
      // `live` only, never `committed`: a pointer move must not re-render the
      // whole list. One mark is rebuilt rather than patched in place - a mark is
      // now three nodes and its *box* moves with every sample, so all three
      // would need rewriting, and a second construction path that has to stay
      // in step with `markSpec()` is not worth two `createElementNS` calls per
      // pointer event.
      live.replaceChildren(
        ...(shape === null ? [] : [specToElement(markSpec(shape), doc)]),
      );
    },

    setFrame(rect: DrawRect | null): void {
      if (unmounted) return;
      // Rebuilt rather than patched, like `setLive`: a resize moves the box,
      // the dashed rect and all eight handles at once, so there is nothing left
      // to patch - and a second construction path that has to stay in step with
      // `frameSpec()` is what this avoids.
      frame.replaceChildren(
        ...(rect === null ? [] : [specToElement(frameSpec(rect), doc)]),
      );
    },

    setInteractive(on: boolean): void {
      if (unmounted) return;
      interactive = on;
      applyInteractive();
    },

    setCursor(value: string): void {
      if (unmounted || value === cursor) return;
      cursor = value;
      applyCursor();
    },

    resize(): void {
      // Only the box: the marks are in document coordinates, so a re-layout
      // moves the content out from under them but never the marks themselves.
      if (unmounted) return;
      remeasure();
    },

    surface(): HTMLElement {
      return host;
    },

    unmount(): void {
      if (unmounted) return;
      unmounted = true;
      if (current === layer) current = null;
      host.remove();
      undoCss();
    },
  };

  current = layer;
  return layer;
}
