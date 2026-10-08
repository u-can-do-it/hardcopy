/**
 * Service worker: orchestrates exports (project.md §3).
 *
 * Every step re-checks the tab, because the user can close it at any moment
 * and a service worker that assumes otherwise throws in the user's face.
 */

import { encodingFor, type ImageEncoding } from "@/lib/capture/format";
import { isUsableSelection, MAX_IMAGE_AREA_PX, planCapture } from "@/lib/capture/plan";
import { stitchImage } from "@/lib/capture/stitch";
import { base64ToBytes, CdpSession, hasDebuggerPermission, withDebugger } from "@/lib/cdp";
import {
  commandToast,
  isCommandName,
  requestForCommand,
  type CommandName,
} from "@/lib/commands";
import { downloadBytes, downloadPdf } from "@/lib/download";
import { loadDrawPrefs } from "@/lib/draw/prefs";
import { renderFilename } from "@/lib/filename";
import { isPro } from "@/lib/license";
import {
  CANVAS_BACKGROUND_EXPRESSION,
  choosePaintedHeight,
  decodeImagePixels,
  paintedHeightFromScan,
  parseRgb,
  pickScanScale,
} from "@/lib/pdf/painted-height";
import { DOCUMENT_HEIGHT_EXPRESSION, planPrintToPdf } from "@/lib/pdf/print-options";
import {
  fail,
  type AnnotateExportRequest,
  type AnnotateRequest,
  type AnnotateSuccess,
  type BgRequest,
  type BgResponse,
  type CaptureRequest,
  type CaptureSuccess,
  type Failure,
  type ExportRequest,
  type PageMeta,
  type PageResponse,
  type StateSuccess,
} from "@/lib/messages";
import { effectivePageMode, loadSettings } from "@/lib/settings";
import type { CaptureRect, PrepOptions, Settings } from "@/lib/types";
import { canAttachDebugger, canInject } from "@/lib/urls";
import { defineBackground } from "wxt/utils/define-background";

/** Built by WXT from entrypoints/prepare.ts. */
const PREPARE_SCRIPT = "prepare.js";
/** Built by WXT from entrypoints/select-area.ts. */
const SELECT_SCRIPT = "select-area.js";
/** Built by WXT from entrypoints/annotate.ts. */
const ANNOTATE_SCRIPT = "annotate.js";

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function tabStillOpen(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Inject the pre-processing script. Safe to call repeatedly: the script guards
 * against double installation itself.
 */
async function injectScript(
  tabId: number,
  file: string,
): Promise<{ ok: true } | ReturnType<typeof fail>> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: [file],
    });
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/file:|Cannot access/i.test(detail)) {
      return fail(
        "INJECT_FAILED",
        "Chrome would not let the extension run here. For local files, enable " +
          '"Allow access to file URLs" on the extension\'s details page.',
      );
    }
    return fail("INJECT_FAILED", `Could not run on this page: ${detail}`);
  }
}

function injectPrepareScript(tabId: number): ReturnType<typeof injectScript> {
  return injectScript(tabId, PREPARE_SCRIPT);
}

function mergePrep(base: PrepOptions, overrides: Partial<PrepOptions> | undefined): PrepOptions {
  return overrides ? { ...base, ...overrides } : base;
}

/**
 * The document's height, trimmed to where it actually paints.
 *
 * Falls back to the nominal height whenever the scan cannot be taken or does
 * not look trustworthy - see lib/pdf/painted-height.ts. Leaving a blank strip
 * on the end is a much smaller failure than clipping the page.
 */
async function paintedHeight(
  session: CdpSession,
  width: number,
  nominalPx: number,
): Promise<number> {
  try {
    const scale = pickScanScale(nominalPx);
    const png = await session.captureScaledPage(width, nominalPx, scale);
    if (!png) return nominalPx;

    const scan = await decodeImagePixels(png);
    const background = parseRgb(await session.evaluate<string>(CANVAS_BACKGROUND_EXPRESSION));
    return choosePaintedHeight(nominalPx, paintedHeightFromScan(scan, scale, background));
  } catch {
    return nominalPx;
  }
}

/**
 * Take our own annotate furniture out of a capture, and put it back.
 *
 * Best-effort and **stateless**, the way `reportInPage` is: nothing here knows
 * or records whether annotate mode is running in this tab. When it is not, the
 * send simply fails - no annotate script is listening - and nothing happens. So
 * there is no flag to keep and nothing that can get out of step, which is the
 * whole reason the two capture paths can carry this without gaining any
 * bookkeeping (.plan/design.md §4.3, contracts.md §15).
 *
 * `false` hides the bar, which is `position: fixed` and would otherwise repeat
 * on every printed sheet, and drops the layer's `pointer-events` so the region
 * selector can have the pointer. The layer stays *visible* throughout: the
 * marks are the point of the export.
 *
 * `window.print()` needs none of this - the page hides the bar on `beforeprint`
 * itself - so only the two CDP paths call it, and that is what keeps the bar out
 * of a screenshot or a one-click PDF started from the popup, which does not know
 * annotate mode exists.
 */
