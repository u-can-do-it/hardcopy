import { beforeEach, describe, expect, it } from "vitest";
import {
  filenameDraft,
  filenamePreview,
  previewPage,
  setPreviewPage,
} from "@/stores/drafts";

const SAMPLE_TITLE = "How Chrome prints a web page";

describe("filenamePreview", () => {
  beforeEach(() => {
    previewPage.value = { title: SAMPLE_TITLE, url: "https://example.com/blog/printing" };
    filenameDraft.value = "{title}-{date}";
  });

  it("previews the sample page until a caller knows better", () => {
    expect(filenamePreview.value).toContain(SAMPLE_TITLE);
  });

  it("names the page the popup is looking at", () => {
    setPreviewPage("Wirtualna Polska - Wszystko co ważne", "https://www.wp.pl/");
    filenameDraft.value = "{host}-{title}";
    expect(filenamePreview.value).toBe("wp.pl-Wirtualna Polska - Wszystko co ważne.pdf");
  });

  it("keeps the sample when the tab offers nothing to preview", () => {
    // A tab whose title and URL are both unreadable renders as the bare
    // fallback, which says nothing about the template.
    setPreviewPage(undefined, undefined);
    setPreviewPage("  ", "");
    expect(filenamePreview.value).toContain(SAMPLE_TITLE);
  });

  it("previews a title-less page rather than inventing one", () => {
    // The empty {title} leaves a dangling separator that sanitising trims, so
    // what the user sees is what they would actually get: just the date.
    setPreviewPage("", "https://news.ycombinator.com/item?id=1");
    expect(filenamePreview.value).toMatch(/^\d{4}-\d{2}-\d{2}\.pdf$/);

    filenameDraft.value = "{host}-{title}";
    expect(filenamePreview.value).toBe("news.ycombinator.com.pdf");
  });

  it("follows the template as it is typed", () => {
    setPreviewPage("Quarterly report", "https://example.org/q3");
    filenameDraft.value = "{host}";
    expect(filenamePreview.value).toBe("example.org.pdf");
  });
});
