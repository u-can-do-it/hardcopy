/**
 * The "select part of the page" overlay, injected on demand.
 *
 * Unlisted, for the same reason as entrypoints/prepare.ts: a declared content
 * script needs `matches`, and `<all_urls>` would put a permission warning on
 * the install prompt that §5's `host_permissions: []` exists to avoid. Injected
 * under `activeTab`, it reaches the tab the user clicked on and nothing else.
 *
 * It answers one question - which rectangle? - in *document* coordinates, which
 * is the space `Page.captureScreenshot`'s clip is in. Everything else (freezing
 * the page, capturing, saving) belongs to the background.
 *
 * The UI lives in a shadow root so the host page's CSS cannot reach it: a page
 * with `div { position: static !important }` in its stylesheet would otherwise
 * scatter the overlay across the document.
 */

import { rectFromPoints } from "@/lib/capture/plan";
import { fail, type PageRequest, type PageResponse } from "@/lib/messages";
import type { CaptureRect } from "@/lib/types";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";

interface SelectWindow extends Window {
  __pagepdfSelectInstalled?: boolean;
}

/** Above every `z-index` a page can name, and above the prepare header block. */
const Z_INDEX = 2_147_483_647;

const OVERLAY_CSS = `
:host { all: initial; }
.root {
  position: fixed;
  inset: 0;
  z-index: ${Z_INDEX};
  cursor: crosshair;
  font: 500 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #fff;
  -webkit-user-select: none;
  user-select: none;
}
/* Dim everything, then punch a hole with a shadow big enough for any viewport. */
.scrim { position: absolute; inset: 0; background: rgba(15, 23, 42, 0.38); }
.rect {
  position: absolute;
  display: none;
  border: 1px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 0 0 100vmax rgba(15, 23, 42, 0.38);
  background: transparent;
}
.rect[data-visible="1"] { display: block; }
.rect[data-visible="1"] ~ .scrim { display: none; }
.pill {
  position: absolute;
  left: 50%;
  top: 16px;
  transform: translateX(-50%);
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.92);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  white-space: nowrap;
}
.size {
  position: absolute;
  display: none;
  white-space: nowrap;
  padding: 3px 7px;
  border-radius: 5px;
  background: rgba(15, 23, 42, 0.92);
  font-variant-numeric: tabular-nums;
}
.size[data-visible="1"] { display: block; }
.toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  z-index: ${Z_INDEX};
  padding: 9px 14px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.94);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.32);
  font: 500 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #fff;
  max-width: min(520px, 80vw);
}
.toast[data-tone="error"] { background: rgba(153, 27, 27, 0.96); }
`;

/** How long the "saved / failed" line stays up after the capture. */
const TOAST_MS = 4_000;

