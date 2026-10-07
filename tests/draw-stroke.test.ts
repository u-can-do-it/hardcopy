import { describe, expect, it } from "vitest";

import {
  coord,
  dotPath,
  outlineToPath,
  PATH_PRECISION,
  strokePath,
  STROKE_OPTIONS,
} from "@/lib/draw/stroke";
import type { StrokePoint, Vec2 } from "@/lib/draw/model";

/**
 * Every number in a `d`, whatever command it belongs to.
 *
 * The assertions below are about *the string that ends up in the PDF* -
 * precision, closure, no exponents - and never about the coordinates
 * perfect-freehand chose. Those are its business, and pinning them here would
 * make this suite fail on a patch bump that improved the pen.
 */
function numbersIn(d: string): number[] {
  return (d.match(/-?[\d.]+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
}

/** A sample list along a path, with the flat pressure a mouse reports. */
function samples(...points: readonly [number, number][]): StrokePoint[] {
  return points.map(([x, y]) => ({ x, y, pressure: 0.5 }));
}

function vec(x: number, y: number): Vec2 {
  return { x, y };
}

describe("STROKE_OPTIONS", () => {
  it("stays inside perfect-freehand's 0..1 range for all three knobs", () => {
    // Out of range is not an error the library reports; it just draws badly.
    const { smoothing, thinning, streamline } = STROKE_OPTIONS;
    for (const value of [smoothing, thinning, streamline]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("thins the pen without making the 2px pen disappear", () => {
    // radius = size * (0.5 - thinning * (0.5 - pressure)), so the thinnest the
    // 2px pen ever gets is this. Under half a pixel prints faint enough to
    // read as a rendering fault rather than as a pen.
    const thinnest = 2 * (0.5 - STROKE_OPTIONS.thinning * 0.5);
    expect(thinnest).toBeGreaterThanOrEqual(0.5);
    // ...and it does still taper: no thinning at all is a pipe, not a pen.
    expect(STROKE_OPTIONS.thinning).toBeGreaterThan(0);
  });
});

describe("PATH_PRECISION", () => {
  it("is two decimals", () => {
    // Contracts §5 fixes the value: a hundredth of a CSS px is invisible, and
    // it is what keeps a mark from carrying thousands of 17-digit doubles into
    // the exported PDF.
    expect(PATH_PRECISION).toBe(2);
  });
});

describe("coord", () => {
  /**
   * Exported, and therefore asserted directly: `lib/draw/render.ts` and
   * `lib/draw/symbols.ts` both round with this one, so a line, a rect and a
   * symbol scaled into the same box emit the same strings. The path builders
   * below cover the same guarantee through a `d`; these two tests are about the
   * shared function itself.
   */
  it("returns plain decimals, at most PATH_PRECISION of them", () => {
    expect(coord(10)).toBe("10");
    // Rounded rather than truncated, and trailing zeros dropped.
    expect(coord(2.98765)).toBe("2.99");
    expect(coord(4.004)).toBe("4");
    expect(coord(-3.006)).toBe("-3.01");
    for (const value of [1.23456789, -0.005, 1e6 + 1 / 3]) {
      expect(coord(value)).toMatch(/^-?\d+(\.\d{1,2})?$/);
    }
  });

  it("degrades anything it cannot write that way to 0", () => {
    // The categorical part: never an exponent, never "NaN", never "Infinity" -
    // one of those in a `d` or an attribute and the browser discards the mark.
    for (const value of [Number.NaN, Infinity, -Infinity, 1e21, 5e22, Number.MAX_VALUE]) {
      expect(coord(value)).toBe("0");
    }
    // And -0, which would otherwise print with a sign.
    expect(coord(-0)).toBe("0");
  });
});

describe("outlineToPath", () => {
  it("returns an empty string for an empty outline", () => {
    // A stroke that produced no outline must not produce `d=""`-adjacent
    // garbage like "M Z"; the caller checks for "" and renders nothing.
    expect(outlineToPath([])).toBe("");
  });

  it("moves to the first point, lines to the rest and closes", () => {
    const d = outlineToPath([vec(1, 2), vec(3, 4), vec(5, 6)]);

    expect(d).toBe("M 1 2 L 3 4 L 5 6 Z");
    // The outline surrounds the stroke and the path is filled, so it must be
    // closed - an open outline fills as a wedge.
    expect(d.startsWith("M ")).toBe(true);
    expect(d.endsWith(" Z")).toBe(true);
    expect(d.match(/M/g)).toHaveLength(1);
  });

  it("rounds every coordinate to PATH_PRECISION decimals", () => {
    // No value here sits on a binary tie (-3.005 is stored just *under* the
    // half, so it would round to -3 and say nothing about the rounding).
    const d = outlineToPath([vec(1.23456789, 2.98765432), vec(-3.006, 4.004), vec(0, 10)]);

    for (const n of numbersIn(d)) {
      const decimals = (String(n).split(".")[1] ?? "").length;
      expect(decimals).toBeLessThanOrEqual(PATH_PRECISION);
    }
    // Rounded, not truncated (2.98765 -> 2.99, not 2.98), away from zero on a
    // negative, and trailing zeros dropped rather than padded (4.004 -> "4").
    expect(d).toBe("M 1.23 2.99 L -3.01 4 L 0 10 Z");
  });

  it("never emits exponent notation", () => {
    // SVG path data has no exponent grammar: one "4e-7" and the browser
    // discards the rest of the `d`, so a stroke near the document origin -
    // or one carrying a tiny float from the smoothing pass - would come out
    // truncated. Both ends of the range: tiny and merely large.
    const d = outlineToPath([vec(0.0000004, -0.00000009), vec(1234567.891, 2e7), vec(1e-21, 3)]);

    expect(d).not.toMatch(/e/i);
    expect(d).toBe("M 0 0 L 1234567.89 20000000 L 0 3 Z");
  });

  it("never emits exponent notation at the large end either", () => {
    // 2e7 above says nothing about the large end: `toFixed` is only
    // exponent-free *below* 1e21, and at or above it returns "5e+22". Past
    // ~1.8e306 a finite input does not even survive the rounding - `x * 100`
    // overflows to Infinity. Three magnitudes, one per way out: just past the
    // toFixed threshold, deep into it, and at the overflow.
    const d = outlineToPath([
      vec(1.5e21, -5e22),
      vec(1e300, -1e300),
      vec(Number.MAX_VALUE, -Number.MAX_VALUE),
    ]);

    // The guarantee, not the formatting: nothing an SVG parser cannot read.
    expect(d).not.toMatch(/e/i);
    expect(d).not.toMatch(/NaN|Infinity/);
    // Out of range degrades to the same 0 a non-finite coordinate gets, rather
    // than to a number 297 orders of magnitude off ("1e+300" -> "1e+3", which
    // is what stripping trailing zeros off an exponent used to produce).
    for (const n of numbersIn(d)) {
      expect(n).toBe(0);
    }
  });

  it("degrades at 1e21 exactly, not just past it", () => {
    // The magnitude the test above steps straight over (1.5e21, 1e300,
    // MAX_VALUE): 1e21 is the one double whose *rounded* value lands back
    // below the threshold - `Math.round(1e21 * 100) / 100` is
    // `999999999999999868928` - so a guard on the rounded value alone let
    // exactly this one through as a 21-digit integer.
    expect(outlineToPath([vec(1e21, -1e21)])).toBe("M 0 0 Z");
  });

  it("keeps a non-finite coordinate from taking the whole path with it", () => {
    const d = outlineToPath([vec(Number.NaN, 5), vec(Number.POSITIVE_INFINITY, 6)]);

    expect(d).not.toMatch(/NaN|Infinity/);
    expect(d).toBe("M 0 5 L 0 6 Z");
  });
});

describe("dotPath", () => {
  it("draws a closed circle centred on the point", () => {
    const d = dotPath(vec(100, 40), 5);

    expect(d.startsWith("M ")).toBe(true);
    expect(d.endsWith(" Z")).toBe(true);
    // Two half-arcs, so it is one filled path like every other stroke rather
    // than a second element kind for the renderer to branch on.
    expect(d.match(/A/g)).toHaveLength(2);
    // At the right place: it starts on the left edge, arcs to the right edge
    // and comes back, all on the centre's own y.
    expect(d).toBe("M 95 40 A 5 5 0 1 0 105 40 A 5 5 0 1 0 95 40 Z");
  });

  it("keeps its coordinates rounded and exponent-free too", () => {
    const d = dotPath(vec(0.0000004, 12.3456), 1.005);

    expect(d).not.toMatch(/e/i);
    for (const n of numbersIn(d)) {
      expect((String(n).split(".")[1] ?? "").length).toBeLessThanOrEqual(PATH_PRECISION);
    }
  });

  it("paints nothing for a radius that is not a positive, finite number", () => {
    // A zero-radius arc is a degenerate command renderers disagree about, so
    // it gets no path at all rather than an invisible one.
    expect(dotPath(vec(10, 10), 0)).toBe("");
    expect(dotPath(vec(10, 10), -3)).toBe("");
    expect(dotPath(vec(10, 10), Number.NaN)).toBe("");
  });

  it("paints nothing for a radius that survives the guard but not the rounding", () => {
    // 0.004 is positive and finite, so the guard lets it through - and then
    // rounds to "0" in the `d`, which is the degenerate arc the guard is for.
    // The check has to be about what is emitted.
    expect(dotPath(vec(10, 10), 0.004)).toBe("");
    // Half of 10^-PATH_PRECISION is where a circle starts existing again.
    expect(dotPath(vec(10, 10), 0.005)).not.toBe("");
    // The other way to vanish: a radius too small to separate the two anchor
    // points at the coordinate it sits on.
    expect(dotPath(vec(1e6, 10), 0.004)).toBe("");
  });
});

describe("strokePath", () => {
  it("returns nothing for no samples", () => {
    expect(strokePath([], 4)).toBe("");
  });

  it("draws a single sample as the dot at that sample", () => {
    const at = vec(120.5, 33.25);

    // The pen's nominal radius: `width` is the diameter, as perfect-freehand's
    // `size` is.
    expect(strokePath([{ ...at, pressure: 0.5 }], 8)).toBe(dotPath(at, 4));
  });

  it("draws a tap that never moved as the same dot, however many samples it left", () => {
    // A held tap can emit several identical samples, which perfect-freehand
    // treats as a zero-length *stroke*: at `size: 4` that comes back as a
    // regular 13-gon of radius 1.84 centred on the sample, where one sample
    // comes back as 44 points of radius 1.13..2.97 centred a quarter of a
    // pixel off it. Both deliveries have to look like the dot the user meant -
    // the same circle, at the radius the pen was set to.
    const at = vec(50, 60);
    const held = [
      { ...at, pressure: 0.4 },
      { ...at, pressure: 0.6 },
      { ...at, pressure: 0.5 },
    ];

    expect(strokePath(held, 4)).toBe(dotPath(at, 2));
  });

  it("returns a closed, rounded, exponent-free filled outline for a real stroke", () => {
    const d = strokePath(
      samples([10, 10], [30, 14], [55, 40], [80, 44], [110, 30]),
      4,
    );

    expect(d).not.toBe("");
    expect(d.startsWith("M ")).toBe(true);
    // Closed and filled: a stroke is an outline polygon, not a stroked line.
    expect(d.endsWith(" Z")).toBe(true);
    expect(d).not.toMatch(/e/i);
    expect(d).not.toMatch(/NaN|Infinity/);

    const numbers = numbersIn(d);
    // An outline around five samples is many points, not a handful.
    expect(numbers.length).toBeGreaterThan(20);
    for (const n of numbers) {
      expect(Number.isFinite(n)).toBe(true);
      expect((String(n).split(".")[1] ?? "").length).toBeLessThanOrEqual(PATH_PRECISION);
    }
    // Exactly one subpath: the outline is a single closed polygon.
    expect(d.match(/M/g)).toHaveLength(1);
    expect(d.match(/Z/g)).toHaveLength(1);
  });

  it("wraps the outline around the samples, not somewhere else", () => {
    // The one thing worth asserting about perfect-freehand's numbers: that
    // they surround the input. A pen of width 4 may reach a couple of px past
    // the samples, and the streamlining may fall a little short of the last
    // one, so this is a generous box rather than an exact one.
    const width = 4;
    const points = samples([100, 200], [140, 200], [180, 240]);
    const d = strokePath(points, width);

    const numbers = numbersIn(d);
    const xs = numbers.filter((_, i) => i % 2 === 0);
    const ys = numbers.filter((_, i) => i % 2 === 1);
    const slack = width * 4;

    expect(Math.min(...xs)).toBeGreaterThan(100 - slack);
    expect(Math.max(...xs)).toBeLessThan(180 + slack);
    expect(Math.min(...ys)).toBeGreaterThan(200 - slack);
    expect(Math.max(...ys)).toBeLessThan(240 + slack);
  });

  it("gets fatter with the pen, not just longer", () => {
    // Width has to reach the geometry: a stroke that ignored `size` would
    // render every pen the same and the width control would be decoration.
    const points = samples([0, 100], [50, 100], [100, 100]);
    const spread = (d: string) => {
      const ys = numbersIn(d).filter((_, i) => i % 2 === 1);
      return Math.max(...ys) - Math.min(...ys);
    };

    expect(spread(strokePath(points, 8))).toBeGreaterThan(spread(strokePath(points, 2)));
  });
});
