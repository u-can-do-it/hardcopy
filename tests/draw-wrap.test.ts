import { describe, expect, it } from "vitest";

import { MIN_TEXT_HEIGHT_PX } from "@/lib/draw/frame";
import { DEFAULT_DRAW_PREFS } from "@/lib/draw/prefs";
import { createTextMeasure, layoutText, TEXT_LINE_HEIGHT, wrapLines } from "@/lib/draw/wrap";

import type { DrawRect } from "@/lib/draw/model";
import type { Measure } from "@/lib/draw/wrap";

/**
 * All of the wrapping, with no font, no canvas and no document.
 *
 * `measure` is a parameter of every function under test (contracts §18), which
 * is the whole reason this suite can exist in a repo whose vitest runs with
 * `environment: "node"`: the fake below is the only "font" here, and it is
 * exact, so every expectation in the file is arithmetic rather than a guess at
 * what some machine's Helvetica does.
 *
 * `createTextMeasure()` is the one function in `wrap.ts` a unit test cannot
 * really reach - there is no document to measure in. What *is* checked is its
 * documented fallback: it hands back a `Measure` that answers `0` instead of
 * throwing, and a `0` measure turns wrapping off.
 */

/** Half an em per code unit - the fake `Measure` contracts §18 names. */
const halfEm: Measure = (text, fontSize) => text.length * fontSize * 0.5;

/** One font size for the whole suite, so that widths below are readable. */
const FONT_SIZE = 10;

/** The width of `n` code units at `FONT_SIZE`, under `halfEm`. Five px each. */
function units(n: number): number {
  return n * FONT_SIZE * 0.5;
}

function rect(x: number, y: number, width: number, height: number): DrawRect {
  return { x, y, width, height };
}

/**
 * A ceiling on a slow-but-finite wrap. That is all a timeout here can be.
 *
 * It does **not** catch the hang it is named for: `wrapLines` is synchronous,
 * and a synchronous loop that makes no progress never yields the JS thread, so
 * vitest's timer never gets to fire (verified under this repo's vitest 3.0.5 -
 * such a run has to be killed from outside the runner). What the clock does
 * catch is the survivable relative: a change that still terminates but measures
 * its way through a degenerate box hundreds of thousands of times.
 *
 * The real protection is structural, and lives in `wrap.ts`. `wrapSegment` is a
 * single pass over a fixed token array, with no loop whose exit depends on a
 * line getting shorter. `breakWord`'s `chunk !== ""` guard gives a character
 * wider than `maxWidth` a line of its own rather than emitting an empty line
 * and trying the same character again. And `wrapLines` turns soft wrapping off
 * outright for a `maxWidth` that is not both finite and positive. The
 * degenerate-box cases below are evidence for those three by returning at all -
 * not by beating a clock.
 */
const HANG_TIMEOUT_MS = 1_000;

describe("TEXT_LINE_HEIGHT", () => {
  it("clears the line box of the loosest face in the label stack, and stays a label", () => {
    // The floor is the loosest face in `LABEL_FONT_FAMILY`, not the average
    // one. Ascent plus descent is about 1.2 em across the stack - the figure
    // layer.ts's since-retired `TEXT_EM_LINE = 1.5` bound was built on - but
    // Segoe UI asks for about 1.33 em once its
    // line gap is counted, and 1.33 is therefore what wrap.ts's doc comment
    // argues from and what this asserts: at 1.25 the argument in that comment
    // would be false while a `> 1.2` assertion stayed green. Over about 1.5 a
    // two-line label stops reading as one label and starts reading as two
    // marks that happen to be near each other.
    expect(TEXT_LINE_HEIGHT).toBeGreaterThanOrEqual(1.33);
    expect(TEXT_LINE_HEIGHT).toBeLessThanOrEqual(1.5);
  });

  it("puts a one-line box at the default font size over the frame's minimum", () => {
    // Both numbers imported rather than quoted. With `16` and `20` inline this
    // assertion could not do the one job it claims - either constant could move
    // and it would stay green - and comparing the two is the whole point: a
    // freshly placed box must not begin by snapping taller than it was drawn on
    // the first drag of a resize handle.
    expect(DEFAULT_DRAW_PREFS.fontSize * TEXT_LINE_HEIGHT).toBeGreaterThanOrEqual(
      MIN_TEXT_HEIGHT_PX,
    );
  });
});

