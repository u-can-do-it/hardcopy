/** Shared types. Kept free of chrome.* references so pure helpers stay testable. */

/**
 * Which way a PDF is made.
 *
 * - `"screen"` - one click: CDP renders the page with its screen styles and the
 *   file goes straight to Downloads. The default. Chrome shows its yellow
 *   "is debugging this browser" bar while it runs.
 * - `"print"` - `window.print()`: Chrome's own dialog, the site's print
 *   stylesheet, and no `debugger` at all.
 */
export type ExportMode = "print" | "screen";

/**
 * Paginated sheets vs one continuous page. The single page needs the `screen`
 * path: Chrome's print dialog takes its paper size from its own dropdown.
 */
export type PageMode = "paginated" | "single";

/**
 * What a screenshot covers: the whole document, or a rectangle the user drew
 * over the page.
 */
export type CaptureArea = "full" | "region";

/**
 * How a screenshot is encoded.
 *
 * WebP is the default because a screenshot is the worst case for PNG: a
 * photograph-like page of gradients, avatars and anti-aliased text encodes
 * losslessly at a size nobody wants to keep, and a full-page shot of a long
 * article ran past the 64MiB message ceiling on the way to being saved. PNG
 * stays available for anyone who wants the lossless original.
 */
export type ImageFormat = "webp" | "jpeg" | "png";

/**
 * What the bar has selected. `symbol` is qualified by a `SymbolKind` - the
 * dropdown is seven marks behind one tool.
 *
 * Seven members, and it went to nine and back again: task 27 added `rect-fill`
 * and `ellipse-fill` as tools of their own, and this pass removes them because
 * the user asked for **one menu common to both shapes** (`.plan/design.md` §18).
 * A fill is a `FillMode` on `DrawPrefs.fill` now - a pen setting like the width
 * and the colour, which is what lets one control serve the rectangle and the
 * ellipse instead of doubling the row of shape buttons for every mode added.
 *
 * The whole of annotate mode is Pro, so every tool here is offered whenever
 * the bar is up.
 */
export type DrawTool =
  | "pencil"
  | "highlighter"
  | "line"
  | "rect"
  | "ellipse"
  | "symbol"
  | "text";

/** The symbol palette. `pin` is the auto-incrementing numbered pin. */
export type SymbolKind =
  | "arrow"
  | "arrow-double"
  | "check"
  | "cross"
  | "bang"
  | "star"
  | "pin";

/**
 * Three steps, not a slider: a slider is a fiddly thing to hit on a bar
 * floating over someone's page, and nobody has ever needed 5px specifically.
 */
export type StrokeWidth = 2 | 4 | 8;

/**
 * How a rectangle or an ellipse is filled. A pen setting, not a tool.
 *
 * - `"none"` - an outline. The default, and what every rect and ellipse drawn
 *   before this existed is.
 * - `"tint"` - a translucent interior at `FILL_OPACITY`, outline still solid.
 *   A read-through block: the right mark for pointing at a region of a chart,
 *   and it does not touch the text underneath, which stays in the PDF and
 *   stays searchable.
 * - `"cover"` - a **solid** interior, no alpha, and the covered text is hidden
 *   so that it is not in the exported PDF's text layer at all
 *   (`lib/dom/cover.ts`, `.plan/design.md` §19).
 *
 * `"cover"` is the one member with a consequence outside the mark itself.
 * Read `.plan/design.md` §17 and §21 before changing anything about it - §21 is
 * the list of places it does *not* remove text, and a cross-origin iframe is a
 * genuine leak.
 */
export type FillMode = "none" | "tint" | "cover";

/**
 * The bar's position and the pen it was last holding.
 *
 * `chrome.storage.local`, deliberately not `sync`: one position for every
 * site, and a position synced from a 34-inch monitor onto a laptop is a bar
 * off the edge of the screen.
 */
export interface DrawPrefs {
  /** The bar's top-left in *viewport* coordinates. Clamped on load. */
  bar: { x: number; y: number };
  tool: DrawTool;
  symbol: SymbolKind;
  /** CSS colour, one of `DRAW_COLORS` or whatever the colour input returned. */
  color: string;
  width: StrokeWidth;
  /** Text tool, in CSS px. */
  fontSize: number;
  /**
   * The width a new text box opens at, in CSS px - the last width the frame
   * was resized to.
   *
   * Width only, and not the height: the height is derived on every keystroke
   * (`layoutText` grows it to fit), so a stored one would be a number that
   * describes how much text was in some previous label. You size a box once for
   * a page and then keep typing into boxes that size, which is the width.
   */
  textWidth: number;
  /**
   * The fill the next rectangle or ellipse gets. A pen setting, like the width
   * and the colour, so one menu serves both shapes.
   *
   * Persisted, so it survives a reload like the rest of the pen - which is
   * exactly why `FILL_NOTE`'s session-start branch exists (§27.3): somebody who
   * left the bar armed on `"cover"` must be told again what it does.
   */
  fill: FillMode;
}

/**
 * A rectangle in CSS pixels, in *document* coordinates - the origin is the top
 * of the page, not the top of the viewport, which is what `Page.captureScreenshot`
 * clips against.
 */
export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Everything the in-page pre-processing step needs to know. */
export interface PrepOptions {
  /** Hide `position: fixed|sticky` elements taller than `stickyMinHeight`. */
  hideSticky: boolean;
  /** Minimum rendered height (px) before a fixed/sticky element is hidden. */
  stickyMinHeight: number;
  /** Extra user-supplied CSS selectors to hide. */
  hideSelectors: string[];
  /** Open every `<details>` element. */
  expandDetails: boolean;
  /** Un-clip `overflow: hidden|auto|scroll` containers so nothing is cut off. */
  unlockScrollContainers: boolean;
  /** Scroll the page to fire lazy loaders, then scroll back. */
  loadLazyImages: boolean;
  /** Prepend a small title / URL / date block. */
  addHeader: boolean;
  /** Force `print-color-adjust: exact` so backgrounds survive. */
  exactColors: boolean;
}

export interface Settings {
  prep: PrepOptions;
  /** e.g. `{title}-{date}` - see lib/filename.ts for tokens. */
  filenameTemplate: string;
  /** One click (CDP) or Chrome's print dialog. */
  exportMode: ExportMode;
  /** Paginated or single long page. Only the `screen` path can honour `single`. */
  pageMode: PageMode;
  /** Encoding for screenshots. */
  imageFormat: ImageFormat;
}

/** Result of one in-page pre-processing run, reported back for the popup. */
export interface PrepReport {
  hiddenElements: number;
  detailsOpened: number;
  containersUnlocked: number;
  imagesForced: number;
  /** Non-fatal problems worth showing the user. */
  warnings: string[];
  /**
   * Set in single-page mode when the page was too tall for one sheet and had
   * to be split (PROJECT.md §4.2, "Single-page trap").
   */
  pageSizeNote?: string;
}
