import { describe, expect, it } from "vitest";
import { canInject } from "@/lib/urls";

describe("canInject", () => {
  it("allows ordinary pages", () => {
    expect(canInject("https://example.com/a").ok).toBe(true);
    expect(canInject("http://localhost:3000/").ok).toBe(true);
  });

  it("rejects the privileged schemes from project.md §10.3", () => {
    for (const url of [
      "chrome://settings",
      "chrome-extension://abc/page.html",
      "devtools://devtools/bundled/x.html",
      "view-source:https://example.com",
      "about:blank",
      "data:text/html,hi",
    ]) {
      expect(canInject(url).ok, url).toBe(false);
    }
  });

  it("rejects the Web Store, both hostnames", () => {
    expect(canInject("https://chromewebstore.google.com/detail/x").ok).toBe(false);
    expect(canInject("https://chrome.google.com/webstore/detail/x").ok).toBe(false);
    // The rest of chrome.google.com is not the store.
    expect(canInject("https://chrome.google.com/other").ok).toBe(true);
  });

  it("rejects the built-in PDF viewer", () => {
    const verdict = canInject("https://example.com/paper.PDF");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/already a PDF/);
  });

  it("gives a reason for every rejection", () => {
    const verdict = canInject("chrome://settings");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason.length).toBeGreaterThan(10);
  });

  it("handles a missing or unparseable url", () => {
    expect(canInject(undefined).ok).toBe(false);
    expect(canInject("¯\\_(ツ)_/¯").ok).toBe(false);
  });

  it("allows file URLs - the extra opt-in is Chrome's to enforce", () => {
    expect(canInject("file:///Users/me/doc.html").ok).toBe(true);
  });
});
