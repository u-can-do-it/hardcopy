/**
 * Find the bottom of the page's *visible* content, by looking at the pixels.
 *
 * `cssContentSize.height` - and `scrollHeight`, which agrees with it - is the
 * document's nominal height, and that is not the same as where the page stops
 * painting. Ad slots reserve space their ads never fill, and an infinite feed
 * that was scrolled to the bottom reserves room for a batch that never arrives
 * once scripts are frozen. Paper cut to the nominal height is then one tall
 * sheet with a long empty tail - measured on wp.pl, ~19,200px of content inside
 * a document reported as much taller.
 *
 * The first attempt at this walked the DOM looking for elements with text or
 * media in them and took the lowest. That needs a guess about what "paints" -
 * it misses CSS backgrounds, gradients and canvas, so it needed sanity guards
 * against clipping real content, and the guards are what made it unreliable.
 *
 * A downscaled screenshot answers the same question by measurement instead:
 * render the page Chromium is about to print, shrink it, and find the last row
 * of pixels that differs from the bottom edge. Nothing that paints can hide
 * from it. It costs one `Page.captureScreenshot` - 136ms for a 19,000px page,
 * 35ms for a 44,000px one, both well under 50kB - because the scale is chosen
 * to keep the image about `SCAN_TARGET_ROWS` tall however long the page is.
 *
 * Pure apart from `decodeImagePixels`; covered by tests/painted-height.test.ts.
 */

/** Ignore a trailing gap smaller than this; it is ordinary page padding. */
export const TAIL_TOLERANCE_PX = 64;
/** Keep a little below the last painted row for shadows and descenders. */
export const TAIL_PADDING_PX = 24;
/** Rows to aim for in the scan image; sets the vertical precision. */
export const SCAN_TARGET_ROWS = 1400;
export const MAX_SCAN_SCALE = 0.25;
export const MIN_SCAN_SCALE = 0.01;

/**
 * How far a channel may drift from the bottom edge and still count as empty.
 *
 * Nearly exact, because a PNG screenshot is lossless: identical rows downscale
 * to identical rows, so genuinely blank space matches to the level. At 6 this
 * swallowed 222px of a slow gradient - it read as flat - and the trim then put
 * the remainder on a second sheet. Anything that paints moves a scan pixel much
 * further than 2, even averaged at 6%.
 */
export const SCAN_TOLERANCE = 2;

/** Keep the scan around `SCAN_TARGET_ROWS` tall whatever the page's height. */
export function pickScanScale(docHeightPx: number): number {
  if (!(docHeightPx > 0)) return MAX_SCAN_SCALE;
  return Math.min(MAX_SCAN_SCALE, Math.max(MIN_SCAN_SCALE, SCAN_TARGET_ROWS / docHeightPx));
}

/**
 * The page's own background colour, read from the tab.
 *
 * Sent as a string for `Runtime.evaluate`, like `DOCUMENT_HEIGHT_EXPRESSION`.
 * The canvas takes `html`\'s background, or `body`\'s when `html` is
 * transparent - the propagation rule in CSS backgrounds - and white when
 * neither paints.
 */
export const CANVAS_BACKGROUND_EXPRESSION = `(() => {
  var opaque = function (c) {
    return c && c !== 'transparent' && !/rgba\\(.*,\\s*0\\s*\\)$/.test(c) ? c : '';
  };
  var html = opaque(getComputedStyle(document.documentElement).backgroundColor);
  var body = document.body ? opaque(getComputedStyle(document.body).backgroundColor) : '';
  return html || body || 'rgb(255, 255, 255)';
})()`;

export type Rgb = [number, number, number];