async function setAnnotateUi(tabId: number, visible: boolean): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PAGE_ANNOTATE_UI", visible });
  } catch {
    // Nobody is drawing in this tab, so there was nothing to hide.
  }
}

/**
 * One-click export (project.md §4.2): no dialog, screen CSS, real page size.
 * The default `exportMode`.
 *
 * The whole reason this cannot be done from the print path is step 1 here -
 * driving the tab over CDP. `window.print()` hands paper size to the print
 * dialog, which ignores whatever the page asks for.
 */
async function handleScreenExport(
  request: ExportRequest,
  settings: Settings,
): Promise<BgResponse> {
  const tab = await getActiveTab();
  if (!tab?.id) return fail("NO_TAB", "No active tab to export.");
  const tabId = tab.id;

  const verdict = canAttachDebugger(tab.url);
  if (!verdict.ok) return fail("RESTRICTED_URL", verdict.reason);

  if (!(await hasDebuggerPermission())) {
    return fail(
      "UNKNOWN",
      "This build cannot attach the debugger, which one-click export needs.",
    );
  }

  const injected = await injectPrepareScript(tabId);
  if (!injected.ok) return injected;

  const pageMode = effectivePageMode(settings.pageMode, "screen", request.overrides?.pageMode);
  const meta: PageMeta = {
    title: tab.title ?? "",
    url: tab.url ?? "",
    now: new Date().toISOString(),
  };

  // Prepare the DOM but do not print: this path drives the printing itself.
  let prepared: PageResponse;
  try {
    prepared = (await chrome.tabs.sendMessage(tabId, {
      type: "PAGE_PREPARE",
      prep: mergePrep(settings.prep, request.overrides?.prep),
      pageMode,
      print: false,
      screenMedia: true,
      meta,
    })) as PageResponse;
  } catch (error) {
    if (!(await tabStillOpen(tabId))) {
      return fail("TAB_CLOSED", "The tab was closed before the export finished.");
    }
    const detail = error instanceof Error ? error.message : String(error);
    return fail("NO_RESPONSE", `The page did not respond: ${detail}`);
  }

  if (!prepared || prepared.ok !== true || !("report" in prepared)) {
    return prepared && prepared.ok === false
      ? prepared
      : fail("NO_RESPONSE", "The page sent an unexpected reply.");
  }

  let measured: { width: number; height: number } | undefined;

  // Everything below this line is photographed, so the bar goes first.
  await setAnnotateUi(tabId, false);

  try {
    const { bytes, plan } = await withDebugger(tabId, async (session) => {
      // The trick behind "screen look": render with screen CSS, not @media print.
      await session.emulateScreenMedia();

      // Freeze scripts so the page cannot grow between measuring and printing.
      await session.setScriptExecutionDisabled(true);
      try {
        const contentSize = await session.getStableContentSize();

        // The page's own scrollHeight, straight from the DOM. It is the number
        // the user means by "how tall is this page", and CDP's cssContentSize
        // does not always agree with it; prefer the DOM and fall back.
        const domHeight = await session.evaluate<number>(DOCUMENT_HEIGHT_EXPRESSION);
        const nominal = domHeight && domHeight > 0 ? domHeight : contentSize.height;

        // ...but a document is routinely taller than the page it paints: ad
        // slots hold space their ads never fill, and a feed frozen mid-load
        // keeps the room it reserved. Look at the pixels before cutting paper
        // to that number, or the export ends in a long blank strip.
        const height = await paintedHeight(session, contentSize.width, nominal);

        measured = { width: Math.round(contentSize.width), height: Math.round(height) };
        const printPlan = planPrintToPdf({ width: contentSize.width, height }, pageMode, {
          trimmed: height < nominal,
        });
        const result = await session.printToPdf(printPlan.params);

        // ReturnAsStream avoids a huge base64 string for a tall page (§10.2);
        // fall back to inline data if the browser ignored the request.
        const pdf = result.stream
          ? await session.readStream(result.stream)
          : base64ToBytes(result.data);

        return { bytes: pdf, plan: printPlan };
      } finally {
        // Detaching would reset this anyway; being explicit means a page is
        // never left script-dead if the session outlives this call.
        await session.setScriptExecutionDisabled(false);
      }
    });

    const filename = renderFilename(settings.filenameTemplate, {
      title: tab.title,
      url: tab.url,
    });
    await downloadPdf(bytes, filename);

    // Still nominally an estimate - Chromium decides where content breaks - but
    // a reliable one now the paper is sized from a settled measurement.
    // Parsing the output to count pages exactly would mean pulling pdf-lib
    // (~440kB) into the service worker for a status line; not worth it.
    return {
      ok: true,
      mode: "screen",
      report: prepared.report,
      printRequested: false,
      filename,
      sheets: plan.sheets,
      ...(plan.note === undefined ? {} : { note: plan.note }),
      ...(measured === undefined ? {} : { contentPx: measured }),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (!(await tabStillOpen(tabId))) {
      return fail("TAB_CLOSED", "The tab was closed before the export finished.");
    }
    return fail("UNKNOWN", `Export failed: ${detail}`);
  } finally {
    // In the `finally` so a failed export never leaves the user's bar hidden.
    await setAnnotateUi(tabId, true);
    // No print dialog here, so nothing fires `afterprint` - ask the page to
    // undo the pre-processing explicitly.
    try {
      await chrome.tabs.sendMessage(tabId, { type: "PAGE_RESTORE" });
    } catch {
      // Tab gone, or the script was already torn down. Either way, done.
    }
  }
}

async function handleExport(request: ExportRequest): Promise<BgResponse> {
  // Read once per export: `exportMode` decides which path runs and, through
  // `effectivePageMode`, whether "single long page" applies. Both are free.
  const settings = await loadSettings();

  if (settings.exportMode === "screen") return handleScreenExport(request, settings);

  const tab = await getActiveTab();
  if (!tab?.id) return fail("NO_TAB", "No active tab to export.");
  const tabId = tab.id;

  const verdict = canInject(tab.url);
  if (!verdict.ok) return fail("RESTRICTED_URL", verdict.reason);

  const injected = await injectPrepareScript(tabId);
  if (!injected.ok) return injected;

  if (!(await tabStillOpen(tabId))) {
    return fail("TAB_CLOSED", "The tab was closed before the export finished.");
  }

  const printMeta: PageMeta = {
    title: tab.title ?? "",
    url: tab.url ?? "",
    now: new Date().toISOString(),
  };

  let response: PageResponse;
  try {
    response = (await chrome.tabs.sendMessage(tabId, {
      type: "PAGE_PREPARE",
      prep: mergePrep(settings.prep, request.overrides?.prep),
      // The print path, so this resolves to `paginated` whatever storage says:
      // Chrome's print dialog takes its paper size from its own dropdown and
      // discards `@page { size }`. Asking for single-page CSS on this path only
      // unsettles the layout of a document that is going to be paginated
      // regardless.
      pageMode: effectivePageMode(settings.pageMode, "print", request.overrides?.pageMode),
      print: true,
      meta: printMeta,
    })) as PageResponse;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (!(await tabStillOpen(tabId))) {
      return fail("TAB_CLOSED", "The tab was closed before the export finished.");
    }
    return fail("NO_RESPONSE", `The page did not respond: ${detail}`);
  }

  if (!response || response.ok !== true) {
    return response ?? fail("NO_RESPONSE", "The page did not respond.");
  }
  if (!("report" in response)) {
    return fail("NO_RESPONSE", "The page sent an unexpected reply.");
  }

  return { ok: true, mode: "print", report: response.report, printRequested: true };
}

/**
 * Photograph a rectangle of the document, whatever it takes.
 *
 * One `Page.captureScreenshot` per slice (lib/capture/plan.ts decides how many
 * and at what scale), stitched back into a single PNG. Runs inside an attached
 * session so the caller can measure and capture without re-attaching.
 */
async function captureRect(
  session: CdpSession,
  rect: CaptureRect,
  bounds: { width: number; height: number },
  encoding: ImageEncoding,
): Promise<{ bytes: Uint8Array; plan: ReturnType<typeof planCapture> }> {
  // The format decides how big the finished image may be: WebP tops out at
  // 16,383px and truncates silently past it (lib/capture/format.ts).
  const plan = planCapture(rect, bounds, { maxEdge: encoding.maxEdge, maxArea: MAX_IMAGE_AREA_PX });
  if (plan.slices.length === 0) throw new Error("there is nothing inside that area");

  // Slices come back as PNG whatever the output format: they are an
  // intermediate, and encoding each one lossily would put its artefacts through
  // a second round when the stitched image is encoded.
  const parts: Uint8Array[] = [];
  for (const slice of plan.slices) {
    parts.push(
      await session.captureClip(
        { x: plan.rect.x, y: slice.y, width: plan.rect.width, height: slice.height },
        plan.scale,
      ),
    );
  }

  return { bytes: await stitchImage(parts, encoding), plan };
}

/** A rectangle, a deliberate `null` (the user backed out), or a real failure. */
type AreaOutcome = { ok: true; rect: CaptureRect | null } | Failure;

/** Put the selector up and wait for the drag. There is no timeout on purpose. */
async function askForArea(tabId: number): Promise<AreaOutcome> {
  const injected = await injectScript(tabId, SELECT_SCRIPT);
  if (!injected.ok) return injected;

  try {
    const reply = (await chrome.tabs.sendMessage(tabId, {
      type: "PAGE_SELECT_AREA",
    })) as PageResponse;

    if (reply?.ok === true && "rect" in reply) return { ok: true, rect: reply.rect };
    if (reply?.ok === false && reply.code === "CANCELLED") return { ok: true, rect: null };
    return fail("NO_RESPONSE", "The area selector sent an unexpected reply.");
  } catch (error) {
    if (!(await tabStillOpen(tabId))) {
      return fail("TAB_CLOSED", "The tab was closed before the area was picked.");
    }
    const detail = error instanceof Error ? error.message : String(error);
    return fail("NO_RESPONSE", `The page did not respond: ${detail}`);
  }
}

/**
 * Tell the user how it went, in the page.
 *
 * A region capture starts with a click on the page, and that click closes the
 * popup - so the popup is gone long before the file is saved and there is
 * nowhere else to say "saved". Best-effort: a tab that has navigated away in
 * the meantime simply hears nothing.
 */
async function reportInPage(tabId: number, text: string, tone: "done" | "error"): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PAGE_SELECT_STATUS", text, tone });
  } catch {
    // The selector is gone with the page it was injected into. Nothing to do.
  }
}

