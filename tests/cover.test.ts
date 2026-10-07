import { describe, expect, it } from "vitest";

import { coveredRuns, coversBox, intersects } from "@/lib/dom/cover";
import type { Box, Cover, InkInset } from "@/lib/dom/cover";

/**
 * A line of monospaced characters, **7 wide and 16 tall**, starting at the
 * origin: character `i` occupies `[i * 7, i * 7 + 7]` horizontally.
 *
 * Deliberately **not square, and nowhere near it**. A 10x10 fixture makes every
 * axis-and-extent confusion invisible - swap `height` for `width` in the
 * vertical comparisons of `intersects` and a suite built on squares stays
 * entirely green, because on a square the two are the same number. Real inputs
 * are not square in either direction and not square the *same* way: a body-text
 * character is about 7 by 16, and a cover dragged over one line of it is about
 * 550 by 20 - taller than wide against shorter than wide. Cross the extents
 * there and a cover approaching from below reads a character's width where it
 * needs its height, and misses characters it is painted over. That is the same
 * silent-leak class as `<` for `<=`, so the fixtures here have `width` and
 * `height` differing throughout, and `describe("intersects")` pins each of the
 * four comparisons individually.
 *
 * 7 and 16 also keep every boundary case an assertion about an *exact* edge - a
 * cover stopping at 14 stops on the seam between character 1 and character 2 -
 * without the arithmetic being the thing under test. What the DOM half will
 * really hand `coveredRuns` is `Range.getClientRects()`, which is neither
 * monospaced nor round; that is precisely why a touch counts as a hit, and why
 * this file pins that direction so hard.
 */
const CHAR_W = 7;
const LINE_H = 16;

function line(text: string, top = 0): Box[] {
  return [...text].map((_, i) => ({ x: i * CHAR_W, y: top, width: CHAR_W, height: LINE_H }));
}

/** One character's box, at the size a line of body text measures. */
function glyph(x: number, y = 0): Box {
  return { x, y, width: CHAR_W, height: LINE_H };
}

/**
 * A rectangular cover from one x to another, tall enough to swallow the line -
 * the shape of a cover dragged over a line of text, wide and short.
 */
function band(left: number, right: number, top = -3, bottom = LINE_H + 3): Cover {
  return { kind: "rect", box: { x: left, y: top, width: right - left, height: bottom - top } };
}

