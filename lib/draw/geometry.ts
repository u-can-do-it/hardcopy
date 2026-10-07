/**
 * Every spatial question the drawing tool asks, answered in one place.
 *
 * The pointer state machine (entrypoints/annotate.ts) and the bar
 * (lib/draw/bar.ts) are glue: they read events and set attributes. All the
 * arithmetic between the two - viewport to document, the shift constraints,
 * arrowhead barbs, where the bar is allowed to sit - lives here so it can be
 * read and tested without a document in sight.
 *
 * Pure module: no DOM, no chrome.*, and nothing that measures. That last part
 * is why `anchorCorrection` takes already-measured numbers rather than an
 * element - a `getBoundingClientRect()` in here would be a forced reflow
 * hiding inside a function nobody expects to touch the layout, called from a
 * pointermove handler.
 *
 * Coordinates are CSS px, and are *document* coordinates - the origin is the
 * top of the page, not the top of the viewport (lib/draw/model.ts) - except
 * where a parameter is named `client` or `viewport`.
 *
 * Covered by tests/draw-geometry.test.ts.
 */

import type { DrawRect, Vec2 } from "./model";

/** Radians in one degree. The two angle functions below are the only users. */
const DEG = Math.PI / 180;

/**
 * Shift snaps a line to this many degrees.
 *
 * 15deg puts 24 stops around the circle, which covers the four axes and both
 * diagonals - the angles anyone holds shift *for* - while keeping every stop
 * within 7.5deg of wherever the pointer actually was, so a snap never looks
 * like the line went somewhere the user did not aim.
 */
export const SNAP_STEP_DEG: number = 15;

/**
 * How close the bar may sit to a viewport edge.
 *
 * Enough that the bar reads as floating over the page rather than welded to
 * the window, and enough of a grip left showing to drag it back after a drag
 * that ended somewhere silly.
 */
export const BAR_MARGIN_PX: number = 8;

/**
 * Viewport -> document, with the *current* scroll. Called per pointer event.
 *
 * Per event, and with the scroll read at that moment, is the whole reason a
 * stroke can run past the fold: unlike entrypoints/select-area.ts, which
 * blocks the wheel for the duration of a drag, drawing lets the page scroll
 * mid-stroke and every sample still lands where the pointer was
 * (.plan/design.md §4.5).
 */
export function toDocument(client: Vec2, scroll: Vec2): Vec2 {
  return { x: client.x + scroll.x, y: client.y + scroll.y };
}

/**
 * What `left`/`top` put an appended host at document (0, 0).
 *
 * `position: absolute` resolves against the nearest positioned ancestor, and a
 * page is free to put `position: relative` plus a margin or a border on `html`.
 * So the host is appended at 0,0, measured once, and corrected by this - one
 * forced reflow at mount, exact afterwards.
 *
 * @param hostRect - the host's own `getBoundingClientRect()` x/y
 * @param scroll   - `{ x: scrollX, y: scrollY }` at the time of measurement
 */
export function anchorCorrection(hostRect: Vec2, scroll: Vec2): Vec2 {
  // Where the host actually landed, in document coordinates, and then the
  // offset that moves it back to the origin.
  const at = toDocument(hostRect, scroll);
  // `0 - v` rather than `-v`: negating zero gives `-0`, which survives into a
  // `left: -0px` and compares unequal to 0 under `Object.is`. A host that
  // needs no correction should say so with a plain zero.
  return { x: 0 - at.x, y: 0 - at.y };
}

/**
 * Normalise a drag in any direction. No rounding.
 *
 * The deliberate opposite of `rectFromPoints` in lib/capture/plan.ts, which
 * rounds *outwards*: that rectangle becomes a `Page.captureScreenshot` clip,
 * where half a pixel of slack is the difference between including the edge of
 * the content and shaving it off. This one becomes SVG attributes, which take
 * fractions happily, and rounding it would nudge a mark off whatever it was
 * drawn around - visible immediately on a highlighter over a line of text.
 *
 * **Not for a symbol drag.** Positive extents throw the drag's direction away,
 * and `symbolSpec` (lib/draw/symbols.ts) aims an arrow along the rect's
 * *signed* diagonal - so a symbol normalised through here still renders, still
 * passes every test, and silently always points down and to the right. Store a
 * symbol's drag as
 * `{ x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y }`
 * instead; see "How an arrow is aimed" at the top of symbols.ts. Every other
 * kind wants this function.
 */
export function normalizeRect(a: Vec2, b: Vec2): DrawRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * Shift on a rect/ellipse: the corner that makes it square, sign preserved.
 *
 * Sized by the *longer* of the two drags, so the square always reaches the
 * pointer in whichever axis moved furthest. Sizing by the shorter one instead
 * leaves the shape shrinking away from the cursor on a mostly-horizontal drag,
 * which reads as the tool having stopped following the hand.
 *
 * A drag with no movement in one axis still gets a square: the sign of zero is
 * taken as positive, so shift-dragging straight down builds the square down
 * and to the right rather than returning a zero-width rect that `isDegenerate`
 * would throw away as a stray click.
 */
export function constrainSquare(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: from.x + (dx < 0 ? -size : size),
    y: from.y + (dy < 0 ? -size : size),
  };
}

/**
 * Shift on a line: the end point snapped to the nearest `step` degrees, length
 * kept.
 *
 * Rotating about `from` and keeping the length means shift straightens a line
 * without also resizing it - press it and release it mid-drag and the line
 * pivots in place instead of growing.
 */