/**
 * Screenshot the page: the whole document, or the rectangle the user drew.
 *
 * Deliberately *not* the same pipeline as the PDF export. A full-page shot
 * pre-processes the DOM first (hidden sticky bars, expanded sections, lazy
 * images) because those settings are exactly as useful in a picture as in a
 * PDF, and it trims the tail with the same painted-height scan. A region shot
 * touches nothing at all: the user drew a rectangle around what is on screen
 * right now, and pre-processing would move the content out from under it.
 */
async function handleCapture(request: CaptureRequest): Promise<BgResponse> {
  const tab = await getActiveTab();
  if (!tab?.id) return fail("NO_TAB", "No active tab to capture.");
  const tabId = tab.id;

  const verdict = canAttachDebugger(tab.url);
  if (!verdict.ok) return fail("RESTRICTED_URL", verdict.reason);

  if (!(await hasDebuggerPermission())) {
    return fail(
      "CAPTURE_FAILED",
      "This build cannot attach the debugger, which screenshots need.",
    );
  }

  const settings = await loadSettings();
  const encoding = encodingFor(settings.imageFormat);
  const filename = renderFilename(
    settings.filenameTemplate,
    { title: tab.title, url: tab.url },
    encoding.extension,
  );

  // --- region: ask first, and never touch the page ---------------------------
  if (request.area === "region") {
    // Before `askForArea`, not just before the capture: the selector and the
    // drawing surface both want the pointer, and this is what hands it over
    // (.plan/design.md §4.3). The `finally` covers every way out of the branch -
    // a cancelled drag and a selection too small to use included - so the bar
    // comes back whether or not there was ever a capture.
    //
    // Still "never touch the page" as far as the section heading means it: this
    // moves our own furniture, and the content under the user's rectangle is as
    // untouched as it ever was.
    await setAnnotateUi(tabId, false);
    try {
      const asked = await askForArea(tabId);
      if (!asked.ok) return asked;
      if (!asked.rect) return fail("CANCELLED", "Area selection was cancelled.");

      const rect = asked.rect;
      if (!isUsableSelection(rect)) {
        await reportInPage(tabId, "That selection was too small to capture.", "error");
        return fail("CANCELLED", "That selection was too small to capture.");
      }

      try {
        const { bytes, plan } = await withDebugger(tabId, async (session) => {
          const metrics = await session.getLayoutMetrics();
          return captureRect(
            session,
            rect,
            { width: metrics.cssContentSize.width, height: metrics.cssContentSize.height },
            encoding,
          );
        });

        await downloadBytes(bytes, filename, encoding.mime);
        await reportInPage(tabId, `Saved ${filename}`, "done");

        const success: CaptureSuccess = {
          ok: true,
          kind: "capture",
          area: "region",
          filename,
          size: { width: plan.width, height: plan.height },
          scale: plan.scale,
          ...(plan.note === undefined ? {} : { note: plan.note }),
        };
        return success;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (!(await tabStillOpen(tabId))) {
          return fail("TAB_CLOSED", "The tab was closed before the screenshot finished.");
        }
        await reportInPage(tabId, `Screenshot failed: ${detail}`, "error");
        return fail("CAPTURE_FAILED", `Screenshot failed: ${detail}`);
      }
    } finally {
      await setAnnotateUi(tabId, true);
    }
  }

  // --- full page: pre-process, measure, then photograph ----------------------
  const injected = await injectPrepareScript(tabId);
  if (!injected.ok) return injected;

  const meta: PageMeta = {
    title: tab.title ?? "",
    url: tab.url ?? "",
    now: new Date().toISOString(),
  };

  let prepared: PageResponse;
  try {
    prepared = (await chrome.tabs.sendMessage(tabId, {
      type: "PAGE_PREPARE",
      prep: settings.prep,
      // Paper size means nothing to a picture; single-page mode is a PDF idea.
      pageMode: "paginated",
      print: false,
      meta,
    })) as PageResponse;
  } catch (error) {
    if (!(await tabStillOpen(tabId))) {
      return fail("TAB_CLOSED", "The tab was closed before the screenshot finished.");
    }
    const detail = error instanceof Error ? error.message : String(error);
    return fail("NO_RESPONSE", `The page did not respond: ${detail}`);
  }

  if (!prepared || prepared.ok !== true || !("report" in prepared)) {
    return prepared && prepared.ok === false
      ? prepared
      : fail("NO_RESPONSE", "The page sent an unexpected reply.");
  }

  // Everything below this line is photographed, so the bar goes first.
  await setAnnotateUi(tabId, false);

  try {
    const { bytes, plan } = await withDebugger(tabId, async (session) => {
      // Same reasoning as the export path: a feed that keeps growing between
      // the measurement and the capture is measured at one height and
      // photographed at another.
      await session.setScriptExecutionDisabled(true);
      try {
        const contentSize = await session.getStableContentSize();
        const domHeight = await session.evaluate<number>(DOCUMENT_HEIGHT_EXPRESSION);
        const nominal = domHeight && domHeight > 0 ? domHeight : contentSize.height;
        const height = await paintedHeight(session, contentSize.width, nominal);

        return captureRect(
          session,
          { x: 0, y: 0, width: contentSize.width, height },
          { width: contentSize.width, height },
          encoding,
        );
      } finally {
        await session.setScriptExecutionDisabled(false);
      }
    });

    await downloadBytes(bytes, filename, encoding.mime);

    const success: CaptureSuccess = {
      ok: true,
      kind: "capture",
      area: "full",
      filename,
      size: { width: plan.width, height: plan.height },
      scale: plan.scale,
      report: prepared.report,
      ...(plan.note === undefined ? {} : { note: plan.note }),
    };
    return success;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (!(await tabStillOpen(tabId))) {
      return fail("TAB_CLOSED", "The tab was closed before the screenshot finished.");
    }
    return fail("CAPTURE_FAILED", `Screenshot failed: ${detail}`);
  } finally {
    // In the `finally` so a failed capture never leaves the user's bar hidden.
    await setAnnotateUi(tabId, true);
    try {
      await chrome.tabs.sendMessage(tabId, { type: "PAGE_RESTORE" });
    } catch {
      // Tab gone, or the script was already torn down. Either way, done.
    }
  }
}

