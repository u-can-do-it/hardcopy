/**
 * The pen: pointer samples -> one SVG path `d`.
 *
 * `perfect-freehand` turns a list of samples into a **closed outline polygon**
 * whose width varies with pressure and speed; we turn that polygon into a `d`
 * that renders as a *filled* path with `stroke: none` (contracts §6). That is
 * why the pencil looks like a pen rather than like a 4px pipe, and why the
 * mark arrives in the PDF as vector geometry instead of a bitmap.
 *
 * Only `strokePath` touches the library. `outlineToPath` and `dotPath` are
 * dependency-free on purpose: they are where the string formatting lives -
 * precision, closure, no exponent notation - and that is the half worth
 * testing. perfect-freehand's own numbers are its business, and pinning them
 * in a test would turn it into a change-detector on the next patch bump.
 *
 * No DOM and no chrome.* here. Covered by tests/draw-stroke.test.ts.
 */

import { getStroke } from "perfect-freehand";

import type { StrokePoint, Vec2 } from "./model";

/**
 * perfect-freehand tuning. Measured by eye; change together with a look at a
 * real pen.
 *
 * `size` is not here - it is the selected `StrokeWidth` and arrives per call.
 *
 * - `smoothing` 0.5 is the library default: it softens the outline's edges
 *   without rounding off the deliberate corner in a mark drawn *around* a
 *   word, which is most of what this pen is used for.
 * - `thinning` 0.4 sits under the 0.5 default because the taper is relative to
 *   the pen: at 0.5 the thin end of the 2px pen is a 0.5px sliver that prints
 *   faint and reads as a rendering fault. 0.4 keeps the 2px pen between 0.6
 *   and 1.4px - still visibly a pen stroke, still visible.
 * - `streamline` 0.4, likewise under the default: streamlining pulls each
 *   sample toward the last one, so it takes mouse jitter out but also makes
 *   the stroke lag the cursor and stop short of where the pointer stopped.
 *   Someone underlining a phrase notices the short end more than the jitter.
 *
 * Everything else is left at the library's default, deliberately - including
 * `simulatePressure`, which stays on because `StrokePoint.pressure` is a flat
 * 0.5 for a mouse (`model.ts`) and velocity is the only pressure signal a
 * mouse has.
 */
export const STROKE_OPTIONS: {
  smoothing: number;
  thinning: number;
  streamline: number;
} = {
  smoothing: 0.5,
  thinning: 0.4,
  streamline: 0.4,
};

/**
 * Decimals kept in a path `d`. Two is invisible and keeps the string short.
 *
 * It is not only tidiness: perfect-freehand returns full doubles, and a stroke
 * is hundreds of points. Left alone, one mark is a few thousand
 * 17-significant-digit numbers embedded in the exported PDF, for a difference
 * of a hundredth of a CSS pixel.
 */
export const PATH_PRECISION: number = 2;

/**
 * One coordinate, as it appears in a `d` or in an SVG attribute.
 *
 * **Shared on purpose, and exported from here rather than from a renderer.**
 * `lib/draw/render.ts` and `lib/draw/symbols.ts` both need this exact rounding:
 * a symbol's coordinates have to round like a line's, or two identical drags
 * produce two different strings and a click-placed arrow lands a hundredth of a
 * pixel off the rect it was scaled into. `stroke.ts` is the leaf both of those
 * modules already sit above, so one export here is one copy and no import
 * cycle - where exporting it from `render.ts` (which imports `symbols.ts` for
 * the `symbol` case) would have made `render` -> `symbols` -> `render`.
 *
 * `toFixed` rather than `String`: `String(0.0000004)` is `"4e-7"`, and the SVG
 * path grammar has no exponent notation for path data - a single such number
 * makes the browser discard the rest of the `d` from that point on, so a
 * stroke that happened to land near the document origin would come out
 * truncated. Trailing zeros are then stripped because `"10.00"` costs three
 * bytes more than `"10"` on every coordinate of every mark.
 *
 * The guarantee is categorical: what comes back is always plain decimal
 * digits, at most `PATH_PRECISION` of them after the point. A number that
 * cannot be written that way becomes `0` rather than the string `"NaN"` or an
 * exponent, for the reason above - it keeps a bad number from taking the whole
 * path with it. Three ways in, all of them closed:
 *
 * - Non-finite, *including a finite input that only becomes non-finite here*:
 *   `value * 100` overflows to `Infinity` around 1.8e306, so the guard tests
 *   the rounded value and not only the input.
 * - At or above 1e21, where `toFixed` itself switches to exponent notation
 *   (`(5e22).toFixed(2)` is `"5e+22"`) - the one thing this function exists to
 *   prevent. No page has a coordinate out there, so it degrades like any other
 *   bad number rather than expanding to a 300-digit integer. The magnitude is
 *   tested on *both* sides of the rounding, because the round trip does not
 *   preserve it: `Math.round(1e21 * 100) / 100` is `999999999999999868928`, a
 *   hair below 1e21, so a guard on the rounded value alone would let exactly
 *   that one double through as a 21-digit integer.
 * - `-0`, which would otherwise print as `"-0"`.
 *
 * The zero strip works on the decimals alone, and so cannot reach an exponent
 * even if one ever got this far: `"1e+300".replace(/\.?0+$/, "")` is `"1e+3"`,
 * a silently wrong number 297 orders of magnitude off rather than a visibly
 * broken one.
 */