export function snapAngle(from: Vec2, to: Vec2, step: number = SNAP_STEP_DEG): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);

  // A drag that has not moved has no angle to snap - `atan2(0, 0)` is 0, so
  // without this the line would jump to horizontal on pointerdown. A step of 0
  // (or a NaN one) would divide into infinity and hand back NaN coordinates,
  // which SVG draws as nothing at all; leaving `to` alone is the honest answer
  // to both.
  if (length === 0 || !(step > 0)) return to;

  const stepRad = step * DEG;
  const angle = Math.round(Math.atan2(dy, dx) / stepRad) * stepRad;
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}

/**
 * How far each barb is swept back off the shaft.
 *
 * 30deg either side is the 60deg included angle of a hand-drawn arrowhead:
 * wide enough to read as an arrow at a 2px stroke, narrow enough that the head
 * does not look like a triangle parked on the end of a line.
 */
const BARB_DEG = 30;

/**
 * The two barb points of an arrowhead at `to`, coming from `from`.
 *
 * Both are exactly `size` from the tip and mirrored about the shaft, so the
 * head stays symmetric at any angle and the renderer can draw it as one
 * `barb -> tip -> barb` polyline. The pair is symmetric, so the order only
 * matters for keeping that path stable between renders.
 *
 * A line of no length has no direction: `atan2(0, 0)` is 0, so the head opens
 * to the right. Such a line is degenerate anyway (`isDegenerate`, model.ts)
 * and never reaches the layer - this just keeps the numbers finite.
 */
export function arrowHead(from: Vec2, to: Vec2, size: number): [Vec2, Vec2] {
  // Back along the shaft first, then swept out to either side of it.
  const back = Math.atan2(from.y - to.y, from.x - to.x);
  const barb = (side: number): Vec2 => ({
    x: to.x + Math.cos(back + side * BARB_DEG * DEG) * size,
    y: to.y + Math.sin(back + side * BARB_DEG * DEG) * size,
  });
  return [barb(-1), barb(1)];
}

/**
 * Keep the bar on screen - on drag, and again on window resize.
 *
 * `margin` is respected on all four edges, and when they disagree the near
 * edge wins: a bar wider or taller than the viewport is pinned to `margin`
 * rather than handed a negative position. A bar hanging off the right is still
 * draggable; a bar off the left has taken its own grip with it. Not
 * hypothetical either - the bar carries every tool group, and a narrow window
 * or a page at 200% zoom gets there.
 */
export function clampToViewport(
  pos: Vec2,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin: number = BAR_MARGIN_PX,
): Vec2 {
  const axis = (at: number, extent: number, within: number): number =>
    Math.min(Math.max(at, margin), Math.max(within - extent - margin, margin));

  return {
    x: axis(pos.x, size.width, viewport.width),
    y: axis(pos.y, size.height, viewport.height),
  };
}

/**
 * The gap between the bar and whatever hangs off it - a popover panel, the note.
 *
 * Interpolated into `BAR_CSS`'s offsets *and* counted by `dropSide` below, so
 * the arithmetic deciding which side there is room on cannot drift from the
 * offset the stylesheet actually applies.
 *
 * An **addition** to `contracts.md` §4, which fixed this module at two
 * constants and seven functions and named no popover at all - the panels that
 * hang off the bar are themselves an addition to §11.
 */
export const POPOVER_GAP_PX: number = 6;

/**
 * Which side of the bar a panel or the note hangs on. An **addition** to
 * `contracts.md` §4, and the value `data-place` is written from in bar.ts, so
 * the two attribute strings `BAR_CSS` matches on have one declaration.
 */
export type DropSide = "below" | "above";

/**
 * Which side of the bar something hanging off it fits on.
 *
 * An **addition** to `contracts.md` §4: it is the third export the popover flip
 * needed, and it belongs beside the function whose parking is what made the
 * flip necessary.
 *
 * Here beside `clampToViewport` because it is the same fact from the other end.
 * That function is free to park the bar as low as
 * `viewportHeight - barHeight - margin`, and `.root` is `position: fixed`; so a
 * panel that always hung below it opened *entirely outside the viewport* for a
 * bar dragged to the bottom of the screen - and a fixed subtree cannot be
 * scrolled to, so the symbols palette was simply unreachable, with nothing on
 * screen to say why. The flip is arithmetic over four numbers, so it lives here
 * with a test rather than inline in the mount code (`CLAUDE.md`).
 *
 * `below` wins whenever it fits, ties included: it is where the caret triangle
 * points and where the panel has always opened, and a menu that changed sides
 * on a two-pixel resize would be its own bug. When neither side fits the larger
 * one wins, which is the most of the panel that can be reached at all.
 *
 * @param bar             the bar's own `top` and `bottom`, in viewport px
 * @param height          the panel's or note's own height
 * @param viewportHeight  `window.innerHeight`
 */
export function dropSide(
  bar: { top: number; bottom: number },
  height: number,
  viewportHeight: number,
  margin: number = BAR_MARGIN_PX,
): DropSide {
  const below = viewportHeight - margin - bar.bottom;
  const above = bar.top - margin;
  // The gap counts: it is between the bar and the panel on either side.
  const needed = height + POPOVER_GAP_PX;

  if (needed <= below) return "below";
  if (needed <= above) return "above";
  return above > below ? "above" : "below";
}
