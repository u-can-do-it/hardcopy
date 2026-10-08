/**
 * Makes Blob URLs for the service worker (project.md §3, §10.1) - for the
 * exported PDF, and for a screenshot PNG, which arrive the same way.
 *
 * This document exists for one reason: a service worker has no
 * URL.createObjectURL. It does *not* do the downloading - an offscreen
 * document only gets `chrome.runtime` and a handful of other APIs, and
 * `chrome.downloads` is not among them (reading `.download` off it throws).
 * So the URL goes back to the worker, which holds the `downloads` permission.
 */

import { base64ToBytes } from "@/lib/base64";
import type { OffscreenRequest, OffscreenResponse } from "@/lib/messages";

/**
 * How long a minted URL stays valid.
 *
 * The worker starts the download as soon as it has the URL and Chrome reads
 * from an in-memory Blob, so this only has to outlive that copy. Revoking is
 * what keeps a long-lived offscreen document from holding every PDF ever
 * exported in memory.
 */
const REVOKE_DELAY_MS = 120_000;

/**
 * Chunks of transfers still arriving, by id.
 *
 * A file crosses in pieces because `chrome.runtime.sendMessage` refuses
 * anything over 64MiB and a full-page screenshot goes past that (lib/download.ts).
 * Each entry is dropped the moment its `final` chunk lands; the timer only
 * exists for the transfer that never finishes - a worker that was terminated
 * mid-file would otherwise leave its pieces here for the life of the document.
 */
const transfers = new Map<string, { parts: Uint8Array[]; timer: number }>();

/** Long enough for a slow, very large export; short enough to not be a leak. */
const TRANSFER_TIMEOUT_MS = 300_000;

function take(id: string): Uint8Array[] {
  const existing = transfers.get(id);
  if (existing) clearTimeout(existing.timer);
  transfers.delete(id);
  return existing?.parts ?? [];
}

function keep(id: string, parts: Uint8Array[]): void {
  const existing = transfers.get(id);
  if (existing) clearTimeout(existing.timer);
  transfers.set(id, {
    parts,
    timer: self.setTimeout(() => transfers.delete(id), TRANSFER_TIMEOUT_MS),
  });
}

chrome.runtime.onMessage.addListener(
  (message: OffscreenRequest, _sender, sendResponse: (r: OffscreenResponse) => void) => {
    // The popup's own messages reach this document too; ignore them.
    if (message?.type !== "OFFSCREEN_BLOB_URL") return false;

    try {
      const parts = take(message.id);
      parts.push(base64ToBytes(message.base64));

      if (!message.final) {
        keep(message.id, parts);
        sendResponse({ ok: true });
        return false;
      }

      const blob = new Blob(parts as BlobPart[], { type: message.mime || "application/pdf" });
      const url = URL.createObjectURL(blob);

      setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
      sendResponse({ ok: true, url });
    } catch (error) {
      take(message.id);
      sendResponse({
        ok: false,
        code: "UNKNOWN",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return false;
  },
);