/**
 * Give the held pre-processing pass up and restore the page.
 *
 * `release: true` is what distinguishes this from the `PAGE_RESTORE` every
 * export path already sends: while annotate mode holds a pass, prepare.ts
 * ignores a restore without it, which is what stops a popup-initiated export
 * from pulling the page out from under the drawing (contracts.md §2.5).
 *
 * Best-effort, the way `reportInPage` is: a tab that has navigated away has
 * already dropped the marks, the injected scripts and the `activeTab` grant, so
 * it simply hears nothing and there is nothing left to undo.
 */
async function releasePrepared(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PAGE_RESTORE", release: true });
  } catch {
    // The page is gone with the script that was holding the pass.
  }
}

/**
 * Enter annotate mode: mark the page up, then export with the marks in it.
 *
 * Pro only, and the one entitlement check left in the extension. Drawing
 * itself never touches `chrome.debugger` - hence `canInject` and not
 * `canAttachDebugger`: it is pointer events and SVG elements, with no CDP
 * anywhere in the feature (design.md §3). A save from the bar can still use it,
 * through whichever export path `exportMode` picks.
 *
 * The page is prepared *before* the first stroke and the pass is `hold`-ed, so
 * `<details>` are open, lazy images are in and the sticky furniture is gone
 * while the user draws - and nothing later re-prepares underneath the marks,
 * which would move the content out from under every one of them (§4.2).
 */
