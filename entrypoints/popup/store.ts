/**
 * Popup state and actions as signals, keeping App.tsx presentational.
 */

import { computed, signal } from "@preact/signals";

import type { BgRequest, BgResponse, CaptureSuccess, ExportSuccess } from "@/lib/messages";
import type { CaptureArea } from "@/lib/types";
import { proUnlocked } from "@/stores/license";
import { initSettingsStore, settings } from "@/stores/settings";

export type Status =
  | { kind: "hint" }
  | { kind: "working"; text: string }
  | { kind: "done"; text: string }
  | { kind: "error"; text: string };

export interface TabState {
  title: string;
  /** Why this tab cannot be exported, when it cannot. */
  blocked?: string | undefined;
}

export const tab = signal<TabState | null>(null);
export const status = signal<Status>({ kind: "hint" });
export const busy = signal(false);

/** `isPro()` as the background answered it when the popup opened. */
const proAtOpen = signal(false);

/**
 * The one Pro switch, as this popup currently knows it.
 *
 * Starts from the background's answer, then defers to the licence store as
 * soon as that has read `isPro()` itself: activating a key in the Pro dialog
 * has to unlock the Draw button the user tapped to open it, without a reopen.
 */
export const pro = computed(() => proUnlocked.value ?? proAtOpen.value);

export const blocked = computed(() => tab.value?.blocked);
export const controlsDisabled = computed(
  () => settings.value === null || Boolean(blocked.value),
);
export const exportDisabled = computed(() => busy.value || controlsDisabled.value);

function send(request: BgRequest): Promise<BgResponse> {
  return chrome.runtime.sendMessage(request) as Promise<BgResponse>;
}

function describe(success: ExportSuccess): string {
  const { report } = success;
  const bits: string[] = [];
  if (report.hiddenElements) bits.push(`${report.hiddenElements} element(s) hidden`);
  if (report.detailsOpened) bits.push(`${report.detailsOpened} section(s) expanded`);
  if (report.imagesForced) bits.push(`${report.imagesForced} image(s) forced to load`);

  const prefix = bits.length ? `${bits.join(", ")}. ` : "";
  const warnings = report.warnings.length ? `${report.warnings.join(" ")} ` : "";
  // §4.2's "Single-page trap": say so when the page was too tall for one sheet.
  const split = success.note ?? report.pageSizeNote;
  const splitText = split ? `${split} ` : "";

  const size = success.contentPx
    ? ` Measured ${success.contentPx.width} x ${success.contentPx.height} px.`
    : "";

  const outcome = success.printRequested
    ? "Opening the print dialog..."
    : `Saved ${success.filename ?? "the PDF"}${
        success.sheets && success.sheets > 1 ? ` (${success.sheets} sheets)` : ""
      }.${size}`;

  return `${prefix}${splitText}${warnings}${outcome}`;
}

function describeCapture(success: CaptureSuccess): string {
  const { size, filename, note } = success;
  const scaled = success.scale < 1 ? `${note ?? ""} ` : "";
  return `${scaled}Saved ${filename} - ${size.width} x ${size.height} px.`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function initPopup(): Promise<void> {
  await initSettingsStore();

  try {
    const state = await send({ type: "GET_STATE" });
    if (state.ok && "settings" in state) {
      tab.value = { title: state.tabTitle ?? "", blocked: state.blocked };
      proAtOpen.value = state.isPro;
    } else if (!state.ok) {
      status.value = { kind: "error", text: state.error };
    }
  } catch (error) {
    status.value = {
      kind: "error",
      text: `Could not read the current tab: ${message(error)}`,
    };
  }
}

export async function runExport(): Promise<void> {
  busy.value = true;
  status.value = { kind: "working", text: "Preparing the page..." };

  try {
    // One click or the print dialog is `settings.exportMode`, which the
    // background reads for itself - the same request the shortcut sends.
    const response = await send({ type: "EXPORT" });

    if (!response.ok) {
      status.value = { kind: "error", text: response.error };
      return;
    }
    // `report` alone no longer identifies an export - a full-page screenshot
    // carries one too - so narrow on the field only an export has.
    if ("printRequested" in response) {
      status.value = { kind: "done", text: describe(response) };
    }
  } catch (error) {
    status.value = { kind: "error", text: `Export failed: ${message(error)}` };
  } finally {
    busy.value = false;
  }
}

/**
 * Take a screenshot of the whole page, or of an area the user draws.
 *
 * The region path cannot report back here: selecting an area means clicking on
 * the page, and that closes the popup. So the popup hands the job over, says
 * what is about to happen, and closes itself deliberately rather than being
 * dismissed mid-sentence - the background reports the result in the page and
 * Chrome's download bubble shows the file.
 */
export async function runCapture(area: CaptureArea): Promise<void> {
  if (area === "region") {
    status.value = { kind: "working", text: "Drag to select an area..." };
    void send({ type: "CAPTURE", area });
    setTimeout(() => window.close(), 200);
    return;
  }

  busy.value = true;
  status.value = { kind: "working", text: "Capturing the page..." };

  try {
    const response = await send({ type: "CAPTURE", area });

    if (!response.ok) {
      status.value = { kind: "error", text: response.error };
      return;
    }
    if ("kind" in response && response.kind === "capture") {
      status.value = { kind: "done", text: describeCapture(response) };
    }
  } catch (error) {
    status.value = { kind: "error", text: `Screenshot failed: ${message(error)}` };
  } finally {
    busy.value = false;
  }
}

/**
 * Annotate mode: mark the page up, then export with the marks in it.
 *
 * Closes the popup on success, the way the region capture does - drawing means
 * clicking on the page, which dismisses the popup either way, so it goes
 * deliberately rather than being dismissed mid-sentence. Unlike that one it
 * *waits* for the reply first: the background prepares the page before the bar
 * appears, and a restricted URL or a refused injection has nowhere to be
 * reported once the popup is gone. So a failure keeps the popup open with the
 * error in `status`, and only a started session closes it.
 */
export async function startAnnotate(): Promise<void> {
  busy.value = true;
  status.value = { kind: "working", text: "Preparing the page..." };

  try {
    const response = await send({ type: "ANNOTATE", action: "start" });

    if (!response.ok) {
      status.value = { kind: "error", text: response.error };
      return;
    }
    status.value = {
      kind: "done",
      text: "Draw on the page. Esc, or the bar's X, when you are done.",
    };
    setTimeout(() => window.close(), 200);
  } catch (error) {
    status.value = { kind: "error", text: `Could not start drawing: ${message(error)}` };
  } finally {
    busy.value = false;
  }
}
