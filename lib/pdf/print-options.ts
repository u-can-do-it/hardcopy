/**
 * Page.printToPDF parameter builder (project.md §4.2 step 6).
 *
 * Pure module - covered by tests/print-options.test.ts.
 *
 * One correction to the spec worth knowing: §4.2 describes tall single-page
 * exports as "chunks of <= 190 in merged with pdf-lib". No merge is needed.
 * printToPDF paginates by itself, so a 400 in page asked for on 190 in paper
 * comes back as one PDF containing three sheets. What we choose is the slice
 * height; Chromium does the slicing.
 */

import type { PageMode } from "../types";

export const CSS_PX_PER_INCH = 96;

/**
 * The page's height, straight from the DOM, evaluated in the tab.
 *
 * Sent as a string because it runs through Runtime.evaluate after script
 * execution is disabled - which stops the page's scripts, not CDP's own
 * evaluation.
 */
export const DOCUMENT_HEIGHT_EXPRESSION =
  "Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)";

/**
 * Tallest single sheet we will ask Chromium for.
 *
 * Measured on Chrome 152, one page of the requested height came out intact at
 * every size tried: 190, 200, 213, 250, 300, 400 and 500 in - there is no
 * ~200in "practical ceiling" (ARCHITECTURE.md Decision 4).
 *
 * 500in (48,000px) is where this stops, not because Chromium refuses but
 * because rendering and memory grow with it - a 213in page already weighs
 * ~70MB. Anything taller is split into equal sheets.
 */
export const MAX_PAPER_INCHES = 500;

/**
 * Headroom added to the measured height of a single continuous page.
 *
 * Paper sized to the *exact* measured height is a coin flip: a late-arriving
 * image, a font swap or a sub-pixel rounding difference makes the print layout
 * a few pixels taller than the measurement, the content overflows, and because
 * every sheet in a PDF has the same size the result is two sheets - the second
 * one near-empty with the page background stretched across it. A thin unused
 * strip at the bottom is a far better trade than a phantom second page.
 */
export const SINGLE_PAGE_SLACK_PX = 32;

export const A4_WIDTH_INCHES = 8.27;
export const A4_HEIGHT_INCHES = 11.69;

export interface ContentSize {
  width: number;
  height: number;
}

export interface PrintToPdfParams {
  printBackground: boolean;
  preferCSSPageSize: boolean;
  paperWidth: number;
  paperHeight: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  displayHeaderFooter: boolean;
  transferMode: "ReturnAsStream";
  /**
   * Sheets to keep, e.g. "1-3". Set only when the paper was cut to a measured
   * *painted* height rather than the document's own - see `planPrintToPdf`.
   */
  pageRanges?: string;
}

export interface PrintPlan {
  params: PrintToPdfParams;
  /** Expected sheet count. An estimate: Chromium breaks content its own way. */
  sheets: number;
  /** True when single-page mode exceeded the ceiling and had to slice. */
  split: boolean;
  /** User-facing explanation, present only when `split`. */
  note?: string;
}

/** Paper size for one continuous page, shared by the CDP and CSS `@page` paths. */
export interface SinglePagePlan {
  widthIn: number;
  heightIn: number;
  /** How many sheets this height produces. 1 unless the page was too tall. */
  sheets: number;
  split: boolean;
  note?: string;
}

function px(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function toInches(pixels: number): number {
  return pixels / CSS_PX_PER_INCH;
}

function groupThousands(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Tallest single PDF page: the format's own 14,400pt limit, minus headroom. */
export const MAX_SINGLE_PAGE_PX = MAX_PAPER_INCHES * CSS_PX_PER_INCH;

export function describeSplit(sheets: number, heightPx: number): string {
  return (
    `Page is ${groupThousands(heightPx)} px tall and one PDF page can only be ` +
    `${groupThousands(MAX_SINGLE_PAGE_PX)} px, so it was split into ` +
    `${sheets} equal sheets.`
  );
}

/**
 * Size a single continuous page from the content's own dimensions.
 *
 * Past the ceiling the height becomes equal slices rather than "190 in until it
 * runs out", which would leave a near-empty final sheet. Used by
 * `planPrintToPdf` for the one-click path's printToPDF call and by
 * `lib/dom/page-size.ts` to build the `@page { size }` rule for the print
 * stylesheet.
 */
export function planSinglePageSize(content: ContentSize): SinglePagePlan {
  const widthPx = px(content.width);
  const heightPx = px(content.height);

  const widthIn = widthPx ? Math.min(toInches(widthPx), MAX_PAPER_INCHES) : A4_WIDTH_INCHES;
  const wanted = toInches(heightPx > 0 ? heightPx + SINGLE_PAGE_SLACK_PX : 0);

  if (wanted <= 0) {
    return { widthIn, heightIn: A4_HEIGHT_INCHES, sheets: 1, split: false };
  }
  if (wanted <= MAX_PAPER_INCHES) {
    return { widthIn, heightIn: wanted, sheets: 1, split: false };
  }

  const sheets = Math.ceil(wanted / MAX_PAPER_INCHES);
  return {
    widthIn,
    heightIn: wanted / sheets,
    sheets,
    split: true,
    note: describeSplit(sheets, heightPx),
  };
}

export interface PrintPlanOptions {
  /**
   * The height in `content` is where the page stops *painting*, below the
   * document's own height, because the tail was measured as blank
   * (lib/pdf/painted-height.ts).
   *
   * That changes what a spill means. Paper shorter than the document leaves a
   * remainder, and Chromium puts the remainder on further sheets - so trimming
   * a 23,000px document to its 3,000px of content would have replaced one tall
   * sheet with four. The blank tail is discarded with `pageRanges` instead.
   *
   * Only ever set when the trim was measured. Without it a surprise spill still
   * shows up as an extra sheet, which is visible and can be investigated; with
   * it, content would go missing silently.
   */
  trimmed?: boolean;
}

/**
 * Build printToPDF params from the page's own content size.
 *
 * Paper is as wide as the content so the PDF matches what is on screen rather
 * than reflowing to A4; margins are zero for the same reason.
 */
export function planPrintToPdf(
  content: ContentSize,
  pageMode: PageMode,
  options: PrintPlanOptions = {},
): PrintPlan {
  const single = planSinglePageSize(content);

  let paperHeight: number;
  let sheets: number;
  let split = false;
  let note: string | undefined;

  if (pageMode === "single") {
    paperHeight = single.heightIn;
    sheets = single.sheets;
    split = single.split;
    note = single.note;
  } else {
    paperHeight = A4_HEIGHT_INCHES;
    sheets = Math.max(1, Math.ceil(toInches(px(content.height)) / A4_HEIGHT_INCHES));
  }

  const capSheets = options.trimmed === true && pageMode === "single";

  return {
    params: {
      printBackground: true,
      preferCSSPageSize: false,
      paperWidth: single.widthIn,
      paperHeight,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
      displayHeaderFooter: false,
      transferMode: "ReturnAsStream",
      ...(capSheets ? { pageRanges: sheets === 1 ? "1" : `1-${sheets}` } : {}),
    },
    sheets,
    split,
    ...(note === undefined ? {} : { note }),
  };
}
