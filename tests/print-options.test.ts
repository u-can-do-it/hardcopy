import { describe, expect, it } from "vitest";
import {
  A4_HEIGHT_INCHES,
  CSS_PX_PER_INCH,
  MAX_PAPER_INCHES,
  SINGLE_PAGE_SLACK_PX,
  planPrintToPdf,
} from "@/lib/pdf/print-options";

const inches = (n: number) => n * CSS_PX_PER_INCH;
/** Paper height the planner should choose for a page of `heightPx`. */
const padded = (heightPx: number) => (heightPx + SINGLE_PAGE_SLACK_PX) / CSS_PX_PER_INCH;

describe("planPrintToPdf", () => {
  it("keeps the screen width so the PDF matches the screen", () => {
    const plan = planPrintToPdf({ width: 1280, height: 3000 }, "paginated");
    expect(plan.params.paperWidth).toBeCloseTo(1280 / 96, 5);
    expect(plan.params.paperHeight).toBe(A4_HEIGHT_INCHES);
  });

  it("always asks for backgrounds, zero margins and a stream", () => {
    const { params } = planPrintToPdf({ width: 1000, height: 1000 }, "single");
    expect(params.printBackground).toBe(true);
    expect(params.transferMode).toBe("ReturnAsStream");
    expect(params.displayHeaderFooter).toBe(false);
    expect(params.preferCSSPageSize).toBe(false);
    expect(
      [params.marginTop, params.marginBottom, params.marginLeft, params.marginRight],
    ).toEqual([0, 0, 0, 0]);
  });

  it("makes one tall sheet, with headroom, when single-page mode fits", () => {
    const plan = planPrintToPdf({ width: 1000, height: inches(50) }, "single");
    expect(plan.params.paperHeight).toBeCloseTo(padded(inches(50)), 5);
    expect(plan.sheets).toBe(1);
    expect(plan.split).toBe(false);
    expect(plan.note).toBeUndefined();
  });

  it("keeps a page that fills the ceiling exactly on one sheet", () => {
    const height = inches(MAX_PAPER_INCHES) - SINGLE_PAGE_SLACK_PX;
    const plan = planPrintToPdf({ width: 1000, height }, "single");
    expect(plan.params.paperHeight).toBeCloseTo(MAX_PAPER_INCHES, 5);
    expect(plan.sheets).toBe(1);
    expect(plan.split).toBe(false);
  });

  it("keeps the §9 matrix's 40,000px page on one sheet", () => {
    // ~417in. Chrome renders that in a single page; it only looked impossible
    // under the old 190in cap.
    const plan = planPrintToPdf({ width: 1280, height: 40000 }, "single");
    expect(plan.sheets).toBe(1);
    expect(plan.split).toBe(false);
    expect(plan.params.paperHeight).toBeCloseTo(padded(40000), 5);
  });

  it("slices past the ceiling into equal sheets, none over the limit", () => {
    const height = inches(MAX_PAPER_INCHES * 2.5);
    const plan = planPrintToPdf({ width: 1280, height }, "single");
    expect(plan.split).toBe(true);
    expect(plan.sheets).toBe(3);
    expect(plan.params.paperHeight).toBeLessThanOrEqual(MAX_PAPER_INCHES);
    // Equal slices: sheets * height covers the whole page exactly.
    expect(plan.params.paperHeight * plan.sheets).toBeCloseTo(padded(height), 5);
    expect(plan.note).toMatch(/split into 3 equal sheets/);
  });

  it("clamps an absurdly wide page instead of asking Chromium to refuse", () => {
    const plan = planPrintToPdf({ width: inches(900), height: 2000 }, "paginated");
    expect(plan.params.paperWidth).toBe(MAX_PAPER_INCHES);
  });

  it("estimates sheet count in paginated mode", () => {
    const plan = planPrintToPdf(
      { width: 1000, height: inches(A4_HEIGHT_INCHES * 3) },
      "paginated",
    );
    expect(plan.sheets).toBe(3);
  });

  it("degrades to A4 on a nonsense content size rather than producing NaN paper", () => {
    for (const bad of [
      { width: 0, height: 0 },
      { width: Number.NaN, height: Number.NaN },
      { width: -100, height: -100 },
    ]) {
      const plan = planPrintToPdf(bad, "single");
      expect(Number.isFinite(plan.params.paperWidth)).toBe(true);
      expect(Number.isFinite(plan.params.paperHeight)).toBe(true);
      expect(plan.params.paperHeight).toBeGreaterThan(0);
      expect(plan.sheets).toBe(1);
    }
  });
});

describe("planPrintToPdf with a trimmed height", () => {
  it("caps the sheets so a measured-blank tail cannot spill onto more", () => {
    // 3,000px of content inside a 23,000px document: without the cap, cutting
    // the paper to the content turns one tall sheet into four.
    const plan = planPrintToPdf({ width: 1200, height: 3000 }, "single", { trimmed: true });
    expect(plan.params.pageRanges).toBe("1");
    expect(plan.sheets).toBe(1);
  });

  it("keeps every sheet of a page that had to be split", () => {
    const tall = inches(MAX_PAPER_INCHES) * 2;
    const plan = planPrintToPdf({ width: 1200, height: tall }, "single", { trimmed: true });
    expect(plan.params.pageRanges).toBe(`1-${plan.sheets}`);
    expect(plan.sheets).toBeGreaterThan(1);
  });

  it("leaves an untrimmed export uncapped, so a surprise sheet stays visible", () => {
    expect(planPrintToPdf({ width: 1200, height: 3000 }, "single").params.pageRanges).toBeUndefined();
    expect(
      planPrintToPdf({ width: 1200, height: 3000 }, "paginated", { trimmed: true }).params.pageRanges,
    ).toBeUndefined();
  });
});