async function handleAnnotate(request: AnnotateRequest): Promise<BgResponse> {
  const tab = await getActiveTab();
  if (!tab?.id) return fail("NO_TAB", "No active tab to annotate.");
  const tabId = tab.id;

  // The popup's own way out; the bar's X arrives as ANNOTATE_EXIT instead.
  if (request.action === "stop") return handleAnnotateExit(tabId);

  // Annotate mode is the Pro feature, all of it. One switch, read once
  // (lib/license), and the only entitlement call the feature makes. Before the
  // URL check, so a free browser hears the same thing on every page.
  if (!(await isPro())) return fail("PRO_REQUIRED", "Draw mode is a Pro feature.");

  const verdict = canInject(tab.url);
  if (!verdict.ok) return fail("RESTRICTED_URL", verdict.reason);

  const preparer = await injectPrepareScript(tabId);
  if (!preparer.ok) return preparer;
  // Two injections, run one after the other rather than through `Promise.all`.
  // The parallel version saves one round trip and costs the error message: a
  // refused injection comes back as a sentence for the user (a `file://` URL
  // without the opt-in, a page the `activeTab` grant does not cover), and two
  // of those racing means reporting whichever settled first about a page where
  // both were refused for the same reason. Ordering is free either way - both
  // scripts guard double installation, so pressing Draw twice injects nothing.
  const annotator = await injectScript(tabId, ANNOTATE_SCRIPT);
  if (!annotator.ok) return annotator;

  if (!(await tabStillOpen(tabId))) {
    return fail("TAB_CLOSED", "The tab was closed before annotate mode started.");
  }

  const [settings, prefs] = await Promise.all([loadSettings(), loadDrawPrefs()]);
  const meta: PageMeta = {
    title: tab.title ?? "",
    url: tab.url ?? "",
    now: new Date().toISOString(),
  };

  let prepared: PageResponse;
  try {
    prepared = (await chrome.tabs.sendMessage(tabId, {
      type: "PAGE_PREPARE",
      prep: settings.prep,
      // The user's own setting, resolved against the export path, even though
      // nothing here cuts paper. An export made from *inside* annotate mode
      // reuses this held pass rather than preparing again (contracts.md §13),
      // so whatever is decided here is the paper that export gets - and
      // hard-coding "paginated" would quietly drop single-page mode for every
      // export made with marks up.
      pageMode: effectivePageMode(settings.pageMode, settings.exportMode),
      // Prepared the way the export that reuses this pass will be rendered.
      // `handleScreenExport` sends `screenMedia: true` on every one-click
      // export regardless of page mode, so the condition here is the export
      // mode and not the page mode; a print-dialog export is `window.print()`,
      // which emulates nothing, so this must stay false for it. It cannot be
      // deferred to the export: prepare.ts answers a held pass with the report
      // it already has and never re-prepares (contracts.md §13), so a `screenMedia: true`
      // arriving later is ignored - and the pass would be missing both
      // `freezeViewportUnits()` and the unconditional `BREAK_RESET_CSS`, which
      // is ARCHITECTURE.md Decisions 10 and 11 coming back by a side door.
      //
      // It is also the more correct order by design.md §4.2: annotate mode
      // exists so that what you draw on is what gets exported, so if the
      // export is going to freeze viewport units and re-lay-out the page, that
      // has to happen *before* the first stroke - otherwise every mark below a
      // `100vh` hero drifts by however much the freeze moved it.
      //
      // Consequence, per §9: with one-click and single-page mode on, the page
      // re-lays-out when Draw is pressed, because `pageMode: "single"` plus
      // `screenMedia: true` is exactly the pair that runs the freeze and the
      // unconditional CSS. That is the free preview of the export §4.2 asks
      // for, not a regression.
      screenMedia: settings.exportMode === "screen",
      print: false,
      hold: true,
      meta,
    })) as PageResponse;
  } catch (error) {
    if (!(await tabStillOpen(tabId))) {
      return fail("TAB_CLOSED", "The tab was closed before annotate mode started.");
    }
    const detail = error instanceof Error ? error.message : String(error);
    return fail("NO_RESPONSE", `The page did not respond: ${detail}`);
  }

  // A failed prepare is not holding a pass: prepare.ts sets `held` alongside
  // `active` in the one place the pair cannot get out of step, and has already
  // undone whatever it got through. An `ok: true` reply is the other case - the
  // hold happened - so a reply that is somehow `ok: true` without a `report`
  // has to be released, exactly as the `PAGE_ANNOTATE_START` check below
  // releases on every non-ok shape. Unreachable today (prepare.ts always sends
  // `report` with `ok: true`, and it is the only responder to `PAGE_PREPARE`),
  // but this is the one branch after a successful `hold` that could return with
  // `held` left set, and a stuck `held` makes every later export's
  // `PAGE_RESTORE` a no-op - header block on the page until a reload.
  if (!prepared || prepared.ok !== true || !("report" in prepared)) {
    if (prepared && prepared.ok === true) await releasePrepared(tabId);
    return prepared && prepared.ok === false
      ? prepared
      : fail("NO_RESPONSE", "The page sent an unexpected reply.");
  }

  let started: PageResponse;
  try {
    started = (await chrome.tabs.sendMessage(tabId, {
      type: "PAGE_ANNOTATE_START",
      prefs,
    })) as PageResponse;
  } catch (error) {
    await releasePrepared(tabId);
    if (!(await tabStillOpen(tabId))) {
      return fail("TAB_CLOSED", "The tab was closed before annotate mode started.");
    }
    const detail = error instanceof Error ? error.message : String(error);
    return fail("NO_RESPONSE", `The page did not respond: ${detail}`);
  }

  // A page that could not put the bar up must not be left holding a pass:
  // `held` would survive every later `PAGE_RESTORE`, so the next export would
  // reuse a pass nobody owns, and the header block would sit on the page with
  // no way to get it off short of a reload.
  if (!started || started.ok !== true) {
    await releasePrepared(tabId);
    return started && started.ok === false
      ? started
      : fail("NO_RESPONSE", "The page sent an unexpected reply.");
  }

  const success: AnnotateSuccess = {
    ok: true,
    kind: "annotate",
    active: true,
    report: prepared.report,
  };
  return success;
}

