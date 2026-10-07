import { describe, expect, it } from "vitest";

import { buildPageRule, buildSinglePageCss } from "@/lib/dom/page-size";
import { buildPrintCss } from "@/lib/dom/print-css";
import {
  CSS_PX_PER_INCH,
  MAX_PAPER_INCHES,
  SINGLE_PAGE_SLACK_PX,
  planSinglePageSize,
} from "@/lib/pdf/print-options";

const inches = (n: number) => n * CSS_PX_PER_INCH;
const padded = (heightPx: number) => heightPx + SINGLE_PAGE_SLACK_PX;

describe("planSinglePageSize", () => {
  it("sizes one sheet to the whole page, plus headroom", () => {
    const plan = planSinglePageSize({ width: 1280, height: 4000 });
    expect(plan.widthIn).toBeCloseTo(1280 / 96, 5);
    expect(plan.heightIn).toBeCloseTo(padded(4000) / 96, 5);
    expect(plan.sheets).toBe(1);
    expect(plan.split).toBe(false);
    expect(plan.note).toBeUndefined();
  });

  it("keeps a page that fills the ceiling exactly on one sheet", () => {
    const plan = planSinglePageSize({
      width: 1000,
      height: inches(MAX_PAPER_INCHES) - SINGLE_PAGE_SLACK_PX,
    });
    expect(plan.heightIn).toBeCloseTo(MAX_PAPER_INCHES, 5);
    expect(plan.sheets).toBe(1);
    expect(plan.split).toBe(false);
  });

  it("splits one pixel past the ceiling", () => {
    const plan = planSinglePageSize({
      width: 1000,
      height: inches(MAX_PAPER_INCHES) - SINGLE_PAGE_SLACK_PX + 1,
    });
    expect(plan.split).toBe(true);
    expect(plan.sheets).toBe(2);
  });

  it("keeps a long news homepage on one sheet", () => {
    // The case that started this: ~20,500px, which a competitor exports as a
    // single 213in page and the old 190in cap needlessly split in two.
    const plan = planSinglePageSize({ width: 1512, height: 20465 });
    expect(plan.sheets).toBe(1);
    expect(plan.split).toBe(false);
    expect(plan.heightIn).toBeCloseTo(padded(20465) / 96, 5);
  });

  it("slices into equal sheets only once past the ceiling", () => {
    const height = inches(MAX_PAPER_INCHES * 2.5);
    const plan = planSinglePageSize({ width: 1280, height });
    expect(plan.sheets).toBe(3);
    expect(plan.heightIn).toBeLessThanOrEqual(MAX_PAPER_INCHES);
    // Equal slices covering the page exactly - no near-empty final sheet.
    expect(plan.heightIn * plan.sheets).toBeCloseTo(padded(height) / 96, 5);
    expect(plan.note).toMatch(/split into 3 equal sheets/);
  });

  it("never asks for paper past the ceiling, however tall the page", () => {
    for (const height of [20000, 100000, 500000]) {
      const plan = planSinglePageSize({ width: 1280, height });
      expect(plan.heightIn).toBeLessThanOrEqual(MAX_PAPER_INCHES);
      expect(plan.widthIn).toBeLessThanOrEqual(MAX_PAPER_INCHES);
    }
  });

  it("degrades to A4 on a nonsense size rather than emitting NaN", () => {
    for (const bad of [
      { width: 0, height: 0 },
      { width: Number.NaN, height: Number.NaN },
      { width: -10, height: -10 },
    ]) {
      const plan = planSinglePageSize(bad);
      expect(Number.isFinite(plan.widthIn)).toBe(true);
      expect(Number.isFinite(plan.heightIn)).toBe(true);
      expect(plan.heightIn).toBeGreaterThan(0);
    }
  });
});

describe("buildPageRule", () => {
  it("emits a zero-margin @page sized in pixels", () => {
    const plan = planSinglePageSize({ width: 1280, height: 4000 });
    expect(buildPageRule(plan)).toBe(`@page { size: 1280px ${padded(4000)}px; margin: 0; }`);
  });

  it("emits the slice height, not the full height, when split", () => {
    const height = inches(MAX_PAPER_INCHES * 2.5);
    const plan = planSinglePageSize({ width: 800, height });
    const emitted = Number(/ (\d+)px;/.exec(buildPageRule(plan))?.[1]);
    expect(emitted).toBeLessThanOrEqual(MAX_PAPER_INCHES * 96);
    // The sheets together still cover the page (allowing for rounding).
    expect(emitted * plan.sheets).toBeGreaterThanOrEqual(height - plan.sheets);
  });
});

describe("buildSinglePageCss", () => {
  const css = buildSinglePageCss(planSinglePageSize({ width: 1000, height: 3000 }));

  it("includes the page rule", () => {
    expect(css).toContain(`@page { size: 1000px ${padded(3000)}px; margin: 0; }`);
  });

  it("neutralises forced breaks that would split the single page", () => {
    // A site's `page-break-before: always` otherwise splits the "single" page
    // with nothing to tell the user why. Chrome folds the legacy aliases into
    // these two properties, so these are the ones to assert.
    expect(css).toMatch(/break-before: auto !important/);
    expect(css).toMatch(/break-after: auto !important/);
    expect(css).toContain("*, *::before, *::after");
  });
});

describe("buildPrintCss with single-page mode", () => {
  it("omits the @page rule in paginated mode", () => {
    expect(buildPrintCss({ exactColors: true })).not.toContain("@page");
  });

  it("carries the measured page size in single-page mode", () => {
    const css = buildPrintCss({
      exactColors: true,
      singlePage: buildSinglePageCss(planSinglePageSize({ width: 900, height: 2000 })),
    });
    expect(css).toContain(`size: 900px ${padded(2000)}px`);
  });
});
