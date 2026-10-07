/**
 * Turn the slices from lib/capture/plan.ts into one encoded image.
 *
 * Runs in the service worker: `createImageBitmap` and `OffscreenCanvas` both
 * exist there (the same pair lib/pdf/painted-height.ts leans on), so a
 * screenshot never has to travel to the offscreen document and back just to be
 * drawn. Only the finished bytes go there, and only to be given a Blob URL.
 *
 * This is also where the format is decided: slices are captured as PNG so
 * nothing is thrown away before the seams are joined, and the *result* is
 * encoded once, in whatever the user asked for (lib/capture/format.ts).
 */

import type { ImageEncoding } from "./format";

/** `\x89PNG\r\n\x1a\n`, the signature every PNG starts with. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Read a PNG's dimensions out of its header.
 *
 * The canvas has to be allocated before anything is drawn, so the total height
 * must be known up front - and decoding every slice to a bitmap just to measure
 * it, then decoding again to draw, is two passes over hundreds of megabytes.
 * IHDR is always the first chunk and always in the same 8 bytes.
 *
 * Pure; covered by tests/capture-format.test.ts.
 */
export function readPngSize(png: Uint8Array): { width: number; height: number } {
  if (png.length < 24 || PNG_SIGNATURE.some((byte, i) => png[i] !== byte)) {
    throw new Error("a screenshot slice came back as something other than a PNG");
  }

  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * Stack PNG slices vertically, in the order given, and encode the result.
 *
 * Each slice is drawn at the running height, so the seams land exactly where
 * the previous slice ended - rounding the plan's scaled heights instead would
 * leave a one-pixel gap between slices on some pages. The canvas width is the
 * widest slice; Chromium can return one a pixel narrower than its neighbour
 * after scaling.
 */
export async function stitchImage(
  parts: Uint8Array[],
  encoding: ImageEncoding,
): Promise<Uint8Array> {
  if (parts.length === 0) throw new Error("nothing to stitch");

  // One PNG slice asked for as PNG is already the answer; re-encoding it would
  // cost a full decode and a canvas the size of the page for no change.
  if (parts.length === 1 && encoding.format === "png") return parts[0] as Uint8Array;

  const sizes = parts.map(readPngSize);
  const width = Math.max(...sizes.map((size) => size.width));
  const height = sizes.reduce((sum, size) => sum + size.height, 0);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { alpha: !encoding.opaque });
  if (!ctx) throw new Error("no 2d context for the screenshot");

  // JPEG carries no alpha, and an unpainted corner would come out black rather
  // than as the white the page showed there.
  if (encoding.opaque) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }

  // One slice decoded at a time, drawn, then released. Holding every bitmap at
  // once - the obvious `Promise.all` - doubles peak memory on exactly the pages
  // that are already close to the limit.
  let y = 0;
  for (const part of parts) {
    const bitmap = await createImageBitmap(new Blob([part as BlobPart], { type: "image/png" }));
    try {
      ctx.drawImage(bitmap, 0, y);
      y += bitmap.height;
    } finally {
      bitmap.close();
    }
  }

  const blob = await canvas.convertToBlob({
    type: encoding.mime,
    ...(encoding.quality === undefined ? {} : { quality: encoding.quality }),
  });
  return new Uint8Array(await blob.arrayBuffer());
}
