import { describe, expect, it } from "vitest";

import { LABEL_FONT_FAMILY } from "@/lib/draw/css";
import { arrowHead, normalizeRect } from "@/lib/draw/geometry";
import { MIN_SHAPE_PX } from "@/lib/draw/model";
import { DEFAULT_SYMBOL_SIZE_PX, symbolRect, symbolSpec } from "@/lib/draw/symbols";
import type { DrawRect, SymbolShape, Vec2 } from "@/lib/draw/model";
import type { NodeSpec } from "@/lib/draw/render";
import type { SymbolKind } from "@/lib/types";

/**
 * Asserted on the returned **spec**, like `tests/draw-render.test.ts`: seven
 * symbols' worth of geometry is settled without a document, so `tests/` stays
 * plain vitest with no DOM harness (`CLAUDE.md`).
 *
 * The one decision worth reading before the assertions below: `SymbolShape.rect`
 * is a `DrawRect`, and a *normalised* one no longer says which way the drag ran
 * - `(10,10) -> (42,42)` and the reverse are the same four numbers. `symbols.ts`
 * therefore aims an arrow along the rect's **signed diagonal**: tail at
 * `(x, y)`, tip at `(x + width, y + height)`. A normalised rect points the arrow
 * at its bottom-right corner (pinned in "aims a normalised rect..."); a caller
 * that keeps the drag's sign aims it, with no change to the shape model
 * (pinned in "reverses..."). Both are asserted so neither can drift.
 */

const COLOR = "#dc2626";

function rect(x: number, y: number, width: number, height: number): DrawRect {
  return { x, y, width, height };
}

function symbol(over: Partial<SymbolShape> = {}): SymbolShape {
  return {
    kind: "symbol",
    id: "pagepdf-mark-5",
    color: COLOR,
    width: 4,
    symbol: "arrow",
    rect: rect(100, 200, 32, 32),
    ...over,
  };
}

/**
 * Every `SymbolKind`, as a compile-time-exhaustive list: an eighth symbol added
 * to the union stops this file compiling rather than quietly going untested.
 */
const ALL_KINDS: Record<SymbolKind, true> = {
  arrow: true,
  "arrow-double": true,
  check: true,
  cross: true,
  bang: true,
  star: true,
  pin: true,
};
const KINDS = Object.keys(ALL_KINDS) as SymbolKind[];

/** The spec and every descendant, flattened. */
function nodes(spec: NodeSpec): NodeSpec[] {
  return [spec, ...(spec.children ?? []).flatMap(nodes)];
}

function attrValues(spec: NodeSpec): string[] {
  return nodes(spec).flatMap((node) => Object.values(node.attrs));
}

function attrNames(spec: NodeSpec): string[] {
  return nodes(spec).flatMap((node) => Object.keys(node.attrs));
}

/** The coordinate pairs of a path `d`, in order. */
function pathPoints(d: string): Vec2[] {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const out: Vec2[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    out.push({ x: numbers[i], y: numbers[i + 1] });
  }
  return out;
}

/** The `d` of a symbol's first `path` child. */
function firstPath(spec: NodeSpec): string {
  const path = (spec.children ?? []).find((child) => child.tag === "path");
  expect(path).toBeDefined();
  return path?.attrs.d ?? "";
}

