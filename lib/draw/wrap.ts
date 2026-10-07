/**
 * Word wrap and auto-grow for a text label: a string and a box in, the lines to
 * paint and a box tall enough to hold them out.
 *
 * Wrapping needs advance widths, advance widths need a font, and
 * `lib/draw/render.ts` is pure and runs without a document. This module is
 * where those two facts are reconciled, and it reconciles them the same way
 * `shapeToSpec` / `specToElement` do: **the measuring is a parameter**, so all
 * of the wrapping logic here is pure and unit-tested - `tests/draw-wrap.test.ts`
 * passes a fake of half an em per code unit and needs no font, no canvas and no
 * document - and `createTextMeasure()` is the one function in the file that
 * touches a document, and the one part a unit test cannot reach.
 *
 * The answer then travels on the shape (`.plan/design.md` §13.1):
 * `TextShape.text` is the source of truth, with the `\n`s the user typed, and
 * `TextShape.lines` is this module's output cached on the shape so that the
 * renderer never measures anything.
 *
 * A leaf: types from `./model`, plus `LABEL_FONT_FAMILY` from `./css` inside
 * `createTextMeasure` and nowhere else. No `chrome.*`.
 *
 * Every loop below is a single pass over its input - there is no loop whose exit
 * depends on a line getting shorter - because the caller is a keystroke handler
 * and a degenerate box must not hang the page it is drawn on.
 */

import { LABEL_FONT_FAMILY } from "./css";

import type { DrawRect } from "./model";

/**
 * How much taller than its font size a line of a label sits, as a multiple.
 *
 * Owned here rather than in model.ts because it is a *layout* number: it is
 * what `layoutText` multiplies by to decide whether a box has grown, and what
 * `render.ts` puts in each `<tspan>`'s `dy`. Those two must agree exactly or a
 * wrapped label paints outside the box it was fitted to.
 *
 * 1.4 because the number has a floor and a ceiling and this sits between them:
 *
 * - The floor is the font's own line box. Ascent plus descent is about 1.2 em
 *   for the faces in `LABEL_FONT_FAMILY` - the figure `layer.ts`'s since-retired
 *   `TEXT_EM_LINE = 1.5` bound was built on: "1.2 with a good 0.3 em to spare" -
 *   and at or under that the descenders of one line touch the ascenders of the
 *   next. Segoe UI, the loosest of the stack, asks for about 1.33 em once its
 *   line gap is counted, so 1.4 clears the whole stack rather than the average
 *   of it.
 * - The ceiling is that this is a two- or three-line annotation and not body
 *   copy. Past about 1.5 the lines stop reading as one label and start reading
 *   as separate marks that happen to be near each other.
 *
 * It also puts a freshly placed box at the default 16px label over
 * `MIN_TEXT_HEIGHT_PX` (contracts §21, 20px) at 22.4px, so the first drag of a
 * resize handle does not begin by snapping the box taller than it was drawn.
 */
export const TEXT_LINE_HEIGHT: number = 1.4;

/**
 * The width of a run of text at a font size, in CSS px.
 *
 * A parameter rather than a call, which is what keeps every line of wrapping
 * logic in this file pure and unit-tested: the tests pass a fake (half an em
 * per code unit), and `createTextMeasure()` is the real one.
 */
export type Measure = (text: string, fontSize: number) => number;

export interface TextLayout {
  /** One entry per rendered line. Never empty: an empty label is one empty line. */
  lines: readonly string[];
  /**
   * The box the label was laid out in. `width` is the box's, untouched;
   * `height` is `max(the box's, the lines' own height)`.
   */
  rect: DrawRect;
}

/**
 * A break opportunity: whitespace, *except* a no-break space.
 *
 * U+00A0 is in `\s`, and not breaking there is the one thing it exists for -
 * "10 kg" and "Fig. 3" are typed with one precisely so that they stay on one
 * line. `[^\S\u00a0]` reads as "in `\s` and not U+00A0", and `[\S\u00a0]` is
 * exactly its complement, so the two halves of the tokenizer cannot disagree
 * about which class a character is in and leave a character in neither.
 *
 * A no-break space inside a word too wide for the box *is* still broken, by
 * `breakWord` - at that point every break is a last resort, which is what CSS
 * `word-break: break-all` does with it too.
 */
const TOKENS = /[^\S\u00a0]+|[\S\u00a0]+/g;
const IS_SPACE = /^[^\S\u00a0]/;

