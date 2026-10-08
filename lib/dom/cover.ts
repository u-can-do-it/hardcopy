/**
 * Which characters sit under a cover mark, and must therefore be kept out of
 * the exported PDF's text layer (`.plan/design.md` §19).
 *
 * `lib/dom/`, not `lib/draw/`: this is surgery on the user's page, in the
 * family of `hide-fixed.ts` and `expand.ts`, and it is nothing to do with what
 * a mark *is*.
 *
 * It splits the way every module in that directory splits, and the way
 * `CLAUDE.md` asks: a pure decision a unit test can reach, and a thin DOM
 * walker that it cannot. `shouldHideFixed` / `hideFixedElements` is the exact
 * precedent, and the seam between the two halves is the blank line above
 * `CoverHandle`.
 *
 * **Everything above that line is pure**, and it deliberately refers to nothing
 * from a DOM - no `document`, no `Range`, no `Node`, not even a type - so that
 * `tests/cover.test.ts` can hold the whole rule with plain records the way
 * `tests/hide-fixed.test.ts` does. **Everything below it measures**, and it
 * decides nothing: every question the walker asks is `intersects`', `coversBox`'
 * or `coveredRuns`', which is why it has no suite of its own (§35's Proof) and
 * why a geometry test written against it would be a test in the wrong file.
 *
 * The one import is `./style`, for the exact `style`-attribute undo the field
 * case needs; it touches no DOM at load. Nothing here reads a DOM global at
 * module scope either, so this module still *imports* cleanly under vitest's
 * `environment: "node"` - which is what `tests/cover.test.ts` needs of it.
 *
 * Coordinates are whatever one space the caller chose, for both arguments -
 * see `coveredRuns`. `hideTextUnder` chooses client coordinates, and converts.
 *
 * The pure half is covered by tests/cover.test.ts.
 */

import { overrideStyle, undoAll, type Undo } from "./style";

/** A box in the same coordinate space as the covers. `DOMRect`-shaped. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Which of the two box tools drew a cover. Nothing else can cover
 * (`.plan/design.md` §22): a covered freehand scribble is a mask, not a box.
 */
export type CoverKind = "rect" | "ellipse";

/**
 * One covering mark: the box it was drawn in, and which shape fills it.
 *
 * The shape is here rather than left to the caller because the two differ by
 * about 27% of the box's area, and every one of those characters is in the
 * corners - see `coversBox`.
 *
 * `box` is the **painted** extent, stroke included: `coverAreas`
 * (lib/draw/model.ts) widens it by half the stroke width, because the outline
 * paints outside the path and the set of characters hidden must match the set
 * of pixels covered.
 */
export interface Cover {
  box: Box;
  kind: CoverKind;
}

/** A half-open run of character indices, `[start, end)`. */
export type Run = readonly [start: number, end: number];

/**
 * How much of a character box is empty space rather than ink, in CSS px.
 *
 * A `Range`'s box for a character is the **font box** - the ascent and descent
 * of the whole face, not of the glyph - so its top and bottom edges sit in
 * space no glyph paints in. Measured on the page that produced the user's
 * report - 18px Roboto at `line-height: 26px` - the box is ascent 17 plus
 * descent 4, so 21px tall, while the ink in it reaches 13.5 above the baseline
 * and 3.84 below for a glyph with a descender, 0.18 for one without. That is
 * 3.5px of empty space at the top of every character box and up to 3.82px at
 * the bottom, with a 5px gap of leading between one character's box and the box
 * of the character on the line below. A cover edge landing in that space covers
 * nothing and must hide nothing (`.plan/contracts.md` §31.1).
 *
 * Measured by the walker below - canvas `measureText`, `fontBoundingBox*` minus
 * `actualBoundingBox*` - **once per line**, never once per glyph and never once
 * per node. The rule that reads it stays pure.
 *
 * Per line and not per node, because `actualBoundingBox*` over a whole
 * paragraph is the union over every glyph in it: one descender anywhere
 * collapses `bottom` to about 0.16px for *every* line, including the lines that
 * have none, whose ink really stops 3.82px above their font box. That left the
 * reported cover clearing the line above it by 0.16px - one 0.25px sweep step -
 * rather than by 3.8px, which is §31.1's defect surviving the fix for it
 * (`.plan/contracts.md` §31.4). Every character on a line shares its box's `y`,
 * so the walker groups by that `y` and measures each line's own substring: a
 * handful of calls per node.
 *
 * Zero, or no inset at all, is the honest default for a caller that cannot
 * measure: it restores the behaviour this module shipped with rather than
 * inventing a band. So is a pair of numbers that is not a measurement - a `NaN`
 * from a `TextMetrics` missing a field - because the greedier of two answers is
 * the safe one (`coveredRuns`).
 */
export interface InkInset {
  top: number;
  bottom: number;
}

/**
 * A box with no area covers nothing and is covered by nothing.
 *
 * Both directions, and it is the one place the greedy rule below stops being
 * greedy - deliberately, because neither case is a leak. A zero-area
 * *character* box is a collapsed space or a soft hyphen: it paints no glyph, so
 * there is nothing under the cover to show and nothing in the text layer worth
 * removing. A zero-area *cover* is a rect nobody dragged; hiding text under a
 * mark of no size would hide it under nothing visible, which is the one way
 * over-hiding stops being invisible.
 *
 * `!(v > 0)` rather than `v <= 0` is a statement of intent and **not** a
 * difference in behaviour: the two agree on every input, `NaN` included, since
 * a `NaN` fails `> 0` and `<= 0` alike. The intent is that only a positive
 * extent is an area, so a `NaN` extent - the measurement of something detached,
 * or never laid out - is empty by the same clause that rejects a zero, rather
 * than by the reader having to recall how `<=` treats it. `tests/cover.test.ts`
 * pins the `NaN` answer, because the answer is what matters and either form has
 * to keep giving it.
 */
function isEmpty(box: Box): boolean {
  return !(box.width > 0) || !(box.height > 0);
}

/**
 * Do two boxes share any area?
 *
 * Exported because it is the whole of a `"rect"` cover's rule and half of
 * `coversBox`'s, both of which are below it, and because the DOM half's
 * pre-filter - skip an element whose bounding box misses every cover - is this
 * question asked once per element rather than once per character.
 *
 * **Touching counts.** Edge to edge, and corner to corner: the comparisons are
 * `<=`, not `<`. A glyph whose box ends exactly where a cover begins is the
 * half-glyph-at-the-edge case `coveredRuns` exists to prevent, and floating
 * point makes "exactly" a coin toss anyway - `Range.getClientRects()` and a
 * cover dragged by hand agree to the last bit about as often as they do not.
 * Costing an extra character to a rounding error is invisible; saving one is a
 * leak.
 *
 * Each axis is compared against that axis' own extent - `x` against `width`,
 * `y` against `height` - and a character box is nothing like square (about 7 by
 * 16 for body text) while a cover over a line is nothing like square the other
 * way (about 550 by 20), so crossing the two is not a symmetric mistake that
 * cancels out. It is a cover that misses the characters it is drawn over from
 * one direction, which is the same silent leak as `<` for `<=`.
 * `tests/cover.test.ts` pins each of the four comparisons with a box whose
 * width and height differ enough that the confusion changes the answer.
 *
 * Empty on either side is the exception, and `isEmpty` says why.
 *
 * A negative extent reads as empty rather than as a box pointing backwards.
 * Callers hand this normalised rects - `coverAreas` (lib/draw/model.ts) runs
 * every cover through `positiveBox` - so a negative one here is a bug
 * somewhere else, and answering "no area" is the answer that does not hide a
 * paragraph on the strength of it.
 */