describe("intersects", () => {
  it("is true when two boxes plainly overlap, either way round", () => {
    const a = glyph(0);
    const b = { x: 4, y: 8, width: 550, height: 20 };
    expect(intersects(a, b)).toBe(true);
    // Symmetric: the DOM half asks char-against-cover and nothing stops a
    // future caller asking it the other way.
    expect(intersects(b, a)).toBe(true);
  });

  it("counts a shared edge as a hit - the greedy direction, and the leak it prevents", () => {
    // THE BOUNDARY GOES *IN*. `a` ends at x = 7 and the cover starts at x = 7,
    // so they share a line and no area at all. A contained-or-centre rule would
    // call that a miss, and the character it leaves behind is the half glyph at
    // the edge of the block: invisible in the export, findable with Ctrl+F,
    // noticed after the file was sent. An extra character hidden is under an
    // opaque block and costs nothing.
    const why = "a character touching a cover's edge must be covered - .plan/design.md §19.1";
    const a = glyph(0);
    expect(intersects(a, { x: 7, y: 0, width: 550, height: 20 }), why).toBe(true); // right edge
    expect(intersects(a, { x: -550, y: 0, width: 550, height: 20 }), why).toBe(true); // left edge
    expect(intersects(a, { x: 0, y: 16, width: 550, height: 20 }), why).toBe(true); // below
    expect(intersects(a, { x: 0, y: -20, width: 550, height: 20 }), why).toBe(true); // above
  });

  it("counts a shared corner as a hit too, for the same reason", () => {
    // THE BOUNDARY GOES *IN* on both axes at once: these two meet at the single
    // point (7, 16). Diagonal contact is the same leak as edge contact, seen at
    // the corner of the cover, and half a glyph there is as readable as half a
    // glyph down the side.
    const a = glyph(0);
    expect(intersects(a, { x: 7, y: 16, width: 550, height: 20 })).toBe(true);
    expect(intersects(a, { x: -550, y: 16, width: 550, height: 20 })).toBe(true);
  });

  it("is false once there is real space between them, however little", () => {
    // THE BOUNDARY GOES *OUT* here, and this is what stops "greedy" from
    // meaning "everything": a hair of daylight is a miss. Half a pixel, because
    // the next character along in a real measurement is exactly that far away.
    const a = glyph(0);
    expect(intersects(a, { x: 7.5, y: 0, width: 550, height: 20 })).toBe(false);
    expect(intersects(a, { x: 0, y: -20.5, width: 550, height: 20 })).toBe(false);
  });

  describe("asks each axis about its own extent", () => {
    // Four pins, one per comparison, each with a box whose width and height
    // differ enough that reading the wrong one changes the answer. Without
    // these the mutation `a.y <= b.y + b.width && b.y <= a.y + a.width` - a
    // plausible copy-paste from the two lines above it - leaves the suite
    // green, and the shipped behaviour is a cover that skips characters it is
    // painted over. The comment on each says which mutation it catches.

    /** A body-text character, sitting on the second line of a paragraph. */
    const character = glyph(0, 100);

    it("covers a character whose bottom edge a cover starts at", () => {
      // Catches `b.y <= a.y + a.width`: the cover begins at y = 116, exactly
      // where the character ends, so it is a touch and a hit. Read against the
      // character's *width* it is 116 <= 7, and the character is missed - a
      // cover dragged up to a line from below hides nothing on it.
      const fromBelow = { x: 0, y: 116, width: 550, height: 20 };
      expect(intersects(character, fromBelow)).toBe(true);
    });

    it("is not reached by a cover four lines above it", () => {
      // Catches `a.y <= b.y + b.width`: the cover ends at y = 20 and the
      // character starts at y = 100, so 80px of untouched text lie between
      // them. Read against the cover's *width* it is 100 <= 550, and a cover
      // over the heading hides half the article.
      const wayAbove = { x: 0, y: 0, width: 550, height: 20 };
      expect(intersects(character, wayAbove)).toBe(false);
    });

    it("reaches a character 200px along the line it spans", () => {
      // Catches `a.x <= b.x + b.height`: the cover spans 550px of the line, so
      // it plainly reaches x = 200. Read against the cover's *height* it is
      // 200 <= 20, and a cover over a whole line hides only its first 20px.
      const wideCover = { x: 0, y: 96, width: 550, height: 20 };
      expect(intersects(glyph(200, 100), wideCover)).toBe(true);
    });

    it("is not reached by a cover three pixels to its right", () => {
      // Catches `b.x <= a.x + a.height`: the character ends at x = 7 and the
      // cover starts at x = 10. Read against the character's *height* it is
      // 10 <= 16, and every cover picks up the two or three characters sitting
      // beyond its edge - over-hiding that is no longer invisible, because
      // there is no block painted over them.
      const justRight = { x: 10, y: 96, width: 550, height: 20 };
      expect(intersects(character, justRight)).toBe(false);
    });
  });

  it("is true when one box is wholly inside the other, in both directions", () => {
    const outer = { x: 0, y: 0, width: 550, height: 200 };
    const inner = { x: 40, y: 90, width: 3, height: 5 };
    expect(intersects(inner, outer)).toBe(true);
    expect(intersects(outer, inner)).toBe(true);
    // The common case in practice: a character inside a cover that spans the
    // whole line.
    expect(intersects(glyph(0), band(-50, 500).box)).toBe(true);
  });

  it("is false when either side has no area, wherever it sits", () => {
    // THE BOUNDARY GOES *OUT*, and it is the one place the greedy rule stops.
    // Neither case is a leak: a zero-area character paints no glyph, so there is
    // nothing to show and nothing worth removing from the text layer, and a
    // zero-area cover paints no block, so hiding text under it would be the one
    // way over-hiding stops being invisible.
    const box = { x: 0, y: 0, width: 550, height: 20 };
    const insideIt = { x: 5, y: 5, width: 0, height: 0 };
    expect(intersects(insideIt, box)).toBe(false);
    expect(intersects(box, insideIt)).toBe(false);
    // A collapsed space: no width, full line height.
    expect(intersects({ x: 5, y: 0, width: 0, height: LINE_H }, box)).toBe(false);
    // A cover dragged along one axis only.
    expect(intersects(box, { x: -5, y: 0, width: 550, height: 0 })).toBe(false);
    // Both empty.
    expect(intersects(insideIt, insideIt)).toBe(false);
  });

  it("reads a negative extent as no area rather than as a box pointing backwards", () => {
    // `coverAreas` normalises every cover, so a negative extent arriving here is
    // a bug elsewhere. "No area" is the answer that does not hide a paragraph on
    // the strength of it.
    expect(intersects(glyph(0), { x: 550, y: 20, width: -550, height: -20 })).toBe(false);
  });

  it("reads a NaN extent as no area, on either side", () => {
    // Pinned because it is the behaviour, not because `!(v > 0)` and `v <= 0`
    // differ - they agree on NaN, which fails both. A measurement of something
    // detached or never laid out comes back NaN, and "no area" is the answer
    // that neither throws nor hides a paragraph. A future `v < 0` would break
    // this and the zero-area cases above together.
    const box = { x: 0, y: 0, width: 550, height: 20 };
    expect(intersects({ x: 0, y: 0, width: NaN, height: LINE_H }, box)).toBe(false);
    expect(intersects(box, { x: 0, y: 0, width: 550, height: NaN })).toBe(false);
    // A NaN *origin* has no extent to reject, and still must not be a hit.
    expect(intersects({ x: NaN, y: 0, width: CHAR_W, height: LINE_H }, box)).toBe(false);
  });
});

