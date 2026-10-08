/**
 * The injected `<style media="print">` (project.md §4.1 step 2).
 */

import type { Undo } from "./style";

export const STYLE_ATTR = "data-pagepdf-print-css";

/**
 * Always applied. Sites routinely pin `body` to the viewport height with
 * `overflow: hidden`, and Chrome then prints exactly one page of a long
 * article - the single most common "this extension is broken" report there is.
 */
export const BASE_PRINT_CSS = `
html, body {
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  overflow: visible !important;
}
`;

/** Opt-in: keep backgrounds and dark themes instead of Chrome's white-out. */
export const EXACT_COLORS_CSS = `
*, *::before, *::after {
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}
`;

export interface PrintCssOptions {
  exactColors: boolean;
  /** Single-page mode's `@page` rule and break reset, from lib/dom/page-size.ts. */
  singlePage?: string | undefined;
}

export function buildPrintCss(opts: PrintCssOptions): string {
  const parts = [BASE_PRINT_CSS];
  if (opts.singlePage) parts.push(opts.singlePage);
  if (opts.exactColors) parts.push(EXACT_COLORS_CSS);
  return parts.join("\n");
}

/**
 * Hide `<noscript>` blocks.
 *
 * The one-click path freezes the page's scripts before it measures, and
 * Chrome's UA stylesheet only hides `noscript` while scripting is *enabled* -
 * so turning scripting off reveals every one of them. Worse, a document parsed
 * with scripting on holds their contents as a plain text node, so what surfaces
 * is raw markup: a tracking pixel's `<img src="https://..." width="1" height="1">`
 * printed as words under the footer. Reported on wp.pl; not reproduced here
 * headless, where the same page kept its single `noscript` unrendered either
 * way. The rule is right regardless - the user never saw that text on screen,
 * so it does not belong in a PDF meant to look like the screen.
 */
export const HIDE_NOSCRIPT_CSS = `noscript { display: none !important; }`;

function injectStyle(css: string, media: string | null): Undo {
  const style = document.createElement("style");
  style.setAttribute(STYLE_ATTR, "");
  if (media) style.media = media;
  style.textContent = css;
  (document.head ?? document.documentElement).appendChild(style);
  return () => style.remove();
}

export function injectPrintCss(opts: PrintCssOptions): Undo {
  return injectStyle(buildPrintCss(opts), "print");
}

/**
 * Inject rules that must survive `Emulation.setEmulatedMedia({media:"screen"})`.
 *
 * The one-click path renders the PDF with the site's *screen* CSS - that is the
 * whole "looks like the screen" feature - and a `media="print"` stylesheet does
 * not match under it. Anything that path needs from the print stylesheet has to
 * be injected without a media condition instead.
 */
export function injectUnconditionalCss(css: string): Undo {
  return injectStyle(css, null);
}
