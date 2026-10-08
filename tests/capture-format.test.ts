import { describe, expect, it } from "vitest";

import {
  CANVAS_MAX_EDGE,
  encodingFor,
  JPEG_QUALITY,
  WEBP_MAX_EDGE,
  WEBP_QUALITY,
} from "@/lib/capture/format";
import { readPngSize } from "@/lib/capture/stitch";
import { chunkRanges, CHUNK_BYTES } from "@/lib/base64";
import { DEFAULT_SETTINGS, mergeSettings } from "@/lib/settings";

describe("encodingFor", () => {
  it("describes WebP as the compressed default", () => {
    expect(encodingFor("webp")).toEqual({
      format: "webp",
      label: "WebP",
      mime: "image/webp",
      extension: ".webp",
      quality: WEBP_QUALITY,
      opaque: false,
      maxEdge: WEBP_MAX_EDGE,
    });
  });

  it("gives WebP a far lower ceiling than the others, because it has one", () => {
    // Chrome 152 encodes a 1280x20000 canvas to a 1280x16383 WebP, silently.
    expect(WEBP_MAX_EDGE).toBe(16_383);
    expect(encodingFor("jpeg").maxEdge).toBe(CANVAS_MAX_EDGE);
    expect(encodingFor("png").maxEdge).toBe(CANVAS_MAX_EDGE);
  });

  it("marks JPEG opaque, because it has no alpha to paint into", () => {
    const jpeg = encodingFor("jpeg");
    expect(jpeg.opaque).toBe(true);
    expect(jpeg.extension).toBe(".jpg");
    expect(jpeg.quality).toBe(JPEG_QUALITY);
  });

  it("asks for no quality on PNG, which is lossless", () => {
    const png = encodingFor("png");
    expect(png.quality).toBeUndefined();
    expect(png.mime).toBe("image/png");
  });

  it("falls back to JPEG for anything unrecognised", () => {
    expect(encodingFor(undefined).format).toBe("jpeg");
    expect(encodingFor("gif" as never).format).toBe("jpeg");
  });
});

describe("imageFormat setting", () => {
  it("defaults to JPEG", () => {
    expect(DEFAULT_SETTINGS.imageFormat).toBe("jpeg");
    expect(mergeSettings({}).imageFormat).toBe("jpeg");
  });

  it("keeps a stored choice and rejects a nonsense one", () => {
    expect(mergeSettings({ imageFormat: "png" }).imageFormat).toBe("png");
    expect(mergeSettings({ imageFormat: "tiff" }).imageFormat).toBe("jpeg");
  });
});

describe("chunkRanges", () => {
  it("covers the whole length exactly", () => {
    const ranges = chunkRanges(10_000, 3_000);
    expect(ranges).toEqual([
      [0, 3_000],
      [3_000, 6_000],
      [6_000, 9_000],
      [9_000, 10_000],
    ]);
  });

  it("returns one range for a file that fits in a single message", () => {
    expect(chunkRanges(500)).toEqual([[0, 500]]);
  });

  it("still yields one (empty) range for an empty file, so `final` is sent", () => {
    expect(chunkRanges(0)).toEqual([[0, 0]]);
  });

  it("chunks on a 3-byte boundary, so each piece encodes independently", () => {
    expect(CHUNK_BYTES % 3).toBe(0);
    // ...and well under the 64MiB the message channel allows, base64 included.
    expect(CHUNK_BYTES * (4 / 3)).toBeLessThan(64 * 1024 * 1024);
  });

  it("refuses a nonsensical chunk size rather than looping forever", () => {
    expect(() => chunkRanges(10, 0)).toThrow();
  });
});

describe("readPngSize", () => {
  /** A minimal PNG header: signature, length, "IHDR", width, height. */
  function header(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(bytes.buffer);
    view.setUint32(8, 13);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return bytes;
  }

  it("reads the dimensions out of IHDR", () => {
    expect(readPngSize(header(1280, 4096))).toEqual({ width: 1280, height: 4096 });
  });

  it("respects a byte offset, so a subarray still reads correctly", () => {
    const padded = new Uint8Array(32);
    padded.set(header(800, 600), 8);
    expect(readPngSize(padded.subarray(8))).toEqual({ width: 800, height: 600 });
  });

  it("refuses anything that is not a PNG rather than inventing a size", () => {
    expect(() => readPngSize(new Uint8Array(24))).toThrow(/PNG/);
    expect(() => readPngSize(header(10, 10).subarray(0, 20))).toThrow(/PNG/);
  });
});
