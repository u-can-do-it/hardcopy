/**
 * The message protocol, in one place so both ends of every channel are typed.
 *
 * Three channels, and they do not overlap:
 *   popup/options   -> background      via chrome.runtime.sendMessage
 *   injected script -> background      via chrome.runtime.sendMessage (sender.tab)
 *   background      -> injected script via chrome.tabs.sendMessage
 */

import type {
  CaptureArea,
  CaptureRect,
  DrawPrefs,
  ExportMode,
  PageMode,
  PrepOptions,
  PrepReport,
  Settings,
} from "./types";

export type ErrorCode =
  | "NO_TAB"
  | "RESTRICTED_URL"
  | "INJECT_FAILED"
  | "NO_RESPONSE"
  | "TAB_CLOSED"
  | "PRO_REQUIRED"
  /** The user dismissed the area selector - not an error, but not a capture. */
  | "CANCELLED"
  | "CAPTURE_FAILED"
  | "UNKNOWN";

export interface Failure {
  ok: false;
  code: ErrorCode;
  /** Shown to the user verbatim, so write it like a sentence. */
  error: string;
}

export function fail(code: ErrorCode, error: string): Failure {
  return { ok: false, code, error };
}

// --- popup/options -> background --------------------------------------------

/**
 * Save the active tab as a PDF. Which way - one click or the print dialog - is
 * `settings.exportMode`, read by the background, so the popup, the shortcut and
 * the drawing bar cannot disagree about it.
 */
export interface ExportRequest {
  type: "EXPORT";
  /** Per-run overrides; persisted settings supply anything omitted. */
  overrides?: { prep?: Partial<PrepOptions>; pageMode?: PageMode } | undefined;
}

export interface StateRequest {
  type: "GET_STATE";
}

/** Take a PNG of the whole page, or of a rectangle the user draws over it. */
export interface CaptureRequest {
  type: "CAPTURE";
  area: CaptureArea;
}

/** Turn annotate mode on or off in the active tab. From the popup. */
export interface AnnotateRequest {
  type: "ANNOTATE";
  action: "start" | "stop";
}

/**
 * Save from the bar, where the user's hand already is. Sent by the injected
 * annotate script, so the background takes the tab from `sender`, not from
 * `chrome.tabs.query` - the popup is not open and "active tab" is not a safe
 * answer here.
 */
export interface AnnotateExportRequest {
  type: "ANNOTATE_EXPORT";
  /**
   * `"pdf"` takes whichever export path `exportMode` picks, `"png"` the
   * full-page screenshot, and `"region"` the area screenshot - the selector
   * goes up over the marks and the user drags out what to keep.
   */
  target: "pdf" | "png" | "region";
}

/** The bar's X, or Esc. Restores the page. Sent by the injected script. */
export interface AnnotateExitRequest {
  type: "ANNOTATE_EXIT";
}

export type BgRequest =
  | ExportRequest
  | StateRequest
  | CaptureRequest
  | AnnotateRequest
  | AnnotateExportRequest
  | AnnotateExitRequest;

export interface ExportSuccess {
  ok: true;
  mode: ExportMode;
  report: PrepReport;
  /** True once the print dialog has been asked for - not that a file was saved. */
  printRequested: boolean;
  /** One-click: the file actually written to Downloads. */
  filename?: string;
  /** One-click: sheets produced, and why, when a tall page had to be split. */
  sheets?: number;
  note?: string;
  /**
   * One-click: the page size the export was actually measured at. Surfaced in the
   * popup because when the sheet count is surprising, this is the number that
   * explains it - and it is otherwise invisible.
   */
  contentPx?: { width: number; height: number };
}

export interface CaptureSuccess {
  ok: true;
  kind: "capture";
  area: CaptureArea;
  /** The file written to Downloads. */
  filename: string;
  /** Image size in px, after any downscale. */
  size: { width: number; height: number };
  /** 1 unless the picture had to be shrunk to fit one image. */
  scale: number;
  /** Why the result is not literally what was asked for, when it is not. */
  note?: string;
  /** Full-page captures pre-process the DOM first; region captures do not. */
  report?: PrepReport;
}

export interface StateSuccess {
  ok: true;
  settings: Settings;
  isPro: boolean;
  /** Why the active tab cannot be exported, when it cannot. */
  blocked?: string | undefined;
  tabTitle?: string | undefined;
  tabUrl?: string | undefined;
}

export interface AnnotateSuccess {
  ok: true;
  kind: "annotate";
  /** Whether annotate mode is running in the tab now. */
  active: boolean;
  /** The pre-processing pass annotate mode entered on. Absent when stopping. */
  report?: PrepReport | undefined;
}

export type BgResponse =
  | ExportSuccess
  | StateSuccess
  | CaptureSuccess
  | AnnotateSuccess
  | Failure;

// --- background -> injected script ------------------------------------------

