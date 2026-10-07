import { describe, expect, it } from "vitest";
import { BASE_PRINT_CSS, buildPrintCss } from "@/lib/dom/print-css";

describe("buildPrintCss", () => {
  it("always un-pins body height - the one-page-only bug", () => {
    const css = buildPrintCss({ exactColors: false });
    expect(css).toContain(BASE_PRINT_CSS.trim().split("\n")[0] as string);
    expect(css).toMatch(/overflow: visible !important/);
  });

  it("adds colour preservation only when asked", () => {
    expect(buildPrintCss({ exactColors: true })).toMatch(
      /print-color-adjust: exact/,
    );
    expect(buildPrintCss({ exactColors: false })).not.toMatch(
      /print-color-adjust: exact/,
    );
  });
});
