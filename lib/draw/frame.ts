/**
 * The editor frame's geometry: where the eight handles are, which one a press
 * hit, and what moving or resizing does to the box.
 *
 * Pure module, and a leaf: types only, from ./model. No DOM - task 22's
 * `frameSpec` (lib/draw/layer.ts) draws what this module measures, and
 * `entrypoints/annotate.ts`'s `frameDrag` state feeds it pointer deltas. Both
 * are glue; all four functions below can be read and tested without a document
 * (`CLAUDE.md`).
 *
 * Written against any `DrawRect` rather than against `TextShape`, deliberately:
 * `.plan/design.md` §11.2 defers select/move-a-committed-mark to phase 3, and
 * phase 3 wants exactly these four functions over exactly this argument. Shaped
 * for the one caller it has today, it would be written twice.
 *
 * Coordinates are **document** coordinates in CSS px, like every other number
 * in lib/draw/ (lib/draw/model.ts) - and so are the deltas, which is why
 * `moveFrame` and `resizeFrame` take a `Vec2` of movement rather than a pointer
 * position: the caller has already converted through `toDocument`.
 *
 * Covered by tests/draw-frame.test.ts.
 */

import type { DrawRect, Vec2 } from "./model";

/** Which part of the frame a press landed on. */
export type FrameZone =
  | "move"
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw";

/**
 * The side of a square handle, in CSS px.
 *
 * 10px is a hit target you can find with a mouse without hunting for a pixel.
 *
 * The handles are *centred* on the corners and edge midpoints, not inset into
 * the box (`frameHandles`), so half of each hangs outside it. That is what makes
 * a one-line label grabbable: the 4px of frame either side of a 20px-tall box
 * would otherwise be the whole target. It is also what sets the ceiling on this
 * number, and the arithmetic is the centred one, not the inset one. Writing `H`
 * for this constant, then, straight off `frameHandles`, with the box's origin as
 * 0 and along an axis of extent `E`:
 *
 * - the leading corner handle spans `-H/2 .. +H/2`,
 * - the midpoint handle `E/2 - H/2 .. E/2 + H/2`,
 * - the trailing corner handle `E - H/2 .. E + H/2`.
 *
 * A corner and its neighbouring midpoint handle therefore meet when
 * `H/2 >= E/2 - H/2`, i.e. at **`H >= E/2`** - half the edge. (Inset handles,
 * spanning `0..H` and `E-H..E`, would meet at `H >= E/3` instead: 13.3px on a
 * 40px edge, which is where an earlier "past 13" here came from. They are not
 * the layout this module implements.) The smallest box a drag can reach is
 * `MIN_TEXT_WIDTH_PX` x `MIN_TEXT_HEIGHT_PX` = 40x20, so the **height** axis
 * binds first: 10 there, against 20 on the width axis.
 *
 * Which means the shipped H = 10 is exactly at that threshold, and not below it.
 * On a 20px-tall box `nw` spans y `[-5, 5]` and `w` spans y `[5, 15]`: they
 * **abut**, and `contains` includes its edges, so a press at y = 5 is inside
 * both. "Corners beat edges" (`FRAME_RESIZE_ZONES`, `frameZoneAt`) is
 * load-bearing at today's constant, not only past some larger one. On the width
 * axis there is still room to spare: `nw` `[-5, 5]`, `n` `[15, 25]`, `ne`
 * `[35, 45]`.
 *
 * Grow it and what shrinks is the midpoint handle's *reachable* span on the
 * height axis - its own `H`, less whatever the two corners occlude, which is
 * `min(H, 20 - H)`: the full `H` up to 10, then `20 - H` (6px at H = 14), and
 * nothing at **H = 20**, where the corners alone (`[-10, 10]` and `[10, 30]`)
 * cover the whole 20px edge and `w`/`e` cannot be pressed on a minimum-height
 * box at all. 20 is the number to weigh against, not 13.
 */
export const FRAME_HANDLE_PX: number = 10;

/**
 * The smallest a text box may be dragged, in CSS px.
 *
 * Not a limit on the *rendered* label - `layoutText` (lib/draw/wrap.ts) grows
 * the height past this whenever the text needs it. It is a limit on what a drag
 * may ask for, and it exists twice over:
 *
 * - a box narrower than one word wraps that word character by character
 *   (`.plan/design.md` §16.6): deliberate, and better than a URL running off
 *   the side of the page, but 40px keeps it from getting silly. At the default
 *   16px label that is two or three characters, so "OK" in a 40px box is still
 *   a box somebody could have meant.
 * - a box dragged to nothing cannot be dragged back. Every handle collapses
 *   onto the same point, so there is no edge left to grab and no interior left
 *   to press for `"move"`. 20px of height is about one line of the default
 *   label, which is the smallest box that is still a text box.
 */