export interface PageMeta {
  title: string;
  url: string;
  /** ISO date string, formatted in the page for the optional header block. */
  now: string;
}

export interface PagePrepareRequest {
  type: "PAGE_PREPARE";
  prep: PrepOptions;
  /** "single" sizes one continuous sheet instead of A4 pages. */
  pageMode: PageMode;
  /** The print path calls window.print(); one-click prepares only and drives CDP itself. */
  print: boolean;
  /**
   * The caller renders with screen media emulated and cuts the paper to this
   * document - true for the one-click CDP path only. See `PrepareContext`.
   */
  screenMedia?: boolean;
  meta: PageMeta;
  /**
   * Annotate mode owns this pass and will keep it: hold it rather than undoing
   * it, and reuse it for any later `PAGE_PREPARE` until a `PAGE_RESTORE` with
   * `release` arrives.
   *
   * Drawing happens on a prepared page, and re-preparing under the marks would
   * move the content out from under every one of them - a mark below an
   * expanded section drifts by however tall that section turned out to be.
   */
  hold?: boolean | undefined;
}

export interface PagePingRequest {
  type: "PAGE_PING";
}

/**
 * Undo the pre-processing. The print path restores from `afterprint`; the
 * one-click path has no dialog to hang that off, so the background asks
 * explicitly.
 */
export interface PageRestoreRequest {
  type: "PAGE_RESTORE";
  /**
   * Give up a held pass and restore. Only the annotate-exit path sends this;
   * an ordinary export's `PAGE_RESTORE` is ignored while a pass is held, which
   * is what stops a popup-initiated export from tearing the drawing surface
   * out from under the user.
   */
  release?: boolean | undefined;
}

/**
 * Ask the area selector (entrypoints/select-area.ts) for a rectangle. Resolves
 * when the user finishes the drag, or fails with CANCELLED when they press Esc.
 * There is no timeout: the user is allowed to think.
 */
export interface PageSelectAreaRequest {
  type: "PAGE_SELECT_AREA";
}

/**
 * A line of feedback shown in the page after the selector is gone.
 *
 * The popup cannot do this job: the first click on the page dismisses it, so by
 * the time the file is saved there is no popup left to report into.
 */
export interface PageSelectStatusRequest {
  type: "PAGE_SELECT_STATUS";
  text: string;
  tone: "done" | "error";
}

/**
 * Put the bar and the drawing layer up. The page is already prepared by the
 * time this arrives.
 */
export interface PageAnnotateStartRequest {
  type: "PAGE_ANNOTATE_START";
  prefs: DrawPrefs;
}

/** Take both hosts down. The background restores the page separately. */
export interface PageAnnotateStopRequest {
  type: "PAGE_ANNOTATE_STOP";
}

/**
 * Hide our own furniture around a capture.
 *
 * `false` hides the bar - it is `position: fixed`, so leaving it in would
 * repeat it on every printed sheet - and drops the layer's `pointer-events`,
 * which is what lets the region selector have the pointer. The layer stays
 * *visible*: the marks are the point.
 */
export interface PageAnnotateUiRequest {
  type: "PAGE_ANNOTATE_UI";
  visible: boolean;
}

export type PageRequest =
  | PagePrepareRequest
  | PagePingRequest
  | PageRestoreRequest
  | PageSelectAreaRequest
  | PageSelectStatusRequest
  | PageAnnotateStartRequest
  | PageAnnotateStopRequest
  | PageAnnotateUiRequest;

export type PageResponse =
  | { ok: true; report: PrepReport }
  | { ok: true; pong: true }
  | { ok: true; rect: CaptureRect }
  | Failure;

// --- background -> offscreen document ---------------------------------------

/**
 * One piece of a file on its way to the offscreen document.
 *
 * Chunked because `chrome.runtime.sendMessage` refuses anything over 64MiB, and
 * a full-page screenshot of a long page goes past that on its own, never mind
 * the third that base64 adds. Chunks of one transfer arrive in order and are
 * held until `final`, which is the message that answers with a URL. See
 * lib/download.ts.
 */
export interface OffscreenRequest {
  type: "OFFSCREEN_BLOB_URL";
  /** Groups the chunks of one file; a fresh id per download. */
  id: string;
  /** This chunk, base64-encoded so it survives the message channel. */
  base64: string;
  /** MIME type for the Blob; PDFs and PNGs both come through here. */
  mime: string;
  /** The last chunk: assemble the Blob and reply with its URL. */
  final: boolean;
}

/** The offscreen document mints a URL; the worker does the downloading. */
export type OffscreenResponse = { ok: true; url?: string } | Failure;

export const EMPTY_REPORT: PrepReport = {
  hiddenElements: 0,
  detailsOpened: 0,
  containersUnlocked: 0,
  imagesForced: 0,
  warnings: [],
};