export function intersects(a: Box, b: Box): boolean {
  if (isEmpty(a) || isEmpty(b)) return false;
  return (
    a.x <= b.x + b.width &&
    b.x <= a.x + a.width &&
    a.y <= b.y + b.height &&
    b.y <= a.y + a.height
  );
}

/**
 * The point of the interval `[lo, hi]` nearest to zero: the origin clamped into
 * it. Used per axis by `coversBox`, where the origin is the ellipse's centre.
 */
function nearestToZero(lo: number, hi: number): number {
  if (lo > 0) return lo;
  if (hi < 0) return hi;
  return 0;
}

/**
 * Does `cover` paint over any part of `box`?
 *
 * `"rect"` is `intersects`. `"ellipse"` is the same question asked of the
 * ellipse **inscribed** in `cover.box`, exactly rather than through its
 * bounding box - and that distinction is the point of the function existing
 * (`.plan/contracts.md` §29).
 *
 * A bounding box is about 27% larger than the ellipse inside it (`4/π`), and
 * all of the difference is in the four corner lobes. `render.ts` paints the
 * ellipse, so a character in a corner tested against the box is hidden from the
 * export with **nothing painted over it**: in the PDF the word is simply gone,
 * with a blank where it was. That is not the bargain §19.1 struck. §19.1 pays
 * for over-hiding with one sentence - the extra character is *under an opaque
 * block* - and in the corners it is not. Being exact removes the unpainted hole
 * **and** the over-hide at once, so it is better on both axes rather than a
 * trade between them.
 *
 * The derivation, which is why this is eight lines and not a general
 * ellipse-rectangle intersection:
 *
 * 1. Translate to the ellipse's centre, so it is `x²/rx² + y²/ry² = 1`.
 * 2. Divide the x axis by `rx` and the y axis by `ry`. That is an axis-aligned
 *    scale, so the character box comes through it **still axis-aligned** -
 *    which is the whole trick - and the ellipse becomes the unit circle.
 * 3. The nearest point of an axis-aligned box to the origin is the origin
 *    clamped into it, one axis at a time (`nearestToZero`).
 * 4. The box meets the circle exactly when that point is within it: `d² <= 1`.
 *
 * `<=`, not `<`: the greedy rule of §19.1 is unchanged and its reasoning stands
 * untouched - a character touching the region at all is covered, because an
 * extra one is invisible and a missed one is a leak. What §29 changed is only
 * *which region* is being greedy, never the direction it is greedy in.
 *
 * Empty on either side is `intersects`' exception for `intersects`' reasons: a
 * zero-area cover has no `rx` or `ry` to divide by, and hides nothing.
 */
export function coversBox(cover: Cover, box: Box): boolean {
  const area = cover.box;
  if (cover.kind === "rect") return intersects(area, box);
  if (isEmpty(area) || isEmpty(box)) return false;

  // The inscribed ellipse, as `render.ts` paints it: the box's centre, and a
  // semi-axis of half each extent. Both are > 0, because `isEmpty` said so.
  const rx = area.width / 2;
  const ry = area.height / 2;
  const cx = area.x + rx;
  const cy = area.y + ry;

  // The character box in units of those semi-axes, where the ellipse is the
  // unit circle. Still axis-aligned, so it is still two intervals.
  const dx = nearestToZero((box.x - cx) / rx, (box.x + box.width - cx) / rx);
  const dy = nearestToZero((box.y - cy) / ry, (box.y + box.height - cy) / ry);
  return dx * dx + dy * dy <= 1;
}

/**
 * `box` shrunk to the ink inside it: `y + inset.top` down to
 * `y + height - inset.bottom`, with `x` and `width` untouched.
 *
 * **The y axis only.** The x axis of a character box is ink to its edges as far
 * as this rule needs to care - a glyph's side bearings are a fraction of a
 * pixel, and §19.1's argument that a character clipped at its left or right
 * edge is covered is exactly right. The y axis is different in kind: the box
 * carries the whole face's ascent and descent whatever glyph is in it, so its
 * top and bottom edges are reliably empty by several pixels, and the box below
 * it starts only after the line's leading. That is where a cover edge hid a
 * line it painted nothing over.
 *
 * Three answers that are not the arithmetic, in the order they are asked:
 *
 * - **No inset, or a zero one**: the box itself, unchanged and not a copy of
 *   it. The contract's stated default, and the pre-§31.1 behaviour exactly.
 * - **An inset that is not a number**: the box itself again. `NaN` in either
 *   field would otherwise make a band of `NaN`, and `intersects` answers
 *   `false` to every comparison against one - so a walker that merely failed to
 *   measure would have turned the whole cover off and left every covered word
 *   in the PDF. The old box over-hides; that is the direction to fail in.
 * - **A negative component**: clamped to zero, so an inset can only ever shrink
 *   this box and never grow it. `{top: -2}` is finite and arithmetically
 *   sensible - ink that overshoots the font box, which accents and emoji do -
 *   and left alone it would return a box starting 2px *above* the character's
 *   own, so a cover grazing the leading above would hide a line it paints
 *   nothing over. That is the bug this whole function exists to remove, in
 *   miniature and in the same direction. The walker clamps too, but
 *   `coveredRuns` is the exported surface and the rule belongs where the rule
 *   is (`.plan/contracts.md` §31.4).
 * - **An inset taller than the box**: a **1px** band at the centre of where the
 *   ink was measured to be, rather than a box of no height. An inset that big
 *   means the measurement is wrong - a subtree scaled down by a CSS transform
 *   measures a smaller box than the canvas reports a font box for, because
 *   `getBoundingClientRect()` is in the transformed space and `measureText` is
 *   not - and a zero-height box is invisible to `intersects`, which is the
 *   under-hiding direction. Erring towards hiding is the safe error. The centre
 *   is clamped into the box, because the one thing worse than a band too thin is
 *   a band beside the glyph rather than on it.
 */
function inkBox(box: Box, inset: InkInset | undefined): Box {
  if (inset === undefined) return box;
  if (!Number.isFinite(inset.top) || !Number.isFinite(inset.bottom)) return box;
  // Clamped before anything is asked of them, so every line below is about a
  // box that only shrank. The zero test comes after the clamp so that an inset
  // of `{top: 0, bottom: -2}` gives back the same box, not a copy of it.
  const top = Math.max(0, inset.top);
  const bottom = Math.max(0, inset.bottom);
  if (top === 0 && bottom === 0) return box;

  const height = box.height - top - bottom;
  if (height > 0) return { x: box.x, y: box.y + top, width: box.width, height };

  // The midpoint of the two inset edges - `y + top` and `y + height - bottom` -
  // which is the ink centre for an inset that overlaps itself just as it is for
  // one that does not.
  const middle = box.y + (box.height + top - bottom) / 2;
  const centre = Math.min(Math.max(middle, box.y), box.y + box.height);
  return { x: box.x, y: centre - 0.5, width: box.width, height: 1 };
}

