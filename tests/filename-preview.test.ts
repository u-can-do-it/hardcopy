import { beforeEach, describe, expect, it } from "vitest";
import { filenameDraft, filenamePreview, SAMPLE_PAGE } from "@/stores/drafts";

describe("filenamePreview", () => {
  beforeEach(() => {
    filenameDraft.value = "{title}-{date}";
  });

  it("previews the sample page", () => {
    expect(filenamePreview.value).toContain(SAMPLE_PAGE.title);
  });

  it("follows the template as it is typed", () => {
    filenameDraft.value = "{host}";
    expect(filenamePreview.value).toBe("example.com.pdf");
  });
});
