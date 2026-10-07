/**
 * In-page pre-processing, injected on demand (PROJECT.md §4.1).
 *
 * This is an *unlisted* script, not a declared content script, and that is the
 * whole point. A declared content script needs `matches`, and `matches:
 * ["<all_urls>"]` puts "Read and change all your data on all websites" on the
 * install prompt - which would flatly contradict §5's `host_permissions: []`.
 * Injected through chrome.scripting under `activeTab`, the same code reaches
 * the tab the user clicked on and nothing else, with no install warning.
 */

import { prepareForExport, type Prepared } from "@/lib/dom/prepare";
import { showBackdrop } from "@/lib/draw/backdrop";
import { fail, type PageRequest, type PageResponse } from "@/lib/messages";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";

/** Injection is idempotent - re-running must not stack message listeners. */
interface PagePdfWindow extends Window {
  __pagepdfInstalled?: boolean;
}

export default defineUnlistedScript(() => {
  const w = window as PagePdfWindow;
  if (w.__pagepdfInstalled) return;
  w.__pagepdfInstalled = true;

  let active: Prepared | null = null;

  /** Annotate mode owns the prepared pass; an export must not tear it down. */
  let held = false;

  const restore = (): void => {
    const current = active;
    active = null;
    current?.undo();
  };

  /**
   * Print *after* responding, because Chrome blocks the renderer while the
   * print preview is open. Undo runs from `afterprint` and again once print()
   * returns; `Prepared.undo` is idempotent, so whichever lands first wins.
   *
   * Both undos are skipped while the pass is `held`: printing from annotate
   * mode must leave the prepared page (and the marks drawn on it) standing.
   * `held` is read when each path fires, not captured here, so a `release`
   * that arrives while the dialog is open still gets its restore.
   */
  const schedulePrint = (): void => {
    const onAfterPrint = (): void => {
      window.removeEventListener("afterprint", onAfterPrint);
      if (!held) restore();
    };
    window.addEventListener("afterprint", onAfterPrint);

    setTimeout(() => {
      try {
        window.print();
      } finally {
        window.removeEventListener("afterprint", onAfterPrint);
        if (!held) restore();
      }
    }, 50);
  };

  chrome.runtime.onMessage.addListener(
    (message: PageRequest, _sender, sendResponse: (r: PageResponse) => void) => {
      if (message?.type === "PAGE_PING") {
        sendResponse({ ok: true, pong: true });
        return false;
      }
      if (message?.type === "PAGE_RESTORE") {
        // `release` is annotate mode giving the pass up. Without it, a held
        // pass survives - that is what stops an ordinary export's `finally`
        // from pulling the page out from under the drawing.
        if (message.release === true) held = false;
        if (!held) restore();
        sendResponse({ ok: true, pong: true });
        return false;
      }
      if (message?.type !== "PAGE_PREPARE") return false;

      // Annotate mode is holding a pass: reuse it. Re-preparing under the
      // marks would move the content out from under every one of them. The
      // `active !== null` half is the guard - a flag left stale by a failed
      // pass falls through to a normal prepare rather than exporting an
      // unprepared page.
      if (held && active !== null) {
        sendResponse({ ok: true, report: active.report });
        if (message.print) schedulePrint();
        return true;
      }

      void (async () => {
        // The curtain (contracts.md §32, §32.2). Up before the pass begins,
        // down in the `finally` around it. The trigger is the lazy-image sweep
        // itself and not which path asked for the pass: §32.2 widened it from
        // annotate mode, because an export scrolls the page exactly the same
        // way and by then the popup has closed, leaving nothing on screen to
        // say anything is happening. A pass with the sweep off never shows one
        // however long it runs - it is the scroll that reads as a glitch.
        //
        // It puts itself up on a delay, so a page that prepares in a few ms
        // shows nothing at all; `remove()` before the delay elapses is one of
        // the two states it is idempotent in.
        //
        // This handle is this pass's, and it is deliberately not the only thing
        // that can take a curtain down (§32.3). Nothing serialises `PAGE_PREPARE`
        // per tab and the sweep budget is 8s, so two passes overlap for seconds
        // at a time - press Draw on a long article, reopen the popup, Export -
        // and a `finally` holding a per-call local removes only its own curtain.
        // `showBackdrop()` therefore keeps a module-level handle and takes down
        // whatever is already up, so the curtain an earlier in-flight pass put
        // there cannot still be in the document when `schedulePrint` opens the
        // dialog or the one-click path captures. That closes the
        // fixed-chrome-in-a-PDF half only: two prepares in flight still
        // double-run the pass and scramble `active`/`held`, which `BACKLOG.md`
        // records.
        const curtain = message.prep.loadLazyImages ? showBackdrop() : null;
        try {
          let prepared: Prepared;
          // This `finally` wraps the pass and nothing else, on purpose: the
          // curtain has to be down before the *reply*, not merely before this
          // handler ends. The reply is what lets the print path open the print
          // dialog (`schedulePrint` below, and the CLAUDE.md invariant that we
          // answer before calling `print()`) and the one-click path start its
          // CDP capture. A curtain caught by either is `position: fixed` chrome
          // repeated on every sheet - the exact failure the drawing layer's
          // never-fixed rule exists to prevent.
          try {
            // A previous run may not have been undone (dialog dismissed oddly).
            restore();
            prepared = await prepareForExport(
              message.prep,
              message.meta,
              message.pageMode,
              { screenMedia: message.screenMedia === true },
            );
          } finally {
            curtain?.remove();
          }
          active = prepared;
          // Set with `active`, in the one place the pair can't get out of
          // step: a holding pass is kept, any other prepare clears the flag
          // so its own `PAGE_RESTORE` is honoured as it always was.
          held = message.hold === true;
          sendResponse({ ok: true, report: prepared.report });
          if (message.print) schedulePrint();
        } catch (error) {
          restore();
          const detail = error instanceof Error ? error.message : String(error);
          sendResponse(fail("UNKNOWN", `Preparing the page failed: ${detail}`));
        }
      })();

      return true; // response is async
    },
  );
});
