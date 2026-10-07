/**
 * The symbol vocabulary: seven marks, each as SVG geometry scaled into the rect
 * the pointer drew.
 *
 * Kept out of `lib/draw/render.ts` (`.plan/design.md` §6) because this is the
 * one kind whose geometry is more than "put the drag's box in four attributes":
 * two arrows along a diagonal, four glyph templates and a numbered badge. Pure
 * module - no DOM, no `document`, no `chrome.*` - so every one of those seven is
 * an assertion in `tests/draw-symbols.test.ts` rather than something you check
 * by drawing it.
 *
 * ## How an arrow is aimed
 *
 * `SymbolShape.rect` is a `DrawRect`, and `normalizeRect` (geometry.ts) returns
 * positive extents - so a *normalised* rect no longer carries the drag's
 * direction at all: `(10,10) -> (42,42)` and `(42,42) -> (10,10)` arrive as the
 * same four numbers. The constraint is the shape model, not `arrowHead`'s
 * `from`/`to` signature, and `SymbolShape` is committed and not ours to change.
 *
 * The rule, therefore, is the rect's own **signed diagonal**: the tail sits at
 * `(rect.x, rect.y)` and the tip at `(rect.x + width, rect.y + height)`. Two
 * consequences, both deliberate:
 *
 * - Handed a normalised rect, an arrow always runs from the box's top-left
 *   corner to its bottom-right. That is what a click-placed arrow
 *   (`DEFAULT_SYMBOL_SIZE_PX` square) is, and it is what "still aimed sensibly"
 *   means in task 16's manual check - fixed and predictable rather than
 *   arbitrary.
 * - A caller that *keeps* the sign - a drag stored as
 *   `{ x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y }`
 *   instead of through `normalizeRect` - aims the arrow with no change to the
 *   shape model whatsoever: negative extents put the tip on the corner the
 *   pointer finished on. That is the seam the symbol tool uses, and it is why
 *   this module reads the sign rather than taking `Math.abs` up front.
 *   `symbolRect` below **is** that seam: it is the one place the sign, Shift and
 *   the click-to-place size are decided, and it is tested, so the sentence above
 *   is a guarantee rather than a warning to whoever writes the drag next.
 *
 * Every *other* symbol is scaled into the **normalised** box, so a backwards
 * drag cannot mirror a check mark or stand an exclamation mark on its head.
 *
 * ## Numbers
 *
 * Coordinates go through `coord()` from `stroke.ts` rather than a second copy of
 * it: a symbol has to round exactly like a line or a rect does, and `coord`'s
 * guarantee - plain decimals, never an exponent, never `NaN`, never `Infinity` -
 * is what keeps a degenerate rect from emitting an attribute the browser
 * discards. Nothing here divides by an extent either, so a zero-size rect
 * collapses the geometry onto a point instead of producing arithmetic nobody
 * can draw.
 *
 * `stroke.ts` and `css.ts` (for `LABEL_FONT_FAMILY`) both sit *below* this
 * module and `render.ts` - `stroke.ts` is a leaf, and `css.ts`'s one import is
 * `POPOVER_GAP_PX` from `geometry.ts`, which imports nothing back - so the two
 * things the pin shares with a text label cost no import cycle: `render`
 * imports `symbols`, never the other way round.
 */

import { LABEL_FONT_FAMILY } from "./css";
import { arrowHead, constrainSquare } from "./geometry";
import { MIN_SHAPE_PX } from "./model";
import { coord } from "./stroke";

import type { DrawRect, SymbolShape, Vec2 } from "./model";
import type { NodeSpec } from "./render";

/**
 * Click-to-place size, before any click-drag resize.
 *
 * 32px is roughly a line and a half of body text: big enough that a check or a
 * numbered pin reads at a glance in the exported PDF, small enough that a
 * mis-aimed click does not cover the paragraph it was meant to point at. A
 * click places a `32 x 32` rect; a drag sizes it and, per the note above, can
 * also aim it.
 */
export const DEFAULT_SYMBOL_SIZE_PX: number = 32;

