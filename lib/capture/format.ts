/**
 * What a screenshot is encoded as, and what that costs.
 *
 * The first version saved PNG only, which is the wrong default for this job in
 * two ways. A screenshot is mostly the kind of content PNG is worst at -
 * gradients, photographs, anti-aliased text - so a full-page shot of a long
 * article comes out at tens of megabytes; and that file then has to cross to
 * the offscreen document, where anything over 64MiB is refused outright. WebP
 * at quality 0.92 is visually indistinguishable on page content and lands
 * around a fifth of the size, which fixes the file *and* the transfer.
 *
 * Pure module - covered by tests/capture-format.test.ts.
 */

import type { ImageFormat } from "../types";

export interface ImageEncoding {
  format: ImageFormat;
  /** For `OffscreenCanvas.convertToBlob` and the download Blob alike. */
  mime: string;
  extension: string;
  /** Undefined for PNG, which ignores it. */
  quality?: number;
  /** JPEG has no alpha channel, so the canvas needs an opaque ground first. */
  opaque: boolean;
  /**
   * The tallest (and widest) image this format can hold, in px. Past it the
   * capture is scaled down to fit - see lib/capture/plan.ts.
   */
  maxEdge: number;
}

/**
 * High enough that page text stays crisp - screenshots are read, not glanced
 * at - and low enough to be worth the switch. 0.92 is where WebP stops paying
 * for itself against a lossless encode of flat UI colour.
 */
export const WEBP_QUALITY = 0.92;
/** JPEG needs a touch more to keep text edges clean, and still beats PNG. */
export const JPEG_QUALITY = 0.94;

/**
 * WebP stores dimensions in 14 bits, so 16,383px is the format's own ceiling -
 * and Chromium does not report going past it. Measured on Chrome 152: a
 * 1280x20000 canvas encoded as WebP decodes back as **1280x16383**, silently,
 * with the bottom 3,617px gone. Nothing about the blob says so. That is why the
 * limit lives here rather than as one number for every format: a full-page shot
 * of a long article is routinely taller than this, and losing its ending
 * without a word is the worst thing this feature could do.
 */
export const WEBP_MAX_EDGE = 16_383;

/**
 * JPEG's own limit is 65,535px, which is also where `OffscreenCanvas` stops:
 * 65,535 allocates, 70,000 throws "the size of OffscreenCanvas is zero". PNG
 * has no practical limit of its own, so it takes the canvas's. In both cases
 * MAX_IMAGE_AREA_PX is the constraint that actually bites first.
 */
export const CANVAS_MAX_EDGE = 65_535;

const ENCODINGS: Record<ImageFormat, ImageEncoding> = {
  webp: {
    format: "webp",
    mime: "image/webp",
    extension: ".webp",
    quality: WEBP_QUALITY,
    opaque: false,
    maxEdge: WEBP_MAX_EDGE,
  },
  jpeg: {
    format: "jpeg",
    mime: "image/jpeg",
    extension: ".jpg",
    quality: JPEG_QUALITY,
    opaque: true,
    maxEdge: CANVAS_MAX_EDGE,
  },
  png: {
    format: "png",
    mime: "image/png",
    extension: ".png",
    opaque: false,
    maxEdge: CANVAS_MAX_EDGE,
  },
};

/** Never throws: an unknown format from older settings degrades to WebP. */
export function encodingFor(format: ImageFormat | undefined): ImageEncoding {
  return ENCODINGS[format as ImageFormat] ?? (ENCODINGS.webp as ImageEncoding);
}
