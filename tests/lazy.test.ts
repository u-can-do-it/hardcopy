import { describe, expect, it } from "vitest";

import { MAX_GROWTH_FACTOR, MAX_HEIGHT_PX, shouldStopGrowing } from "@/lib/dom/lazy";

describe("shouldStopGrowing", () => {
  it("keeps scrolling a page of ordinary length", () => {
    expect(shouldStopGrowing(8000, 9000)).toBe(false);
    expect(shouldStopGrowing(8000, 8000 * MAX_GROWTH_FACTOR)).toBe(false);
  });

  it("stops once the page has tripled - a feed loading its next batch", () => {
    expect(shouldStopGrowing(8000, 8000 * MAX_GROWTH_FACTOR + 1)).toBe(true);
  });

  it("stops at the absolute ceiling even if the page started tall", () => {
    // A page that begins at 40,000px never triples, so the factor alone would
    // let an infinite feed run away.
    expect(shouldStopGrowing(40_000, MAX_HEIGHT_PX)).toBe(true);
    expect(shouldStopGrowing(40_000, MAX_HEIGHT_PX - 1)).toBe(false);
  });

  it("does not divide by a zero starting height", () => {
    expect(shouldStopGrowing(0, 1000)).toBe(false);
    expect(shouldStopGrowing(0, MAX_HEIGHT_PX)).toBe(true);
  });
});