/**
 * The rect a symbol drag describes: signed, so the drag aims it, and a
 * `DEFAULT_SYMBOL_SIZE_PX` square when the pointer never moved.
 *
 * An **addition** to `contracts.md` §7, which listed one constant and
 * `symbolSpec`: the signed-rect seam §7 describes in prose had to become a
 * named, tested function for that prose to be a guarantee rather than a warning.
 *
 * The whole of the symbol tool's click-or-drag decision, in one pure function,
 * and here rather than in the entrypoint because it is eight lines of
 * arithmetic over two points and the entrypoint has no test to hold it in place
 * (`CLAUDE.md`: logic lives in `lib/`, entrypoints stay thin). It answers three
 * questions, and the first two are the ones that were being conflated:
 *
 * - **Was that a click?** One question - *did the pointer move at all* - and so
 *   one radial test, `Math.hypot(dx, dy) < MIN_SHAPE_PX`. Emphatically **not**
 *   `isDegenerate`'s rect test (model.ts), which is per-axis on purpose: a
 *   400x1 *rect* is a drag that never left the line it started on, while a
 *   400x1 *arrow* is a horizontal arrow, which is the commonest aim there is.
 *   Borrowing the per-axis test re-read every deliberate horizontal or vertical
 *   drag as a click and handed back a 32x32 down-right arrow - intermittently,
 *   depending on whether the hand's cross-axis wobble happened to clear 4px.
 *   The threshold is kept rather than testing `from` against `to` so that a 3px
 *   twitch is still a click the mouse moved during, and gets its symbol.
 * - **Which way does it point?** The sign, kept: the extents are `to - from`
 *   and are free to be negative. See "How an arrow is aimed" above -
 *   `normalizeRect` here still renders and still passes, and always points down
 *   and to the right.
 * - **Shift?** `constrainSquare` (geometry.ts) preserves the sign, so it squares
 *   the box without un-aiming it, which on an arrow is a 45-degree snap. A click
 *   has no direction to square up, so Shift held over one is ignored rather than
 *   allowed to turn the default box into something else.
 *
 * The preview and the committed mark are therefore the same call: a symbol
 * shows its click-placed self until the pointer has gone `MIN_SHAPE_PX`, and
 * nothing changes shape at `pointerup`.
 */
export function symbolRect(from: Vec2, to: Vec2, shift: boolean): DrawRect {
  if (Math.hypot(to.x - from.x, to.y - from.y) < MIN_SHAPE_PX) {
    return {
      x: from.x,
      y: from.y,
      width: DEFAULT_SYMBOL_SIZE_PX,
      height: DEFAULT_SYMBOL_SIZE_PX,
    };
  }
  const end = shift ? constrainSquare(from, to) : to;
  return { x: from.x, y: from.y, width: end.x - from.x, height: end.y - from.y };
}

/**
 * The barb length as a fraction of the shaft, and its ceiling in CSS px.
 *
 * Proportional, so a small arrow is not all head and the 32px default gets a
 * ~13px one; capped, because past a couple of hundred pixels a proportional
 * head stops looking like an arrow and starts looking like a paper dart.
 */
const HEAD_SCALE = 0.28;
const HEAD_MAX_PX = 28;

/** The pin's digits, as a multiple of the badge's radius. */
const PIN_FONT_SCALE = 1.2;

/**
 * The badge under a pin's number.
 *
 * White rather than the pen colour, with the ring and the digits in the pen
 * colour: the number has to stay readable over whatever the pin was dropped on,
 * and a dark digit on white beats white on amber (`DRAW_COLORS[1]`) by a long
 * way. `LAYER_CSS` forces `print-color-adjust: exact`, so it prints as it looks.
 */
const PIN_FILL = "#ffffff";

/** A point in the unit square, y down, as the glyph templates are written. */
type UnitPoint = readonly [number, number];

/** A tick. Down to the low corner, then up past it - the long arm is the read. */
const CHECK: readonly UnitPoint[] = [
  [0.1, 0.54],
  [0.4, 0.85],
  [0.9, 0.15],
];

/** Two strokes, inset from the corners so the round caps stay in the box. */
const CROSS: readonly (readonly UnitPoint[])[] = [
  [
    [0.15, 0.15],
    [0.85, 0.85],
  ],
  [
    [0.85, 0.15],
    [0.15, 0.85],
  ],
];