function subpathCount(d: string): number {
  return (d.match(/M/g) ?? []).length;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * A segment's slope, in the SVG sense - y grows downwards, so a positive slope
 * runs down and to the right.
 *
 * The *sign* is what the glyph assertions use, and it is direction-independent:
 * reversing a segment's two points leaves it unchanged. That is what makes it
 * the right test for "these two strokes cross" - a mutation that reverses one
 * subpath rather than rotating it cannot slip past. Vertical segments have no
 * slope and none of the templates below contains one, so the guard is an
 * assertion rather than a fallback.
 */
function slope(a: Vec2, b: Vec2): number {
  expect(b.x).not.toBe(a.x);
  return (b.y - a.y) / (b.x - a.x);
}

function centreOf(box: DrawRect): Vec2 {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

const DEG = Math.PI / 180;

function childByTag(spec: NodeSpec, tag: string): NodeSpec | undefined {
  return (spec.children ?? []).find((child) => child.tag === tag);
}

describe("DEFAULT_SYMBOL_SIZE_PX", () => {
  it("is 32, the click-to-place size", () => {
    // Pinned as a literal: it is the size of every symbol placed without a
    // drag, so a drift here silently resizes the whole palette.
    expect(DEFAULT_SYMBOL_SIZE_PX).toBe(32);
  });

  it("places a click-sized arrow that is aimed and inside its own box", () => {
    const size = DEFAULT_SYMBOL_SIZE_PX;
    const spec = symbolSpec(symbol({ rect: rect(0, 0, size, size) }));
    const points = pathPoints(firstPath(spec));

    // Task 16's "place one by click: it is DEFAULT_SYMBOL_SIZE_PX and still
    // aimed sensibly" - a 32px square rect is a 32px arrow on its diagonal.
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[1]).toEqual({ x: size, y: size });
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(size);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(size);
    }
  });
});

/**
 * The whole click-or-drag decision, and the reason it is in this module at all.
 *
 * It lived in `entrypoints/annotate.ts`, untested, where it reused
 * `isDegenerate` (model.ts) as its "that was a click" test - an **either-axis**
 * test, so every deliberate horizontal or vertical drag was re-read as a click
 * and committed as a 32x32 down-right arrow while the preview showed the long
 * arrow right up to the release. Two of these assertions are that bug; the rest
 * are the mutation the review found on the same line, `normalizeRect(from, to)`,
 * which renders and always points down and to the right.
 */
