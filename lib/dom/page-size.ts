/**
 * Single continuous page (project.md §1, "Single long page"). **One-click only.**
 *
 * This was briefly wired into the `window.print()` path on the assumption that
 * CSS Paged Media would be enough. It is not, and the feature needs the CDP
 * path. Measured on Chrome 152 with one document rendered three ways:
 *
 *   | @page size    | printToPDF result                  |
 *   | ------------- | ---------------------------------- |
 *   | absent        | 3 pages, 8.50x11.00in (Letter)     |
 *   | 1000px 3000px | 1 page, 10.42x31.25in              |
 *   | 10.4167in ... | 1 page, 10.42x31.25in (identical)  |
 *
 * So Chromium's print pipeline honours `@page { size }`, and px is as good as
 * a physical unit. But the *interactive* dialog takes its paper size from its
 * own dropdown and discards the CSS size - which is precisely why CDP exposes
 * `preferCSSPageSize`. A user who ticks the option through `window.print()`
 * gets ordinary Letter/A4 pagination and no explanation.
 *
 * Kept because the one-click path needs exactly this: either these declarations
 * plus `preferCSSPageSize: true`, or `planSinglePageSize` feeding `paperWidth` /
 * `paperHeight` directly, as `lib/pdf/print-options.ts` does today.
 */

import {
  CSS_PX_PER_INCH,
  planSinglePageSize,
  type ContentSize,
  type SinglePagePlan,
} from "../pdf/print-options";

/** Full scrollable extent of the document, in CSS pixels. */
export function measureContentSize(): ContentSize {
  const doc = document.documentElement;
  const body = document.body as HTMLElement | null;

  return {
    width: Math.max(doc.scrollWidth, body?.scrollWidth ?? 0, doc.clientWidth),
    height: Math.max(doc.scrollHeight, body?.scrollHeight ?? 0, doc.clientHeight),
  };
}

/** Measure the page and size one continuous sheet to fit it. */
export function planPageFromDocument(): SinglePagePlan {
  // planSinglePageSize adds its own headroom (SINGLE_PAGE_SLACK_PX).
  return planSinglePageSize(measureContentSize());
}

/**
 * The `@page` rule for a plan.
 *
 * Zero margins because the point is to match the screen; the page's own padding
 * already provides whatever gutter it wants, and a margin would reflow the
 * content to a narrower box than the height was measured against.
 */
export function buildPageRule(plan: SinglePagePlan): string {
  const width = (plan.widthIn * CSS_PX_PER_INCH).toFixed(0);
  const height = (plan.heightIn * CSS_PX_PER_INCH).toFixed(0);
  return `@page { size: ${width}px ${height}px; margin: 0; }`;
}

/**
 * Undo forced page breaks.
 *
 * Matters as much as the page size: one `page-break-before: always` left in a
 * site's stylesheet splits the "single" page in two - a sheet of content, then
 * whatever follows the break on a second, mostly empty one - and the user has
 * no way to see why. Confirmed on Chrome 152: a `break-before: page` in the
 * site's *screen* CSS produces two sheets from a document that otherwise fits
 * on one.
 *
 * Only the modern properties: Chrome maps the legacy `page-break-before` /
 * `page-break-after` aliases straight onto these (it even serialises them that
 * way), so listing both just doubles the rule.
 */
export const BREAK_RESET_CSS = `*, *::before, *::after {
  break-before: auto !important;
  break-after: auto !important;
}`;

/**
 * Everything the single-page mode contributes to the print stylesheet.
 *
 * Print-only, so this is the `window.print()` path's copy. The CDP path
 * renders with screen media emulated and sizes the paper itself, which leaves
 * a `media="print"` stylesheet inert - it injects `BREAK_RESET_CSS`
 * unconditioned instead (see lib/dom/prepare.ts).
 */
export function buildSinglePageCss(plan: SinglePagePlan): string {
  return `${buildPageRule(plan)}
${BREAK_RESET_CSS}`;
}
