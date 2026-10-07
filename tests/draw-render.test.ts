import { describe, expect, it } from "vitest";

import { LABEL_FONT_FAMILY } from "@/lib/draw/css";
import { FILL_OPACITY, HIGHLIGHT_WIDTH_SCALE } from "@/lib/draw/model";
import { HIGHLIGHT_OPACITY, shapeToSpec, SVG_NS } from "@/lib/draw/render";
import { strokePath } from "@/lib/draw/stroke";
import { symbolSpec } from "@/lib/draw/symbols";
import { TEXT_LINE_HEIGHT } from "@/lib/draw/wrap";
import type {
  DrawRect,
  EllipseShape,
  LineShape,
  RectShape,
  Shape,
  StrokePoint,
  StrokeShape,
  SymbolShape,
  TextShape,
  Vec2,
} from "@/lib/draw/model";
import type { NodeSpec } from "@/lib/draw/render";
import type { FillMode } from "@/lib/types";

/**
 * Everything here asserts on the returned **spec**. That is the whole point of
 * the split in `lib/draw/render.ts`: the rendering decisions - which tag, which
 * attribute carries the colour, whether a mark is filled or stroked - are
 * settled without a document, so `tests/` stays plain vitest with no DOM
 * harness (`CLAUDE.md`). `specToElement` is three DOM calls over this data and
 * is covered by `pnpm compile` plus the §9 manual matrix.
 */

const COLOR = "#dc2626";

/** A sample list along a path, with the flat pressure a mouse reports. */
function samples(...points: readonly [number, number][]): StrokePoint[] {
  return points.map(([x, y]) => ({ x, y, pressure: 0.5 }));
}

function vec(x: number, y: number): Vec2 {
  return { x, y };
}

function rect(x: number, y: number, width: number, height: number): DrawRect {
  return { x, y, width, height };
}

function stroke(over: Partial<StrokeShape> = {}): StrokeShape {
  return {
    kind: "stroke",
    id: "pagepdf-mark-1",
    color: COLOR,
    width: 4,
    highlight: false,
    points: samples([10, 10], [30, 14], [55, 40], [80, 44]),
    ...over,
  };
}

function line(over: Partial<LineShape> = {}): LineShape {
  return {
    kind: "line",
    id: "pagepdf-mark-2",
    color: COLOR,
    width: 4,
    from: vec(10.126, 20),
    to: vec(30, 40.004),
    ...over,
  };
}

function box(over: Partial<RectShape> = {}): RectShape {
  return {
    kind: "rect",
    id: "pagepdf-mark-3",
    color: COLOR,
    width: 8,
    rect: rect(12.5, 30, 100, 40.5),
    // The outline, which is what the plain `rect` button still draws. The two
    // filled modes are passed explicitly by the cases below and say so.
    fill: "none",
    ...over,
  };
}

function ellipse(over: Partial<EllipseShape> = {}): EllipseShape {
  return {
    kind: "ellipse",
    id: "pagepdf-mark-4",
    color: COLOR,
    width: 2,
    rect: rect(10, 20, 40, 60),
    fill: "none",
    ...over,
  };
}

function symbol(over: Partial<SymbolShape> = {}): SymbolShape {
  return {
    kind: "symbol",
    id: "pagepdf-mark-5",
    color: COLOR,
    width: 4,
    symbol: "arrow",
    rect: rect(0, 0, 32, 32),
    ...over,
  };
}

/** Distinctive, so "it is not in an attribute" is a real assertion. */
const LABEL = "Ctrl+F finds this";