export const MIN_TEXT_WIDTH_PX: number = 40;
export const MIN_TEXT_HEIGHT_PX: number = 20;

/**
 * Which edges each zone owns, as a sign per axis.
 *
 * -1 is the leading edge (west, north), +1 the trailing one (east, south), and
 * 0 is "this axis does not move". One table with three readers - `frameHandles`
 * centres a handle where it points, `resizeFrame` moves the edges it names, and
 * `FRAME_RESIZE_ZONES` is its keys minus `"move"` - which is the point: the
 * transposed sign this module is most likely to grow lives in exactly one
 * place, spelled out, instead of once per function.
 *
 * A `Record<FrameZone, …>`, so a ninth zone fails `pnpm compile` until somebody
 * says which edges it moves. The literal `EdgeSign` union does the same for a
 * typo: `{ x: 2 }` is not a direction.
 */
type EdgeSign = -1 | 0 | 1;

const ZONE_EDGES: Record<FrameZone, { x: EdgeSign; y: EdgeSign }> = {
  move: { x: 0, y: 0 },
  nw: { x: -1, y: -1 },
  ne: { x: 1, y: -1 },
  se: { x: 1, y: 1 },
  sw: { x: -1, y: 1 },
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
};

/**
 * The eight resize zones, in a stable order. `"move"` is not one of them.
 *
 * **The order is load-bearing, and it is corners first.** `frameZoneAt` returns
 * the first handle a press is inside, so this array is where "corners beat
 * edges" is decided - reorder it and the hit test changes. Clockwise from the
 * north-west within each group, which is also the order `frameSpec` appends the
 * handle elements in, so the DOM reads the way the box does.
 */
export const FRAME_RESIZE_ZONES: readonly FrameZone[] = [
  "nw",
  "ne",
  "se",
  "sw",
  "n",
  "e",
  "s",
  "w",
];

/**
 * A rect with both extents positive, the box unmoved.
 *
 * The same four lines as `positiveBox` in lib/draw/layer.ts, and not imported
 * from it: this module imports types only, and that one is private to the
 * module that mounts the DOM. Duplicating four lines is the cheaper of the two,
 * and `normalizeRect` in geometry.ts is not it either - that takes two points,
 * not a rect.
 */
