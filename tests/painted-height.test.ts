import { describe, expect, it } from "vitest";

import {
  choosePaintedHeight,
  findPaintedRow,
  MAX_SCAN_SCALE,
  paintedHeightFromScan,
  pickScanScale,
  SCAN_TARGET_ROWS,
  TAIL_PADDING_PX,
  TAIL_TOLERANCE_PX,
  parseRgb,
  tailShowsBackground,
  type PixelScan,
  type Rgb,
} from "@/lib/pdf/painted-height";

/**
 * A scan whose rows are built from `rows`: each entry is one row, given as the
 * colour of every column. Anything not listed repeats the last row, which is
 * what an empty tail looks like.
 */
function scan(width: number, rows: Array<number[]>): PixelScan {
  const data = new Uint8ClampedArray(width * rows.length * 4);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const grey = row[x] ?? 0;
      const i = (y * width + x) * 4;
      data[i] = grey;
      data[i + 1] = grey;
      data[i + 2] = grey;
      data[i + 3] = 255;
    }
  });
  return { width, height: rows.length, data };
}

const flat = (width: number, grey: number) => new Array<number>(width).fill(grey);
const WHITE: Rgb = [255, 255, 255];

describe("findPaintedRow", () => {
  it("finds the last row that differs from the bottom edge", () => {
    const rows = [flat(4, 255), [255, 0, 0, 255], flat(4, 255), flat(4, 255)];
    expect(findPaintedRow(scan(4, rows))).toBe(1);
  });

  it("compares column by column, so a centred column reads as empty", () => {
    // A white page with a grey content column down the middle: the column is
    // not "content", the text on it is.
    const column = [255, 240, 240, 255];
    const text = [255, 240, 20, 255];
    expect(findPaintedRow(scan(4, [column, text, column, column]))).toBe(1);
  });

  it("returns -1 when nothing differs from the bottom", () => {
    expect(findPaintedRow(scan(4, [flat(4, 12), flat(4, 12), flat(4, 12)]))).toBe(-1);
  });

  it("ignores drift within the tolerance", () => {
    expect(findPaintedRow(scan(4, [flat(4, 252), flat(4, 255)]), 6).valueOf()).toBe(-1);
    expect(findPaintedRow(scan(4, [flat(4, 240), flat(4, 255)]), 6).valueOf()).toBe(0);
  });

  it("survives an empty scan", () => {
    expect(findPaintedRow({ width: 0, height: 0, data: new Uint8ClampedArray() })).toBe(-1);
  });
});

describe("paintedHeightFromScan", () => {
  it("scales the painted row back to CSS pixels", () => {
    // Row 1 of a scan taken at 5%: content ends by CSS pixel 40.
    const rows = [flat(2, 255), [255, 0], flat(2, 255), flat(2, 255)];
    expect(paintedHeightFromScan(scan(2, rows), 0.05, WHITE)).toBe(40);
  });

  it("is zero when the scan shows nothing", () => {
    expect(paintedHeightFromScan(scan(2, [flat(2, 9), flat(2, 9)]), 0.05, [9, 9, 9])).toBe(0);
  });
});

describe("tailShowsBackground", () => {
  it("accepts a tail that shows the page background somewhere", () => {
    // A centred white column on a grey page: the grey edges are the giveaway.
    expect(tailShowsBackground(scan(4, [flat(4, 221), [221, 255, 255, 221]]), [221, 221, 221])).toBe(
      true,
    );
  });

  it("refuses a full-bleed colour band the page painted on purpose", () => {
    // Trimming it would only move the band onto sheets of its own.
    expect(tailShowsBackground(scan(4, [flat(4, 255), flat(4, 60)]), WHITE)).toBe(false);
  });

  it("refuses when the background is unknown", () => {
    expect(tailShowsBackground(scan(4, [flat(4, 255), flat(4, 255)]), undefined)).toBe(false);
  });
});

describe("parseRgb", () => {
  it("reads what getComputedStyle returns", () => {
    expect(parseRgb("rgb(18, 18, 42)")).toEqual([18, 18, 42]);
    expect(parseRgb("rgba(255, 255, 255, 0.5)")).toEqual([255, 255, 255]);
    expect(parseRgb("color(srgb 1 1 1)")).toBeUndefined();
    expect(parseRgb(undefined)).toBeUndefined();
  });
});

describe("pickScanScale", () => {
  it("keeps the scan about SCAN_TARGET_ROWS tall", () => {
    expect(20_000 * pickScanScale(20_000)).toBeCloseTo(SCAN_TARGET_ROWS, 5);
    expect(44_000 * pickScanScale(44_000)).toBeCloseTo(SCAN_TARGET_ROWS, 5);
  });

  it("does not magnify a short page", () => {
    expect(pickScanScale(800)).toBe(MAX_SCAN_SCALE);
    expect(pickScanScale(0)).toBe(MAX_SCAN_SCALE);
  });
});

describe("choosePaintedHeight", () => {
  it("trims a long empty tail left by a feed reserving space", () => {
    // 19,000px of content inside a 45,000px document.
    expect(choosePaintedHeight(45_000, 19_000)).toBe(19_000 + TAIL_PADDING_PX);
  });

  it("leaves an ordinary trailing gap alone", () => {
    // wp.pl freshly loaded: 19,264px document, content ends at 19,223px.
    expect(choosePaintedHeight(19_264, 19_223)).toBe(19_264);
  });

  it("keeps the nominal height when the gap is at the tolerance", () => {
    const painted = 10_000;
    const nominal = painted + TAIL_PADDING_PX + TAIL_TOLERANCE_PX;
    expect(choosePaintedHeight(nominal, painted)).toBe(nominal);
  });

  it("ignores a scan that returned nothing", () => {
    expect(choosePaintedHeight(20_000, 0)).toBe(20_000);
    expect(choosePaintedHeight(20_000, Number.NaN)).toBe(20_000);
  });

  it("trusts even a drastic trim, because the scan cannot miss what paints", () => {
    // 3,000px of content inside a 23,000px document is the real shape of a
    // page full of reserved ad space; the old DOM walk refused this one.
    expect(choosePaintedHeight(23_000, 3_007)).toBe(3_007 + TAIL_PADDING_PX);
  });

  it("never returns more than the document itself", () => {
    expect(choosePaintedHeight(5_000, 9_000)).toBe(5_000);
    expect(choosePaintedHeight(5_000, 5_000)).toBe(5_000);
  });
});
