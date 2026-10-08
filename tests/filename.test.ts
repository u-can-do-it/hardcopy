import { describe, expect, it } from "vitest";
import {
  MAX_FILENAME_LENGTH,
  hostOf,
  renderFilename,
  sanitiseSegment,
} from "@/lib/filename";

const url = "https://www.example.com/blog/post";
const date = new Date(2026, 8, 7, 14, 30, 5); // local time, 7 Sep 2026

describe("sanitiseSegment", () => {
  it("replaces the characters project.md §10.8 lists", () => {
    expect(sanitiseSegment('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
  });

  it("collapses separator runs and trims the edges", () => {
    expect(sanitiseSegment("  --hello--world--  ")).toBe("hello-world");
  });

  it("drops trailing dots, which Windows rejects", () => {
    expect(sanitiseSegment("report...")).toBe("report");
  });

  it("strips zero-width characters that titles smuggle in", () => {
    expect(sanitiseSegment("in​visible﻿")).toBe("invisible");
  });

  it("strips control characters", () => {
    expect(sanitiseSegment("tab\tand\nnewline")).toBe("tab and newline");
  });

  it("escapes Windows device names", () => {
    expect(sanitiseSegment("CON")).toBe("CON-page");
    expect(sanitiseSegment("com1")).toBe("com1-page");
    expect(sanitiseSegment("console")).toBe("console");
  });
});

describe("hostOf", () => {
  it("drops the www prefix", () => {
    expect(hostOf(url)).toBe("example.com");
  });

  it("returns empty for junk rather than throwing", () => {
    expect(hostOf("not a url")).toBe("");
    expect(hostOf(undefined)).toBe("");
  });
});

describe("renderFilename", () => {
  it("fills the documented tokens", () => {
    expect(renderFilename("{title}-{date}", { title: "My Post", url, date })).toBe(
      "My Post-2026-09-07.pdf",
    );
    expect(renderFilename("{host}_{time}", { url, date })).toBe("example.com_14-30-05.pdf");
  });

  it("leaves unknown tokens alone rather than blanking them", () => {
    // Braces are legal in a filename, so the token survives verbatim - better
    // than silently producing an empty name from a typo'd template.
    expect(renderFilename("{nope}", { title: "t", url, date })).toBe("{nope}.pdf");
  });

  it("falls back to the hostname when the title is empty", () => {
    expect(renderFilename("{title}", { title: "   ", url, date })).toBe("example.com.pdf");
  });

  it("falls back to 'page' when there is nothing at all", () => {
    expect(renderFilename("{title}", {})).toBe("page.pdf");
  });

  it("trims the separator left behind by an empty token", () => {
    expect(renderFilename("{title}-{date}", { url, date })).toBe("2026-09-07.pdf");
  });

  it("caps the length including the extension", () => {
    const out = renderFilename("{title}", { title: "a".repeat(400), url, date });
    expect(out.length).toBe(MAX_FILENAME_LENGTH);
    expect(out.endsWith(".pdf")).toBe(true);
  });

  it("never returns a name that is only an extension", () => {
    expect(renderFilename("///", { url: "https://x.test" })).toBe("x.test.pdf");
  });
});