/** Parse the `rgb()` / `rgba()` string `getComputedStyle` returns. */
export function parseRgb(value: string | undefined): Rgb | undefined {
  const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(value ?? "");
  if (!m) return undefined;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** RGBA rows, as `CanvasRenderingContext2D.getImageData` hands them over. */
export interface PixelScan {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * The lowest row that is not a copy of the page's bottom edge, or -1.
 *
 * Each row is compared with the bottom row *column by column* rather than with
 * one background colour, so a centred content column on a different ground -
 * every second site - reads as empty right down its length, while a row of text
 * across it does not. A tail that is not flat (a gradient, say) matches nothing
 * and simply yields no trim, which is the safe direction.
 */
export function findPaintedRow(scan: PixelScan, tolerance = SCAN_TOLERANCE): number {
  const { width, height, data } = scan;
  if (width <= 0 || height <= 0) return -1;

  const stride = width * 4;
  const bottom = (height - 1) * stride;

  for (let y = height - 2; y >= 0; y--) {
    const row = y * stride;
    for (let i = 0; i < stride; i += 4) {
      // RGB only: a screenshot is opaque, and alpha never carries the content.
      if (
        Math.abs((data[row + i] ?? 0) - (data[bottom + i] ?? 0)) > tolerance ||
        Math.abs((data[row + i + 1] ?? 0) - (data[bottom + i + 1] ?? 0)) > tolerance ||
        Math.abs((data[row + i + 2] ?? 0) - (data[bottom + i + 2] ?? 0)) > tolerance
      ) {
        return y;
      }
    }
  }
  return -1;
}

/**
 * Does the page's bottom edge show the page's own background anywhere?
 *
 * This is what separates space nothing painted in from a band the page painted
 * deliberately. A reserved ad slot or an unfilled feed shows whatever is
 * behind it - the canvas, or a wrapper sitting on the canvas - so the bottom
 * row still has the page's background somewhere across its width. A full-bleed
 * colour block at the foot of the page does not, and must not be trimmed: the
 * trim would only move it onto sheets of its own.
 *
 * Without a background to compare against (an unreadable colour, a gradient or
 * image on the canvas) the answer is no, and nothing is trimmed.
 */
export function tailShowsBackground(
  scan: PixelScan,
  background: Rgb | undefined,
  tolerance = SCAN_TOLERANCE,
): boolean {
  if (!background || scan.width <= 0 || scan.height <= 0) return false;

  const stride = scan.width * 4;
  const bottom = (scan.height - 1) * stride;
  for (let i = 0; i < stride; i += 4) {
    if (
      Math.abs((scan.data[bottom + i] ?? 0) - background[0]) <= tolerance &&
      Math.abs((scan.data[bottom + i + 1] ?? 0) - background[1]) <= tolerance &&
      Math.abs((scan.data[bottom + i + 2] ?? 0) - background[2]) <= tolerance
    ) {
      return true;
    }
  }
  return false;
}

/** Where the page stops painting, in CSS pixels, from a scan taken at `scale`. */
export function paintedHeightFromScan(
  scan: PixelScan,
  scale: number,
  background: Rgb | undefined,
): number {
  if (!tailShowsBackground(scan, background)) return 0;
  const row = findPaintedRow(scan);
  if (row < 0 || !(scale > 0)) return 0;
  return Math.ceil((row + 1) / scale);
}

/**
 * Decide the height to print, given the document's own and the painted one.
 *
 * There is deliberately no "that trim looks too big, ignore it" guard. The
 * DOM-walk version had one - it refused any painted height under a fifth of the
 * document - because it could not see CSS-painted content, so a small result
 * usually meant it had missed something. A pixel scan cannot miss anything that
 * paints, and the case worth fixing is precisely the extreme one: 3,000px of
 * content inside a 23,000px document, the rest reserved ad space. The safety
 * lives in `tailShowsBackground` and in the caller capping the sheet count.
 */
export function choosePaintedHeight(nominalPx: number, paintedPx: number): number {
  if (!Number.isFinite(paintedPx) || paintedPx <= 0) return nominalPx;
  if (paintedPx >= nominalPx) return nominalPx;

  const trimmed = paintedPx + TAIL_PADDING_PX;
  return nominalPx - trimmed > TAIL_TOLERANCE_PX ? trimmed : nominalPx;
}

/**
 * Decode PNG bytes to pixels.
 *
 * `createImageBitmap` and `OffscreenCanvas` both exist in an MV3 service
 * worker, so the scan needs neither the offscreen document nor the tab.
 */
export async function decodeImagePixels(png: Uint8Array): Promise<PixelScan> {
  const bitmap = await createImageBitmap(new Blob([png as BlobPart], { type: "image/png" }));
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context for the page scan");
    ctx.drawImage(bitmap, 0, 0);
    const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: image.width, height: image.height, data: image.data };
  } finally {
    bitmap.close();
  }
}