describe("coversBox", () => {
  /**
   * An ellipse drawn around a small block of text: 200 wide, 80 tall, so
   * `rx` = 100 and `ry` = 40 about the centre (100, 40).
   *
   * Not a circle, on purpose and for the same reason the character boxes are
   * not square: `rx` and `ry` are two different numbers, and each is divided
   * into its own axis. Swap them - or swap `cx` and `cy` - and a circle fixture
   * says nothing at all, while the shipped answer is an ellipse rotated a
   * quarter turn out of the one being painted.
   */
  const OVAL: Box = { x: 0, y: 0, width: 200, height: 80 };
  const ellipse: Cover = { kind: "ellipse", box: OVAL };
  const asRect: Cover = { kind: "rect", box: OVAL };

  it('is exactly `intersects` for a `"rect"` cover, touching edges included', () => {
    // The rect branch changes nothing about §26.1's rule; §29 only added a
    // second branch beside it.
    const cases: Box[] = [
      glyph(100, 40), // the middle
      glyph(0, 0), // the corner
      { x: 200, y: 80, width: CHAR_W, height: LINE_H }, // touching the far corner
      { x: 200.5, y: 80, width: CHAR_W, height: LINE_H }, // half a pixel clear of it
      { x: -CHAR_W, y: 32, width: CHAR_W, height: LINE_H }, // touching the left edge
    ];
    for (const box of cases) expect(coversBox(asRect, box)).toBe(intersects(OVAL, box));
    // And those cases are not all one answer, or the loop would prove nothing.
    expect(coversBox(asRect, glyph(0, 0))).toBe(true);
    expect(coversBox(asRect, { x: 200.5, y: 80, width: CHAR_W, height: LINE_H })).toBe(false);
  });

  it("covers a character in the middle of the ellipse", () => {
    expect(coversBox(ellipse, glyph(96, 32))).toBe(true);
  });

  it("leaves the corner of the bounding box alone - the hole §29 exists to close", () => {
    // THE WHOLE POINT. A bounding box is 4/π - about 27% - larger than the
    // ellipse inside it, and every bit of that difference is in the four corner
    // lobes. `render.ts` paints the ellipse, so a character tested against the
    // box is hidden from the export with **nothing painted over it**: in the PDF
    // the word is gone and the space where it was is blank. §19.1 pays for
    // over-hiding with one sentence - the extra character is under an opaque
    // block - and in the corners it is not.
    const corner = glyph(0, 0);
    expect(coversBox(ellipse, corner)).toBe(false);
    // ...and the approximation this replaces would have said yes, which is what
    // makes it a hole rather than a difference of opinion.
    expect(intersects(OVAL, corner)).toBe(true);
  });

  it("counts a character touching the ellipse itself as covered", () => {
    // THE BOUNDARY GOES *IN*, same as `intersects` and for the same reason: the
    // greedy rule of §19.1 is unchanged, and only the region it is greedy about
    // moved. This box's right edge ends at x = 0, and its rows span y = 40, so
    // it touches the ellipse at its leftmost point (0, 40) and nowhere else -
    // `d²` is exactly 1, and `<=` takes it. Under `<` this character keeps half
    // a glyph in the exported text layer.
    const why = "greedy: a touch is a hit, because a missed character is a leak";
    expect(coversBox(ellipse, glyph(-CHAR_W, 32)), why).toBe(true);
    // Half a pixel further out is a miss, so "greedy" still does not mean
    // "everything".
    expect(coversBox(ellipse, glyph(-CHAR_W - 0.5, 32))).toBe(false);
  });

  describe("divides each axis by its own semi-axis", () => {
    // Two pins for `rx`/`ry` (and, as it happens, for `cx`/`cy`): one that must
    // stay true and one that must stay false. Swapping the two on a 200x80
    // ellipse turns it a quarter turn, and each of these flips.

    it("does not reach a character above the ellipse's top edge", () => {
      // 10px clear of the box, near the middle horizontally. With `rx` and `ry`
      // crossed the ellipse becomes tall and narrow and swallows it.
      expect(coversBox(ellipse, { x: 60, y: -10, width: CHAR_W, height: 8 })).toBe(false);
    });

    it("reaches a character just inside the ellipse's left edge", () => {
      // 5px in from the box's left edge, on the centre line. With `rx` and `ry`
      // crossed the ellipse becomes tall and narrow and loses it - a cover
      // drawn round a word that hides the middle of it and leaves both ends.
      expect(coversBox(ellipse, { x: 5, y: 36, width: CHAR_W, height: 8 })).toBe(true);
    });
  });

  it("covers nothing with an ellipse of no area, and does not throw over it", () => {
    // No `rx` or `ry` to divide by, and nothing painted to hide anything under.
    const flat: Cover = { kind: "ellipse", box: { x: 0, y: 40, width: 200, height: 0 } };
    const thin: Cover = { kind: "ellipse", box: { x: 100, y: 0, width: 0, height: 80 } };
    expect(coversBox(flat, glyph(96, 32))).toBe(false);
    expect(coversBox(thin, glyph(96, 32))).toBe(false);
    // A negative extent reads as no area here too, rather than as a box
    // pointing backwards - the same answer `intersects` gives, and for the same
    // reason: it is a bug upstream, and "no area" does not hide a paragraph on
    // the strength of it.
    const backwards: Cover = { kind: "ellipse", box: { x: 200, y: 80, width: -200, height: -80 } };
    expect(coversBox(backwards, glyph(96, 32))).toBe(false);
  });

  it("is not fooled by a character box of no area", () => {
    // A collapsed space dead in the centre of the ellipse: nothing painted, so
    // nothing to hide.
    expect(coversBox(ellipse, { x: 100, y: 32, width: 0, height: LINE_H })).toBe(false);
    expect(coversBox(asRect, { x: 100, y: 32, width: 0, height: LINE_H })).toBe(false);
  });
});