/** The stem of a "!"; the dot below it is a filled circle, not a line cap. */
const BANG_STEM: readonly UnitPoint[] = [
  [0.5, 0.06],
  [0.5, 0.62],
];
const BANG_DOT: UnitPoint = [0.5, 0.88];
const BANG_DOT_R = 0.08;

/** 1/phi^2, the inner radius that makes a pentagram's arms straight. */
const STAR_INNER = 0.382;

/**
 * A five-pointed star: ten vertices, alternating radii, first point straight up.
 *
 * Computed rather than typed out - ten hand-written pairs is ten chances to put
 * one arm 2% off and never notice - and computed once at module load, which
 * costs nothing and keeps the geometry readable.
 */
const STAR: readonly UnitPoint[] = Array.from({ length: 10 }, (_, i): UnitPoint => {
  const radius = 0.5 * (i % 2 === 0 ? 1 : STAR_INNER);
  const angle = (-90 + i * 36) * (Math.PI / 180);
  return [0.5 + Math.cos(angle) * radius, 0.5 + Math.sin(angle) * radius];
});

/**
 * The min corner plus a positive extent.
 *
 * The same job as the private `normalized` in `render.ts`, done here rather
 * than up front in `symbolSpec` because the two arrows *use* the sign to aim
 * themselves (see the note at the top of the file). Normalising is therefore a
 * per-symbol decision, and every symbol but the arrows takes it.
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
 * Unit square -> document coordinates. Multiplication only: a rect with no
 * width collapses the glyph onto a vertical line, where dividing by an extent
 * would hand back `Infinity` and draw nothing at all.
 */
function scaleInto(rect: DrawRect): (point: UnitPoint) => Vec2 {
  const box = positiveBox(rect);
  return ([ux, uy]) => ({ x: box.x + ux * box.width, y: box.y + uy * box.height });
}

/** A polyline -> a path `d`. `closed` adds the `Z` (the star, and only it). */
function polyline(points: readonly Vec2[], closed: boolean = false): string {
  if (points.length === 0) return "";
  const parts = points.map((p, i) => `${i === 0 ? "M" : "L"} ${coord(p.x)} ${coord(p.y)}`);
  if (closed) parts.push("Z");
  return parts.join(" ");
}

/** One or more unit-space subpaths, scaled into the rect, as a single `d`. */
function templatePath(
  rect: DrawRect,
  subpaths: readonly (readonly UnitPoint[])[],
  closed: boolean = false,
): string {
  const to = scaleInto(rect);
  return subpaths.map((points) => polyline(points.map(to), closed)).join(" ");
}

/**
 * How long the barbs are for this shaft.
 *
 * A shaft of no length has no head - the barbs collapse onto the tip and paint
 * nothing, which is the honest answer for a rect `isDegenerate` would have
 * thrown away anyway. The finite guard is because `Math.hypot` propagates an
 * infinite extent, and `Infinity * 0.28` is not a length.
 */
function headSize(from: Vec2, to: Vec2): number {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (!Number.isFinite(length)) return 0;
  return Math.min(length * HEAD_SCALE, HEAD_MAX_PX);
}

/** `barb -> tip -> barb`, as its own subpath, so the head is never filled shut. */
function headPath(from: Vec2, to: Vec2, size: number): string {
  const [left, right] = arrowHead(from, to, size);
  return polyline([left, to, right]);
}

/**
 * Shaft plus one head, or plus two for `arrow-double`.
 *
 * One `path` rather than one per subpath: an arrow is a single mark, and
 * `stroke-linejoin: round` on the group is what keeps the barbs from growing
 * spikes where they meet the tip.
 */
function arrowPath(rect: DrawRect, double: boolean): string {
  // The signed diagonal - the whole of the aiming decision. See the file note.
  const tail: Vec2 = { x: rect.x, y: rect.y };
  const tip: Vec2 = { x: rect.x + rect.width, y: rect.y + rect.height };
  const size = headSize(tail, tip);

  const parts = [polyline([tail, tip]), headPath(tail, tip, size)];
  if (double) parts.push(headPath(tip, tail, size));
  return parts.filter((part) => part !== "").join(" ");
}