/**
 * One word that does not fit, broken between characters into chunks that do.
 *
 * The last resort, and the reason a long URL cannot run off the side of the
 * page instead of wrapping. Walked with `for...of`, which iterates code points
 * rather than UTF-16 units, so a break can never land inside a surrogate pair
 * and leave a lone surrogate to paint as a replacement character. A combining
 * mark or an emoji ZWJ sequence can still be split: that needs
 * `Intl.Segmenter`, and it is not worth the cost on a case that only arises
 * *inside* a word already too wide for its own box.
 *
 * The `chunk !== ""` guard is the progress guarantee. A single character wider
 * than `maxWidth` takes a line of its own rather than producing an empty line
 * and another attempt at the same character, so this terminates for any
 * `maxWidth` - `MIN_TEXT_WIDTH_PX` keeps a box from getting there, and this
 * keeps it from mattering if one ever does.
 */
function breakWord(
  word: string,
  maxWidth: number,
  fontSize: number,
  measure: Measure,
): string[] {
  const chunks: string[] = [];
  let chunk = "";
  for (const char of word) {
    const grown = chunk + char;
    if (chunk !== "" && measure(grown, fontSize) > maxWidth) {
      chunks.push(chunk);
      chunk = char;
    } else {
      chunk = grown;
    }
  }
  if (chunk !== "") chunks.push(chunk);
  return chunks;
}

/**
 * Greedy wrap of one hard segment - a run with no `\n` anywhere in it.
 *
 * Two accumulators, and the second one is where "a trailing space at a soft
 * break is dropped" lives: `line` holds the segment up to and including the
 * last word placed, and `pending` holds the whitespace seen since. Whitespace
 * between two words joins the line only once a word has landed after it, so at
 * a break there is nothing to trim off - the space is simply never committed.
 * Whitespace at the *end* of a segment is not a break, so it is kept: it is
 * what the user typed, and it paints nothing.
 *
 * The joining space counts toward the fit, where CSS lets a trailing space hang
 * past the end of the line. A hair conservative, and the only case it changes
 * is the knife-edge one where the space itself is what overflowed - which moves
 * a break one word earlier rather than putting a line past the box.
 *
 * **The leading indent is break whitespace when it does not fit.** `line` is
 * empty only before the segment's first word has landed, so the only whitespace
 * that can ever reach a word ahead of it is the segment's own indent - and
 * gluing that on must not be what makes the word too wide. When indent plus
 * word overflows, the indent is dropped and the word takes the line alone.
 *
 * Dropped rather than committed as a line of its own, of the two ways to keep
 * the word whole, because a line holding nothing but an indent paints nothing
 * and `layoutText` counts lines: it would grow the box by a whole line height
 * for whitespace the user cannot see, and put a blank first line into the
 * `<tspan>`s and so into the PDF. Dropping it is the rule this function already
 * applies to the space at any other soft break - the whitespace is a break
 * opportunity, it is never committed, and `text` stays the source of truth.
 * Keeping the word whole is contracts §18 ("words are kept whole where they
 * fit") and the Ctrl+F promise in `.plan/design.md` §13.3.
 */
function wrapSegment(
  segment: string,
  maxWidth: number,
  fontSize: number,
  measure: Measure,
): string[] {
  const lines: string[] = [];
  let line = "";
  let pending = "";

  for (const token of segment.match(TOKENS) ?? []) {
    if (IS_SPACE.test(token)) {
      pending += token;
      continue;
    }

    const joined = line + pending + token;
    if (line === "") {
      // Nothing in front of the word to break away from, so it takes this line
      // whatever it measures - the only question is whether `pending`, which
      // here can only be the segment's leading indent, comes with it. It does
      // where it fits, and is dropped as break whitespace where it does not, so
      // that an indent can never be the reason a word is split.
      line = pending !== "" && measure(joined, fontSize) > maxWidth ? token : joined;
    } else if (measure(joined, fontSize) <= maxWidth) {
      line = joined;
    } else {
      lines.push(line);
      line = token;
    }
    pending = "";

    if (measure(line, fontSize) > maxWidth) {
      // `line` is now exactly one word, and never an indent plus a word: the
      // branch above either started it, or left alone a line that fits and so
      // cannot reach here. So this is the only place a word is ever split, it
      // is split only after failing on a line of its own, and it is measured
      // against the whole box rather than the box less an indent.
      const chunks = breakWord(line, maxWidth, fontSize, measure);
      for (const chunk of chunks.slice(0, -1)) lines.push(chunk);
      // The last chunk stays open so the next word can sit beside it, the way
      // `word-break: break-all` carries on along the line it broke onto.
      line = chunks[chunks.length - 1] ?? "";
    }
  }

  lines.push(line + pending);
  return lines;
}

/**
 * Break `text` into rendered lines at `maxWidth`.
 *
 * `\n` is split on first, always, so a break the user typed is honoured and a
 * blank line survives as an empty entry. Each segment is then greedy-wrapped:
 * words are kept whole where they fit, and a single word wider than `maxWidth`
 * is broken between characters so a long URL cannot run off the side.
 *
 * A trailing space at a soft break is dropped from the line and kept in `text`.
 *
 * `maxWidth <= 0` or non-finite means **no soft wrapping** - one line per hard
 * segment. A degenerate box must not loop.
 *
 * Never returns an empty array: `wrapLines("", …)` is `[""]`.
 */