describe("coveredRuns", () => {
  it("returns the one run a cover over the middle of a line covers", () => {
    // "abcdefghij", and a cover from x=17 to x=40. Character 2 spans [14, 21]
    // and character 5 spans [35, 42], so both are cut by an edge and both are
    // in - greedily. Character 6 starts at 42, past the cover, and is out.
    const boxes = line("abcdefghij");
    expect(coveredRuns(boxes, [band(17, 40)])).toEqual([[2, 6]]);
  });

  it("merges two words and the space between them into one run", () => {
    // A cover straddling "top secret" is one wrapping element, not two: the
    // space at index 3 is itself under the block, so nothing breaks the run.
    // Splitting it would put two `<span>`s where the page had one text node for
    // no gain (`.plan/design.md` §19.1).
    const boxes = line("top secret here");
    const runs = coveredRuns(boxes, [band(-2, 69)]);
    expect(runs).toEqual([[0, 10]]);
    // The space is inside the run, and " here" - which starts at x=70 - is not.
    expect("top secret here".slice(runs[0]![0], runs[0]![1])).toBe("top secret");
  });

  it("merges adjacent covers into one run, with no seam between them", () => {
    // Two covers meeting at x=35: characters 0-4 from the first, 5-9 from the
    // second, and the join must not show up as two runs. Character 4 spans
    // [28, 35] and character 5 spans [35, 42], so both touch the seam and both
    // are covered by both - the merge has to survive that too.
    const boxes = line("abcdefghij");
    expect(coveredRuns(boxes, [band(0, 35), band(35, 70)])).toEqual([[0, 10]]);
  });

  it("merges overlapping covers, counting a doubly covered character once", () => {
    const boxes = line("abcdefghij");
    expect(coveredRuns(boxes, [band(-5, 31), band(14, 50)])).toEqual([[0, 8]]);
  });

  it("returns runs ascending however the covers were drawn", () => {
    // Covers arrive in the order the user drew them, which is any order at all.
    // The DOM half splits the text node run by run, so a descending pair would
    // have it splitting at an offset it had already moved past.
    const boxes = line("abcdefghij");
    const runs = coveredRuns(boxes, [band(57, 70), band(-5, 13)]);
    expect(runs).toEqual([
      [0, 2],
      [8, 10],
    ]);
    for (const [start, end] of runs) expect(start).toBeLessThan(end);
  });

  it("keeps two separate covers on one line as two runs", () => {
    // The gap between them is uncovered text, and merging across it would hide
    // words nobody drew over - the one direction where over-hiding is no longer
    // invisible, because there is no block painted over the gap to hide it.
    const boxes = line("abcdefghij");
    expect(coveredRuns(boxes, [band(0, 13), band(36, 48)])).toEqual([
      [0, 2],
      [5, 7],
    ]);
  });

  it("yields nothing for a cover that misses every character", () => {
    const boxes = line("abcdefghij");
    expect(coveredRuns(boxes, [band(0, 70, 100, 140)])).toEqual([]); // below the line
    expect(coveredRuns(boxes, [band(200, 300)])).toEqual([]); // past the end of it
  });

  it("yields nothing when there is nothing to ask about", () => {
    expect(coveredRuns([], [band(0, 1000)])).toEqual([]);
    expect(coveredRuns(line("abc"), [])).toEqual([]);
    expect(coveredRuns([], [])).toEqual([]);
  });

  it("yields one run spanning the whole node when a cover swallows it", () => {
    const boxes = line("abcdefghij");
    expect(coveredRuns(boxes, [band(-50, 500, -50, 500)])).toEqual([[0, boxes.length]]);
  });

  it("covers a character that only touches a cover's edge", () => {
    // THE BOUNDARY GOES *IN*, and this is the same pin as in `intersects`, held
    // at the level the DOM half actually calls: the cover stops exactly at
    // x=14, where character 2 starts, and character 2 is still in the run.
    // Under a contained rule the answer would be [0, 2] and the export would
    // carry a glyph that looks covered and is not - the leak this tool exists
    // to prevent, and the kind found after the file was sent.
    const boxes = line("abcdefghij");
    const why = "greedy: a touch is a hit, because a missed character is a leak";
    expect(coveredRuns(boxes, [band(0, 14)]), why).toEqual([[0, 3]]);
  });

  it("handles a cover over a second line without touching the first", () => {
    // The boxes of one text node can span two lines after a wrap, and a cover
    // over the second one must not take the first with it - the test is asked
    // about both axes, not only x, and about each axis' own extent.
    const first = line("abcde");
    const second = line("fghij", 20);
    expect(coveredRuns([...first, ...second], [band(-50, 500, 18, 40)])).toEqual([[5, 10]]);
  });

  describe("an ellipse cover hides the ellipse, not the box around it", () => {
    /**
     * A cover drawn round a 20-character line: 140 wide (exactly the line) and
     * 80 tall, with the line sitting near the top of it at y = 4.
     *
     * Off the ellipse's centre line on purpose. On the centre line every
     * character within the box is inside the ellipse too and the two shapes
     * agree, which is the one arrangement that would prove nothing.
     */
    const box: Box = { x: 0, y: 0, width: 140, height: 80 };
    const boxes = line("abcdefghijklmnopqrst", 4);

    it("leaves the character at each end, which the ellipse does not reach", () => {
      // Characters 0 and 19 sit in the top corners of the bounding box, outside
      // the ellipse - and outside the paint. Hiding them would take two words
      // out of the PDF with nothing drawn where they were.
      expect(coveredRuns(boxes, [{ kind: "ellipse", box }])).toEqual([[1, 19]]);
    });

    it("and the same box as a rect takes the whole line, as it should", () => {
      // Same geometry, same characters, one field different. A rect really does
      // paint its corners, so hiding them is the invisible over-hide §19.1
      // argues for - which is exactly why the kind has to travel with the box.
      expect(coveredRuns(boxes, [{ kind: "rect", box }])).toEqual([[0, 20]]);
    });
  });

  describe("a character box of no area", () => {
    /** A soft hyphen or a collapsed space: zero wide, full line height. */
    function empty(x: number): Box {
      return { x, y: 0, width: 0, height: LINE_H };
    }

    it("yields nothing on its own, however big the cover", () => {
      expect(coveredRuns([empty(21)], [band(-50, 500)])).toEqual([]);
      expect(coveredRuns([empty(0), empty(7), empty(14)], [band(-50, 500)])).toEqual([]);
    });

    it("does not split the word it sits in the middle of", () => {
      // THE FIX §29's review asked for, and it is not a tidiness point. Letting
      // an empty box close the run would put an element boundary **inside a
      // covered word** - and an inline boundary is where Chrome restarts
      // shaping, so kerning and ligatures stop crossing it. §17.1's whole
      // promise is that this mechanism reflows nothing. The boundary also buys
      // nothing: the characters either side of a soft hyphen are both covered,
      // so there is no second region to describe, and the extra run would be
      // counted into `CoverHandle.runs`, which the user is shown.
      const boxes = line("mid-word");
      boxes[3] = empty(21);
      expect(coveredRuns(boxes, [band(-50, 500)])).toEqual([[0, 8]]);
    });

    it("neither opens a run nor closes one, so it is not wrapped at an edge", () => {
      // The other half of "neither opens nor closes": characters 0-2 are under
      // the cover, character 3 measures zero, and character 4 is clear of it.
      // The run ends at the last *covered* character, so the soft hyphen past
      // the edge is left out of the wrapping element rather than swept into it.
      const boxes = line("abcdefghij");
      boxes[3] = empty(21);
      expect(coveredRuns(boxes, [band(-2, 20)])).toEqual([[0, 3]]);
    });

    it("does not open one at the start either", () => {
      const boxes = line("abcdefghij");
      boxes[0] = empty(0);
      expect(coveredRuns(boxes, [band(-2, 20)])).toEqual([[1, 3]]);
    });
  });

  it("covers nothing with a zero-area cover, and does not throw over it", () => {
    // A rect nobody dragged. `isDegenerate` should have discarded it long before
    // here; if one arrives anyway it hides nothing, because hiding text under a
    // mark of no size is the one way over-hiding stops being invisible.
    const boxes = line("abcdefghij");
    const flat: Cover = { kind: "rect", box: { x: 0, y: 0, width: 70, height: 0 } };
    expect(coveredRuns(boxes, [band(35, 35)])).toEqual([]);
    expect(coveredRuns(boxes, [flat])).toEqual([]);
    // And a real cover beside a degenerate one still does its job.
    expect(coveredRuns(boxes, [band(35, 35), band(-5, 13)])).toEqual([[0, 2]]);
  });
});