/**
 * Which characters of one text node fall under a cover.
 *
 * `charBoxes[i]` is the box of character `i`; `covers` are the covering marks,
 * each with its shape. In whatever one coordinate space the caller chose - the
 * DOM half uses client coordinates, because that is what
 * `Range.getClientRects()` returns and converting both sides would be two
 * conversions to get the same answer.
 *
 * **A character is covered if its box meets a cover's painted area at all** -
 * not if it is contained, and not by its centre. Greedy on purpose, and the
 * asymmetry is the whole argument: an extra character hidden is *invisible*,
 * because it is under an opaque block, while a character missed is a *leak* -
 * half a glyph of a password showing at the edge of the box, noticed after the
 * file was sent. For a tool whose job is removal, the safe direction is the
 * only defensible default (`.plan/design.md` §19.1).
 *
 * The two rules a reader is likely to reach for instead both fail on that
 * asymmetry. *Contained* drops every character the cover's edge cuts through,
 * which is precisely the row of half-glyphs down each side of the block.
 * *Centre* drops the ones cut past their middle, which is the same failure with
 * a smaller radius: still visible, still a leak, and harder to notice because
 * it only shows on the characters the user dragged the edge nearest to. Both
 * fail silently - the export looks covered, and the text is in the file - so
 * the greediness is not a rounding convenience, it is the safety property.
 *
 * "Meets the painted area" is `coversBox`, not `intersects`: an ellipse is
 * tested as an ellipse, so the greedy region is the one that is actually
 * painted rather than the box around it.
 *
 * **Each character box is shrunk vertically by its own inset before it is
 * tested** - `y + inset.top` to `y + height - inset.bottom`, see `inkBox` - so a
 * cover edge landing in the empty leading between two lines no longer grazes the
 * neighbouring line's font box and take every character on it. That was the
 * user's reported bug and it made the feature unusable: one touch takes a whole
 * line, because every character on a line shares one `y`, and the run merging
 * below then joins it to the lines actually covered - so a block dropped in the
 * middle of a paragraph hid the paragraph, including a line above it that was
 * never painted over (`.plan/contracts.md` §31.1).
 *
 * `insets[i]` is the inset for `charBoxes[i]`: **per character in the signature
 * and per line in practice**. Every character on a line shares its box's `y`, so
 * the walker measures one inset per line and repeats it across that line's
 * characters. One inset for the whole node is what §31.4 rejects, and the reason
 * is the direction the measurement errs in: `actualBoundingBox*` over a node is
 * the union over all its glyphs, so one descender anywhere in a paragraph
 * collapses `bottom` for every line in it, and a line with no descenders - whose
 * ink stops 3.82px above its font box - is then treated as inked to within
 * 0.16px of it. The reported cover cleared that boundary by 0.16px, one 0.25px
 * sweep step, which is not a fix so much as a coincidence; per line it clears by
 * 3.8px.
 *
 * A shorter array than `charBoxes`, or none at all, leaves the unmatched
 * characters uninset - the pre-§31.1 behaviour, and the honest answer for a
 * caller that could not measure them.
 *
 * This is §29's fix one axis over, and it is the same kind of fix: §29 refused
 * to let an ellipse's bounding box hide the text in corners it does not paint
 * over, and the font box's descent and half-leading hide text in a band the
 * cover does not paint over either. Insetting to the ink and keeping `<=` is
 * **strictly better on both axes** rather than a trade between them - it
 * removes an over-hide and gives up no leak-prevention at all, because the
 * leading contains no ink to leak. The x axis is untouched and stays greedy.
 *
 * `insets` omitted is the pre-§31.1 behaviour exactly, which is what a caller
 * with no way to measure should get.
 *
 * Adjacent and overlapping runs are merged, and runs come back in ascending
 * order, so a cover straddling two words is one run and one wrapping element.
 *
 * A zero-area cover covers nothing. A zero-area *character* box - a collapsed
 * space, a soft hyphen - is skipped entirely: it neither opens a run nor closes
 * an open one. Not merely "left alone", and the difference matters. Splitting a
 * run at a soft hyphen in the middle of a covered word would put an element
 * boundary **inside the word**, and an inline boundary is exactly where Chrome
 * restarts shaping: kerning and ligatures do not cross it. §17.1's promise is
 * that this mechanism reflows nothing, and that boundary buys nothing at all,
 * because the characters on both sides of it are covered anyway. It would also
 * inflate `CoverHandle.runs`, which is a number the user is shown.
 *
 * Neither zero-area case is an error and neither throws.
 */
export function coveredRuns(
  charBoxes: readonly Box[],
  covers: readonly Cover[],
  insets?: readonly InkInset[],
): Run[] {
  const runs: Run[] = [];
  if (covers.length === 0) return runs;

  // One pass in index order, opening a run at the first covered character and
  // closing it at the first uncovered one. Merging is therefore not a second
  // step that could disagree with the first: adjacent characters are never two
  // runs to begin with, two covers over the same character contribute it once,
  // and the output is ascending because the input index is.
  //
  // `end` trails the last *covered* index rather than the loop counter, which
  // is what lets an empty box be skipped without being swallowed: a soft hyphen
  // sitting just past the cover's edge closes nothing, and is not wrapped
  // either.
  let start = -1;
  let end = -1;
  for (let i = 0; i < charBoxes.length; i += 1) {
    const box = charBoxes[i];
    // The **measured** box decides whether there is a character here at all, and
    // the inset one decides whether it is covered. A collapsed space is skipped
    // for `isEmpty`'s reasons however the inset would have reshaped it, and
    // `inkBox` never returns an empty box for a box that was not empty - a 1px
    // band at worst - so nothing becomes invisible to the test on the way.
    if (isEmpty(box)) continue;
    // `insets?.[i]` and not `insets[i]`: a short array is a caller that measured
    // some of the node, and the characters past its end are uninset rather than
    // an index error.
    const ink = inkBox(box, insets?.[i]);
    if (covers.some((cover) => coversBox(cover, ink))) {
      if (start < 0) start = i;
      end = i + 1;
    } else if (start >= 0) {
      runs.push([start, end]);
      start = -1;
    }
  }
  if (start >= 0) runs.push([start, end]);
  return runs;
}

/**
 * What one `hideTextUnder` call did, and how to put it back.
 *
 * `restore()` is not an error path - it runs on **every** use, because the
 * covers are applied around a capture and taken off after
 * (`.plan/design.md` §20), and because annotate mode restores the page on exit.
 * It must `normalize()` every parent it split, so a second pass measures the
 * same geometry as the first.
 *
 * Idempotent: a second `restore()` does nothing.
 */
export interface CoverHandle {
  restore(): void;
  /** Text runs wrapped. For the note line and for the §9 matrix. */
  runs: number;
  /** Form controls hidden whole. See `hideTextUnder`. */
  fields: number;
}

/**
 * `Node.TEXT_NODE`, as a literal.
 *
 * Not `Node.TEXT_NODE` itself, because that reads a DOM global, and the header
 * above promises this module stays importable where there is no DOM. Every
 * other DOM name below is inside a function body, which is never evaluated
 * under `environment: "node"`; a module-scope `const` would be.
 */
const TEXT_NODE = 3;