export default defineUnlistedScript(() => {
  const w = window as SelectWindow;
  if (w.__pagepdfSelectInstalled) return;
  w.__pagepdfSelectInstalled = true;

  /** Teardown for whichever selection is running; null when idle. */
  let cancelActive: ((reason: string) => void) | null = null;
  let toastTimer: number | undefined;

  function makeHost(): { host: HTMLElement; shadow: ShadowRoot } {
    const host = document.createElement("div");
    // The host itself must not take part in the page's layout.
    host.style.setProperty("all", "initial", "important");
    host.style.setProperty("position", "fixed", "important");
    host.style.setProperty("z-index", String(Z_INDEX), "important");
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = OVERLAY_CSS;
    shadow.append(style);
    return { host, shadow };
  }

  function showToast(text: string, tone: "done" | "error"): void {
    const { host, shadow } = makeHost();
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.dataset.tone = tone;
    toast.textContent = text;
    shadow.append(toast);
    document.documentElement.append(host);

    if (toastTimer !== undefined) clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => host.remove(), TOAST_MS);
  }

  /**
   * Put the overlay up and resolve with what the user drew.
   *
   * Resolves after the overlay has been removed *and* a frame has been painted
   * without it - otherwise the capture that follows photographs our own scrim.
   */
  function selectArea(): Promise<CaptureRect | null> {
    cancelActive?.("restarted");

    return new Promise<CaptureRect | null>((resolve) => {
      const { host, shadow } = makeHost();

      const root = document.createElement("div");
      root.className = "root";
      const rectEl = document.createElement("div");
      rectEl.className = "rect";
      const scrim = document.createElement("div");
      scrim.className = "scrim";
      const pill = document.createElement("div");
      pill.className = "pill";
      pill.textContent = "Drag to select an area - Esc to cancel";
      const sizeEl = document.createElement("div");
      sizeEl.className = "size";
      root.append(rectEl, scrim, pill, sizeEl);
      shadow.append(root);
      document.documentElement.append(host);

      let start: { x: number; y: number } | null = null;
      let latest: { x: number; y: number } | null = null;

      const finish = (rect: CaptureRect | null): void => {
        cancelActive = null;
        window.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
        host.remove();
        // Two frames: one to process the removal, one to paint without it.
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(rect)));
      };

      const draw = (): void => {
        if (!start || !latest) return;
        const left = Math.min(start.x, latest.x);
        const top = Math.min(start.y, latest.y);
        const width = Math.abs(start.x - latest.x);
        const height = Math.abs(start.y - latest.y);

        rectEl.dataset.visible = "1";
        rectEl.style.left = `${left}px`;
        rectEl.style.top = `${top}px`;
        rectEl.style.width = `${width}px`;
        rectEl.style.height = `${height}px`;

        sizeEl.dataset.visible = "1";
        sizeEl.textContent = `${Math.round(width)} x ${Math.round(height)}`;
        // Under the selection, or inside it when there is no room below.
        const below = top + height + 8;
        sizeEl.style.left = `${left}px`;
        sizeEl.style.top = `${below + 24 > window.innerHeight ? Math.max(top + 8, 8) : below}px`;
      };

      const onPointerDown = (event: PointerEvent): void => {
        if (event.button !== 0) {
          finish(null);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        start = { x: event.clientX, y: event.clientY };
        latest = start;
        pill.textContent = "Release to capture - Esc to cancel";
        try {
          // Keeps the drag alive when the pointer leaves the window. Not every
          // pointer can be captured (a synthetic one, a pen that just left the
          // digitiser), and losing capture is not worth losing the selection.
          root.setPointerCapture(event.pointerId);
        } catch {
          // Carry on without capture.
        }
        draw();
      };

      const onPointerMove = (event: PointerEvent): void => {
        if (!start) return;
        event.preventDefault();
        latest = { x: event.clientX, y: event.clientY };
        draw();
      };

      const onPointerUp = (event: PointerEvent): void => {
        if (!start) return;
        event.preventDefault();
        event.stopPropagation();
        latest = { x: event.clientX, y: event.clientY };

        // Client -> document: the clip the background sends to CDP is measured
        // from the top of the page, and the page may be scrolled.
        const offsetX = window.scrollX;
        const offsetY = window.scrollY;
        const rect = rectFromPoints(
          { x: start.x + offsetX, y: start.y + offsetY },
          { x: latest.x + offsetX, y: latest.y + offsetY },
        );
        finish(rect);
      };

      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        finish(null);
      };

      /** Scrolling mid-drag would move the page out from under the rectangle. */
      const onWheel = (event: WheelEvent): void => {
        if (start) event.preventDefault();
      };

      root.addEventListener("pointerdown", onPointerDown);
      root.addEventListener("pointermove", onPointerMove);
      root.addEventListener("pointerup", onPointerUp);
      root.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        finish(null);
      });
      window.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("wheel", onWheel, { passive: false, capture: true });

      cancelActive = () => finish(null);
    });
  }

  chrome.runtime.onMessage.addListener(
    (message: PageRequest, _sender, sendResponse: (r: PageResponse) => void) => {
      if (message?.type === "PAGE_SELECT_STATUS") {
        showToast(message.text, message.tone);
        sendResponse({ ok: true, pong: true });
        return false;
      }
      if (message?.type !== "PAGE_SELECT_AREA") return false;

      void selectArea().then((rect) => {
        sendResponse(
          rect
            ? { ok: true, rect }
            : fail("CANCELLED", "Area selection was cancelled."),
        );
      });

      return true; // the user takes as long as they take
    },
  );
});