function positiveBox(rect: DrawRect): DrawRect {
  return {
    x: Math.min(rect.x, rect.x + rect.width),
    y: Math.min(rect.y, rect.y + rect.height),
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

/** Is `at` within `box`, edges included? A press on a border is on the thing. */
function contains(box: DrawRect, at: Vec2): boolean {
  return (
    at.x >= box.x &&
    at.x <= box.x + box.width &&
    at.y >= box.y &&
    at.y <= box.y + box.height
  );
}

/**
 * The eight handle rects, centred on the corners and edge midpoints of `rect`.
 *
 * Exported because it has **two readers** - `frameZoneAt` for the hit test and
 * `frameSpec` (lib/draw/layer.ts) for the DOM - and they must agree: the handle
 * you can see is the handle you can grab. One function, one answer.
 *
 * `rect` is normalised first, so a negative extent cannot put a handle on the
 * wrong side.
 */
export function frameHandles(rect: DrawRect): readonly { zone: FrameZone; rect: DrawRect }[] {
  const box = positiveBox(rect);
  const half = FRAME_HANDLE_PX / 2;

  return FRAME_RESIZE_ZONES.map((zone) => {
    const edges = ZONE_EDGES[zone];
    // A sign of -1 puts the centre on the leading edge, +1 on the trailing one
    // and 0 at the midpoint - which is `(1 + sign) / 2` of the extent.
    const cx = box.x + ((1 + edges.x) * box.width) / 2;
    const cy = box.y + ((1 + edges.y) * box.height) / 2;
    return {
      zone,
      rect: { x: cx - half, y: cy - half, width: FRAME_HANDLE_PX, height: FRAME_HANDLE_PX },
    };
  });
}

/**
 * Which zone `at` is in, or `null` for outside the frame entirely.
 *
 * Corners beat edges, so the 10px square where a corner and an edge handle
 * overlap resizes both axes - which is what a corner is for. Anything inside
 * the box and on no handle is `"move"`, including the box's interior: a press
 * on the label you are typing moves it, it does not commit it.
 */
export function frameZoneAt(rect: DrawRect, at: Vec2): FrameZone | null {
  const box = positiveBox(rect);

  // First hit wins, and `FRAME_RESIZE_ZONES` is ordered corners first - see the
  // note there. Eight inclusion tests per pointerdown, not per pointermove.
  for (const handle of frameHandles(box)) {
    if (contains(handle.rect, at)) return handle.zone;
  }

  return contains(box, at) ? "move" : null;
}

/** `rect` translated by `delta`. No clamping - the layer clips. */
export function moveFrame(rect: DrawRect, delta: Vec2): DrawRect {
  // Extents pass through untouched rather than normalised: this function moves
  // a box and does nothing else, and a caller that handed in a negative extent
  // gets its own box back where it put it.
  return { x: rect.x + delta.x, y: rect.y + delta.y, width: rect.width, height: rect.height };
}

/**
 * A minimum that a box can be dragged back off.
 *
 * `resizeFrame` promises a positive `width` and `height` for every input, so a
 * `min` of 0, a negative one or a NaN one cannot be honoured as given - and
 * honouring it would produce the box with no grabbable edge that
 * `MIN_TEXT_WIDTH_PX` exists to prevent. The module's own minimum stands in.
 */
function floorOf(value: number, fallback: number): number {
  return value > 0 ? value : fallback;
}

/**
 * `rect` with the edges `zone` names moved by `delta`.
 *
 * Clamped by **pinning the opposite edge**: dragging the west handle east past
 * `min.width` stops with the east edge where it was, rather than flipping the
 * box inside out and leaving the handles mirrored. `"move"` is a no-op here -
 * `moveFrame` is its function - so a caller that forgets to branch moves
 * nothing instead of resizing by a whole diagonal.
 *
 * For every resize zone the returned rect has `width >= min.width` and
 * `height >= min.height`, both positive.
 *
 * Not for `"move"`, and contracts.md §21 is self-inconsistent about that: it
 * exempts `"move"` as a no-op in one sentence and then states the minimums for
 * every input in the next. The no-op wins here - a zone that changes nothing
 * cannot also normalise and grow the box it was handed - and
 * tests/draw-frame.test.ts pins that reading, including for a rect with negative
 * extents. Do not "fix" it back to the blanket wording.
 */
export function resizeFrame(
  rect: DrawRect,
  zone: FrameZone,
  delta: Vec2,
  min: { width: number; height: number },
): DrawRect {
  // Ahead of the normalisation on purpose: "no-op" means the same numbers back,
  // not a tidied version of them.
  //
  // A copy, not `rect` itself. Every other path here returns a fresh object, and
  // a caller that mutated this one would be mutating the editor's own rect -
  // "unchanged" should not mean "aliased".
  if (zone === "move") return { ...rect };

  const box = positiveBox(rect);
  const edges = ZONE_EDGES[zone];
  const minWidth = floorOf(min.width, MIN_TEXT_WIDTH_PX);
  const minHeight = floorOf(min.height, MIN_TEXT_HEIGHT_PX);

  // Edges rather than x/width: an offset and an extent make the leading-edge
  // case two arithmetic steps that have to agree (`x += d; width -= d`), which
  // is where a sign gets transposed. A pair of edges makes each case one step,
  // and the clamp below one comparison.
  const span = (
    lead: number,
    trail: number,
    sign: EdgeSign,
    move: number,
    floor: number,
  ): [number, number] => {
    if (sign < 0) {
      // The trailing edge is the pin: the leading one may not pass it, less the
      // minimum.
      return [Math.min(lead + move, trail - floor), trail];
    }
    // A sign of 0 moves nothing on this axis and is clamped all the same,
    // because the postcondition is unconditional: a box handed in already under
    // the minimum comes back at the minimum, growing away from the leading edge,
    // rather than passing an axis through untouched.
    //
    // That is not only a defensive case: a box opens at `fontSize *
    // TEXT_LINE_HEIGHT` tall, and the bar's smallest font size is 12
    // (`FONT_SIZES`, lib/draw/bar.ts) against a line height of 1.4
    // (lib/draw/wrap.ts), so a 12px label starts 16.8px tall - under
    // `MIN_TEXT_HEIGHT_PX`. The first `e` or `w` drag on one snaps its height to
    // 20 without having named the y axis. A one-time 3.2px correction on the
    // smallest of the five sizes, and the alternative is a box that keeps a
    // height no drag could have asked for.
    return [lead, Math.max(trail + (sign > 0 ? move : 0), lead + floor)];
  };

  const [left, right] = span(box.x, box.x + box.width, edges.x, delta.x, minWidth);
  const [top, bottom] = span(box.y, box.y + box.height, edges.y, delta.y, minHeight);

  return { x: left, y: top, width: right - left, height: bottom - top };
}