describe("symbolRect", () => {
  const from: Vec2 = { x: 100, y: 100 };

  it("aims each of the four diagonals differently, and keeps the sign", () => {
    // The signed diagonal is the whole of the aiming decision: tail at
    // `(x, y)`, tip at `(x + width, y + height)`. Every one of these four is a
    // different arrow, and `normalizeRect` would collapse all four into the
    // *same* box - which is what makes this the mutation guard.
    const boxes = [
      symbolRect(from, { x: 200, y: 200 }, false),
      symbolRect(from, { x: 200, y: 40 }, false),
      symbolRect(from, { x: 40, y: 200 }, false),
      symbolRect(from, { x: 40, y: 40 }, false),
    ];

    expect(boxes[0]).toEqual({ x: 100, y: 100, width: 100, height: 100 });
    expect(boxes[1]).toEqual({ x: 100, y: 100, width: 100, height: -60 });
    expect(boxes[2]).toEqual({ x: 100, y: 100, width: -60, height: 100 });
    expect(boxes[3]).toEqual({ x: 100, y: 100, width: -60, height: -60 });
    // Four drags, four rects: no two of them are the same four numbers.
    expect(new Set(boxes.map((box) => JSON.stringify(box))).size).toBe(4);
  });

  it("is not normalizeRect, on a drag where the difference is the aim", () => {
    // Stated as the substitution rather than as its symptom, so the mutation
    // the review made by hand - `normalizeRect(d.from, to)` on the symbol path -
    // fails here by name. Both extents negative, and `normalizeRect`'s are
    // positive by construction.
    const to: Vec2 = { x: 40, y: 40 };
    const box = symbolRect(from, to, false);

    expect(box).not.toEqual(normalizeRect(from, to));
    expect(box.width).toBeLessThan(0);
    expect(box.height).toBeLessThan(0);
    // ...and the arrow that comes out of it has its tip where the drag ended,
    // which is the consequence a user sees.
    const points = pathPoints(firstPath(symbolSpec(symbol({ rect: box }))));
    expect(points[0]).toEqual(from);
    expect(points[1]).toEqual(to);
  });

  it("keeps a long horizontal drag's length, instead of re-reading it as a click", () => {
    // Review finding 1, measured: this came back `32 x 32` because
    // `isDegenerate`'s either-axis test called a 300x0 rect degenerate. A
    // horizontal arrow is the commonest aim there is.
    expect(symbolRect(from, { x: 400, y: 100 }, false)).toEqual({
      x: 100,
      y: 100,
      width: 300,
      height: 0,
    });
    // And the two intermittent ones: thin in the cross axis because a hand
    // wobbles, and previously a click for exactly that reason.
    expect(symbolRect(from, { x: 300, y: 102 }, false)).toEqual({
      x: 100,
      y: 100,
      width: 200,
      height: 2,
    });
    expect(symbolRect(from, { x: 102, y: 300 }, false)).toEqual({
      x: 100,
      y: 100,
      width: 2,
      height: 200,
    });
  });

  it("gives a click DEFAULT_SYMBOL_SIZE_PX, down and to the right", () => {
    // `from === to`: the signed rect has no extent at all, and a symbol is
    // placed by a click. The corner pair is the one this module documents a
    // click-placed arrow as being aimed along.
    expect(symbolRect(from, from, false)).toEqual({
      x: 100,
      y: 100,
      width: DEFAULT_SYMBOL_SIZE_PX,
      height: DEFAULT_SYMBOL_SIZE_PX,
    });
  });

  it("treats a twitch under MIN_SHAPE_PX as the click it was", () => {
    // A radial threshold, not a per-axis one: 3px in each axis is 4.24px of
    // travel and is a drag; 2px in each is 2.83px and is a click the mouse
    // moved during. The point of keeping a threshold at all is that the second
    // one gets its symbol rather than nothing.
    expect(symbolRect(from, { x: 102, y: 102 }, false).width).toBe(DEFAULT_SYMBOL_SIZE_PX);
    expect(symbolRect(from, { x: 103, y: 103 }, false).width).toBe(3);
    // Exactly on the threshold in one axis: MIN_SHAPE_PX of travel is a drag.
    expect(symbolRect(from, { x: 100 + MIN_SHAPE_PX, y: 100 }, false).width).toBe(MIN_SHAPE_PX);
  });

  it("squares under Shift without un-aiming the drag", () => {
    // `constrainSquare` preserves the sign (geometry.ts), so Shift on an arrow
    // is a 45-degree snap rather than a re-aim: an up-left drag stays up-left.
    const box = symbolRect(from, { x: 40, y: 90 }, true);

    expect(box).toEqual({ x: 100, y: 100, width: -60, height: -60 });
    // Sized by the longer axis, so the square still reaches the pointer.
    expect(Math.abs(box.width)).toBe(60);
    // A horizontal drag under Shift gains its missing axis - the one case the
    // old code got right, and only because `constrainSquare` manufactured it.
    expect(symbolRect(from, { x: 400, y: 100 }, true)).toEqual({
      x: 100,
      y: 100,
      width: 300,
      height: 300,
    });
  });

  it("ignores Shift on a click, which has no direction to square up", () => {
    expect(symbolRect(from, from, true)).toEqual(symbolRect(from, from, false));
  });
});

