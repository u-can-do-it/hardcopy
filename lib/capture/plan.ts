/**
 * Turning "capture this rectangle" into calls Chromium will actually answer.
 *
 * `Page.captureScreenshot` with `captureBeyondViewport` will photograph content
 * far below the fold, but not without limits: the surface it rasterises into is
 * a GPU texture, and a full-page shot of a long feed asks for one that no
 * driver will hand out. Chromium's own answer is a protocol error, which the
 * user reads as "the screenshot button is broken".
 *
 * So a capture is planned before it is taken: the rectangle is clamped to the
 * document, shrunk if it is beyond what a single image can hold, and cut into
 * horizontal slices small enough to come back one at a time. The slices are
 * stitched afterwards (lib/capture/stitch.ts) - to the caller it is one PNG.
 *
 * Pure module - no chrome.*, no canvas - and covered by tests/capture-plan.test.ts.
 */

import type { CaptureRect } from "../types";

/** Below this in either axis, a drag was a stray click, not a selection. */
export const MIN_SELECTION_PX = 12;

/**
 * The longest edge a stitched image may have, when the format does not say
 * otherwise. Encodings carry their own (`ImageEncoding.maxEdge`) because
 * WebP's is far lower than the canvas's - see lib/capture/format.ts.
 */
export const MAX_IMAGE_EDGE_PX = 65_535;

/**
 * The most pixels a stitched image may hold.
 *
 * The canvas holds it as RGBA, 4 bytes a pixel, so 2^26 px is ~268MB of live
 * memory in the service worker before anything is encoded. That is already a
 * 52,000px-tall shot of a 1280px-wide page; going further trades a picture
 * nobody scrolls through for a real risk of the worker being killed mid-export.
 */
export const MAX_IMAGE_AREA_PX = 2 ** 26;

/** What the output image has to fit inside. Usually the format's own limits. */
export interface ImageLimits {
  maxEdge: number;
  maxArea: number;
}

export const DEFAULT_LIMITS: ImageLimits = {
  maxEdge: MAX_IMAGE_EDGE_PX,
  maxArea: MAX_IMAGE_AREA_PX,
};

/**
 * Rows per `captureScreenshot` call.
 *
 * Small enough that any one call is cheap and safely under the texture limit,
 * large enough that an ordinary page is one or two calls. Slices only exist
 * because one enormous call is the thing that fails.
 */
export const SLICE_HEIGHT_PX = 4_096;

export interface CaptureSlice {
  /** Document-space top of this slice, in CSS px. */
  y: number;
  /** Height of this slice in CSS px, before `scale`. */
  height: number;
}

export interface CapturePlan {
  /** The clamped rectangle the slices cover, in CSS px. */
  rect: CaptureRect;
  /** 1 unless the rectangle had to be shrunk to fit an image. */
  scale: number;
  /** Expected image size in device px; the stitch uses the real slice sizes. */
  width: number;
  height: number;
  slices: CaptureSlice[];
  /** Shown to the user when the plan is not literally what they asked for. */
  note?: string;
}

/** Round a rectangle outwards, so a half-pixel drag never clips content. */
function outward(rect: CaptureRect): CaptureRect {
  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  return {
    x,
    y,
    width: Math.ceil(rect.x + rect.width) - x,
    height: Math.ceil(rect.y + rect.height) - y,
  };
}

/** The rectangle between two points, whichever way round they were dragged. */
export function rectFromPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
): CaptureRect {
  return outward({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  });
}

/** Trim a rectangle to the document; a selection dragged off the edge is normal. */
export function clampRect(rect: CaptureRect, bounds: { width: number; height: number }): CaptureRect {
  const r = outward(rect);
  const x = Math.min(Math.max(r.x, 0), Math.max(bounds.width, 0));
  const y = Math.min(Math.max(r.y, 0), Math.max(bounds.height, 0));
  return {
    x,
    y,
    width: Math.max(Math.min(r.x + r.width, bounds.width) - x, 0),
    height: Math.max(Math.min(r.y + r.height, bounds.height) - y, 0),
  };
}

/** Is this rectangle worth capturing, or was it a click that wandered? */
export function isUsableSelection(rect: CaptureRect): boolean {
  return rect.width >= MIN_SELECTION_PX && rect.height >= MIN_SELECTION_PX;
}

/**
 * The largest scale at which `rect` still fits inside one image.
 *
 * Shrinking is the only honest option left when a page is 40,000px tall: the
 * alternatives are refusing outright or cutting the bottom off, and a slightly
 * smaller picture of the whole page is what the user asked for.
 */
export function fitScale(
  rect: { width: number; height: number },
  limits: ImageLimits = DEFAULT_LIMITS,
): number {
  const { width, height } = rect;
  if (!(width > 0) || !(height > 0)) return 1;

  const byEdge = Math.min(limits.maxEdge / width, limits.maxEdge / height);
  const byArea = Math.sqrt(limits.maxArea / (width * height));
  return Math.min(1, byEdge, byArea);
}

/** Cut a height into slices of at most `SLICE_HEIGHT_PX`, top to bottom. */
export function sliceRect(rect: CaptureRect, sliceHeight = SLICE_HEIGHT_PX): CaptureSlice[] {
  if (!(rect.height > 0) || !(sliceHeight > 0)) return [];

  const slices: CaptureSlice[] = [];
  for (let offset = 0; offset < rect.height; offset += sliceHeight) {
    slices.push({ y: rect.y + offset, height: Math.min(sliceHeight, rect.height - offset) });
  }
  return slices;
}

/**
 * Plan a capture of `rect` within a document of `bounds`.
 *
 * Returns no slices when there is nothing to capture; the caller reports that
 * rather than sending Chromium an empty clip.
 */
export function planCapture(
  rect: CaptureRect,
  bounds: { width: number; height: number },
  limits: ImageLimits = DEFAULT_LIMITS,
): CapturePlan {
  const clamped = clampRect(rect, bounds);
  const scale = fitScale(clamped, limits);
  const width = Math.max(Math.round(clamped.width * scale), 0);
  const height = Math.max(Math.round(clamped.height * scale), 0);

  // Slice in source pixels, so each call comes back around
  // `SLICE_HEIGHT_PX * scale` tall whatever the scale is.
  const slices =
    clamped.width > 0 && clamped.height > 0 ? sliceRect(clamped, SLICE_HEIGHT_PX / scale) : [];

  const note =
    scale < 1
      ? `Too big for one image at full size, so it was scaled to ${Math.round(scale * 100)}%.`
      : undefined;

  return {
    rect: clamped,
    scale,
    width,
    height,
    slices,
    ...(note === undefined ? {} : { note }),
  };
}