describe("wrapLines", { timeout: HANG_TIMEOUT_MS }, () => {
  it("wraps greedily at maxWidth, and splits no word doing it", () => {
    // "alpha beta" is 10 units (50px) and fits; adding " gamma" makes 16 (80px)
    // and does not. "gamma delta" is 11 units (55px), so both lines are as full
    // as a whole word lets them be.
    const lines = wrapLines("alpha beta gamma delta", units(12), FONT_SIZE, halfEm);
    expect(lines).toEqual(["alpha beta", "gamma delta"]);
    // Every word whole and in order: with single spaces and no character
    // breaking, the lines rejoin into exactly the text that went in.
    expect(lines.join(" ")).toBe("alpha beta gamma delta");
    for (const line of lines) expect(halfEm(line, FONT_SIZE)).toBeLessThanOrEqual(units(12));
  });

  it("keeps a word that fits exactly, rather than breaking on the boundary", () => {
    // A fit is `<= maxWidth`. 10 units is 50px, and the box is 50px.
    expect(wrapLines("alpha beta", units(10), FONT_SIZE, halfEm)).toEqual(["alpha beta"]);
  });

  it("splits a single word wider than the box, between characters", () => {
    const lines = wrapLines("aaaaaaaaaa", units(4), FONT_SIZE, halfEm);
    expect(lines).toEqual(["aaaa", "aaaa", "aa"]);
    // Nothing is lost or added: a soft break inserts no hyphen and no space.
    expect(lines.join("")).toBe("aaaaaaaaaa");
    for (const line of lines) expect(halfEm(line, FONT_SIZE)).toBeLessThanOrEqual(units(4));
  });

  it("gives a character wider than the whole box a line of its own", () => {
    // The progress guarantee, and the reason this call returns at all: an empty
    // line plus another attempt at the same character is the shape of the hang.
    expect(wrapLines("abc", units(1) - 1, FONT_SIZE, halfEm)).toEqual(["a", "b", "c"]);
  });

  it("leaves the line a broken word ended on open for the next word", () => {
    // 6 units of "a" break into 5 + 1 at a 5-unit box; " bb" then fits beside
    // the leftover, the way `word-break: break-all` carries on along the line
    // it broke onto rather than starting a fresh one.
    expect(wrapLines("aaaaaa bb", units(5), FONT_SIZE, halfEm)).toEqual(["aaaaa", "a bb"]);
  });

  it("always breaks on a newline, and keeps a blank line", () => {
    expect(wrapLines("a\n\nb", units(100), FONT_SIZE, halfEm)).toEqual(["a", "", "b"]);
    // Honoured even where the two segments would comfortably have shared a line.
    expect(wrapLines("a\nb", units(100), FONT_SIZE, halfEm)).toEqual(["a", "b"]);
    // A hard break inside a segment that also soft-wraps: each segment wraps on
    // its own, and neither borrows a word from the other.
    expect(wrapLines("alpha beta\ngamma", units(5), FONT_SIZE, halfEm)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("is one empty line for an empty label, never no lines at all", () => {
    // So that a caller may read `lines[0]` or divide by `lines.length`.
    expect(wrapLines("", units(48), FONT_SIZE, halfEm)).toEqual([""]);
  });

  it.each([0, -5, NaN, Infinity])("does no soft wrapping at maxWidth %p", (maxWidth) => {
    // The assertion that matters is that the call *returns*: 0 and -5 would
    // otherwise mean "break every character", which is a loop that makes no
    // progress. NaN is a box dragged through a bad number and Infinity is "no
    // limit"; both want the same answer as a box with no width - one line per
    // hard segment, and nothing measured.
    const text = "a much longer run of words than any box\nand a second line";
    expect(wrapLines(text, maxWidth, FONT_SIZE, halfEm)).toEqual([
      "a much longer run of words than any box",
      "and a second line",
    ]);
  });

  it("drops the space it broke at, however many there were", () => {
    // The space between two words belongs to neither line once the break falls
    // on it: `"alpha "` would paint the same but would come back out of
    // `lines` and into a `<tspan>`, where a stray trailing space is a hair of
    // extra selection at the end of a line in the exported PDF.
    expect(wrapLines("alpha beta", units(5), FONT_SIZE, halfEm)).toEqual(["alpha", "beta"]);
    expect(wrapLines("alpha   beta", units(5), FONT_SIZE, halfEm)).toEqual(["alpha", "beta"]);
  });

  it("keeps whitespace that is not at a break", () => {
    // The end of a segment is not a soft break, so what the user typed stays -
    // it paints nothing, and `text` remains the source of truth either way.
    expect(wrapLines("alpha ", units(100), FONT_SIZE, halfEm)).toEqual(["alpha "]);
    // A leading indent is part of the first line it lands on, and counts toward
    // that line's fit: "  alpha" is 7 units in a 7-unit box, so "beta" is
    // pushed to the second line a word earlier than it would be without it.
    expect(wrapLines("  alpha beta", units(7), FONT_SIZE, halfEm)).toEqual(["  alpha", "beta"]);
    // Wide enough for the indent and both words, so the case above is a real
    // break and not the only width this text was ever tried at.
    expect(wrapLines("  alpha beta", units(12), FONT_SIZE, halfEm)).toEqual(["  alpha beta"]);
  });

  it("drops a leading indent rather than splitting the word it sits in front of", () => {
    // The indent is the one run of whitespace that can reach a word before the
    // word has had a line to itself, and gluing it on must not be what makes
    // the word too wide: `halfEm("alpha")` is 25 in a 25px box, so the word
    // fits and has to come back whole. Dropped, the indent is break whitespace
    // like the space at any other soft break - `text` keeps it, and it painted
    // nothing.
    expect(wrapLines("  alpha", units(5), FONT_SIZE, halfEm)).toEqual(["alpha"]);
    // A tab is the same character class and gets the same answer, and the rest
    // of the segment then wraps as though the indent had never been there.
    expect(wrapLines("\talpha beta", units(5), FONT_SIZE, halfEm)).toEqual(["alpha", "beta"]);
  });

  it("breaks an over-wide indented word against the box, not the box minus the indent", () => {
    // `breakWord` is still reached for a word that genuinely does not fit:
    // "hello" is 25 in a 20px box. What the indent must not do is decide
    // *where* - with "  " still glued on, the first chunk was "  he", two units
    // of it spent on whitespace that paints nothing and the break a character
    // earlier than the box asked for.
    expect(wrapLines("  hello", units(4), FONT_SIZE, halfEm)).toEqual(["hell", "o"]);
    // Six units of "a" in a five-unit box breaks 5 + 1 whether it is indented
    // or not: the indent changes nothing about a word that was never going to
    // fit.
    expect(wrapLines("  aaaaaa", units(5), FONT_SIZE, halfEm)).toEqual(["aaaaa", "a"]);
    expect(wrapLines("aaaaaa", units(5), FONT_SIZE, halfEm)).toEqual(["aaaaa", "a"]);
  });

  it("never splits a word that would have fitted, over a spread of texts and widths", () => {
    // The invariant itself, asserted rather than sampled: contracts §18 ("words
    // are kept whole where they fit") and the Ctrl+F promise design §13.3 puts
    // in the README ("a word is never split by a soft wrap, so single words
    // always match").
    //
    // Order-aware, not a substring scan, because a scan flags lines a soft wrap
    // is not guilty of: in `"ab a"` at a 2-unit box the line `"a"` is a proper
    // prefix of the word `"ab"` and both words are whole. So the words that
    // came out are walked against the words that went in, and any word that did
    // not come back in one piece has to prove it could not have fitted. That
    // rejoin also says nothing was lost, added or reordered.
    const texts = [
      "alpha beta gamma delta",
      "  alpha beta",
      "\talpha beta gamma",
      "    epsilon zeta",
      "  hello",
      "alpha   beta gamma",
      "  alpha\n  beta gamma\n\n  delta",
      "aaaaaaaaaaaa zeta",
      "  aaaaaaaaaaaa zeta",
      "alpha\u00a0beta gamma",
      "  alpha\u00a0beta gamma",
    ];
    // The same word class as `wrap.ts`'s tokenizer: in `\S`, plus U+00A0.
    const WORDS = /[\S\u00a0]+/g;

    for (const text of texts) {
      for (let n = 1; n <= 14; n += 1) {
        const maxWidth = units(n);
        const lines = wrapLines(text, maxWidth, FONT_SIZE, halfEm);
        const wanted = text.match(WORDS) ?? [];
        const got = lines.flatMap((line) => line.match(WORDS) ?? []);
        const where = `${JSON.stringify(text)} at ${maxWidth}px -> ${JSON.stringify(lines)}`;

        let i = 0;
        for (const word of wanted) {
          if (got[i] === word) {
            i += 1;
            continue;
          }
          let rejoined = "";
          while (i < got.length && rejoined !== word) {
            rejoined += got[i];
            i += 1;
          }
          expect(rejoined, `lost or reordered a word: ${where}`).toBe(word);
          expect(
            halfEm(word, FONT_SIZE),
            `split ${JSON.stringify(word)}, which fits: ${where}`,
          ).toBeGreaterThan(maxWidth);
        }
        expect(i, `left words over: ${where}`).toBe(got.length);
      }
    }
  });

  it("never breaks at a no-break space", () => {
    // U+00A0 is in `\s`, and not breaking there is what it is for. At a 2-unit
    // box "a\u00a0b" is too wide, so it is broken between characters like any
    // other over-wide word - and the U+00A0 stays attached to the "a" instead
    // of being dropped as if it were a soft break.
    expect(wrapLines("a\u00a0b", units(2), FONT_SIZE, halfEm)).toEqual(["a\u00a0", "b"]);
    // The same box, an ordinary space: now it *is* a break, and the space goes.
    expect(wrapLines("a b", units(2), FONT_SIZE, halfEm)).toEqual(["a", "b"]);
  });
});

describe("layoutText", { timeout: HANG_TIMEOUT_MS }, () => {
  it("never changes the width, the x or the y, and never writes back", () => {
    const box = rect(12, 34, units(10), 8);
    const out = layoutText("alpha beta gamma", box, FONT_SIZE, halfEm);
    expect(out.rect.x).toBe(12);
    expect(out.rect.y).toBe(34);
    // Widening the box would move the wrap the lines were just fitted to.
    expect(out.rect.width).toBe(units(10));
    // The caller's rect is the box the *user* dragged, and the editor keeps it:
    // a box dragged tall stays tall only because the grown height never writes
    // back into it.
    expect(box).toEqual(rect(12, 34, units(10), 8));
  });

  it("grows the height to hold the lines", () => {
    // Two lines at a 10-unit box: 2 * 10px * 1.4 = 28px, from a box 8px tall.
    const out = layoutText("alpha beta gamma", rect(0, 0, units(10), 8), FONT_SIZE, halfEm);
    expect(out.lines).toEqual(["alpha beta", "gamma"]);
    expect(out.rect.height).toBeCloseTo(2 * FONT_SIZE * TEXT_LINE_HEIGHT);
    expect(out.rect.height).toBeCloseTo(28);
  });

  it("leaves a taller box alone", () => {
    // The reason a box dragged tall stays tall after a line is deleted: the
    // height is a `Math.max`, so the user's drag wins whenever it is the bigger
    // of the two.
    const out = layoutText("alpha", rect(0, 0, units(10), 500), FONT_SIZE, halfEm);
    expect(out.lines).toEqual(["alpha"]);
    expect(out.rect.height).toBe(500);
  });

  it("is one line tall for an empty label", () => {
    // A box placed and not yet typed into still has to be a box.
    const out = layoutText("", rect(0, 0, units(10), 0), FONT_SIZE, halfEm);
    expect(out.lines).toEqual([""]);
    expect(out.rect.height).toBeCloseTo(FONT_SIZE * TEXT_LINE_HEIGHT);
  });

  it("lays out at the box's own width", () => {
    // `rect.width` is `wrapLines`'s `maxWidth`, and nothing else is.
    const text = "alpha beta gamma delta";
    const out = layoutText(text, rect(7, 9, units(12), 1), FONT_SIZE, halfEm);
    expect(out.lines).toEqual(wrapLines(text, units(12), FONT_SIZE, halfEm));
  });
});

describe("createTextMeasure", () => {
  it("answers 0 where there is no document, instead of throwing", () => {
    // This suite runs with `environment: "node"` (vitest.config.ts), so there
    // is no document here at all - which is exactly the fallback the contract
    // describes, and the reason it exists: this function is called from inside
    // a keystroke handler, where a throw would eat the character.
    const measure = createTextMeasure();
    expect(measure("alpha beta", 16)).toBe(0);
    // Cached after the first attempt, and the second call must not throw either.
    expect(measure("", 16)).toBe(0);
  });

  it("turns wrapping off rather than breaking every character", () => {
    // A measure that answers 0 means everything fits, which is the same
    // degradation as a box with no usable width: hard breaks only.
    const measure = createTextMeasure();
    expect(wrapLines("alpha beta\ngamma", units(1), FONT_SIZE, measure)).toEqual([
      "alpha beta",
      "gamma",
    ]);
  });
});
