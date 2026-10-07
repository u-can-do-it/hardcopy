import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, effectivePageMode, mergeSettings } from "@/lib/settings";

describe("mergeSettings", () => {
  it("returns defaults for nothing stored", () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings("garbage")).toEqual(DEFAULT_SETTINGS);
  });

  it("does not hand back the shared default object", () => {
    const merged = mergeSettings(null);
    merged.prep.hideSelectors.push("mutated");
    expect(DEFAULT_SETTINGS.prep.hideSelectors).toEqual([]);
  });

  it("keeps stored values", () => {
    const merged = mergeSettings({
      prep: { hideSticky: false, stickyMinHeight: 120 },
      filenameTemplate: "{host}",
      pageMode: "single",
    });
    expect(merged.prep.hideSticky).toBe(false);
    expect(merged.prep.stickyMinHeight).toBe(120);
    expect(merged.filenameTemplate).toBe("{host}");
    expect(merged.pageMode).toBe("single");
  });

  it("fills in fields a previous version never wrote", () => {
    const merged = mergeSettings({ prep: { hideSticky: false } });
    expect(merged.prep.expandDetails).toBe(DEFAULT_SETTINGS.prep.expandDetails);
  });

  it("replaces wrongly typed fields instead of throwing", () => {
    const merged = mergeSettings({
      prep: { hideSticky: "yes", stickyMinHeight: "tall", hideSelectors: "nope" },
      filenameTemplate: 42,
    });
    expect(merged.prep.hideSticky).toBe(DEFAULT_SETTINGS.prep.hideSticky);
    expect(merged.prep.stickyMinHeight).toBe(DEFAULT_SETTINGS.prep.stickyMinHeight);
    expect(merged.prep.hideSelectors).toEqual([]);
    expect(merged.filenameTemplate).toBe(DEFAULT_SETTINGS.filenameTemplate);
  });

  it("clamps the sticky threshold to a sane range", () => {
    expect(mergeSettings({ prep: { stickyMinHeight: -50 } }).prep.stickyMinHeight).toBe(0);
    expect(mergeSettings({ prep: { stickyMinHeight: 99999 } }).prep.stickyMinHeight).toBe(2000);
    expect(mergeSettings({ prep: { stickyMinHeight: Number.NaN } }).prep.stickyMinHeight).toBe(
      DEFAULT_SETTINGS.prep.stickyMinHeight,
    );
  });

  it("cleans the selector list", () => {
    const merged = mergeSettings({
      prep: { hideSelectors: ["  .a  ", "", "  ", ".b", 7] },
    });
    expect(merged.prep.hideSelectors).toEqual([".a", ".b"]);
  });

  it("refuses an empty filename template", () => {
    expect(mergeSettings({ filenameTemplate: "   " }).filenameTemplate).toBe(
      DEFAULT_SETTINGS.filenameTemplate,
    );
  });

  it("falls back to paginated for an unknown page mode", () => {
    expect(mergeSettings({ pageMode: "sideways" }).pageMode).toBe("paginated");
  });

  it("defaults to one-click export and keeps the print dialog once chosen", () => {
    expect(DEFAULT_SETTINGS.exportMode).toBe("screen");
    expect(mergeSettings({ exportMode: "print" }).exportMode).toBe("print");
  });

  it("treats an unknown export mode - a stored `batch` included - as one-click", () => {
    expect(mergeSettings({ exportMode: "batch" }).exportMode).toBe("screen");
    expect(mergeSettings({ exportMode: 3 }).exportMode).toBe("screen");
  });
});

describe("effectivePageMode", () => {
  it("gives the one-click path the mode it asked for", () => {
    expect(effectivePageMode("single", "screen")).toBe("single");
    expect(effectivePageMode("paginated", "screen")).toBe("paginated");
  });

  it("paginates for the print dialog, whatever storage says", () => {
    // Chrome's dialog picks the paper itself and discards `@page { size }`.
    expect(effectivePageMode("single", "print")).toBe("paginated");
  });

  it("does not let a per-run override reach the print dialog", () => {
    expect(effectivePageMode("paginated", "print", "single")).toBe("paginated");
    expect(effectivePageMode("paginated", "screen", "single")).toBe("single");
  });

  it("lets an override take single back to paginated", () => {
    expect(effectivePageMode("single", "screen", "paginated")).toBe("paginated");
  });

  it("falls back to paginated for an unknown override", () => {
    expect(effectivePageMode("single", "screen", "sideways" as never)).toBe("paginated");
  });
});