/**
 * The badge and its number.
 *
 * The number is a real `<text>` node carrying `textContent`, not a drawn glyph:
 * a pin is the mark that most wants to be findable, and `CLAUDE.md`'s one check
 * that matters - export, Ctrl+F, find it - has to hold for "3" as much as for a
 * label. `stroke: none` on it because the group strokes, and outlined digits at
 * an 8px pen are a smudge.
 *
 * A circle inscribed in the box rather than an ellipse filling it: a pin is a
 * badge, and a drag that happened to be 3:1 should not deliver a lozenge with a
 * squashed number in it.
 */
function pinChildren(shape: SymbolShape): NodeSpec[] {
  const box = positiveBox(shape.rect);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const radius = Math.min(box.width, box.height) / 2;

  return [
    {
      tag: "circle",
      attrs: { cx: coord(cx), cy: coord(cy), r: coord(radius), fill: PIN_FILL },
    },
    {
      tag: "text",
      attrs: {
        x: coord(cx),
        y: coord(cy),
        fill: shape.color,
        stroke: "none",
        "font-size": coord(radius * PIN_FONT_SCALE),
        "font-family": LABEL_FONT_FAMILY,
        // Centred both ways, which is what makes the digit sit in the badge
        // rather than hanging off its baseline at the middle of the disc.
        "text-anchor": "middle",
        "dominant-baseline": "central",
      },
      // `?? 1` and not `|| 1`: an index of 0 would be a bug upstream
      // (`nextPinIndex` starts at 1), and printing "0" says so out loud.
      text: String(shape.index ?? 1),
    },
  ];
}

/** The geometry, minus everything the group already says. */
function symbolChildren(shape: SymbolShape): NodeSpec[] {
  switch (shape.symbol) {
    case "arrow":
      return [{ tag: "path", attrs: { d: arrowPath(shape.rect, false) } }];

    case "arrow-double":
      return [{ tag: "path", attrs: { d: arrowPath(shape.rect, true) } }];

    case "check":
      return [{ tag: "path", attrs: { d: templatePath(shape.rect, [CHECK]) } }];

    case "cross":
      return [{ tag: "path", attrs: { d: templatePath(shape.rect, CROSS) } }];

    case "bang": {
      const to = scaleInto(shape.rect);
      const box = positiveBox(shape.rect);
      const dot = to(BANG_DOT);
      return [
        { tag: "path", attrs: { d: templatePath(shape.rect, [BANG_STEM]) } },
        {
          tag: "circle",
          attrs: {
            cx: coord(dot.x),
            cy: coord(dot.y),
            // Off the shorter axis, so the dot stays a dot in a tall or wide box.
            r: coord(Math.min(box.width, box.height) * BANG_DOT_R),
            // A dot is solid or it is not a dot.
            fill: shape.color,
            stroke: "none",
          },
        },
      ];
    }

    case "star":
      return [{ tag: "path", attrs: { d: templatePath(shape.rect, [STAR], true) } }];

    case "pin":
      return pinChildren(shape);

    default:
      return unsupported(shape.symbol);
  }
}

/**
 * A `<g>` holding the symbol's own geometry, scaled into `shape.rect`.
 *
 * The group carries the paint - colour, width, joins - and the children carry
 * nothing but geometry, so a symbol is one place to look when a mark comes out
 * the wrong colour. `fill: none` on the group for the same reason every other
 * outlined kind sets it: a page shipping `svg { fill: currentColor }` must not
 * be able to flood a check mark into a blob (and the two children that *are*
 * filled - the badge and the "!" dot - say so themselves).
 */
export function symbolSpec(shape: SymbolShape): NodeSpec {
  return {
    tag: "g",
    attrs: {
      id: shape.id,
      fill: "none",
      stroke: shape.color,
      "stroke-width": coord(shape.width),
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    },
    children: symbolChildren(shape),
  };
}

/**
 * Unreachable while the `switch` above names every `SymbolKind`, which is the
 * point: add an eighth symbol and this stops compiling.
 */
function unsupported(symbol: never): never {
  throw new Error(`symbolSpec: unsupported symbol ${String(symbol)}`);
}