/**
 * The reported page's vertical geometry, as `.plan/contracts.md` §31.1 measured
 * it on the article that produced the user's report: 18px Roboto in a 724px
 * column at `line-height: 26px`, one 224-character text node, three lines.
 *
 * - a character's `Range` box is the **font box** - ascent 17 plus descent 4,
 *   so `FONT_H` is 21 - while the lines are `LINE_PITCH` 26 apart. Consecutive
 *   character boxes therefore have a **5px gap of empty leading** between them,
 *   and that gap is what the sweeps below walk.
 * - the ink inside that box is smaller again: `actualBoundingBoxAscent` 13.5
 *   leaves 3.5px of empty space at the top, and `actualBoundingBoxDescent` 0.18
 *   for glyphs with no descender leaves 3.82px at the bottom. `INK` is that
 *   pair. `INK_DESCENDERS` is the same face measured over text that *does*
 *   descend - descent 3.84, so only 0.16px of the bottom is empty - which is
 *   the inset a *line* holding a `p` or a `y` measures, and the worse case for
 *   this fix.
 *
 * Copied from §31.1 rather than re-derived: they were measured in a real
 * Chromium on the page that produced the report, and `CLAUDE.md` asks that such
 * numbers be trusted over a recollection. Nothing in this repo can check them
 * from the other end - `tests/draw-model.test.ts` sweeps the same fixture, but
 * the shares it reproduces are a function of `DRAW_WIDTHS` and the sweep's own
 * step rather than of these proportions, and would come out the same for any
 * two-line fixture with a gap this wide. §31.1 is the source and the only one.
 */
const FONT_H = 21;
const LINE_PITCH = 26;
const INK: InkInset = { top: 3.5, bottom: 3.82 };
const INK_DESCENDERS: InkInset = { top: 3.5, bottom: 0.16 };
/** A measurement that found nothing empty: the font box is the ink. */
const ZERO: InkInset = { top: 0, bottom: 0 };

/**
 * One inset repeated across `count` characters: a node measured **whole**.
 *
 * What §31.4 rejects as the walker's measurement, and still the right fixture
 * for a node whose lines all have the same deepest glyph - `nodeWide(INK)` is a
 * two-line paragraph with no descender on either line, which is a real
 * paragraph and the one the y-axis cases below are about.
 */
function nodeWide(inset: InkInset, count = 10): InkInset[] {
  return new Array<InkInset>(count).fill(inset);
}

/**
 * Line 1's inset then line 2's, five characters each: what the walker measures
 * now (`.plan/contracts.md` §31.4).
 *
 * `perLine(INK, INK_DESCENDERS)` is the paragraph the report was drawn on - a
 * line with no descender above a line with one - and the pair that tells the two
 * measurements apart. Node-wide, line 2's `y` drags line 1's bottom inset from
 * 3.82px down to 0.16px; per line, line 1 keeps its own.
 */
function perLine(first: InkInset, second: InkInset): InkInset[] {
  return [...nodeWide(first, 5), ...nodeWide(second, 5)];
}

/** Five characters of body text on the line whose font box starts at `top`. */
function inkLine(top: number): Box[] {
  return [0, 1, 2, 3, 4].map((i) => ({ x: i * CHAR_W, y: top, width: CHAR_W, height: FONT_H }));
}

/**
 * One text node wrapped into two lines: characters 0-4 on the first, 5-9 on the
 * second. One node, because that is what makes the bug a *paragraph* - the two
 * lines are adjacent indices, so a cover that takes both is one merged run and
 * one wrapping `<span>` over every word of it.
 */
function twoLines(): Box[] {
  return [...inkLine(0), ...inkLine(LINE_PITCH)];
}

/** A cover dropped from `top`: wide enough for the line, deep enough to swallow line 2. */
function dropped(top: number): Cover {
  return { kind: "rect", box: { x: -50, y: top, width: 600, height: 40 } };
}