describe("symbolSpec - every kind", () => {
  it("covers all seven symbols", () => {
    expect(KINDS).toHaveLength(7);
  });

  it("is a `g` with at least one child", () => {
    for (const kind of KINDS) {
      const spec = symbolSpec(symbol({ symbol: kind }));

      expect(spec.tag).toBe("g");
      // The group carries the paint and the children carry the geometry, so a
      // childless `g` is a symbol that renders as nothing at all.
      expect(spec.children?.length ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it("puts the colour, the width and the id on the group", () => {
    for (const kind of KINDS) {
      const spec = symbolSpec(symbol({ symbol: kind, color: "#2563eb", width: 8 }));

      expect(spec.attrs.id).toBe("pagepdf-mark-5");
      expect(spec.attrs.stroke).toBe("#2563eb");
      // Hyphenated, the SVG spelling - `strokeWidth` would be an attribute the
      // browser ignores in silence.
      expect(spec.attrs["stroke-width"]).toBe("8");
      // Never filled by default: a page shipping `svg { fill: currentColor }`
      // must not be able to flood a check mark into a blob.
      expect(spec.attrs.fill).toBe("none");
      expect(spec.attrs["stroke-linecap"]).toBe("round");
      expect(spec.attrs["stroke-linejoin"]).toBe("round");
    }
  });

  it("emits strings, with attribute names in SVG's hyphenated spelling", () => {
    for (const kind of KINDS) {
      const spec = symbolSpec(symbol({ symbol: kind }));

      for (const value of attrValues(spec)) expect(typeof value).toBe("string");
      // camelCase is the DOM property spelling, not the attribute one; an
      // accidental `fontSize` sets nothing and fails nowhere.
      for (const name of attrNames(spec)) expect(name).toBe(name.toLowerCase());
    }
  });

  it("never emits NaN, Infinity or exponent notation", () => {
    for (const kind of KINDS) {
      const spec = symbolSpec(symbol({ symbol: kind, rect: rect(0.0004, 1e7, 33.333, 12.5) }));

      for (const value of attrValues(spec)) {
        expect(value).not.toMatch(/NaN|Infinity/);
        // SVG path data has no exponent grammar: one "4e-7" and the browser
        // discards the rest of the `d`.
        expect(value).not.toMatch(/\de[+-]?\d/i);
      }
    }
  });

  it("draws seven different marks", () => {
    // A copy-pasted template is the failure this catches: two symbols that
    // share geometry are two buttons that do the same thing.
    const drawn = KINDS.map((kind) => JSON.stringify(symbolSpec(symbol({ symbol: kind }))));

    expect(new Set(drawn).size).toBe(KINDS.length);
  });
});

describe("symbolSpec - the arrows", () => {
  it("aims a normalised rect from its top-left corner at its bottom-right", () => {
    // The documented decision, pinned: `normalizeRect` returns positive extents,
    // so a normalised rect carries no direction and the arrow takes the box's
    // own diagonal. Change this and every click-placed arrow turns round.
    const spec = symbolSpec(symbol({ rect: rect(100, 200, 32, 40) }));
    const points = pathPoints(firstPath(spec));

    expect(points[0]).toEqual({ x: 100, y: 200 });
    expect(points[1]).toEqual({ x: 132, y: 240 });
  });

  it("puts the head on the tip, swept back along the shaft", () => {
    const tail = { x: 100, y: 200 };
    const tip = { x: 132, y: 232 };
    const spec = symbolSpec(symbol({ rect: rect(100, 200, 32, 32) }));
    const d = firstPath(spec);
    const points = pathPoints(d);

    // Shaft, then `barb -> tip -> barb` as its own subpath: two subpaths, five
    // points, and the tip is the middle one of the head.
    expect(subpathCount(d)).toBe(2);
    expect(points).toHaveLength(5);
    expect(points[3]).toEqual(tip);

    const [left, right] = [points[2], points[4]];
    // Both barbs the same distance from the tip, so the head stays symmetric...
    expect(dist(left, tip)).toBeCloseTo(dist(right, tip), 1);
    // ...and both behind it, or the "head" is a pair of spikes off the front.
    for (const barb of [left, right]) {
      expect(dist(barb, tail)).toBeLessThan(dist(tip, tail));
      expect(dist(barb, tip)).toBeGreaterThan(0);
    }

    // The barbs are geometry.ts's, not a second implementation of it.
    const size = dist(left, tip);
    const [expectedLeft, expectedRight] = arrowHead(tail, tip, size);
    expect(left.x).toBeCloseTo(expectedLeft.x, 1);
    expect(left.y).toBeCloseTo(expectedLeft.y, 1);
    expect(right.x).toBeCloseTo(expectedRight.x, 1);
    expect(right.y).toBeCloseTo(expectedRight.y, 1);
  });

  it("reverses the head when the rect's extents are reversed", () => {
    // The other half of the decision: a caller that keeps the drag's sign -
    // `{ x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y }`
    // rather than `normalizeRect` - aims the arrow, with no change to
    // `SymbolShape`. Same box on the page, opposite tip.
    const forwards = pathPoints(firstPath(symbolSpec(symbol({ rect: rect(100, 200, 32, 32) }))));
    const backwards = pathPoints(firstPath(symbolSpec(symbol({ rect: rect(132, 232, -32, -32) }))));

    expect(forwards[0]).toEqual({ x: 100, y: 200 });
    expect(forwards[1]).toEqual({ x: 132, y: 232 });
    expect(backwards[0]).toEqual({ x: 132, y: 232 });
    expect(backwards[1]).toEqual({ x: 100, y: 200 });
    // The head follows the tip rather than staying at one corner.
    expect(forwards[3]).toEqual({ x: 132, y: 232 });
    expect(backwards[3]).toEqual({ x: 100, y: 200 });

    // A mixed-sign drag - up and to the right - aims there too.
    const upRight = pathPoints(firstPath(symbolSpec(symbol({ rect: rect(100, 232, 32, -32) }))));
    expect(upRight[3]).toEqual({ x: 132, y: 200 });
  });

  it("gives arrow-double a head at each end", () => {
    const spec = symbolSpec(symbol({ symbol: "arrow-double", rect: rect(100, 200, 32, 32) }));
    const d = firstPath(spec);
    const points = pathPoints(d);

    // Shaft plus two heads: 2 + 3 + 3 points.
    expect(subpathCount(d)).toBe(3);
    expect(points).toHaveLength(8);
    expect(points[3]).toEqual({ x: 132, y: 232 });
    expect(points[6]).toEqual({ x: 100, y: 200 });
  });

  it("scales the head with the shaft, up to a ceiling", () => {
    const headOf = (size: number): number => {
      const points = pathPoints(firstPath(symbolSpec(symbol({ rect: rect(0, 0, size, size) }))));
      return dist(points[2], points[3]);
    };

    // Proportional, so a small arrow is not all head...
    expect(headOf(32)).toBeGreaterThan(0);
    expect(headOf(64)).toBeGreaterThan(headOf(32));
    // ...and capped, so a page-long arrow is not a paper dart.
    expect(headOf(4000)).toBeCloseTo(headOf(2000), 1);
    expect(headOf(4000)).toBeLessThan(0.28 * Math.hypot(4000, 4000));
  });
});

describe("symbolSpec - the glyph templates", () => {
  const templates: SymbolKind[] = ["check", "cross", "bang", "star"];

  it("keeps every point inside the rect it was scaled into", () => {
    const box = rect(100, 200, 48, 64);

    for (const kind of templates) {
      const spec = symbolSpec(symbol({ symbol: kind, rect: box }));

      for (const node of nodes(spec)) {
        for (const point of pathPoints(node.attrs.d ?? "")) {
          expect(point.x).toBeGreaterThanOrEqual(box.x);
          expect(point.x).toBeLessThanOrEqual(box.x + box.width);
          expect(point.y).toBeGreaterThanOrEqual(box.y);
          expect(point.y).toBeLessThanOrEqual(box.y + box.height);
        }
      }
    }
  });

  it("is unmirrored by a backwards drag, unlike the arrows", () => {
    // A check mark drawn right-to-left is still a check mark, and a "!" must
    // never arrive upside down - so everything but the arrows is scaled into
    // the *normalised* box.
    for (const kind of [...templates, "pin" as const]) {
      const forwards = symbolSpec(symbol({ symbol: kind, rect: rect(100, 200, 32, 32) }));
      const backwards = symbolSpec(symbol({ symbol: kind, rect: rect(132, 232, -32, -32) }));

      expect(backwards).toEqual(forwards);
    }

    // The contrast: the arrows read the sign on purpose.
    expect(symbolSpec(symbol({ rect: rect(132, 232, -32, -32) }))).not.toEqual(
      symbolSpec(symbol({ rect: rect(100, 200, 32, 32) })),
    );
  });

  it("closes the star and leaves the open glyphs open", () => {
    // A pentagram is a closed outline; a tick joined back on itself is a
    // triangle.
    expect(firstPath(symbolSpec(symbol({ symbol: "star" })))).toContain("Z");
    for (const kind of ["check", "cross", "bang"] as const) {
      expect(firstPath(symbolSpec(symbol({ symbol: kind })))).not.toContain("Z");
    }
    // Ten vertices: five points and five valleys.
    expect(pathPoints(firstPath(symbolSpec(symbol({ symbol: "star" }))))).toHaveLength(10);
  });

  it("turns the check's two arms, instead of drawing a corner", () => {
    // A count of points and a bounding box say nothing about the shape: every
    // point of a tick, of a right angle and of a "V" is inside the rect. What
    // makes it a tick is the *turn*, so that is what is asserted.
    const box = rect(100, 200, 48, 64);
    const points = pathPoints(firstPath(symbolSpec(symbol({ symbol: "check", rect: box }))));

    expect(points).toHaveLength(3);
    // Left to right throughout - a tick is read in one direction.
    expect(points[0].x).toBeLessThan(points[1].x);
    expect(points[1].x).toBeLessThan(points[2].x);
    // The corner: the middle vertex is the lowest point of the mark (y is
    // down), so the pen goes down into it and back up out of it.
    expect(points[1].y).toBeGreaterThan(points[0].y);
    expect(points[1].y).toBeGreaterThan(points[2].y);
    // The same statement as two arms sloping opposite ways. A third point
    // *below* the second draws a right angle and passes neither check.
    const down = slope(points[0], points[1]);
    const up = slope(points[1], points[2]);
    expect(down).toBeGreaterThan(0);
    expect(up).toBeLessThan(0);
    expect(down * up).toBeLessThan(0);
    // "The long arm is the read": the up-stroke past the corner is the longer
    // of the two, and it finishes higher than the tick began.
    expect(dist(points[1], points[2])).toBeGreaterThan(dist(points[0], points[1]));
    expect(points[2].y).toBeLessThan(points[0].y);
  });

  it("makes the cross's two strokes actually cross", () => {
    const box = rect(100, 200, 48, 64);
    const d = firstPath(symbolSpec(symbol({ symbol: "cross", rect: box })));
    const points = pathPoints(d);

    expect(subpathCount(d)).toBe(2);
    expect(points).toHaveLength(4);

    // Opposite signs, which is the whole of "cross": two *parallel* strokes
    // satisfy every count and bounds check ever written and draw an equals
    // sign. Sign, not value, so reversing a subpath cannot fake it either.
    const first = slope(points[0], points[1]);
    const second = slope(points[2], points[3]);
    expect(first).toBeGreaterThan(0);
    expect(second).toBeLessThan(0);
    expect(first * second).toBeLessThan(0);

    // ...and they meet in the middle: each stroke's midpoint is the box's
    // centre, so the arms intersect rather than making a corner off to one
    // side. Two opposite slopes on their own could still be an X pulled apart.
    const centre = centreOf(box);
    for (const [from, to] of [
      [points[0], points[1]],
      [points[2], points[3]],
    ] as const) {
      const mid = midpoint(from, to);
      expect(mid.x).toBeCloseTo(centre.x, 1);
      expect(mid.y).toBeCloseTo(centre.y, 1);
    }
  });

  it("puts the star's ten vertices where a pentagram's are", () => {
    // A 100px box, so the two-decimal rounding cannot move a vertex further
    // than a hundredth of a pixel.
    const box = rect(100, 200, 100, 100);
    const points = pathPoints(firstPath(symbolSpec(symbol({ symbol: "star", rect: box }))));
    const centre = centreOf(box);
    const outerRadius = 50;
    // 1/phi^2 is the inner radius that makes a pentagram's arms straight -
    // derived here rather than copied from the module's 0.382.
    const phiSquared = ((1 + Math.sqrt(5)) / 2) ** 2;
    const innerRadius = outerRadius / phiSquared;

    expect(points).toHaveLength(10);

    // The first vertex points *straight up*: due north of the centre, on the
    // box's top edge. A star lying on its side is still ten points inside the
    // rect, so this is the assertion that pins the phase - and, because the
    // x is the cosine and the y the sine, swapping the two lands it due west.
    expect(points[0].x).toBeCloseTo(centre.x, 1);
    expect(points[0].y).toBeCloseTo(box.y, 1);

    // Every vertex, against the definition of a pentagram rather than against
    // the module: ten of them 36 degrees apart, starting straight up,
    // alternating between the two radii. This is what pins the step (36, not
    // 40 - which would leave the last arm 40 degrees short of the first).
    for (const [index, point] of points.entries()) {
      const angle = (-90 + index * 36) * DEG;
      const radius = index % 2 === 0 ? outerRadius : innerRadius;
      expect(point.x).toBeCloseTo(centre.x + Math.cos(angle) * radius, 1);
      expect(point.y).toBeCloseTo(centre.y + Math.sin(angle) * radius, 1);
    }

    // The ratio, measured off the emitted geometry: 2.618 to 1. One radius for
    // all ten is a decagon, and the two swapped is an inside-out star - both
    // of which are ten points, evenly spaced, inside the box.
    const outer = points.filter((_, i) => i % 2 === 0).map((p) => dist(p, centre));
    const inner = points.filter((_, i) => i % 2 === 1).map((p) => dist(p, centre));
    for (const r of outer) expect(r).toBeCloseTo(outerRadius, 1);
    for (const r of inner) expect(r).toBeCloseTo(innerRadius, 1);
    expect(Math.min(...outer) / Math.max(...inner)).toBeCloseTo(phiSquared, 1);
  });

  it("gives the bang a solid dot under its stem", () => {
    const spec = symbolSpec(symbol({ symbol: "bang", rect: rect(100, 200, 32, 32) }));
    const stem = childByTag(spec, "path");
    const dot = childByTag(spec, "circle");

    expect(stem).toBeDefined();
    expect(dot).toBeDefined();
    // Filled with the pen colour and explicitly unstroked: the group strokes,
    // and a dot is solid or it is not a dot.
    expect(dot?.attrs.fill).toBe(COLOR);
    expect(dot?.attrs.stroke).toBe("none");
    expect(Number(dot?.attrs.r)).toBeGreaterThan(0);
    // Below the stem, which is what makes it an exclamation mark.
    const stemPoints = pathPoints(stem?.attrs.d ?? "");
    expect(Number(dot?.attrs.cy)).toBeGreaterThan(stemPoints[1].y);
  });
});

describe("symbolSpec - the numbered pin", () => {
  it("carries its number as real text, not as an attribute", () => {
    const spec = symbolSpec(symbol({ symbol: "pin", index: 3, rect: rect(100, 200, 48, 48) }));
    const label = childByTag(spec, "text");

    expect(label).toBeDefined();
    // `textContent` on a real `<text>` node is the only route by which a pin's
    // number comes out of Chrome findable with Ctrl+F - the check CLAUDE.md
    // says matters most - and the only safe place for a string either way.
    expect(label?.text).toBe("3");
    expect(Object.values(label?.attrs ?? {})).not.toContain("3");
  });

  it("defaults to 1 when the index is absent", () => {
    // Absent for every symbol but the pin (model.ts), and a pin placed before
    // `nextPinIndex` is wired up must still read as the first one.
    const spec = symbolSpec(symbol({ symbol: "pin" }));

    expect(childByTag(spec, "text")?.text).toBe("1");
  });

  it("sets the number in a font a stranger's machine already has", () => {
    const label = childByTag(symbolSpec(symbol({ symbol: "pin" })), "text");

    // The same stack as a text label, and it ends in a generic family: a web
    // font would need a network request from a subtree that has to paint the
    // instant the print dialog opens.
    expect(label?.attrs["font-family"]).toBe(LABEL_FONT_FAMILY);
    expect(LABEL_FONT_FAMILY).toMatch(/(sans-serif|serif|monospace)$/);
    expect(Number(label?.attrs["font-size"])).toBeGreaterThan(0);
    // Centred both ways, so the digit sits in the badge instead of hanging off
    // a baseline through the middle of it.
    expect(label?.attrs["text-anchor"]).toBe("middle");
    expect(label?.attrs["dominant-baseline"]).toBe("central");
    // The group strokes; outlined digits at an 8px pen are a smudge.
    expect(label?.attrs.fill).toBe(COLOR);
    expect(label?.attrs.stroke).toBe("none");
  });

  it("puts the badge and the number on the same centre", () => {
    const spec = symbolSpec(symbol({ symbol: "pin", rect: rect(100, 200, 48, 48) }));
    const badge = childByTag(spec, "circle");
    const label = childByTag(spec, "text");

    expect(badge?.attrs.cx).toBe("124");
    expect(badge?.attrs.cy).toBe("224");
    expect(badge?.attrs.r).toBe("24");
    expect(label?.attrs.x).toBe(badge?.attrs.cx);
    expect(label?.attrs.y).toBe(badge?.attrs.cy);
    // An opaque badge, so the number reads over whatever it was dropped on -
    // and not in the pen colour, which would put white digits on amber.
    expect(badge?.attrs.fill).toBe("#ffffff");
  });

  it("stays a circle in a rect that is not square", () => {
    // A badge, not a lozenge with a squashed number in it: the radius comes off
    // the shorter axis.
    const spec = symbolSpec(symbol({ symbol: "pin", rect: rect(0, 0, 120, 40) }));

    expect(childByTag(spec, "circle")?.attrs.r).toBe("20");
  });
});

describe("symbolSpec - degenerate rects", () => {
  it("survives a zero-size rect without Infinity or NaN", () => {
    // A click that never became a drag. `isDegenerate` (model.ts) drops these
    // before they reach the layer, but the scale maths must not divide by an
    // extent - one "NaN" in a `d` and the browser discards the whole path.
    for (const kind of KINDS) {
      const spec = symbolSpec(symbol({ symbol: kind, rect: rect(50, 60, 0, 0) }));

      for (const value of attrValues(spec)) expect(value).not.toMatch(/NaN|Infinity/);
      // ...and it still renders as *something*, at a point, rather than
      // collapsing to an empty `d` the layer would append for nothing.
      expect(spec.children?.length ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it("survives a rect with no width, and one with no height", () => {
    for (const kind of KINDS) {
      for (const box of [rect(10, 20, 0, 48), rect(10, 20, 48, 0)]) {
        const spec = symbolSpec(symbol({ symbol: kind, rect: box }));

        expect(attrValues(spec).join(" ")).not.toMatch(/NaN|Infinity/);
        expect(spec.children?.length ?? 0).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("degrades a non-finite rect to numbers a browser can parse", () => {
    // Not reachable from a pointer event, and the guarantee is `num`'s rather
    // than this module's - but it is the guarantee that keeps a bad number from
    // taking a whole mark with it, so it is asserted here too.
    for (const kind of KINDS) {
      const spec = symbolSpec(
        symbol({ symbol: kind, rect: rect(Number.NaN, Infinity, -Infinity, 1e308) }),
      );

      for (const value of attrValues(spec)) expect(value).not.toMatch(/NaN|Infinity/);
    }
  });
});