function text(over: Partial<TextShape> = {}): TextShape {
  const shape: TextShape = {
    kind: "text",
    id: "pagepdf-mark-6",
    color: COLOR,
    width: 4,
    // The label's box, and `x`/`y` is its top-left - what `at` used to be, and
    // what the `x`/`y` attributes below are still read from. 25.2 is one line
    // at 18px (`TEXT_LINE_HEIGHT`), which is what a click makes.
    rect: { x: 10, y: 24.5, width: 240, height: 25.2 },
    text: LABEL,
    lines: [LABEL],
    fontSize: 18,
    ...over,
  };
  // `lines` is a layout cache of `text` and `layoutText` is its only real
  // producer (contracts §19.1), so a case that overrides one and not the other
  // would be a shape no session could hand the renderer - and now that the
  // renderer *reads* `lines`, such a case would also be testing a label the
  // fixture never says out loud. Splitting on `\n` is what `wrapLines` does
  // first and is exact for every label here, because none of them is long
  // enough to soft-wrap in a 240px box. A case that wants a soft wrap - lines
  // that `text` alone cannot predict - passes both, and says so.
  return over.text !== undefined && over.lines === undefined
    ? { ...shape, lines: shape.text.split("\n") }
    : shape;
}

/** The tspans of a label spec, which is where every line of it lives. */
function tspans(spec: NodeSpec): NodeSpec[] {
  return spec.children ?? [];
}

describe("SVG_NS", () => {
  it("is the SVG namespace, exactly", () => {
    // `createElementNS` with anything else produces an element that lays out
    // and paints as nothing, silently. Pinned as a literal on both sides.
    expect(SVG_NS).toBe("http://www.w3.org/2000/svg");
  });
});

