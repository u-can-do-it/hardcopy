import { describe, expect, it } from "vitest";

import {
  clampRect,
  DEFAULT_LIMITS,
  fitScale,
  isUsableSelection,
  MAX_IMAGE_AREA_PX,
  MAX_IMAGE_EDGE_PX,
  MIN_SELECTION_PX,
  planCapture,
  rectFromPoints,
  sliceRect,
  SLICE_HEIGHT_PX,
} from "@/lib/capture/plan";

describe("rectFromPoints", () => {
  it("normalises a drag made in any direction", () => {
    const downRight = rectFromPoints({ x: 10, y: 20 }, { x: 110, y: 220 });
    const upLeft = rectFromPoints({ x: 110, y: 220 }, { x: 10, y: 20 });
    expect(downRight).toEqual({ x: 10, y: 20, width: 100, height: 200 });
    expect(upLeft).toEqual(downRight);
  });

  it("rounds outwards, so a fractional drag never clips content", () => {
    expect(rectFromPoints({ x: 10.4, y: 20.6 }, { x: 30.2, y: 41.1 })).toEqual({
      x: 10,
      y: 20,
      width: 21,
      height: 22,
    });
  });
});

describe("clampRect", () => {
  const bounds = { width: 1280, height: 4000 };

  it("leaves a rectangle inside the document alone", () => {
    const rect = { x: 100, y: 200, width: 300, height: 400 };
    expect(clampRect(rect, bounds)).toEqual(rect);
  });

  it("trims a selection dragged off the edge", () => {
    expect(clampRect({ x: 1200, y: 3900, width: 400, height: 400 }, bounds)).toEqual({
      x: 1200,
      y: 3900,
      width: 80,
      height: 100,
    });
  });

  it("pulls a selection that starts off-page back to the origin", () => {
    expect(clampRect({ x: -50, y: -30, width: 200, height: 100 }, bounds)).toEqual({
      x: 0,
      y: 0,
      width: 150,
      height: 70,
    });
  });

  it("gives back nothing for a rectangle wholly outside the document", () => {
    const clamped = clampRect({ x: 2000, y: 9000, width: 100, height: 100 }, bounds);
    expect(clamped.width).toBe(0);
    expect(clamped.height).toBe(0);
  });
});

describe("isUsableSelection", () => {
  it("rejects a click that wandered a few pixels", () => {
    expect(isUsableSelection({ x: 0, y: 0, width: MIN_SELECTION_PX - 1, height: 300 })).toBe(false);
    expect(isUsableSelection({ x: 0, y: 0, width: 300, height: MIN_SELECTION_PX - 1 })).toBe(false);
  });

  it("accepts anything at or over the minimum in both axes", () => {
    expect(
      isUsableSelection({ x: 0, y: 0, width: MIN_SELECTION_PX, height: MIN_SELECTION_PX }),
    ).toBe(true);
  });
});

describe("fitScale", () => {
  it("keeps an ordinary page at full size", () => {
    expect(fitScale({ width: 1280, height: 8000 })).toBe(1);
  });

  it("shrinks a page past the edge limit until it fits", () => {
    const height = MAX_IMAGE_EDGE_PX * 3;
    const scale = fitScale({ width: 1280, height });
    expect(scale).toBeCloseTo(1 / 3, 5);
    expect(height * scale).toBeLessThanOrEqual(MAX_IMAGE_EDGE_PX);
  });

  it("honours a format's own, much lower ceiling", () => {
    // WebP stops at 16,383px and says nothing about it, so the planner has to.
    const limits = { maxEdge: 16_383, maxArea: DEFAULT_LIMITS.maxArea };
    const scale = fitScale({ width: 1280, height: 40_000 }, limits);
    expect(40_000 * scale).toBeLessThanOrEqual(16_383);
  });

  it("shrinks on area even when both edges would fit", () => {
    const side = 15_000; // well under the edge limit, far over the area one
    const scale = fitScale({ width: side, height: side });
    expect(scale).toBeLessThan(1);
    expect(side * scale * (side * scale)).toBeLessThanOrEqual(MAX_IMAGE_AREA_PX + 1);
  });

  it("does not divide by zero on an empty rectangle", () => {
    expect(fitScale({ width: 0, height: 0 })).toBe(1);
  });
});

describe("sliceRect", () => {
  it("returns one slice for a page shorter than the slice height", () => {
    expect(sliceRect({ x: 0, y: 0, width: 800, height: 1000 })).toEqual([{ y: 0, height: 1000 }]);
  });

  it("covers the whole rectangle exactly, with no gaps or overlap", () => {
    const rect = { x: 0, y: 120, width: 800, height: SLICE_HEIGHT_PX * 2 + 500 };
    const slices = sliceRect(rect);

    expect(slices).toHaveLength(3);
    expect(slices[0]?.y).toBe(rect.y);
    expect(slices.reduce((sum, s) => sum + s.height, 0)).toBe(rect.height);
    slices.forEach((slice, i) => {
      const previous = slices[i - 1];
      if (previous) expect(slice.y).toBe(previous.y + previous.height);
      expect(slice.height).toBeLessThanOrEqual(SLICE_HEIGHT_PX);
    });
  });

  it("has nothing to slice when the rectangle is empty", () => {
    expect(sliceRect({ x: 0, y: 0, width: 800, height: 0 })).toEqual([]);
  });
});

describe("planCapture", () => {
  it("plans an ordinary page as full-size slices with no note", () => {
    const plan = planCapture({ x: 0, y: 0, width: 1280, height: 5000 }, {
      width: 1280,
      height: 5000,
    });

    expect(plan.scale).toBe(1);
    expect(plan.width).toBe(1280);
    expect(plan.height).toBe(5000);
    expect(plan.note).toBeUndefined();
    expect(plan.slices.reduce((sum, s) => sum + s.height, 0)).toBe(5000);
  });

  it("scales a very tall page down and says so", () => {
    const limits = { maxEdge: 16_383, maxArea: DEFAULT_LIMITS.maxArea };
    const height = 60_000;
    const plan = planCapture({ x: 0, y: 0, width: 1000, height }, { width: 1000, height }, limits);

    expect(plan.scale).toBeLessThan(1);
    expect(plan.height).toBeLessThanOrEqual(limits.maxEdge);
    expect(plan.note).toMatch(/scaled to/);
    // Slices are cut in source pixels, so each one still comes back within the
    // per-call budget once the scale is applied.
    for (const slice of plan.slices) {
      expect(slice.height * plan.scale).toBeLessThanOrEqual(SLICE_HEIGHT_PX + 1);
    }
    expect(plan.slices.reduce((sum, s) => sum + s.height, 0)).toBeCloseTo(height, 5);
  });

  it("clamps the requested rectangle to the document", () => {
    const plan = planCapture({ x: 900, y: 100, width: 800, height: 200 }, {
      width: 1200,
      height: 900,
    });
    expect(plan.rect).toEqual({ x: 900, y: 100, width: 300, height: 200 });
  });

  it("plans no slices when there is nothing inside the rectangle", () => {
    const plan = planCapture({ x: 0, y: 0, width: 0, height: 0 }, { width: 1200, height: 900 });
    expect(plan.slices).toEqual([]);
  });
});
