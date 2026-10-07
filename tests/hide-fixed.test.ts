import { describe, expect, it } from "vitest";
import { MAX_TEXT_SHARE, shouldHideFixed } from "@/lib/dom/hide-fixed";

const candidate = (over: Partial<Parameters<typeof shouldHideFixed>[0]> = {}) => ({
  position: "fixed",
  height: 80,
  textShare: 0.01,
  ...over,
});

describe("shouldHideFixed", () => {
  it("hides tall fixed and sticky furniture", () => {
    expect(shouldHideFixed(candidate(), 40)).toBe(true);
    expect(shouldHideFixed(candidate({ position: "sticky" }), 40)).toBe(true);
  });

  it("leaves normally positioned elements alone", () => {
    for (const position of ["static", "relative", "absolute"]) {
      expect(shouldHideFixed(candidate({ position }), 40)).toBe(false);
    }
  });

  it("respects the height threshold, exclusively", () => {
    expect(shouldHideFixed(candidate({ height: 41 }), 40)).toBe(true);
    expect(shouldHideFixed(candidate({ height: 40 }), 40)).toBe(false);
    expect(shouldHideFixed(candidate({ height: 0 }), 40)).toBe(false);
  });

  it("refuses to hide the page's own content", () => {
    // A sticky main wrapper - hiding it would export a blank PDF.
    expect(shouldHideFixed(candidate({ textShare: 0.9 }), 40)).toBe(false);
    expect(shouldHideFixed(candidate({ textShare: MAX_TEXT_SHARE }), 40)).toBe(true);
  });

  it("hides nothing when the threshold is infinite (selectors-only mode)", () => {
    expect(shouldHideFixed(candidate({ height: 9999 }), Number.POSITIVE_INFINITY)).toBe(false);
  });
});