describe("shapeToSpec - stroke", () => {
  it("is a filled outline, not a stroked line", () => {
    const spec = shapeToSpec(stroke());

    expect(spec.tag).toBe("path");
    // The two halves of the same decision: perfect-freehand returns a closed
    // outline polygon whose width already varies, so the colour goes on `fill`
    // and `stroke` is off. Get this backwards and the pen becomes a fat pipe
    // around a filled blob.
    expect(spec.attrs.fill).toBe(COLOR);
    expect(spec.attrs.stroke).toBe("none");
    // ...and there is therefore no `stroke-width` to set: the width is in the
    // geometry, which is why the pen tapers.
    expect(spec.attrs["stroke-width"]).toBeUndefined();
  });

  it("carries the outline perfect-freehand drew for the selected pen", () => {
    const shape = stroke({ width: 4 });
    const spec = shapeToSpec(shape);

    expect(spec.attrs.d).toBe(strokePath(shape.points, 4));
    // A closed subpath, because it is filled.
    expect(spec.attrs.d.startsWith("M ")).toBe(true);
    expect(spec.attrs.d.endsWith(" Z")).toBe(true);
  });

  it("leaves a sampleless stroke as a path that paints nothing", () => {
    // Reachable only if `isDegenerate` is bypassed; an empty `d` is inert,
    // where a missing `d` attribute would be a hole in the spec's contract.
    const spec = shapeToSpec(stroke({ points: [] }));

    expect(spec.tag).toBe("path");
    expect(spec.attrs.d).toBe("");
  });

  it("gives a plain pencil no blend mode and no opacity", () => {
    const spec = shapeToSpec(stroke({ highlight: false }));

    expect(spec.attrs.style).toBeUndefined();
    expect(spec.attrs.opacity).toBeUndefined();
    // Exactly the four attributes the contract table requires, and nothing
    // else that could quietly wash the pencil out.
    expect(Object.keys(spec.attrs).sort()).toEqual(["d", "fill", "id", "stroke"]);
  });

  it("makes the highlighter the pencil plus mix-blend-mode: multiply", () => {
    const spec = shapeToSpec(stroke({ highlight: true }));

    // Pinned verbatim: multiply is what lets a band of colour sit *over* a
    // page of text instead of covering it, and it is the only reason the
    // highlighter is a separate tool rather than a fat pencil.
    expect(spec.attrs.style).toBe("mix-blend-mode:multiply");
    expect(spec.attrs.style).toContain("mix-blend-mode");
    expect(spec.attrs.style).toContain("multiply");
    // Same tag, same fill/stroke split as the pencil.
    expect(spec.tag).toBe("path");
    expect(spec.attrs.fill).toBe(COLOR);
    expect(spec.attrs.stroke).toBe("none");
    expect(Object.keys(spec.attrs).sort()).toEqual([
      "d",
      "fill",
      "id",
      "opacity",
      "stroke",
      "style",
    ]);
  });

  it("gives the highlighter an alpha you can read through", () => {
    const spec = shapeToSpec(stroke({ highlight: true }));

    // The value, pinned: at 1 a near-black highlighter is an opaque bar over a
    // line of text whose words stay selectable in the PDF, which is the one
    // thing .plan/design.md §8 refuses to ship.
    expect(HIGHLIGHT_OPACITY).toBe(0.4);
    expect(HIGHLIGHT_OPACITY).toBeGreaterThan(0);
    expect(HIGHLIGHT_OPACITY).toBeLessThan(1);
    expect(spec.attrs.opacity).toBe("0.4");
    expect(Number(spec.attrs.opacity)).toBe(HIGHLIGHT_OPACITY);
  });

  it("draws the highlighter at HIGHLIGHT_WIDTH_SCALE times the pen", () => {
    const points = samples([10, 100], [60, 100], [110, 100]);
    const pencil = shapeToSpec(stroke({ points, width: 4, highlight: false }));
    const marker = shapeToSpec(stroke({ points, width: 4, highlight: true }));

    // The same expression as the private `inkWidth` in lib/draw/model.ts, which
    // is what `isDegenerate` measures a highlighter tap against. If the two
    // drift apart, a tap is kept and drawn at the wrong size, or dropped while
    // it would have painted.
    expect(marker.attrs.d).toBe(strokePath(points, 4 * HIGHLIGHT_WIDTH_SCALE));
    expect(pencil.attrs.d).toBe(strokePath(points, 4));
    // ...and the scale is a real multiplier, so the line above is not two
    // spellings of the same width.
    expect(HIGHLIGHT_WIDTH_SCALE).toBeGreaterThan(1);
    expect(marker.attrs.d).not.toBe(pencil.attrs.d);

    // Fatter, not merely different: the band has to cover a line of text.
    const spread = (d: string) => {
      const ys = (d.match(/-?[\d.]+/g) ?? []).map(Number).filter((_, i) => i % 2 === 1);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(spread(marker.attrs.d)).toBeGreaterThan(spread(pencil.attrs.d));
  });
});

describe("shapeToSpec - line", () => {
  it("is an open two-point path with round caps", () => {
    const spec = shapeToSpec(line());

    expect(spec).toEqual({
      tag: "path",
      attrs: {
        id: "pagepdf-mark-2",
        d: "M 10.13 20 L 30 40",
        fill: "none",
        stroke: COLOR,
        "stroke-width": "4",
        "stroke-linecap": "round",
      },
    });
    // Open, so `stroke-linecap` rounds both ends - a closed subpath would join
    // them back onto each other instead.
    expect(spec.attrs.d).not.toContain("Z");
  });

  it("keeps its `d` free of exponent notation", () => {
    // SVG path data has no exponent grammar: one "4e-7" and the browser
    // discards the rest of the `d`. A line drawn near the document origin is
    // the ordinary way to produce one.
    const spec = shapeToSpec(line({ from: vec(0.0000004, 1e300), to: vec(2e7, -0.00000009) }));

    expect(spec.attrs.d).not.toMatch(/e/i);
    expect(spec.attrs.d).not.toMatch(/NaN|Infinity/);
    expect(spec.attrs.d).toBe("M 0 0 L 20000000 0");
  });
});

describe("shapeToSpec - rect", () => {
  it("is an outlined rect at the drag's box", () => {
    const spec = shapeToSpec(box());

    expect(spec).toEqual({
      tag: "rect",
      attrs: {
        id: "pagepdf-mark-3",
        x: "12.5",
        y: "30",
        width: "100",
        height: "40.5",
        // `fill: "none"` is an outline and nothing else - no `fill-opacity`
        // either, which `toEqual` asserts by listing the attributes whole. The
        // three modes are their own describe block below.
        fill: "none",
        stroke: COLOR,
        "stroke-width": "8",
      },
    });
  });

  it("normalises a drag that ran up and to the left", () => {
    // SVG treats a negative `width`/`height` as an error and draws nothing, and
    // nothing in the model promises a normalised rect (`isDegenerate` takes
    // `Math.abs` for the same reason).
    const backwards = shapeToSpec(box({ rect: rect(112.5, 70.5, -100, -40.5) }));

    expect(backwards.attrs).toMatchObject({
      x: "12.5",
      y: "30",
      width: "100",
      height: "40.5",
    });
  });
});

describe("shapeToSpec - ellipse", () => {
  it("derives cx/cy/rx/ry from the drag's box", () => {
    const spec = shapeToSpec(ellipse({ rect: rect(10, 20, 40, 60) }));

    expect(spec).toEqual({
      tag: "ellipse",
      attrs: {
        id: "pagepdf-mark-4",
        // Centre, not corner: x + width / 2 and y + height / 2.
        cx: "30",
        cy: "50",
        // Radii, not diameters - half the box in each axis. An ellipse given
        // the full width is twice the size of the drag that made it.
        rx: "20",
        ry: "30",
        fill: "none",
        stroke: COLOR,
        "stroke-width": "2",
      },
    });
  });

  it("puts the same ellipse in the same place whichever way the drag ran", () => {
    // A negative `rx`/`ry` is an error in SVG: the ellipse would simply vanish.
    const forwards = shapeToSpec(ellipse({ rect: rect(10, 20, 40, 60) }));
    const backwards = shapeToSpec(ellipse({ rect: rect(50, 80, -40, -60) }));

    expect(backwards).toEqual(forwards);
  });

  it("keeps fractional geometry rather than rounding a mark off its target", () => {
    const spec = shapeToSpec(ellipse({ rect: rect(0, 0, 15, 7) }));

    expect(spec.attrs).toMatchObject({ cx: "7.5", cy: "3.5", rx: "7.5", ry: "3.5" });
  });
});

/**
 * The three fill modes, and the one hazard in this feature.
 *
 * A `"tint"` is a read-through block, and the alpha is how it says so: the text
 * under it is still in the exported PDF and still searchable, which the person
 * drawing it can see for themselves. A `"cover"` is the opposite bargain -
 * solid, no alpha anywhere - and what makes an opaque block over a password
 * honest is nothing this module does: it is that the covered characters are
 * hidden from the print, so they are not in the PDF's text layer at all
 * (`lib/dom/cover.ts`, `.plan/design.md` §17, §19-§20).
 *
 * So everything here is about the paint, and the sharpest assertion is that a
 * cover carries no alpha of any kind. A cover that quietly rendered at
 * `FILL_OPACITY` would look almost right and would hide nothing, which is the
 * exact failure the mode exists to prevent.
 */
describe("shapeToSpec - the three fill modes", () => {
  /** Both kinds in one mode, so nothing below is asserted for the rect alone. */
  const inMode = (fill: FillMode): Shape[] => [box({ fill }), ellipse({ fill })];
  const attrsIn = (fill: FillMode): Record<string, string>[] =>
    inMode(fill).map((shape) => shapeToSpec(shape).attrs);

  it("leaves 'none' exactly as it was: fill none, and no alpha at all", () => {
    // The outline mode, pinned here as well as in the two whole-spec assertions
    // above: it has to render what this module rendered before the field
    // existed, or every plain rect and ellipse already drawn changes appearance.
    for (const attrs of attrsIn("none")) {
      expect(attrs.fill).toBe("none");
      expect(attrs["fill-opacity"]).toBeUndefined();
      expect(attrs.opacity).toBeUndefined();
    }
  });

  it("paints a 'tint' interior in the pen colour at FILL_OPACITY", () => {
    for (const attrs of attrsIn("tint")) {
      expect(attrs.fill).toBe(COLOR);
      // A string, like every other attribute value: a number here reaches the
      // document as "undefined" via setAttribute's own coercion path.
      expect(attrs["fill-opacity"]).toBe(String(FILL_OPACITY));
    }
  });

  it("makes a 'cover' solid: the pen colour, no fill-opacity and no opacity", () => {
    // The assertion this mode lives or dies by. A cover is opaque because the
    // text underneath is removed rather than read through, so any alpha here -
    // on the interior or on the whole element - is a block that looks like a
    // redaction and is not one, which is precisely what §17 refused to ship.
    for (const attrs of attrsIn("cover")) {
      expect(attrs.fill).toBe(COLOR);
      expect(attrs["fill-opacity"]).toBeUndefined();
      expect(attrs.opacity).toBeUndefined();
      // `toBeUndefined` passes for an attribute set to the string "undefined"
      // nowhere near as loudly as this does: the keys are listed, so an alpha
      // arriving under any spelling fails.
      expect(Object.keys(attrs)).not.toContain("fill-opacity");
      expect(Object.keys(attrs)).not.toContain("opacity");
    }
  });

  it("makes 'cover' exactly 'tint' minus the alpha", () => {
    // Said as a subtraction, so the two filled modes cannot drift into two
    // different-looking blocks: same colour, same geometry, same outline, and
    // the only difference in the whole spec is the one attribute.
    for (const [covered, tinted] of [
      [box({ fill: "cover" }), box({ fill: "tint" })],
      [ellipse({ fill: "cover" }), ellipse({ fill: "tint" })],
    ] as const) {
      const tintAttrs = { ...shapeToSpec(tinted).attrs };
      delete tintAttrs["fill-opacity"];
      expect(shapeToSpec(covered).attrs).toEqual(tintAttrs);
    }
  });

  it("keeps a tint on `fill-opacity` and never on `opacity`", () => {
    // The point of `fill-opacity` over `opacity`. `opacity` is the whole
    // element, so the stroke would fade with the interior: a mark that looks
    // half-erased, and one whose outline no longer reads as "somebody drew
    // this". It belongs to the highlighter, which is meant to fade whole, and
    // to no fill in any mode.
    for (const attrs of [...attrsIn("none"), ...attrsIn("tint"), ...attrsIn("cover")]) {
      expect(attrs.opacity).toBeUndefined();
    }
    for (const attrs of attrsIn("tint")) {
      expect(attrs["fill-opacity"]).toBe(String(FILL_OPACITY));
    }
  });

  it("draws the same outline in all three modes", () => {
    // The interior is the only thing a mode changes. A mode that also moved the
    // stroke would make the fill menu a second width or colour control.
    for (const kind of [
      (fill: FillMode): Shape => box({ fill }),
      (fill: FillMode): Shape => ellipse({ fill }),
    ]) {
      const outline = (fill: FillMode) => {
        const attrs = shapeToSpec(kind(fill)).attrs;
        return { stroke: attrs.stroke, width: attrs["stroke-width"] };
      };
      expect(outline("tint")).toEqual(outline("none"));
      expect(outline("cover")).toEqual(outline("none"));
      // And solid, not merely equal: the pen colour, whatever the interior does.
      expect(outline("cover").stroke).toBe(COLOR);
    }
  });

  it("still normalises a rect dragged up and to the left, in every mode", () => {
    // A negative width or height makes SVG draw nothing at all, so this is the
    // difference between a filled box and no mark whatsoever - and for a cover,
    // between a block over a password and a page that only looks covered. The
    // fill must not have moved the normalisation.
    for (const fill of ["none", "tint", "cover"] as const) {
      const backwards = shapeToSpec(box({ fill, rect: rect(112.5, 70.5, -100, -40.5) }));

      expect(backwards.attrs, fill).toMatchObject({
        x: "12.5",
        y: "30",
        width: "100",
        height: "40.5",
      });
      // The same box the forward drag produces, interior included.
      expect(backwards).toEqual(shapeToSpec(box({ fill })));
    }
  });

  it("keeps FILL_OPACITY translucent, and about the tint alone", () => {
    // The constant governs one mode. At 0 a tint draws no interior at all and
    // is indistinguishable from `"none"`; at 1 it is an opaque bar over a line
    // of text that looks like a redaction while leaving every word underneath
    // in the PDF - which is the thing `"cover"` exists to do properly, by
    // removing the text rather than by turning this number up.
    const why =
      'FILL_OPACITY must stay strictly between 0 and 1: it governs "tint" alone, ' +
      'and a tint is a read-through block. An opaque fill is "cover" - which is ' +
      "honest because the covered text is removed from the export (lib/dom/cover.ts), " +
      "not because of any alpha. See .plan/design.md §17-§19.";
    expect(FILL_OPACITY, why).toBeGreaterThan(0);
    expect(FILL_OPACITY, why).toBeLessThan(1);
  });
});

describe("shapeToSpec - the colour and the width", () => {
  it("puts the colour on the attribute that paints each kind", () => {
    const color = "#2563eb";

    // Every outlined kind: colour on `stroke`, and `fill` explicitly off, so a
    // page's own `svg { fill: currentColor }` cannot flood a rectangle.
    for (const shape of [
      line({ color }),
      box({ color }),
      ellipse({ color }),
    ] satisfies Shape[]) {
      const spec = shapeToSpec(shape);
      expect(spec.attrs.stroke).toBe(color);
      expect(spec.attrs.fill).toBe("none");
    }

    // The pen is the other way round, because it is an outline polygon.
    const pen = shapeToSpec(stroke({ color }));
    expect(pen.attrs.fill).toBe(color);
    expect(pen.attrs.stroke).toBe("none");
  });

  it("puts the pen width on stroke-width for every stroked kind", () => {
    for (const width of [2, 4, 8] as const) {
      for (const shape of [line({ width }), box({ width }), ellipse({ width })] satisfies Shape[]) {
        expect(shapeToSpec(shape).attrs["stroke-width"]).toBe(String(width));
      }
    }
  });

  it("emits strings, and no text or children, for all four kinds", () => {
    // `attrs` is a Record<string, string>: an accidental number would become
    // "undefined" or "[object Object]" in the document. And these four are all
    // leaves - `text`/`children` belong to the `text` and `symbol` kinds.
    for (const shape of [stroke(), line(), box(), ellipse()] satisfies Shape[]) {
      const spec = shapeToSpec(shape);
      for (const value of Object.values(spec.attrs)) {
        expect(typeof value).toBe("string");
      }
      expect(spec.text).toBeUndefined();
      expect(spec.children).toBeUndefined();
    }
  });

  it("carries the shape's id, so a mark in devtools says whose it is", () => {
    for (const shape of [stroke(), line(), box(), ellipse()] satisfies Shape[]) {
      expect(shapeToSpec(shape).attrs.id).toBe(shape.id);
    }
  });
});

describe("shapeToSpec - symbol", () => {
  it("delegates the whole `g` to symbolSpec", () => {
    // Seven marks' worth of arrowheads and unit-square templates is a module,
    // not a case (contracts §7); the geometry is covered in
    // tests/draw-symbols.test.ts. What this file owns is that the switch
    // actually reaches it.
    const shape = symbol();

    expect(shapeToSpec(shape)).toEqual(symbolSpec(shape));
    expect(shapeToSpec(shape).tag).toBe("g");
    expect(shapeToSpec(shape).attrs.id).toBe(shape.id);
  });
});

describe("shapeToSpec - text", () => {
  it("is a `text` node whose one line is a tspan", () => {
    const spec = shapeToSpec(text());

    expect(spec).toEqual({
      tag: "text",
      attrs: {
        id: "pagepdf-mark-6",
        x: "10",
        y: "24.5",
        // Filled, not stroked: `stroke-width` on text is an outline around
        // every character.
        fill: COLOR,
        "font-size": "18",
        "font-family": LABEL_FONT_FAMILY,
        // `y` is the top of the label, not its baseline, so the text appears
        // where the caret was instead of one line-height above it.
        "dominant-baseline": "text-before-edge",
      },
      // One line is one tspan, not a special case: the ordinary label and the
      // wrapped one go down the same path, so there is no second rendering of
      // text to keep in step (.plan/design.md §13.3).
      children: [{ tag: "tspan", attrs: { x: "10", dy: "0" }, text: LABEL }],
    });
    // ...and the `<text>` carries no `text` of its own. `specToElement` sets
    // `textContent` before appending children, so a `<text>` with both would
    // paint its own copy of the label under the tspans.
    expect(spec.text).toBeUndefined();
  });

  it("gives a three-line label three tspans, in order", () => {
    const spec = shapeToSpec(text({ text: "one\ntwo\nthree" }));

    expect(tspans(spec).map((child) => child.tag)).toEqual(["tspan", "tspan", "tspan"]);
    // The lines' text, in the order they were laid out, and on `text` - the
    // reading order of the exported PDF is the order of these nodes.
    expect(tspans(spec).map((child) => child.text)).toEqual(["one", "two", "three"]);
    expect(spec.text).toBeUndefined();
  });

  it("resets x on every tspan, including the first", () => {
    const spec = shapeToSpec(
      text({ text: "one\ntwo\nthree", rect: { x: 12.5, y: 24.5, width: 240, height: 75.6 } }),
    );

    // Every line starts at the box's left edge. A tspan with no `x` starts
    // where the previous one's advance ended, so line two would begin at the
    // end of line one and the label would walk off to the right.
    for (const child of tspans(spec)) expect(child.attrs.x).toBe("12.5");
    expect(spec.attrs.x).toBe("12.5");
  });

  it("steps each line after the first down by one line height", () => {
    const fontSize = 18;
    const spec = shapeToSpec(
      text({
        text: "one\ntwo\nthree",
        fontSize,
        rect: { x: 10, y: 24.5, width: 240, height: 75.6 },
      }),
    );

    // `dy` is relative, so the first line takes none: it sits at the `<text>`'s
    // own `y`, which `dominant-baseline: text-before-edge` puts at the top of
    // the box.
    expect(tspans(spec).map((child) => child.attrs.dy)).toEqual(["0", "25.2", "25.2"]);
    // The same number `layoutText` grew the box by. If these two ever disagree
    // the label paints outside the box it was fitted to, which decides which
    // printed sheet it lands on.
    expect(fontSize * TEXT_LINE_HEIGHT).toBeCloseTo(25.2);
  });

  it("keeps a blank line between two paragraphs as an empty tspan", () => {
    const spec = shapeToSpec(text({ text: "para one\n\npara two" }));

    // Dropped instead of rendered, the gap the user typed closes up and the
    // two paragraphs run together.
    expect(tspans(spec).map((child) => child.text)).toEqual(["para one", "", "para two"]);
    expect(tspans(spec)).toHaveLength(3);
    // ...and the empty line still takes its full step down.
    expect(tspans(spec).map((child) => child.attrs.dy)).toEqual(["0", "25.2", "25.2"]);
  });

  it("renders a soft-wrapped label from `lines`, not from `text`", () => {
    // The one case that deliberately pins `lines` against `text`: a soft wrap
    // is `layoutText`'s answer after measuring a font, and nothing the renderer
    // could derive from `text` on its own. `text` keeps the `\n`s the user
    // typed (here, none) and stays the source of truth.
    const typed = "a label too wide for its box";
    const spec = shapeToSpec(text({ text: typed, lines: ["a label too", "wide for its box"] }));

    expect(tspans(spec).map((child) => child.text)).toEqual([
      "a label too",
      "wide for its box",
    ]);
    expect(spec.text).toBeUndefined();
    // And the space at the wrap is gone from the painted lines, exactly as
    // `wrapLines` returns them - the renderer neither adds nor trims anything.
    expect(tspans(spec).map((child) => child.text).join("")).not.toContain(typed);
  });

  it("falls back to the label itself if `lines` somehow arrives empty", () => {
    // `layoutText` never returns an empty array (contracts §18), so this is a
    // shape no session produces. It is pinned because the alternative is a
    // `<text>` with no children and no text: a label that paints nothing and
    // exports nothing, silently. One tspan, same path as every other label.
    const spec = shapeToSpec(text({ text: LABEL, lines: [] }));

    expect(tspans(spec)).toEqual([{ tag: "tspan", attrs: { x: "10", dy: "0" }, text: LABEL }]);
  });

  it("never puts a line of the label in an attribute", () => {
    // The label is a string the user typed into their own page. It reaches the
    // document through `textContent` on real `<text>`/`<tspan>` nodes and
    // nowhere else - never `innerHTML`, never an attribute - which is both the
    // safe route and the only one that leaves the words searchable in the
    // exported PDF, the check CLAUDE.md says matters most. A `<tspan>` is text
    // content just as `<text>` is, so wrapping costs nothing here.
    const spec = shapeToSpec(text({ text: `${LABEL}\n${LABEL} again` }));

    expect(tspans(spec).map((child) => child.text)).toEqual([LABEL, `${LABEL} again`]);
    for (const node of [spec, ...tspans(spec)]) {
      for (const value of Object.values(node.attrs)) {
        expect(value).not.toContain("Ctrl+F");
      }
    }
    // No third level: a line is a leaf, so nothing here needs recursing.
    for (const child of tspans(spec)) expect(child.children).toBeUndefined();
  });

  it("keeps a label that looks like markup as one string", () => {
    // No escaping, no sanitising and no parsing: `textContent` cannot execute
    // it, so the honest thing is to render exactly what was typed.
    const hostile = '</text><script>alert(1)</script>';
    const spec = shapeToSpec(text({ text: hostile }));

    expect(tspans(spec).map((child) => child.text)).toEqual([hostile]);
    expect(spec.tag).toBe("text");
    expect(Object.values(spec.attrs).join(" ")).not.toContain("script");
    expect(tspans(spec).flatMap((child) => Object.values(child.attrs)).join(" ")).not.toContain(
      "script",
    );
  });

  it("sets the label in a font stack a stranger's machine already has", () => {
    const spec = shapeToSpec(text());

    // System faces and generic families only: the mark has to paint the instant
    // the print dialog opens, with nothing downloaded.
    expect(spec.attrs["font-family"]).toBe(LABEL_FONT_FAMILY);
    expect(LABEL_FONT_FAMILY).toMatch(/(sans-serif|serif|monospace)$/);
    expect(LABEL_FONT_FAMILY).not.toMatch(/url\(|@import/);
  });

  it("takes its size from the shape, not from the pen width", () => {
    // The text tool's own control (contracts §1, `DrawPrefs.fontSize`). The
    // pen width belongs to the stroked kinds and has no meaning for glyphs.
    for (const fontSize of [8, 16, 42.5, 96]) {
      // A two-letter label in a box grown to one line at this size, so every
      // step of the sweep is a shape a session could really hand the renderer.
      // The default label at 96px is several hundred px of glyphs and would
      // have wrapped to three or four lines in a 240px box, with a `lines` of
      // one and a `height` of 25.2 saying otherwise.
      const spec = shapeToSpec(
        text({
          fontSize,
          width: 8,
          text: "Hi",
          rect: { x: 10, y: 24.5, width: 240, height: fontSize * TEXT_LINE_HEIGHT },
        }),
      );

      expect(spec.attrs["font-size"]).toBe(String(fontSize));
      expect(spec.attrs["stroke-width"]).toBeUndefined();
      // The size is the label's, not the tspans' - they inherit it, and a
      // per-line `font-size` would be a second place to keep it.
      for (const child of tspans(spec)) expect(child.attrs["font-size"]).toBeUndefined();
    }
  });

  it("keeps its coordinates free of exponent notation", () => {
    // Same grammar hazard as `line`: a label placed near the document origin
    // is the ordinary way to produce a `4e-7`. The tspans are in it too - their
    // `x` is the same coordinate and their `dy` is derived from `font-size`.
    const spec = shapeToSpec(
      text({
        text: "one\ntwo",
        rect: { x: 0.0000004, y: 1e300, width: 240, height: 25.2 },
        fontSize: 1e21,
      }),
    );

    for (const node of [spec, ...tspans(spec)]) {
      for (const value of Object.values(node.attrs)) {
        expect(value).not.toMatch(/\de[+-]?\d/i);
        expect(value).not.toMatch(/NaN|Infinity/);
      }
    }
  });
});
