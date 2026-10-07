/**
 * Keyboard shortcuts (manifest `commands`), as pure logic.
 *
 * Four commands, and every one of them is a shortcut *to a thing the popup
 * already does* - deliberately. A command sends the same `BgRequest` the popup
 * button sends and lets the background's existing handler decide everything
 * else, so a shortcut can never drift from the button beside it.
 *
 * Nothing is decided here. One click or the print dialog is
 * `settings.exportMode`, and the page mode is `effectivePageMode`
 * (lib/settings), both resolved by the background inside the export - the one
 * place the popup, the shortcut and the drawing bar all pass through.
 *
 * `draw` is the one command a free browser cannot run: annotate mode is Pro,
 * and the background answers it with `PRO_REQUIRED`, which `commandToast`
 * puts in the page so the keypress is not silently ignored.
 */

import type { BgRequest, BgResponse } from "./messages";

export type CommandName = "save-pdf" | "capture-page" | "capture-area" | "draw";

const NAMES: readonly string[] = ["save-pdf", "capture-page", "capture-area", "draw"];

/**
 * Chrome hands `onCommand` a bare string, and an old binding can outlive the
 * command it was made for. Anything unrecognised is dropped rather than run.
 */
export function isCommandName(value: string): value is CommandName {
  return NAMES.includes(value);
}

/** The request this command stands for. */
export function requestForCommand(name: CommandName): BgRequest {
  switch (name) {
    case "save-pdf":
      return { type: "EXPORT" };
    case "capture-page":
      return { type: "CAPTURE", area: "full" };
    case "capture-area":
      return { type: "CAPTURE", area: "region" };
    case "draw":
      return { type: "ANNOTATE", action: "start" };
  }
}

export interface CommandToast {
  text: string;
  tone: "done" | "error";
}

/**
 * What to say in the page once the command is done, or `null` for nothing.
 *
 * A shortcut has no popup, so the status line the popup would have shown has
 * nowhere to go. `null` is the common case and it is not laziness - it is one
 * rule, that nothing is said twice:
 *
 * - The **print dialog** is its own announcement. A one-click export is the
 *   opposite case, and the reason this function exists: it writes a file with
 *   nothing on screen to show for it.
 * - The **drawing bar** appearing is the announcement for `draw`.
 * - A **region capture announces itself.** `handleCapture`'s region branch
 *   toasts the saved filename, a selection too small to use, and a failed
 *   capture, from inside the page - it has to, because it is shared with the
 *   popup and the click that starts the drag has already closed the popup. So
 *   `capture-area` is silent here for every outcome that branch owns, which is
 *   every outcome from the moment the selector goes up. The failures that come
 *   *before* it - `NO_TAB`, `RESTRICTED_URL` - are not toasted there and still
 *   speak here.
 *
 * `CANCELLED` is silent whatever raised it: the user let go of the drag, or
 * pressed Esc, and they know.
 *
 * Saying it twice is not merely noisy, which is why the region rule is worth
 * the parameter. `select-area.ts` keeps a single timer for the toast it has up,
 * and a second toast clears that timer while removing only its own host - so
 * the duplicate is the one that never goes away, and sits on the page until the
 * user navigates.
 */
export function commandToast(name: CommandName, response: BgResponse): CommandToast | null {
  if (!response.ok) {
    if (response.code === "CANCELLED") return null;
    // The region branch has already put this exact sentence in the page. The
    // only other `CAPTURE_FAILED` in the background is the guard for a build
    // whose manifest does not ask for `debugger` - unreachable while it does,
    // and it still reaches the popup, which is where a build defect belongs.
    if (name === "capture-area" && response.code === "CAPTURE_FAILED") return null;
    return { text: response.error, tone: "error" };
  }

  if ("printRequested" in response) {
    // Print: Chrome's dialog is the feedback. One-click: nothing on screen changed.
    return response.printRequested
      ? null
      : { text: `Saved ${response.filename ?? "the PDF"}`, tone: "done" };
  }

  if ("kind" in response && response.kind === "capture") {
    return response.area === "region" ? null : { text: `Saved ${response.filename}`, tone: "done" };
  }

  return null;
}