/**
 * The SVG namespace, for recognising a `<text>`'s children and for building the
 * wrapper that goes inside one (`.plan/contracts.md` §31.3).
 *
 * **Its own constant, and deliberately not `SVG_NS` from `lib/draw/render.ts`.**
 * The two happen to share a value and mean different things: `render.ts`' is the
 * namespace *our marks are drawn in*, and this one is a namespace *recognised in
 * a stranger's page*. Nothing keeps them in step because nothing has to - a W3C
 * namespace URI is frozen by the spec that minted it, so there is no version of
 * this the two could disagree about.
 *
 * What importing it would cost is real, though. This module's header promises
 * exactly one import, `./style`, picked because it touches no DOM at load;
 * `render.ts` pulls in `css`, `geometry`, `model`, `stroke`, `symbols` and
 * `wrap` behind it, so the line would drag the whole mark-rendering graph into
 * the page-surgery module - and it would point `lib/dom/` at `lib/draw/`, which
 * is the direction the header opens by saying this file does not go
 * ("it is nothing to do with what a mark *is*"). A 32-character constant is the
 * cheaper half of that trade by a long way.
 *
 * Module scope is safe here for `TEXT_NODE`'s reason: it is a string literal,
 * not a DOM global.
 */
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Subtrees the walker never enters.
 *
 * Two different reasons, and both are about the split, not the measurement:
 *
 * - `SCRIPT`, `STYLE`, `NOSCRIPT` and `TEMPLATE` hold text that is never laid
 *   out, so it is in no text layer and no `Range` of it has a box. Rejecting
 *   them is a saving, not a decision.
 * - `TEXTAREA`, `SELECT` and `DATALIST` hold text that is *not* theirs to
 *   split. A `<textarea>`'s child text node is its default value, not the value
 *   Chrome paints, and its content model is text - a `<span>` inserted into one
 *   is not a wrapper, it is a change to the field's value. An `<option>`'s text
 *   is laid out by the browser's own widget, so no `Range` over it has a box to
 *   measure; `<option>` lives inside the last two and so needs no entry of its
 *   own. `<textarea>` and `<select>` are both caught by the form-control pass
 *   below, which hides the whole control rather than reaching inside it - so
 *   rejecting them here is also what keeps each of them blanked **exactly
 *   once**, by the only pass that can see what the browser actually paints.
 *
 * An `<iframe>`'s children are fallback content that is never rendered, and its
 * real content is another document - `.plan/design.md` §21.1, the one leak in
 * this feature a user could be harmed by.
 *
 * Our own UI needs no entry: the layer and the bar are **closed** shadow roots
 * (`lib/draw/layer.ts`, `lib/draw/bar.ts`), and `el.shadowRoot` is `null` for a
 * closed one - so the walk below can descend into the page's *open* roots
 * (`.plan/contracts.md` §31.2) without being able to enumerate ours. Their hosts
 * are appended to `documentElement` rather than to `<body>`, so they are not in
 * the walked subtree either; that is the second reason and the older one.
 *
 * Only the first of those two is load-bearing. The second one evaporates on a
 * document with no `<body>`, where `hideTextUnder` walks `documentElement` and
 * the hosts are inside the walked subtree after all - the closed mode is what
 * still keeps the walk out of them, and it is the guard to preserve.
 */
const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "TEXTAREA",
  "SELECT",
  "DATALIST",
  "IFRAME",
]);

/**
 * Form controls hidden whole, rather than character by character.
 *
 * An `<input>`'s, `<textarea>`'s or `<select>`'s text is not a text node the
 * walker above can reach - there is nothing for a `Range` to split - and Chrome
 * prints it. So the element itself gets `visibility: hidden`. See
 * `hideTextUnder`.
 *
 * `<select>` is the third of them, and the reason is worth writing down
 * (`.plan/contracts.md` §30). A `<select>`'s selected option label is painted by
 * the browser's own widget: no `Range` reaches it, so the character walker
 * cannot see it and would leave it in the PDF. Out of this selector, a cover
 * dragged over a dropdown publishes its selection.
 *
 * That is a **leak, not a limit**, and the distinction is the one §21 draws:
 * between somewhere a cover *cannot* reach - inside a cross-origin iframe,
 * which is somebody else's document - and somewhere it simply was not pointed
 * at. This was the second kind, and pointing it costs one word.
 *
 * The same reasoning applies to anything else that paints text no `Range` can
 * reach - but §30's closing line, "nothing else in HTML does today", is an
 * over-claim and is not repeated here. **CSS-generated content is exactly
 * that**: a `::before` / `::after` `content` string and a list marker are
 * painted from a style rule, belong to no node, and Chrome does put them in the
 * printed text layer. A cover over a numbered list or over a quote mark drawn
 * in CSS leaves that text in the export.
 *
 * It is not fixable from where this walker stands - there is no element to hide
 * and no `Range` to measure, so nothing here can even tell which generated
 * strings a cover paints over. That makes it a limit of the kind §21 collects,
 * not a leak a word in this selector closes, and `.plan/design.md` §21 is where
 * it belongs. Written down rather than asserted away.
 */
const FIELD_SELECTOR = "input, textarea, select";

/**
 * One element's own font, as a canvas `font` shorthand, for measuring the ink
 * inside its character boxes (`InkInset`).
 *
 * **The page's font, never ours.** `LABEL_FONT_FAMILY` (lib/draw/css.ts) is the
 * stack *our marks* are set in, and it is the wrong answer twice over: the inset
 * has to come out in the same units as the boxes it shrinks, and those boxes are
 * the page's text in the page's face at the page's size. Measuring a stranger's
 * paragraph in our font would answer about a face the page never used.
 *
 * Composed from the longhands rather than copied from `cs.font`, for two
 * reasons that both end in a silently wrong measurement:
 * `getComputedStyle().font` is allowed to serialise to the empty string when a
 * longhand is not representable in the shorthand, and an unparseable value
 * assigned to `ctx.font` is **ignored** - it leaves the previous font in place
 * and measures the wrong face with nothing thrown to notice. Four longhands we
 * can write predictably beat one string we cannot check.
 *
 * `font-style` is narrowed to the three keywords for that last reason: `oblique
 * 14deg` is valid CSS and is not certain to survive a canvas font parser, and an
 * angle changes no vertical metric worth a risk. `font-variant` and
 * `font-stretch` are left out for the same trade in the other direction - they
 * move ink widths, not the ascent and descent this measures.
 *
 * The empty string means "no font to measure", and the caller then insets
 * nothing.
 */
function canvasFont(cs: CSSStyleDeclaration): string {
  const size = cs.fontSize;
  const family = cs.fontFamily;
  if (size === "" || family === "") return "";
  const style = cs.fontStyle.startsWith("oblique")
    ? "oblique"
    : cs.fontStyle === "italic"
      ? "italic"
      : "normal";
  const weight = /^\d+$/.test(cs.fontWeight) ? cs.fontWeight : "400";
  return `${style} ${weight} ${size} ${family}`;
}

/**
 * Hide every character under `covers` so it is not in the printed text layer.
 *
 * `visibility: hidden`, never `display: none`: it preserves layout exactly, so
 * nothing reflows and every mark below the cover stays where it was drawn -
 * and hidden content is not painted, so Chrome has nothing to put in the text
 * layer for it. That last clause is the assumption the whole pass rests on and
 * the one a unit test cannot reach; `.plan/tasks/30-probe-hidden-text.md` is
 * the human check that it holds, and it has passed at a real print dialog.
 *
 * `covers` are in **document** coordinates, as marks are; this converts once
 * with the current scroll and then works in client coordinates throughout,
 * because that is what `Range.getClientRects()` speaks and converting the other
 * side per character would be thousands of conversions for the same answer.
 *
 * The boxes arrive already widened by half the stroke (`coverAreas`, §29.2), so
 * nothing here adds padding of its own.
 *
 * What it does add is the other side of that measurement: a character's `Range`
 * box is the font box, which is several pixels taller than the glyph in it, so
 * an ink inset is measured for each **line** of each node - the page's own
 * computed font, canvas `measureText`, `fontBoundingBox*` minus
 * `actualBoundingBox*` - and handed to `coveredRuns`, which does the deciding.
 * Without it a cover edge in the leading between two lines hid the line above
 * the block (`.plan/contracts.md` §31.1); with one inset for the whole node
 * instead of one per line it very nearly still did (§31.4). A page it cannot
 * measure gets no inset and the behaviour this shipped with.
 *
 * Form controls are handled separately and coarsely: an `<input>`, `<textarea>`
 * or `<select>` whose box the cover paints over gets `visibility: hidden` on
 * the *element*, because its text is not a text node this walk can reach and
 * Chrome prints it. The whole field goes - which is the right answer for a
 * field, since a half-hidden password box is not something anyone wants - and
 * it is counted in `CoverHandle.fields` rather than in `runs`.
 *
 * Reaches nothing inside a cross-origin iframe, which is `.plan/design.md`
 * §21.1 and a genuine leak. Say it in docs/ARCHITECTURE.md, not only here.
 *
 * Reaches the page's **open** shadow roots, and not its closed ones
 * (`.plan/contracts.md` §31.2). Neither `createTreeWalker` nor
 * `querySelectorAll` crosses a shadow boundary on its own, so before this a
 * cover dragged over a web component hid nothing at all - the block painted and
 * every word of the component's text stayed in the PDF, which is the
 * under-hiding direction this whole pass exists to prevent. A **closed** root is
 * the same shape of limit as the iframe above - `attachShadow({mode: "closed"})`
 * hands a page a root nothing outside it can get at - and it is also what keeps
 * this walk off our own marks. See `walkRoot` below.
 *
 * **Measure everything, then mutate.** The two passes are not tidiness: a split
 * dirties layout, so interleaving them would make every following
 * `getBoundingClientRect()` force a fresh one, on the synchronous critical path
 * of opening the print dialog (§20). Measuring first leaves layout untouched
 * for the whole of the expensive half.
 *
 * **All or nothing.** Either it returns a handle over a cover that is fully
 * applied, or it throws having put back whatever it had already changed - never
 * a page carrying wrappers that no handle can undo, and never a half-applied
 * cover the caller cannot tell from a whole one. See the comment on the seam
 * between the two halves for why that is the right end of the trade.
 */
