/**
 * Orchestrates one pre-processing pass and hands back a single undo
 * (project.md §4.1). Used by the print path before window.print(), and by the
 * one-click path before driving CDP.
 */

import type { PageMeta } from "../messages";
import type { PageMode, PrepOptions, PrepReport } from "../types";
import { expandDetails, unlockScrollContainers } from "./expand";
import { addHeaderBlock } from "./header";
import { hideFixedElements } from "./hide-fixed";
import { loadLazyImages } from "./lazy";
import { BREAK_RESET_CSS, buildSinglePageCss, planPageFromDocument } from "./page-size";
import { HIDE_NOSCRIPT_CSS, injectPrintCss, injectUnconditionalCss } from "./print-css";
import { undoAll, type Undo } from "./style";
import { freezeViewportUnits } from "./viewport-units";

export interface Prepared {
  report: PrepReport;
  /** Idempotent; safe to call from both `afterprint` and a timeout. */
  undo: Undo;
}

export interface PrepareContext {
  /**
   * The caller renders the PDF with screen media emulated and sizes the paper
   * from this document - the one-click CDP path in `handleScreenExport`.
   *
   * Two things follow, and both are why single-page mode used to come back as
   * two sheets. A `media="print"` stylesheet never matches under screen
   * emulation, so anything single-page mode needs from it has to be injected
   * unconditioned; and the paper about to be cut to this document's height
   * becomes the reference for every `vh` on the page, so those lengths have to
   * be pinned before it is measured. See lib/dom/viewport-units.ts.
   */
  screenMedia: boolean;
}

/**
 * Order is deliberate:
 *   expand and un-clip first, so the lazy-load scroll passes over content that
 *   is actually laid out; hide fixed furniture after, so heights are measured
 *   at final layout; styles last, so nothing we inject gets un-clipped.
 */
export async function prepareForExport(
  prep: PrepOptions,
  meta: PageMeta,
  pageMode: PageMode = "paginated",
  context: PrepareContext = { screenMedia: false },
): Promise<Prepared> {
  const undos: Undo[] = [];
  const report: PrepReport = {
    hiddenElements: 0,
    detailsOpened: 0,
    containersUnlocked: 0,
    imagesForced: 0,
    warnings: [],
  };

  if (prep.expandDetails) {
    const r = expandDetails();
    report.detailsOpened = r.count;
    undos.push(r.undo);
  }

  if (prep.unlockScrollContainers) {
    const r = unlockScrollContainers();
    report.containersUnlocked = r.count;
    undos.push(r.undo);
  }

  if (prep.loadLazyImages) {
    const r = await loadLazyImages();
    report.imagesForced = r.forced;
    report.warnings.push(...r.warnings);
  }

  if (prep.hideSticky || prep.hideSelectors.length > 0) {
    const r = hideFixedElements({
      // A disabled toggle still honours explicit user selectors; an unreachable
      // minHeight is how we express "selectors only".
      minHeight: prep.hideSticky ? prep.stickyMinHeight : Number.POSITIVE_INFINITY,
      extraSelectors: prep.hideSelectors,
    });
    report.hiddenElements = r.count;
    report.warnings.push(...r.warnings);
    undos.push(r.undo);
  }

  if (prep.addHeader) {
    undos.push(addHeaderBlock(meta));
  }

  // Measured last, once the DOM is at its final height: expanding sections,
  // un-clipping containers and loading images all change it, and a sheet sized
  // from the "before" height cuts content off.
  let singlePage: string | undefined;
  if (pageMode === "single") {
    if (context.screenMedia) {
      // Before the measurement, and before the background asks CDP for its
      // own: paper cut to this document turns every `100vh` into a page-tall
      // block, which is what put a second, near-empty sheet on the end.
      undos.push(freezeViewportUnits().undo);
      undos.push(injectUnconditionalCss(`${BREAK_RESET_CSS}\n${HIDE_NOSCRIPT_CSS}`));
    }
    const plan = planPageFromDocument();
    singlePage = buildSinglePageCss(plan);
    if (plan.note) report.pageSizeNote = plan.note;
  }

  undos.push(
    injectPrintCss({
      exactColors: prep.exactColors,
      singlePage,
    }),
  );

  let undone = false;
  return {
    report,
    undo: () => {
      if (undone) return;
      undone = true;
      undoAll(undos);
    },
  };
}