/**
 * Save from the bar, where the user's hand already is.
 *
 * **Thin on purpose**: it picks one of the paths that already exist - the
 * export, the full-page shot or the area shot - and hands their answer straight
 * back. There is no new export path here, no new download and no compositing
 * step - the marks are real SVG in the real DOM by
 * the time this runs, so every existing output carries them without knowing the
 * feature is there (.plan/design.md §1).
 *
 * The reply is the underlying `ExportSuccess` / `CaptureSuccess` / `Failure`
 * **unchanged**, because the bar is the only place left to report into: no
 * popup is open, and the bar shows whatever comes back in its note line.
 *
 * Nothing sets a flag to keep the marks safe from the export's own
 * pre-processing. `prepare.ts` is already holding the pass this page was drawn
 * on (contracts.md §13), so the `PAGE_PREPARE` these paths send comes back with
 * the held report rather than re-preparing under the marks, and the
 * `PAGE_RESTORE` that follows is ignored. That seam is why this function is a
 * handful of lines instead of a flag threaded through three export handlers
 * (§2.3).
 */
async function handleAnnotateExport(
  request: AnnotateExportRequest,
  tabId: number,
): Promise<BgResponse> {
  // `tabId` is the sender's - the tab whose bar was pressed - and the two paths
  // below resolve the active tab for themselves, because both are shared with
  // the popup and keep their bodies (contracts.md §15). So the sender's tab is
  // what this checks against rather than what it steers by: a user who moved to
  // another tab between the press and this message gets a refusal, not an
  // export of a page nobody asked for that has no marks on it. An active tab
  // that cannot be resolved at all is left to the paths below, which have
  // reported that as `NO_TAB` since long before annotate mode existed.
  //
  // A closed tab lands here too, as a mismatch, and the sentence is wasted on
  // it - the bar went with the tab, so there is nobody left to read the note.
  const active = await getActiveTab();
  if (active !== undefined && active.id !== tabId) {
    return fail("NO_TAB", "Switch back to the tab you drew on and save from there.");
  }

  // The bar's two screenshots are the popup's two, unchanged. "Save as image" is
  // the full page, because the marks are spread over the whole document; "Save
  // selected area" puts the selector up and asks for the rectangle the bar has
  // no way to offer. `handleCapture`'s region branch already hides the bar and
  // hands the selector the pointer (`setAnnotateUi`), and the layer stays
  // visible through it, so the marks under the rectangle are in the picture.
  if (request.target === "png") return handleCapture({ type: "CAPTURE", area: "full" });
  if (request.target === "region") return handleCapture({ type: "CAPTURE", area: "region" });

  // The same request the popup sends: `handleExport` reads `exportMode` and
  // takes the one-click or the print-dialog path accordingly.
  return handleExport({ type: "EXPORT" });
}

