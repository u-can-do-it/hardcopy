/**
 * Where we are and are not allowed to operate (project.md §10.3).
 *
 * Both export paths need this: the print path cannot inject a script into a
 * privileged page, and the one-click path additionally cannot attach the
 * debugger to one. Getting a clear message out beats a silent no-op, which is
 * what users read as "broken".
 * Pure module - covered by tests/urls.test.ts.
 */

export type UrlVerdict = { ok: true } | { ok: false; reason: string };

const OK: UrlVerdict = { ok: true };

/** Schemes no extension may script, whatever permissions it holds. */
const BLOCKED_SCHEMES: Record<string, string> = {
  "chrome:": "Chrome's own pages are off-limits to extensions.",
  "chrome-untrusted:": "Chrome's own pages are off-limits to extensions.",
  "chrome-extension:": "Extension pages are off-limits to other extensions.",
  "moz-extension:": "Extension pages are off-limits to other extensions.",
  "devtools:": "DevTools pages cannot be exported.",
  "edge:": "The browser's own pages are off-limits to extensions.",
  "about:": "There is nothing on this page to export.",
  "view-source:": "View-source pages cannot be exported.",
  "data:": "Data URLs cannot be exported.",
};

/** Chrome blocks extensions on its own storefront. */
function isWebStore(u: URL): boolean {
  if (u.hostname === "chromewebstore.google.com") return true;
  return u.hostname === "chrome.google.com" && u.pathname.startsWith("/webstore");
}

/** The built-in PDF viewer hosts a plugin, not a DOM we can usefully print. */
function isPdfViewer(u: URL): boolean {
  return u.pathname.toLowerCase().endsWith(".pdf");
}

/**
 * Can we inject the pre-processing script here? This is the gate for every
 * route that does without the debugger - the print path among them.
 */
export function canInject(url: string | undefined): UrlVerdict {
  if (!url) return { ok: false, reason: "This tab has no page loaded yet." };

  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "This tab's address could not be read." };
  }

  const blocked = BLOCKED_SCHEMES[u.protocol];
  if (blocked) return { ok: false, reason: blocked };

  if (isWebStore(u)) {
    return { ok: false, reason: "Chrome blocks extensions on the Web Store." };
  }
  if (isPdfViewer(u)) {
    return { ok: false, reason: "This is already a PDF - use the viewer's own save button." };
  }
  if (u.protocol === "file:") {
    // Injectable, but only when the user has ticked "Allow access to file URLs"
    // on the extension's details page. Say so up front rather than failing oddly.
    return { ok: true };
  }

  return OK;
}

/**
 * Can we attach chrome.debugger here? Everything canInject() rejects, plus
 * nothing extra today - kept separate because the CDP path may need to add to
 * it (a tab already claimed by another debugger client, for instance).
 */
export function canAttachDebugger(url: string | undefined): UrlVerdict {
  return canInject(url);
}