export function hideTextUnder(covers: readonly Cover[], doc: Document = document): CoverHandle {
  /**
   * Our wrappers, in creation order. `restore()` unwraps them newest-first.
   *
   * `Element`, because they are not all `<span>`s: a run inside an `<svg><text>`
   * is wrapped in a `<tspan>` instead (§31.3, at the wrapper below). The unwrap
   * is the same either way and asks nothing of either - see `restore()`.
   */
  const wrappers: Element[] = [];
  /** Every parent whose text node was split, for `normalize()`. */
  const parents = new Set<Node>();
  /** The exact `style`-attribute undo for each hidden field. */
  const undos: Undo[] = [];
  let restored = false;

  const handle: CoverHandle = {
    runs: 0,
    fields: 0,
    restore(): void {
      // Idempotent, and the flag is set before any work: `restore()` is called
      // by overlapping brackets (§28) in every combination, and the second call
      // must be a no-op rather than a second `normalize()` of a page that has
      // moved on.
      if (restored) return;
      restored = true;

      // The fields first, and not last. `undoAll` guards each undo itself, so
      // it cannot be the thing that throws - and running it before the unwrap
      // loop means no throw in that loop can strand it. A hidden `<input>` left
      // hidden is the one residue of this pass a user would actually see, and
      // nothing brings it back afterwards.
      undoAll(undos);

      // Newest-first, so a run nested inside another's subtree - which cannot
      // happen today, but costs nothing to be right about - comes out before
      // the wrapper around it.
      //
      // **Namespace-blind, and that is why it needs no `<tspan>` case.** Every
      // call in the loop - `parentNode`, `firstChild`, `insertBefore`,
      // `removeChild`, and `normalize()` below - is a `Node` method that moves
      // nodes without reading or writing a name, so a `<tspan>` comes out by the
      // identical four lines an HTML `<span>` does, leaving the same text nodes
      // in the same order under the same parent. The one asymmetry a wrapper
      // could have introduced is a `<tspan>`'s own SVG attributes changing the
      // layout of what is left behind, and there are none: the wrapper carries
      // a single inline `visibility`, and it leaves with the element.
      for (let i = wrappers.length - 1; i >= 0; i -= 1) {
        // Guarded per wrapper, the way `undoAll` guards each undo, and for the
        // same reason: no throw is known here - the page moving or dropping our
        // span is what the `parent` check covers - so this is hardening rather
        // than a fix. What it buys is that one wrapper the page has done
        // something unexpected to cannot leave every *earlier* wrapper hidden
        // and the `normalize()` below unrun.
        try {
          const wrapper = wrappers[i];
          const parent = wrapper.parentNode;
          // The page is free to have thrown our wrapper away while it was
          // hidden. Nothing to put back, and nothing to complain about.
          if (!parent) continue;
          while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
          parent.removeChild(wrapper);
        } catch {
          // That one stays wrapped; the rest still come out.
        }
      }

      // Last, and not optional. A paragraph split into five text nodes measures
      // differently from the one node it was - `Range.getClientRects()` is
      // per-node - so without this the second pass over the same paragraph
      // would hide a different set of characters from the first.
      //
      // Note what it merges: **every** adjacent pair of text nodes under
      // `parent`, not only the pairs this file made by splitting. That is what
      // §26.2 asks for, and it is harmless for a page that is about to be left
      // alone - the characters and their layout are identical either way. It is
      // not free of consequence for a page that is still running: a framework
      // holding references to two adjacent text nodes it rendered separately
      // finds them merged into one, and its next write to the second writes
      // into a node that is no longer in the tree. Nothing here can narrow it -
      // a `Text` merged away cannot be un-merged, and there is no marker on the
      // ones we split - and the window is the length of one capture (§20).
      for (const parent of parents) parent.normalize();
    },
  };

  if (covers.length === 0) return handle;

  const root = doc.body ?? doc.documentElement;
  if (!root) return handle;

  // Document -> client, once, for the covers. Everything after this line is in
  // client coordinates: `getBoundingClientRect()`, `getClientRects()` and these.
  const view = doc.defaultView;
  const scrollX = view?.scrollX ?? 0;
  const scrollY = view?.scrollY ?? 0;
  const local: Cover[] = covers.map((cover) => ({
    kind: cover.kind,
    box: {
      x: cover.box.x - scrollX,
      y: cover.box.y - scrollY,
      width: cover.box.width,
      height: cover.box.height,
    },
  }));

  /**
   * The pre-filter: could this box be near any cover at all?
   *
   * `intersects` against `cover.box`, deliberately, and not `coversBox`: a box
   * outside a cover's bounding box is outside the ellipse inside it too, so the
   * cheap test is exact enough to *skip* on, and only the per-character test has
   * to know which shape was drawn (§29's amendment to this task).
   */
  const near = (box: Box): boolean => local.some((cover) => intersects(cover.box, box));

  /** Is any of a `Range`'s line boxes near a cover? */
  const anyNear = (rects: DOMRectList): boolean => {
    for (let i = 0; i < rects.length; i += 1) if (near(rects[i])) return true;
    return false;
  };

  const range = doc.createRange();
  const splits: Array<{ node: Text; runs: Run[] }> = [];
  const fields: HTMLElement[] = [];

  /**
   * Every root the field pass has to sweep: the document, and each **open**
   * shadow root `walkRoot` found under it.
   *
   * `querySelectorAll` does not cross a shadow boundary any more than
   * `createTreeWalker` does, so an `<input>`, `<textarea>` or `<select>` inside a
   * component was missed in exactly the way the component's text was
   * (`.plan/contracts.md` §31.2) - and the field pass is the *only* pass that can
   * see what the browser paints for a control, so missing it there is missing it
   * entirely.
   *
   * Nothing is swept twice: a shadow tree is not in its document's
   * `querySelectorAll`, and a nested root is not in its parent root's, so each
   * control is found by the one scope it actually lives in.
   */
  const scopes: Array<Document | ShadowRoot> = [doc];

  /**
   * One 2D context for the whole pass, with the last font string it was set to.
   *
   * `undefined` is "not tried yet" and `null` is "tried, and there is none",
   * exactly as `createTextMeasure` (lib/draw/wrap.ts) does it - and made lazily
   * for the same reason: a pass over a page with no cover on it should allocate
   * no canvas. Assigning `ctx.font` reparses the shorthand, so it is skipped
   * while the font is unchanged, which for a paragraph is every node in it.
   */
  let ctx: CanvasRenderingContext2D | null | undefined;
  let font = "";

  /**
   * "This character was not measured", as one shared object rather than a hole.
   *
   * `coveredRuns` reads `insets[i]` positionally, so the array it is handed has
   * to be as long as `charBoxes`; a character whose line could not be measured
   * gets this, which `inkBox` returns the box itself for. One object, because it
   * is never mutated and there may be thousands of characters.
   */
  const NO_INSET: InkInset = { top: 0, bottom: 0 };

  /**
   * The ink inset for each of `boxes`, in the font `el` computes to
   * (`InkInset`), parallel to `boxes` and measured **one line at a time**.
   *
   * **Per line, not per node** (`.plan/contracts.md` §31.4). `actualBoundingBox*`
   * is the union over every glyph in the string it is handed, so measuring the
   * node whole gives the *smallest* empty band any character in it has - and one
   * `p` or `y` anywhere in a paragraph therefore collapses `bottom` to about
   * 0.16px for every line in it, including the lines with no descender at all,
   * whose ink really does stop 3.82px above their font box. That is what left
   * the reported cover clearing the line above it by 0.16px - one step of §31.1's
   * 0.25px sweep - instead of by 3.8px, and on a face whose descent metric equals
   * its deepest glyph it left the report reproducing exactly.
   *
   * Grouping is by the box's `y`, because that is what a line *is* here: the
   * characters of one text node on one line share a line box, so they share a
   * font-box top to the bit. Empty boxes - a collapsed space, a soft hyphen -
   * are left out of their group rather than joined to whichever line sits at
   * `y: 0`, since `coveredRuns` skips them anyway and a stray space would only
   * widen the substring being measured.
   *
   * The greedy direction is unchanged and still deliberate: within a line the
   * inset is still the smallest empty band any of its characters has, so no
   * character is ever shrunk past its own ink. A fixed sample string would be
   * one call per font instead of a handful per node, and it would under-hide the
   * line whose glyphs reach further than the sample's.
   *
   * A handful of `measureText` calls per node, next to a per-character `Range`
   * loop over the same node: this is not the expensive half.
   *
   * `undefined` - no view, no canvas, no font, nothing to group - means "measure
   * nothing", and `coveredRuns` then behaves as it did before §31.1. So does a
   * single line whose metrics are not numbers; it keeps `NO_INSET` and the rest
   * of the node is still measured. A negative component is clamped away: ink
   * that overshoots the font box (accents, emoji) would otherwise *grow* the
   * box, which is the bug this is fixing, in miniature.
   */
  const inkInsetsOf = (el: Element, text: string, boxes: readonly Box[]): InkInset[] | undefined => {
    if (!view) return undefined;
    if (ctx === undefined) {
      try {
        ctx = doc.createElement("canvas").getContext("2d");
      } catch {
        // A page that has exhausted the GPU process, or is hostile about it.
        ctx = null;
      }
    }
    if (!ctx) return undefined;

    const wanted = canvasFont(view.getComputedStyle(el));
    if (wanted === "") return undefined;
    if (font !== wanted) {
      ctx.font = wanted;
      font = wanted;
    }

    // `y` to the indices of the characters sitting on it. A `Map` keeps
    // insertion order, so a node laid out top to bottom is measured top to
    // bottom - which matters to nothing but a debugger's patience.
    const lines = new Map<number, number[]>();
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i];
      if (isEmpty(box)) continue;
      const line = lines.get(box.y);
      if (line) line.push(i);
      else lines.set(box.y, [i]);
    }
    if (lines.size === 0) return undefined;

    const insets: InkInset[] = new Array<InkInset>(boxes.length).fill(NO_INSET);
    for (const indices of lines.values()) {
      // That line's own substring, and nothing else's - which is the whole of
      // §31.4. `text[i]` is the code unit `boxes[i]` was measured from, so a
      // surrogate pair comes back whole: both its halves share a `y`.
      let lineText = "";
      for (const i of indices) lineText += text[i];
      const m = ctx.measureText(lineText);
      const top = m.fontBoundingBoxAscent - m.actualBoundingBoxAscent;
      const bottom = m.fontBoundingBoxDescent - m.actualBoundingBoxDescent;
      // That line stays uninset, and the node's other lines are unaffected.
      if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue;
      const inset: InkInset = { top: Math.max(0, top), bottom: Math.max(0, bottom) };
      for (const i of indices) insets[i] = inset;
    }
    return insets;
  };

  /**
   * Does this node hold text of its own? Asked first, because it costs no layout.
   *
   * A `ShadowRoot` as well as an `Element`, because a component is free to parent
   * text straight to its root - `shadow.textContent = "..."` - and that text is
   * laid out, painted and printed like anyone else's.
   */
  const holdsText = (holder: Element | ShadowRoot): boolean => {
    for (let i = 0; i < holder.childNodes.length; i += 1) {
      const child = holder.childNodes[i];
      if (child.nodeType === TEXT_NODE && (child as Text).data.trim() !== "") return true;
    }
    return false;
  };

  /**
   * Measure `holder`'s own text children against the covers.
   *
   * Two arguments rather than one because a `ShadowRoot` holds text but is not an
   * element: it has no box to pre-filter on and no computed style to measure a
   * font from. `host` is the element that text is laid out in and inherits from -
   * `holder` itself when it is an element, and the shadow host when it is a root -
   * which for text parented straight to a shadow root is the right answer to both
   * questions rather than an approximation of them.
   */
  const measure = (holder: Element | ShadowRoot, host: Element): void => {
    if (!holdsText(holder)) return;

    // The element pre-filter §20 names, and the reason `onBeforePrint` is not a
    // per-character walk of the whole document: one rect per text-holding
    // element, against a handful of covers, before a single character is
    // measured.
    //
    // **Skip only on a box that exists and misses.** An empty rect means
    // *unknown*, not *nowhere*: `intersects` short-circuits on `isEmpty`, so
    // `near` answers "misses every cover" for a box of no area, and skipping on
    // that answer would drop the element's text without ever measuring it.
    // `display: contents` is the shape of it - the element generates no box at
    // all, so `getBoundingClientRect()` is all zeros, while its direct text
    // children are laid out and painted like anyone else's. Skipping there
    // meant a cover dragged over `<div style="display:contents">secret</div>`
    // painted an opaque block and left every word of it in the exported text
    // layer. The same zeros come from a `height: 0; overflow: visible`
    // container whose text paints outside it, and from anything else with no
    // box of its own.
    //
    // Falling through is safe because the second pre-filter below is exact and
    // does not depend on this box: `getClientRects()` over the node's contents
    // measures where the *text* paints, whatever the parent's box says or fails
    // to say. The cost is one extra range call per text node in a boxless
    // subtree - bounded, and paid only by the minority of elements that have no
    // box.
    //
    // `display: none` now falls through here too, and harmlessly: a hidden
    // element's ranges have no client rects either, so the second filter
    // rejects it for the price of that one call, and nothing is hidden that was
    // not already unpainted.
    //
    // What remains a limit is the element that *has* a box and paints text
    // outside it - `white-space: nowrap` overflowing a narrow block with
    // `overflow: visible`. Its rect is non-empty and genuinely misses, so a
    // cover over the spilled part alone still finds nothing to hide. That one
    // is a line for §21's list of honest limits, not a reason to measure every
    // character on the page.
    const elBox = host.getBoundingClientRect();
    if (!isEmpty(elBox) && !near(elBox)) return;

    for (let i = 0; i < holder.childNodes.length; i += 1) {
      const child = holder.childNodes[i];
      if (child.nodeType !== TEXT_NODE) continue;
      const node = child as Text;
      if (node.data.trim() === "") continue;

      // Second pre-filter, one call, and exact where the element's box is not:
      // `getClientRects()` on the whole node is one rect per *line box*, so a
      // cover over one line of a thirty-line paragraph rejects nothing, while a
      // cover elsewhere in a tall element rejects the paragraph whole.
      range.selectNodeContents(node);
      if (!anyNear(range.getClientRects())) continue;

      // Every character, in index order and none skipped: `coveredRuns` reads
      // `charBoxes[i]` as the box of character `i`, and it treats an empty box
      // as *neither* opening nor closing a run - so a gap left unmeasured would
      // silently merge two runs across it.
      //
      // `getBoundingClientRect()` rather than picking one of `getClientRects()`:
      // it is their union, which is the greedy direction §19.1 argues for, and
      // it is one call. A character with no boxes at all - a collapsed space -
      // comes back all zeros, which is the empty box `coveredRuns` skips.
      const boxes: Box[] = [];
      for (let k = 0; k < node.data.length; k += 1) {
        range.setStart(node, k);
        range.setEnd(node, k + 1);
        boxes.push(range.getBoundingClientRect());
      }

      // Measured per line and not per character, and after the pre-filters
      // rather than before them: a node no cover is near never costs a style
      // resolution, and the nodes that reach this point are the handful the
      // covers are drawn over. `host` computes to the font these boxes were laid
      // out in - it is the node's parent element, or the shadow host the node
      // inherits from - and `boxes` is what says where each line of it starts.
      const runs = coveredRuns(boxes, local, inkInsetsOf(host, node.data, boxes));
      if (runs.length > 0) splits.push({ node, runs });
    }
  };

  // `FILTER_REJECT` on an element walker skips the subtree, not just the node,
  // which is the whole point of `SKIP_TAGS`. Hoisted out of `walkRoot` because
  // there is now one walker per root and every one of them filters alike - "the
  // same `SKIP_TAGS` filter" is what §31.2 asks of a shadow root.
  const elementFilter: NodeFilter = {
    acceptNode: (node: Node) =>
      SKIP_TAGS.has((node as Element).tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  };

  /**
   * Measure one root and everything under it, then every **open** shadow root
   * hanging off any of it (`.plan/contracts.md` §31.2).
   *
   * `createTreeWalker` does not cross a shadow boundary, so before this a whole
   * web component's text was invisible to the pass: a cover dragged over it
   * painted an opaque block and left every word of it in the exported text
   * layer. Confirmed against the shipped code - the shadow `<p>`'s markup came
   * back untouched. That is the under-hiding direction, which is the leak the
   * feature exists to prevent, and it is not a limit of the §21 kind because the
   * root was there to be walked all along.
   *
   * **Reach, and nothing else.** Every root gets the same `SKIP_TAGS` filter, the
   * same two pre-filters, the same per-character `Range` boxes and the same
   * per-line ink insets, and every decision is still `coveredRuns`' and
   * `coversBox`'. In particular there is no test here for whether a root is worth
   * entering: a host far from every cover costs this the walk and no more,
   * because each element inside it meets the same pre-filter every other element
   * meets, and a gate here would be a second rule to keep in step with the first.
   *
   * Recursive, because shadow roots nest - a component inside a component is an
   * ordinary element of the outer root, and its own root is found the same way.
   *
   * `host` is the element the root's own text is laid out in and inherits from:
   * `scope` itself when it is an element, and the shadow host when it is a shadow
   * root, which has neither a box nor a computed style of its own. See `measure`.
   *
   * A **closed** root stays unreachable - `el.shadowRoot` is `null` for one - and
   * that is a genuine limit for §21's list rather than a leak, the same shape as
   * a cross-origin iframe: `attachShadow({mode: "closed"})` hands a page a root
   * nothing outside it can get at. It is also exactly what keeps this walk off
   * **our own marks**. `mountLayer` (lib/draw/layer.ts) and `mountBar`
   * (lib/draw/bar.ts) both attach `{mode: "closed"}` roots to hosts appended to
   * `documentElement`, so `el.shadowRoot` is `null` for each of them and nothing
   * here can enumerate either. A walk that reached inside the layer would split
   * the text of our own labels, which are the one thing in the capture that must
   * stay in the PDF.
   */
  /**
   * Walk `el`'s shadow root, if it has an **open** one.
   *
   * One copy, called from the two places an element with a root can turn up: the
   * elements `walkRoot`'s walker returns, and the walk root itself, which that
   * walker never returns. `scopes` is appended here rather than at either call
   * site, so the field pass sees exactly the roots the text pass entered.
   */
  const enterShadow = (el: Element): void => {
    // `null` both for an element with no root and for one whose root is closed.
    const shadow = el.shadowRoot;
    if (!shadow) return;
    scopes.push(shadow);
    walkRoot(shadow, el);
  };

  const walkRoot = (scope: Element | ShadowRoot, host: Element): void => {
    // The root is the one node this walk never *returns*: the walker's filter is
    // not applied to it and `nextNode()` starts past it. So both of the things
    // the loop below does to every element - measure it, and enter its open
    // shadow root - have to be done for the root by hand, and they belong in the
    // same place, because doing only the first is the §31.2 leak all over again.
    // `hideTextUnder` walks `doc.body`, `body` is in the spec's `attachShadow`
    // allow-list and Chrome honours it, so a page that renders itself into
    // `document.body.attachShadow({mode: "open"})` leaked for the *whole*
    // document: `runs: 0`, `fields: 0`, its markup byte-identical under a cover.
    measure(scope, host);
    // `in` rather than a cast, and `enterShadow` rather than a second copy of
    // it: a `ShadowRoot` has no `shadowRoot` of its own, so a nested walk root -
    // one this function reached through another shadow - takes this same branch
    // and falls out of it, instead of needing a rule that says so.
    if ("shadowRoot" in scope) enterShadow(scope);
    const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT, elementFilter);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node as Element;
      measure(el, el);
      enterShadow(el);
    }
  };

  walkRoot(root, root);

  // Form controls, measured in the same untouched layout as the text above, and
  // once per scope the walk reached rather than once for the document: a control
  // inside an open shadow root is no more visible to `querySelectorAll` than its
  // text was to the walker (`scopes`).
  //
  // `coversBox`, not `intersects`: an ellipse that does not paint over the field
  // must not blank it, for §29's reason exactly - a field hidden with nothing
  // drawn over it is a hole in the export, not a cover.
  for (const scope of scopes) {
    for (const el of Array.from(scope.querySelectorAll<HTMLElement>(FIELD_SELECTOR))) {
      const box = el.getBoundingClientRect();
      if (local.some((cover) => coversBox(cover, box))) fields.push(el);
    }
  }

  // --- Nothing above this line changed the DOM. Everything below does. ---
  //
  // And everything below is guarded as one unit, which the half above needs no
  // part of: it mutates nothing, so a throw there leaves the page exactly as it
  // was found and the caller with an exception and no debris.
  //
  // Down here a throw is a different animal. `splitText` on a node the page
  // removed between the measure and the mutation is the shape of it, and it
  // would never reach `return handle` - so the caller gets no handle, and the
  // page keeps however many wrappers went in before the throw. That is hidden
  // text with nothing left in the world that can put it back: it outlives the
  // capture, it outlives `stop()`, and it ends at a reload. Exactly the residue
  // `restore()` exists to make impossible, arrived at from the other side.
  //
  // **Undo and rethrow**, rather than returning a handle over the partial work.
  // The partial handle is the tempting one, because the caller would at least
  // keep its restore - but it hands back a cover that hid *some* of what it
  // paints over and says nothing about it, and the capture then goes out with
  // part of a covered paragraph still in the PDF's text layer. Under-hiding is
  // the leak this module exists to prevent (`.plan/design.md` §19.1), and a
  // silent partial one is the worst version of it. Hiding nothing and putting
  // the page back as it was found is a visible failure, which is the kind that
  // gets fixed.
  try {
    for (const { node, runs } of splits) {
      const parent = node.parentNode;
      if (!parent) continue;
      parents.add(parent);

      // Which namespace this node's wrappers have to be built in, asked once
      // per node rather than once per run - `splitText` never moves a node to a
      // different parent, so every run of one text node answers alike.
      //
      // `parentElement` and not the `parent` above: a namespace belongs to an
      // element, and `parent` may be a **shadow root**, which has none - text
      // parented straight to a root is a case `measure` deliberately reaches.
      // `undefined` there is the right answer rather than a gap, because
      // `attachShadow` is not allowed on an SVG element at all, so a shadow
      // root's own text is never SVG content.
      //
      // **`<foreignObject>` is subtracted from the SVG side**, because it is
      // the one SVG element whose children are laid out as HTML: it is the
      // *boundary* into HTML, not a piece of the inside. Its own
      // `namespaceURI` is the SVG one like any other SVG element's, so without
      // this clause a text node parented straight to it - a bare
      // `<foreignObject>Some text</foreignObject>`, or the trailing text beside
      // an HTML child - answers "SVG" and gets a `<tspan>` built inside an HTML
      // layout context. That is §31.3's bug with the namespaces swapped, and it
      // measures the same way round: the same node's rect went from
      // `[10, 470, 203.11, 20.5]` with a `<span>` to `[0, 0, 0, 0]` with a
      // `<tspan>`. Only a *text* child needs the clause. An **element** child
      // carries its own `namespaceURI` - the XHTML one, put there by the parser
      // - so it never consults the `<foreignObject>` and was always answered
      // correctly; it is the text node, which has no namespace of its own, that
      // falls through to the parent element and has to be told about the
      // boundary.
      //
      // `localName` and not `tagName`: `localName` is the prefix-free name the
      // namespace itself defines, and SVG's is the case-sensitive
      // `foreignObject`. `tagName` is not normalised the same way across
      // serialisations - it is the *qualified* name, so an XHTML-served page
      // may spell it `svg:foreignObject`, and it is upper-cased for
      // HTML-namespace elements. `localName` reads the same however the page
      // reached the DOM.
      const parentEl = node.parentElement;
      const inSvg = parentEl?.namespaceURI === SVG_NS && parentEl.localName !== "foreignObject";

      // Right to left. `splitText` leaves the *earlier* half in `node`, so
      // working down from the last run keeps every remaining run's offsets
      // describing `node` exactly as `coveredRuns` reported them - no
      // re-indexing, and therefore no second place for an off-by-one to live.
      for (let i = runs.length - 1; i >= 0; i -= 1) {
        const [start, end] = runs[i];
        // Both guarded: splitting at the very end or the very start would leave
        // an empty text node behind, and `restore()` should have nothing to
        // tidy that it did not have to create.
        if (end < node.data.length) node.splitText(end);
        const covered = start > 0 ? node.splitText(start) : node;

        // **In the parent's namespace**, which is the whole of §31.3.
        // `createElement` is namespace-blind - it makes an *HTML* element
        // whatever it is inserted into - so an `<svg><text>` covered this way
        // got an HTML `<span>` sitting inside the SVG namespace. SVG renders no
        // such element and lays out none of its children, so the `<text>`'s rect
        // collapsed from `[40,206,214,24]` to `[40,200,0,0]`: the glyphs left
        // layout instead of staying hidden in place, every label after them
        // shifted, and whatever had hidden the text, it was not
        // `visibility: hidden`. That is §17.1's "reflows nothing" broken by the
        // one mechanism chosen for keeping it.
        //
        // `<tspan>` is SVG's own inline wrapper - the element `render.ts` uses
        // for a label's own wrapped lines - so it takes part in `<text>`'s
        // layout the way a `<span>` takes part in a paragraph's: the characters
        // keep their advance widths and their place on the line, and
        // `visibility: hidden` takes away only the paint. It is the single
        // correct counterpart, not the nearest available one.
        //
        // `inSvg` is the parent element's own `namespaceURI`, not the
        // document's and not `instanceof SVGElement`: the question is which
        // namespace *this* element is in, the answer is on the element, and a
        // namespace comparison stays right across a foreign document, where an
        // `instanceof` against this realm's `SVGElement` would answer `false`
        // for an SVG element that is one.
        //
        // For HTML re-entering through `<foreignObject>` the namespace alone is
        // *not* enough, which is why `inSvg` above excludes that one element by
        // name. It is in the SVG namespace like everything else under `<svg>`,
        // but it is the single SVG element whose children lay out as HTML, so
        // it is the boundary rather than the inside. An element child of it
        // carries the HTML namespace on itself and this test reads that and
        // hands it a `<span>`; a bare text child carries no namespace at all,
        // so the question reaches the `<foreignObject>`, and answering it from
        // the namespace alone would put a `<tspan>` into an HTML layout
        // context - §31.3's own failure, mirrored.
        //
        // A bare wrapper with one declaration either way: it inherits
        // everything and is the smallest thing that can carry the property.
        // `!important` because a page's own `span { visibility: visible }` at
        // that weight would otherwise put the text back into the text layer, and
        // this is the one property that must win. `visibility` is an inherited
        // property in SVG exactly as in CSS generally, so the forced declaration
        // reaches the glyphs through the `<tspan>` the same way.
        //
        // "Adds no box of its own" would be a claim about the *default* UA
        // style for a `<span>` - `display: inline`, no margin, padding or
        // border - and not a guarantee. Only `visibility` is forced here, so a
        // page-wide type rule - `span { display: block }` or
        // `span { padding: 2px }` - matches this wrapper exactly as it matches
        // the page's own spans, and would reflow the line it was inserted into.
        // Forcing a full reset instead would trade a rare page for a certain
        // one - `display: inline !important` is the wrong answer inside a flex
        // or grid container - so the narrow declaration stands, and the claim
        // is qualified rather than the code widened.
        const wrapper = inSvg ? doc.createElementNS(SVG_NS, "tspan") : doc.createElement("span");
        wrapper.style.setProperty("visibility", "hidden", "important");
        parent.insertBefore(wrapper, covered);
        wrapper.appendChild(covered);
        wrappers.push(wrapper);
      }
    }

    for (const el of fields) undos.push(overrideStyle(el, [["visibility", "hidden"]]));
  } catch (err) {
    // `restore()` undoes precisely what got in and no more: `wrappers`, `parents`
    // and `undos` are appended as the work happens, so a half-finished pass is
    // the state it is already written for, and its own per-span and per-undo
    // guards mean one stuck wrapper cannot strand the rest.
    try {
      handle.restore();
    } catch {
      // The cleanup must not become the failure. `err` says what actually went
      // wrong, and it is the one worth propagating.
    }
    throw err;
  }

  handle.runs = wrappers.length;
  handle.fields = undos.length;
  return handle;
}