/**
 * Leave annotate mode: take the hosts down, then undo the pass they were drawn
 * on. Reached from the bar's X and from Esc, and from the popup asking to stop.
 *
 * Starting when already started is not an error and neither is stopping when
 * nothing is running - both sends are best-effort, and a tab with no annotate
 * script simply hears nothing.
 */
async function handleAnnotateExit(tabId: number): Promise<BgResponse> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PAGE_ANNOTATE_STOP" });
  } catch {
    // Already gone - navigated away, or never started here.
  }
  await releasePrepared(tabId);

  const success: AnnotateSuccess = { ok: true, kind: "annotate", active: false };
  return success;
}

async function handleState(): Promise<StateSuccess> {
  const [settings, pro, tab] = await Promise.all([loadSettings(), isPro(), getActiveTab()]);
  const verdict = canInject(tab?.url);

  return {
    ok: true,
    settings,
    isPro: pro,
    blocked: verdict.ok ? undefined : verdict.reason,
    tabTitle: tab?.title,
  };
}

/**
 * `tabId` is `sender.tab?.id`, and it is set only for a request that came *from
 * a page* - the annotate bar's own buttons. Those must not fall back to
 * `chrome.tabs.query`: no popup is open, so "the active tab" is not a safe
 * answer for a message a background worker was woken up by.
 */
