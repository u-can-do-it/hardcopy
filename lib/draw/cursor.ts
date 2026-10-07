/**
 * The pointer over the drawing layer: one cursor per tool, so the page says
 * what a press will do before anything is pressed.
 *
 * Two kinds of cursor, and the split is about where a mark starts:
 *
 * - **The pens draw from their nib.** The pencil and the highlighter are drawn
 *   as their own bar icons (lucide `pencil` and `highlighter`, the same path
 *   data as `ICON_PENCIL` / `ICON_HIGHLIGHTER` in lib/draw/bar.ts), full size,
 *   with the hotspot on the point - the stroke comes out of the end of the pen
 *   on screen.
 * - **Everything else is placed by a corner.** A line, a box, an ellipse, a
 *   symbol and a label all start exactly at the press and grow from it
 *   (`symbolRect`, `openEditor`), so their cursor is a crosshair centred on
 *   that point with a small badge of the tool below and to its right. An icon
 *   whose hotspot sits somewhere on its outline is no way to aim the corner of
 *   a rectangle.
 *
 * Every glyph is drawn twice, a wide white stroke under a narrow black one. A
 * cursor has to read on whatever the page is - white paper, a dark theme, a
 * photograph - and the halo is what keeps black ink legible on black. All the
 * halo goes down before any of the ink, so the crosshair's halo cannot cut
 * through the badge's strokes where the two come close.
 *
 * The glyphs live here, beside their hotspots, rather than being imported from
 * the bar: a hotspot is a fact about one exact path, and an icon redrawn on the
 * bar must not quietly move the point a stroke comes out of.
 *
 * A data URL, so nothing is fetched and the manifest does not change. A page
 * whose CSP leaves `data:` out of `img-src` refuses the image, and the browser
 * then shows the keyword after the comma - which is why every cursor names one.
 *
 * Pure: one string per tool, built once at load. `DrawLayer.setCursor` puts it
 * on the layer host (lib/draw/layer.ts); `tests/draw-cursor.test.ts` holds the
 * value to a shape the CSS parser will take.
 */

import type { DrawTool } from "../types";
import type { Vec2 } from "./model";

/**
 * The cursor image's side, in CSS px.
 *
 * Lucide's own 24 grid, so the pen icons go in at scale 1. And well under 32:
 * Chrome refuses a cursor image larger than 32x32 wherever it would overlap
 * the browser's own UI, so anything bigger stops working near the toolbar.
 */
export const CURSOR_PX = 24;

/** The black line, at lucide's weight. */
const INK_WIDTH = 2;

/** The white halo under it: one pixel of white either side of the ink. */
const HALO_WIDTH = INK_WIDTH + 2;

interface Glyph {
  /** Path data in cursor px, on a `CURSOR_PX` square. */
  d: string;
  /** The pixel a press lands on. */
  hotspot: Vec2;
  /**
   * Fill the halo as well as stroking it. The pen bodies only: a white pencil
   * in a black outline reads as an object on any page. A badge stays hollow,
   * because a solid white square is what the fill menu's cover looks like.
   */
  solid: boolean;
  /** The keyword shown when the image is refused. */
  fallback: string;
}

/**
 * The crosshair's centre, and the hotspot of every corner tool.
 *
 * Four arms with a gap in the middle, sized so that a gap survives the halo:
 * the arms' ink ends at 5 and starts again at 9, the halo eats a pixel of that
 * on each side, and the 2px left at 6..8 shows the page under the hotspot - so
 * the crosshair never covers the thing it is aiming at.
 */
const AIM: Vec2 = { x: 7, y: 7 };
const CROSSHAIR = "M7 1v3 M7 10v3 M1 7h3 M10 7h3";

/**
 * Each badge fills the 14..22 square, clear of the arms: the arms run along
 * x = 7 and y = 7 and stop at 14, so nothing of them reaches the badge's corner.
 */
const BADGE_LINE = "M14 22 22 14";
const BADGE_RECT = "M15 14h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z";
const BADGE_ELLIPSE = "M18 14a4 4 0 1 0 0 8a4 4 0 1 0 0-8z";
/** lucide `arrow-up-right`, the symbols group's trigger, in the badge square. */
const BADGE_SYMBOL = "M14 14h8v8 M14 22 22 14";
const BADGE_TEXT = "M14 14h8 M18 14v8";

function aimed(badge: string, fallback = "crosshair"): Glyph {
  return { d: `${CROSSHAIR} ${badge}`, hotspot: AIM, solid: false, fallback };
}

/**
 * A `Record<DrawTool, ...>` so an eighth tool fails `pnpm compile` until it is
 * given a cursor, rather than quietly drawing under the last tool's.
 */
const GLYPHS: Record<DrawTool, Glyph> = {
  // lucide `pencil`. The nib is the 0.5-radius arc ending at (2.64, 21.98),
  // whose outermost point is within a third of a pixel of (2, 22).
  pencil: {
    d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z M15 5l4 4",
    hotspot: { x: 2, y: 22 },
    solid: true,
    fallback: "crosshair",
  },
  // lucide `highlighter`. Its first subpath is the chisel tip, and (3, 20) is
  // the tip's bottom-left vertex - the corner that touches the paper.
  highlighter: {
    d: "M9 11l-6 6v3h9l3-3 M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4",
    hotspot: { x: 3, y: 20 },
    solid: true,
    fallback: "crosshair",
  },
  line: aimed(BADGE_LINE),
  rect: aimed(BADGE_RECT),
  ellipse: aimed(BADGE_ELLIPSE),
  symbol: aimed(BADGE_SYMBOL),
  // A crosshair and not the I-beam, because a click puts the label's top-left
  // corner on the press point and the I-beam's hotspot is half-way down it.
  // The I-beam is still what the browser shows if the image is refused.
  text: aimed(BADGE_TEXT, "text"),
};

function glyphSvg(glyph: Glyph): string {
  const halo = `<path d="${glyph.d}" fill="${glyph.solid ? "#fff" : "none"}" stroke="#fff" stroke-width="${HALO_WIDTH}"/>`;
  const ink = `<path d="${glyph.d}" fill="none" stroke="#000" stroke-width="${INK_WIDTH}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CURSOR_PX}" height="${CURSOR_PX}" ` +
    `viewBox="0 0 ${CURSOR_PX} ${CURSOR_PX}" stroke-linecap="round" stroke-linejoin="round">` +
    `${halo}${ink}</svg>`
  );
}

/**
 * `encodeURIComponent` and not base64: shorter for SVG, and readable in
 * devtools. It escapes `"`, `#` and whitespace, the three characters that
 * would end the quoted URL, start a fragment, or break the declaration.
 */
function cursorValue(glyph: Glyph): string {
  const url = `data:image/svg+xml,${encodeURIComponent(glyphSvg(glyph))}`;
  return `url("${url}") ${glyph.hotspot.x} ${glyph.hotspot.y}, ${glyph.fallback}`;
}

const CURSORS = Object.fromEntries(
  (Object.keys(GLYPHS) as DrawTool[]).map((tool) => [tool, cursorValue(GLYPHS[tool])]),
) as Record<DrawTool, string>;

/** The CSS `cursor` value for the layer while `tool` is armed. */
export function toolCursor(tool: DrawTool): string {
  return CURSORS[tool];
}