export function wrapLines(
  text: string,
  maxWidth: number,
  fontSize: number,
  measure: Measure,
): string[] {
  // `"".split("\n")` is `[""]`, which is the whole of "never empty": an empty
  // label is one empty line, so a caller may read `lines[0]` or divide by
  // `lines.length` without asking first.
  const segments = text.split("\n");
  // A box with no usable width wraps nothing rather than breaking every
  // character onto a line of its own, which is what `maxWidth: 0` would
  // otherwise mean. `NaN` (a box dragged through a bad number) and `Infinity`
  // ("no limit") both want the same answer, and one guard gives it to them.
  if (!(Number.isFinite(maxWidth) && maxWidth > 0)) return segments;

  const lines: string[] = [];
  for (const segment of segments) {
    for (const line of wrapSegment(segment, maxWidth, fontSize, measure)) lines.push(line);
  }
  return lines;
}

/**
 * `wrapLines`, plus the box grown to hold the result.
 *
 * `rect.width` is passed to `wrapLines` as `maxWidth` and comes back unchanged.
 * `rect.height` comes back as
 * `Math.max(rect.height, lines.length * fontSize * TEXT_LINE_HEIGHT)` - the
 * whole of "if the text exceeds height, automatically make the text area
 * higher", and the reason a box dragged tall stays tall.
 *
 * `x` and `y` are passed through untouched.
 */
export function layoutText(
  text: string,
  rect: DrawRect,
  fontSize: number,
  measure: Measure,
): TextLayout {
  const lines = wrapLines(text, rect.width, fontSize, measure);
  return {
    lines,
    // A fresh rect, never the caller's: the editor keeps the box the user
    // dragged (`Editor.rect`) and asks this what that box should *render* as,
    // so the two must not be one object - a box dragged tall stays tall only
    // because the grown height never writes back.
    rect: {
      x: rect.x,
      y: rect.y,
      // Never touched. Widening the box would move the wrap the lines were just
      // fitted to; the user's drag is the only thing that sets a width.
      width: rect.width,
      height: Math.max(rect.height, lines.length * fontSize * TEXT_LINE_HEIGHT),
    },
  };
}

/**
 * The real `Measure`: a cached 2D canvas context with
 * `font = \`${fontSize}px ${LABEL_FONT_FAMILY}\``.
 *
 * The only function in this file that touches a document - the same split as
 * `shapeToSpec` / `specToElement` in render.ts. Called once per session and
 * then per keystroke, so the context and the last font string are both cached.
 *
 * Returns a `Measure` that answers `0` if a context cannot be had, which turns
 * wrapping off rather than throwing inside a keystroke handler.
 *
 * Three things worth knowing about the implementation:
 *
 * - The canvas is made **lazily**, on the first measurement rather than here,
 *   so that constructing a measure is safe anywhere - including in a unit test,
 *   where `document` does not exist at all. `undefined` means "not tried yet"
 *   and `null` means "tried, and there is none".
 * - `measureText` and not `getComputedTextLength()` on a live `<text>`: it is
 *   synchronous, it forces no layout, and it can therefore run on every
 *   keystroke without the layer reflowing. It is an *approximation* of what SVG
 *   will do - shaping, kerning across a run and bidi reordering can each move a
 *   line a hair past the box it was fitted to - and that needs no fudge factor,
 *   because a mark's own `<svg>` is `overflow: visible` (`layer.ts`): a line a
 *   pixel too wide paints, it does not clip. All the box has to get right is
 *   which printed sheet the label lands on.
 * - `LABEL_FONT_FAMILY` is system faces only, with no web font in it, so there
 *   is no font-loading race here to lose: whatever the stack resolves to is
 *   resolved by the time the first character is typed.
 */
export function createTextMeasure(): Measure {
  let ctx: CanvasRenderingContext2D | null | undefined;
  let font = "";

  return (text, fontSize) => {
    if (ctx === undefined) {
      try {
        // `typeof` first because a bare `document` where there is none is a
        // ReferenceError, and the `catch` is for the rest: `getContext` returns
        // null when a context cannot be allocated, and a hostile or exhausted
        // page can make the call itself throw.
        ctx =
          typeof document === "undefined"
            ? null
            : document.createElement("canvas").getContext("2d");
      } catch {
        ctx = null;
      }
    }
    if (ctx === null) return 0;

    const wanted = `${fontSize}px ${LABEL_FONT_FAMILY}`;
    // Assigning `font` reparses the shorthand, so it is skipped while the size
    // is unchanged - which is every keystroke of a label.
    if (font !== wanted) {
      ctx.font = wanted;
      font = wanted;
    }
    return ctx.measureText(text).width;
  };
}