async function handle(request: BgRequest, tabId: number | undefined): Promise<BgResponse> {
  switch (request.type) {
    case "EXPORT":
      return handleExport(request);
    case "CAPTURE":
      return handleCapture(request);
    case "GET_STATE":
      return handleState();
    case "ANNOTATE":
      return handleAnnotate(request);
    case "ANNOTATE_EXPORT":
      return tabId === undefined
        ? fail("NO_TAB", "That request did not come from a tab.")
        : handleAnnotateExport(request, tabId);
    case "ANNOTATE_EXIT":
      return tabId === undefined
        ? fail("NO_TAB", "That request did not come from a tab.")
        : handleAnnotateExit(tabId);
    default:
      return fail("UNKNOWN", "Unknown request.");
  }
}

/**
 * Say something in the page when there is no popup to say it in.
 *
 * The toast lives in the area selector's shadow root (entrypoints/select-area.ts),
 * which is injected here purely to host it. That is sound rather than a
 * borrowed mode: installing the script adds a message listener and nothing
 * else - no overlay, no pointer handlers, no selection - and it guards its own
 * double installation, so doing this while a selection is genuinely running
 * re-registers nothing and the toast gets a shadow host of its own rather than
 * the selector's.
 *
 * Best-effort: a restricted URL refuses the injection, and a shortcut pressed
 * on such a page is therefore **completely silent**. There is no way around it
 * from here - the only surface a background worker has is the one the refused
 * injection would have created. It is the one place a shortcut is worse than
 * the popup, which greys its buttons out and says why (§9).
 */
async function announceInPage(tabId: number, text: string, tone: "done" | "error"): Promise<void> {
  const injected = await injectScript(tabId, SELECT_SCRIPT);
  if (!injected.ok) return;
  await reportInPage(tabId, text, tone);
}

/**
 * Run a keyboard shortcut.
 *
 * `handle(request, undefined)` on purpose: a command is not a message from a
 * page, so there is no `sender.tab`, and every handler a command can reach
 * (export, capture, annotate) resolves the active tab itself. The two handlers
 * that *require* a tabId - ANNOTATE_EXPORT and ANNOTATE_EXIT - are the bar's
 * own buttons and no command maps to them.
 *
 * `tab` is the one `chrome.commands.onCommand` hands over: the tab the shortcut
 * fired on, and the tab the keypress granted `activeTab` on. It is only used to
 * address the toast, never to steer the work - the handlers are shared with the
 * popup and keep their own tab lookup (contracts.md §15).
 */
async function runCommand(name: CommandName, tab: chrome.tabs.Tab | undefined): Promise<void> {
  // Resolved before the work, not after. An export can take a while, and a user
  // who moves to another tab meanwhile should not have "Saved foo.pdf" appear
  // over a page that had nothing to do with it - or, since `activeTab` was
  // never granted there, see it vanish silently.
  const tabId = tab?.id ?? (await getActiveTab())?.id;

  const request = requestForCommand(name);

  let response: BgResponse;
  try {
    response = await handle(request, undefined);
  } catch (error) {
    response = fail("UNKNOWN", error instanceof Error ? error.message : String(error));
  }

  const toast = commandToast(name, response);
  if (!toast || tabId === undefined) return;
  await announceInPage(tabId, toast.text, toast.tone);
}

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener(
    (request: BgRequest, sender, sendResponse: (r: BgResponse) => void) => {
      void (async () => {
        try {
          sendResponse(await handle(request, sender.tab?.id));
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          sendResponse(fail("UNKNOWN", detail));
        }
      })();
      return true; // keep the channel open for the async reply
    },
  );

  // Keyboard shortcuts. Unbound by default beyond the four suggested keys in
  // wxt.config.ts; the user rebinds them at chrome://extensions/shortcuts.
  //
  // @types/chrome types `tab` as always present; Chrome's own reference types
  // it `tab?` without saying when it is absent. Taking the documented shape
  // costs nothing and keeps the assumption out of the code - `runCommand` falls
  // back to the active tab, which is what it used to do unconditionally.
  chrome.commands.onCommand.addListener((name: string, tab: chrome.tabs.Tab | undefined) => {
    if (isCommandName(name)) void runCommand(name, tab);
  });
});