export function coord(value: number): string {
  const scale = 10 ** PATH_PRECISION;
  if (Math.abs(value) >= 1e21) return "0";
  const rounded = Math.round(value * scale) / scale;
  if (!Number.isFinite(rounded) || Math.abs(rounded) >= 1e21) return "0";
  // Catches -0, which would otherwise print as "-0".
  if (rounded === 0) return "0";
  const [whole, decimals = ""] = rounded.toFixed(PATH_PRECISION).split(".");
  const kept = decimals.replace(/0+$/, "");
  return kept === "" ? whole : `${whole}.${kept}`;
}

/**
 * A closed polygon -> one `d`. Empty outline -> `""`.
 *
 * Straight segments, not the quadratic-midpoint variant from
 * perfect-freehand's README: `smoothing` has already curved this outline, the
 * points come back dense, and Q doubles the number of coordinates in the
 * exported file for a difference that is under the 0.01px this rounds to.
 */
export function outlineToPath(outline: readonly Vec2[]): string {
  if (outline.length === 0) return "";
  const parts: string[] = [];
  for (const [index, point] of outline.entries()) {
    parts.push(`${index === 0 ? "M" : "L"} ${coord(point.x)} ${coord(point.y)}`);
  }
  // Closed: the outline surrounds the stroke, and this path is filled.
  parts.push("Z");
  return parts.join(" ");
}

/**
 * A single tap: a filled circle, as a `d`, so one code path renders every
 * stroke.
 *
 * Two absolute half-arcs rather than a `<circle>` element, because the
 * renderer emits exactly one `path` for a stroke shape (contracts §6) - a tap
 * and a scribble must not need two branches downstream.
 *
 * A radius that would paint nothing gets no path at all: a zero-radius arc is
 * a degenerate command that different renderers disagree about. That is judged
 * on what is *emitted*, not on what came in - a positive, finite radius under
 * half of 10^-`PATH_PRECISION` rounds to `"0"` on its way into the `d`, and a
 * radius that is real but vanishes against the coordinate it sits on leaves
 * both anchor points on one spot. Both are the same degenerate arc.
 *
 * Unreachable from `strokePath`, where `StrokeWidth` >= 2 puts the radius at 1
 * or above; this is the function's own contract.
 */
export function dotPath(at: Vec2, radius: number): string {
  if (!Number.isFinite(radius) || radius <= 0) return "";
  const left = coord(at.x - radius);
  const right = coord(at.x + radius);
  const y = coord(at.y);
  const r = coord(radius);
  if (r === "0" || left === right) return "";
  return `M ${left} ${y} A ${r} ${r} 0 1 0 ${right} ${y} A ${r} ${r} 0 1 0 ${left} ${y} Z`;
}

/** Did the pointer never actually move? Exact, because a tap is exact. */
function isOneSpot(points: readonly StrokePoint[], at: Vec2): boolean {
  return points.every((p) => p.x === at.x && p.y === at.y);
}

/**
 * Pointer samples -> the `d` of a variable-width outline. One sample (or all
 * samples at one spot) returns `dotPath`.
 *
 * The one-spot case is not just a shortcut: the two deliveries a tap can
 * produce are different shapes, and neither is the circle the user meant.
 * Measured against 1.2.3 with `STROKE_OPTIONS`, `size: 4`, sample at (50, 60):
 *
 * - Three identical samples are a *stroke of zero length*: 13 points, every
 *   one at radius exactly 1.84 from the sample, 27.7 degrees apart. Regular
 *   and centred, but 8% narrower than the 2 the pen asked for - `thinning`
 *   applies to a stroke that never moved too.
 * - One sample is a stroke with a *cap*: 44 points, radius wandering from 1.13
 *   to 2.97, and centred at (50.23, 60.23) rather than on the sample, because
 *   `getStrokePoints` appends a second point at +[1, 1] when handed only one
 *   (streamlined to +0.66 by the time it reaches the outline).
 *
 * Rather than depend on which of the two the browser happened to deliver, both
 * draw the same circle, at the radius the pen was actually set to.
 */
export function strokePath(points: readonly StrokePoint[], width: number): string {
  if (points.length === 0) return "";
  const first = points[0];
  if (isOneSpot(points, first)) return dotPath(first, width / 2);

  // `size` is the diameter, which is exactly what `StrokeWidth` means. The
  // copy is so the library cannot write back into the live sample list.
  const outline = getStroke([...points], { size: width, ...STROKE_OPTIONS });
  // perfect-freehand speaks in `[x, y]` tuples; `outlineToPath` speaks the
  // `Vec2` the rest of lib/draw uses, and stays free of the dependency.
  return outlineToPath(outline.map(([x, y]) => ({ x, y })));
}