describe("coveredRuns against a character's ink rather than its font box", () => {
  /** The bottom of line 1's font box, and the top of line 2's: the leading between them. */
  const GAP_TOP = FONT_H;
  const GAP_BOTTOM = LINE_PITCH;
  /** §31.1's own sweep resolution. */
  const STEP = 0.25;

  /** Every position in the 5px gap, at that resolution. Twenty-one of them. */
  function gap(): number[] {
    const tops: number[] = [];
    for (let top = GAP_TOP; top <= GAP_BOTTOM; top += STEP) tops.push(top);
    return tops;
  }

  it("leaves the line above alone wherever in the leading the edge lands", () => {
    // THE USER'S BUG, swept rather than sampled. The existing suite has one test
    // of a cover over a second line, and it picks a top in the *safe* half of
    // the gap - so it passed throughout. Every position in the gap is empty
    // leading: line 1's ink ends 3.82px above the gap and line 2's begins 3.5px
    // below it, so an edge anywhere in between paints over neither, and taking
    // line 1 deletes from the PDF a line nothing was drawn on.
    const boxes = twoLines();
    for (const top of gap()) {
      const why = `a cover top at ${top} is in the leading, painting over neither line`;
      expect(coveredRuns(boxes, [dropped(top)], nodeWide(INK)), why).toEqual([[5, 10]]);
    }
    expect(gap()).toHaveLength(21);
  });

  it("leaves it alone across the gap for a line whose glyphs descend too", () => {
    // The same sweep at the smaller inset, which is what the walker measures for
    // a line that really does hold a `p` or a `y`: 0.16px of empty descent rather
    // than 3.82px. That is an honest measurement of *that* line and the win is
    // genuinely thinner on it - `tests/draw-model.test.ts` puts a number on how
    // much thinner once the pen's half-stroke is in the picture - but on the
    // drawn edge alone the whole gap is still clear.
    //
    // What is *not* honest is charging line 1 for line 2's descender, which is
    // what one inset per node does and what the next test is about.
    const boxes = twoLines();
    for (const top of gap()) {
      expect(coveredRuns(boxes, [dropped(top)], nodeWide(INK_DESCENDERS)), `top ${top}`).toEqual([
        [5, 10],
      ]);
    }
  });

  /**
   * The lowest a cover's painted top edge can sit and still take line 1, swept
   * at a hundredth of a pixel.
   *
   * Found rather than asserted, deliberately: the number this returns is the
   * rule's own answer to "where does line 1 stop being ink", not a restatement
   * of the arithmetic inside `inkBox`. `dropped` adds no stroke, so its `y` *is*
   * the painted edge.
   */
  function lastTopTakingLineOne(insets: readonly InkInset[]): number {
    const boxes = twoLines();
    let last = Number.NEGATIVE_INFINITY;
    for (let k = 0; k <= LINE_PITCH * 100; k += 1) {
      const top = k / 100;
      if (coveredRuns(boxes, [dropped(top)], insets).some(([start]) => start < 5)) last = top;
    }
    return last;
  }

  it("gives a line with no descenders its own inset back, not its neighbour's", () => {
    // §31.4, and the whole reason the measurement moved from the node to the
    // line. `actualBoundingBoxDescent` over a node is the union over every glyph
    // in it, so one `p` on line 2 collapses line 1's bottom inset from 3.82px to
    // 0.16px and line 1 is treated as inked to within a sixth of a pixel of a
    // font box it stops 3.82px short of.
    //
    // The margin is the claim. Measured node-wide, a cover painted exactly on
    // the bottom of line 1's font box - which is where §31.1's reported block
    // landed - clears line 1's supposed ink by 0.16px, one step of §31.1's own
    // 0.25px sweep. Measured per line it clears by 3.82px.
    const nodeWideClearance = FONT_H - lastTopTakingLineOne(nodeWide(INK_DESCENDERS));
    const perLineClearance = FONT_H - lastTopTakingLineOne(perLine(INK, INK_DESCENDERS));
    expect(nodeWideClearance).toBeCloseTo(0.16, 1);
    expect(perLineClearance).toBeCloseTo(3.82, 1);
    expect(perLineClearance).toBeGreaterThan(nodeWideClearance + 3);

    // And what that margin is worth, one position at a time: everywhere between
    // line 1's real last ink and the boundary a node-wide measurement invents,
    // the two answers differ and only one of them hides a line with nothing
    // painted over it. `tests/draw-model.test.ts` walks the same window with the
    // pen's half-stroke in the picture, where §31.4 puts it at 2px wide.
    const boxes = twoLines();
    const mixed = perLine(INK, INK_DESCENDERS);
    // 17.25 is the first sweep position past line 1's real ink at 17.18; 20.75
    // is the last one above the boundary a node-wide measurement puts at 20.84.
    for (let top = 17.25; top <= 20.75; top += STEP) {
      const why = `a cover painted from ${top} is below line 1's ink and above line 2's`;
      expect(coveredRuns(boxes, [dropped(top)], nodeWide(INK_DESCENDERS)), why).toEqual([[0, 10]]);
      expect(coveredRuns(boxes, [dropped(top)], mixed), why).toEqual([[5, 10]]);
    }
  });

  it("leaves characters past the end of a short insets array uninset", () => {
    // The contract's default, arriving per character: a caller that measured
    // part of a node gets the old, greedier box for the rest rather than an
    // index error or a band nobody measured.
    const boxes = twoLines();
    // A block ending at 28 - past the top of line 2's font box at 26, short of
    // its ink at 29.5 - so line 2's answer is the one the inset decides.
    const above: Cover = { kind: "rect", box: { x: -50, y: 0, width: 600, height: 28 } };
    expect(coveredRuns(boxes, [above], nodeWide(INK))).toEqual([[0, 5]]);
    expect(coveredRuns(boxes, [above], nodeWide(INK, 5))).toEqual([[0, 10]]);
    expect(coveredRuns(boxes, [above])).toEqual([[0, 10]]);
  });

  it("took the line above at the low end of that gap without an inset - the reported bug", () => {
    // Not a wish: this is the shipped rule, and it stays the answer where there
    // is no measurement to hand. A cover whose top edge sits exactly on the
    // bottom of line 1's font box grazes all five of its characters through
    // `intersects`' `<=`, and `coveredRuns` merges them with line 2 into a
    // single run - one `<span>`, the whole paragraph hidden, including a line
    // that was never painted over.
    expect(coveredRuns(twoLines(), [dropped(GAP_TOP)])).toEqual([[0, 10]]);
    // One quarter-pixel lower and even the un-inset rule is right, which is why
    // the sweep above is the test and a single position would not have been.
    expect(coveredRuns(twoLines(), [dropped(GAP_TOP + STEP)])).toEqual([[5, 10]]);
  });

  it("still takes the whole line a cover really is painted over", () => {
    // The other direction, and the one the greedy rule exists for: an inset that
    // bought quiet by hiding less than the block paints over would be a leak.
    const boxes = twoLines();
    // Inside line 1's ink (3.5 to 17.18) and nowhere near line 2.
    const onOne: Cover = { kind: "rect", box: { x: -50, y: 10, width: 600, height: 5 } };
    expect(coveredRuns(boxes, [onOne], nodeWide(INK))).toEqual([[0, 5]]);
    // Inside line 2's ink (29.5 to 43.18), and line 1 keeps its words.
    const onTwo: Cover = { kind: "rect", box: { x: -50, y: 30, width: 600, height: 10 } };
    expect(coveredRuns(boxes, [onTwo], nodeWide(INK))).toEqual([[5, 10]]);
    // A block over both is one run over both, as it was.
    expect(coveredRuns(boxes, [dropped(10)], nodeWide(INK))).toEqual([[0, 10]]);
  });

  it("takes a line the edge grazes by a hair of ink, not by a hair of leading", () => {
    // The boundary itself, from both sides, a hundredth of a pixel apart: the
    // rule did not stop being greedy, it stopped being greedy about empty space.
    const boxes = twoLines();
    const inkBottom = FONT_H - INK.bottom; // 17.18
    expect(coveredRuns(boxes, [dropped(inkBottom - 0.01)], nodeWide(INK))).toEqual([[0, 10]]);
    expect(coveredRuns(boxes, [dropped(inkBottom + 0.01)], nodeWide(INK))).toEqual([[5, 10]]);
    // And exactly on it is a hit, because a touch is a hit everywhere else here.
    expect(coveredRuns(boxes, [dropped(inkBottom)], nodeWide(INK))).toEqual([[0, 10]]);
  });

  describe("the x axis is not softened with it", () => {
    // §19.1's argument is right about x: a character clipped at its left or
    // right edge is covered, because half a glyph of a password at the edge of
    // the block is the leak the whole feature exists to close. The inset shrinks
    // one axis, and only the axis whose box holds space no glyph paints in.
    const boxes = inkLine(0);
    /** A cover over line 1's ink, cut off at `left` and `right`. */
    const cut = (left: number, right: number): Cover => ({
      kind: "rect",
      box: { x: left, y: 8, width: right - left, height: 6 },
    });

    it("covers a character the cover's right edge stops exactly at", () => {
      // Character 2 spans [14, 21] and the cover stops at 14. Still in.
      expect(coveredRuns(boxes, [cut(0, 14)], nodeWide(INK, 5))).toEqual([[0, 3]]);
    });

    it("covers a character the cover's left edge starts exactly at", () => {
      // Character 1 ends at 14, where the cover begins. Still in.
      expect(coveredRuns(boxes, [cut(14, 40)], nodeWide(INK, 5))).toEqual([[1, 5]]);
    });

    it("covers a character cut through the middle of its glyph", () => {
      expect(coveredRuns(boxes, [cut(3, 17)], nodeWide(INK, 5))).toEqual([[0, 3]]);
    });

    it("answers x exactly as it does with no inset at all", () => {
      for (const cover of [cut(0, 14), cut(14, 40), cut(3, 17), cut(-50, 500)]) {
        // Same covers, over the middle of the ink where the y axis cannot be
        // what decides: the two rules must agree character for character.
        expect(coveredRuns(boxes, [cover], nodeWide(INK, 5))).toEqual(coveredRuns(boxes, [cover]));
      }
    });
  });

  it("behaves exactly as before when no inset is given", () => {
    // The contract's stated default, and the honest one: a caller that cannot
    // measure gets the old, greedier box rather than a band this module made up.
    const boxes = twoLines();
    const arrangements: Cover[][] = [
      [dropped(GAP_TOP)],
      [dropped(GAP_TOP + 2)],
      [dropped(10)],
      [{ kind: "ellipse", box: { x: 0, y: 0, width: 35, height: FONT_H } }],
      [dropped(GAP_TOP), { kind: "rect", box: { x: 0, y: 100, width: 10, height: 10 } }],
      [],
    ];
    for (const covers of arrangements) {
      expect(coveredRuns(boxes, covers)).toEqual(coveredRuns(boxes, covers, nodeWide(ZERO)));
    }
  });

  it("leaves a character box of no area out of it, inset or not", () => {
    // The inset shrinks a box that is tested; it must not promote one that is
    // skipped. A zero-width box still neither opens a run nor closes one.
    const boxes = inkLine(0);
    boxes[2] = { x: 14, y: 0, width: 0, height: FONT_H };
    expect(coveredRuns(boxes, [dropped(10)], nodeWide(INK, 5))).toEqual([[0, 5]]);
    expect(coveredRuns([boxes[2]!], [dropped(10)], [INK])).toEqual([]);
  });

  describe("an inset taller than the box it is asked about", () => {
    // The measurement is wrong when this happens - a page scaled down by a CSS
    // transform is one way - and the two possible answers are not symmetric. A
    // box left with no height is invisible to `intersects`, so the character
    // would be hidden by nothing at all: the under-hiding direction, and a leak.
    // A 1px band keeps it in the argument. Erring towards hiding is the safe
    // error, which is the whole of §19.1.
    const boxes = [{ x: 0, y: 0, width: CHAR_W, height: FONT_H }];
    const tall: InkInset = { top: 20, bottom: 20 };
    /** A cover from `top` to `bottom`, over the character's x. */
    const slab = (top: number, bottom: number): Cover => ({
      kind: "rect",
      box: { x: -1, y: top, width: 10, height: bottom - top },
    });

    it("keeps a 1px band at the ink centre rather than collapsing to nothing", () => {
      // The centre of the two inset edges: y + (height + top - bottom) / 2, so
      // 10.5 here, and the band is [10, 11].
      expect(coveredRuns(boxes, [slab(10, 11)], [tall])).toEqual([[0, 1]]);
      // Touching its top edge is a hit, as it is everywhere else in this file.
      expect(coveredRuns(boxes, [slab(5, 10)], [tall])).toEqual([[0, 1]]);
    });

    it("keeps it to 1px, rather than quietly giving the box back", () => {
      // A tenth of a pixel clear of the band and the answer is no. The fallback
      // is a band, not a licence to ignore the measurement.
      expect(coveredRuns(boxes, [slab(5, 9.9)], [tall])).toEqual([]);
      expect(coveredRuns(boxes, [slab(11.1, 20)], [tall])).toEqual([]);
    });

    it("keeps the band inside the character's own box, however wrong the inset", () => {
      // A lopsided inset puts that centre past the bottom of the box, and a band
      // outside the glyph is the under-hiding this clause exists to prevent: a
      // cover over the glyph would find nothing there to hide.
      const absurd: InkInset = { top: 30, bottom: 0 };
      expect(coveredRuns(boxes, [slab(0, FONT_H)], [absurd])).toEqual([[0, 1]]);
      const lopsided: InkInset = { top: 0, bottom: 30 };
      expect(coveredRuns(boxes, [slab(0, FONT_H)], [lopsided])).toEqual([[0, 1]]);
    });
  });

  describe("an inset with a negative component", () => {
    // An inset may only ever *shrink* a box. A negative component is finite and
    // arithmetically sensible - `actualBoundingBoxAscent` exceeding
    // `fontBoundingBoxAscent` is ink overshooting its font box, which accents and
    // some emoji really do - and left alone it grows the box instead: `{top: -2}`
    // returns a box starting 2px above the character's own, so a cover grazing
    // the leading above the line hides a line it paints nothing over. That is
    // §31.1's bug arriving through the door marked "fix", which is why the clamp
    // is here and not only in the walker: `coveredRuns` is the exported surface,
    // and this suite is what speaks to it (`.plan/contracts.md` §31.4).
    const boxes = [{ x: 0, y: 10, width: CHAR_W, height: FONT_H }]; // the box is [10, 31]
    const slab = (top: number, bottom: number): Cover => ({
      kind: "rect",
      box: { x: -1, y: top, width: 10, height: bottom - top },
    });

    it("does not reach up past the top of the character's own box", () => {
      // The cover stops at 9, a pixel clear of the character. Grown upward by
      // `{top: -2}` the box would start at 8 and be a hit.
      const why = "a negative inset must not widen the box it is asked to shrink";
      expect(coveredRuns(boxes, [slab(7, 9)], [{ top: -2, bottom: 0 }]), why).toEqual([]);
      expect(coveredRuns(boxes, [slab(7, 9)], [ZERO])).toEqual([]);
      expect(coveredRuns(boxes, [slab(7, 9)])).toEqual([]);
    });

    it("does not reach down past the bottom of it either", () => {
      // The same from below: the cover starts at 32, a pixel under the box.
      expect(coveredRuns(boxes, [slab(32, 40)], [{ top: 0, bottom: -2 }])).toEqual([]);
      expect(coveredRuns(boxes, [slab(32, 40)], [ZERO])).toEqual([]);
    });

    it("still insets the component that is a measurement", () => {
      // Clamped, not discarded: a nonsense ascent does not buy the descent's
      // 3.82px back. The ink runs [10, 27.18], so a cover from 27.17 is a hit
      // and one from 27.19 is not - exactly as it would be with `{top: 0}`.
      const half: InkInset = { top: -2, bottom: INK.bottom };
      expect(coveredRuns(boxes, [slab(27.17, 40)], [half])).toEqual([[0, 1]]);
      expect(coveredRuns(boxes, [slab(27.19, 40)], [half])).toEqual([]);
      expect(coveredRuns(boxes, [slab(27.19, 40)], [{ top: 0, bottom: INK.bottom }])).toEqual([]);
    });
  });

  it("reads an inset that is not a number as no inset, not as a band of NaN", () => {
    // `fontBoundingBoxAscent` missing from a `TextMetrics` is `undefined`, and
    // `undefined - 13.5` is `NaN`. Every comparison against a `NaN` band is
    // false, so the band would hide nothing anywhere - a walker that merely
    // failed to measure would have turned the whole cover off. The old box is
    // the greedier answer and the safe one.
    const boxes = twoLines();
    for (const nonsense of [
      { top: Number.NaN, bottom: 0 },
      { top: 3.5, bottom: Number.NaN },
      { top: Number.POSITIVE_INFINITY, bottom: 0 },
    ]) {
      const why = `inset ${JSON.stringify(nonsense)} is not a measurement`;
      expect(coveredRuns(boxes, [dropped(GAP_TOP)], nodeWide(nonsense)), why).toEqual([[0, 10]]);
      expect(coveredRuns(boxes, [dropped(10)], nodeWide(nonsense)), why).toEqual([[0, 10]]);
    }
  });
});
