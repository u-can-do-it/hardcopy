/**
 * Background-side half of the download path (project.md §10.1).
 *
 * Split across two contexts out of necessity: only a document can create a
 * Blob URL, and only the service worker can reach `chrome.downloads`.
 */

import { bytesToBase64, chunkRanges } from "./base64";
import type { OffscreenRequest, OffscreenResponse } from "./messages";

const OFFSCREEN_PATH = "offscreen.html";

/**
 * Create the offscreen document, tolerating the case where it already exists.
 *
 * `chrome.runtime.getContexts` would answer that directly but needs Chrome
 * 116, and the manifest supports 109 - so this leans on the error message,
 * which is stable and needs no version check.
 */
async function ensureOffscreen(): Promise<void> {
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: "Create a Blob URL for the exported PDF, which a service worker cannot.",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (!/single offscreen|already exists/i.test(detail)) throw error;
  }
}

/**
 * Hand the bytes over one chunk at a time and get a Blob URL back.
 *
 * One message per file is the obvious implementation and it is what shipped
 * first; it fails on exactly the files this feature exists for. A 20,000px
 * screenshot is tens of megabytes, base64 adds a third, and
 * `chrome.runtime.sendMessage` refuses at 64MiB - the export dies *after* all
 * the work, at the last step. Chunks are sent in order and awaited one by one,
 * so the offscreen document can append them in the order it receives them.
 */
async function mintBlobUrl(bytes: Uint8Array, mime: string): Promise<string> {
  const id = crypto.randomUUID();
  const ranges = chunkRanges(bytes.length);
  let url: string | undefined;

  for (let i = 0; i < ranges.length; i++) {
    const [start, end] = ranges[i] as [number, number];
    const request: OffscreenRequest = {
      type: "OFFSCREEN_BLOB_URL",
      id,
      base64: bytesToBase64(bytes.subarray(start, end)),
      mime,
      final: i === ranges.length - 1,
    };

    const reply = (await chrome.runtime.sendMessage(request)) as OffscreenResponse | undefined;
    if (!reply) throw new Error("The downloader did not respond.");
    if (!reply.ok) throw new Error(reply.error);
    url = reply.url;
  }

  if (!url) throw new Error("The downloader did not return a URL.");
  return url;
}

/** Save bytes to the user's Downloads folder. Returns the download id. */
export async function downloadBytes(
  bytes: Uint8Array,
  filename: string,
  mime: string,
): Promise<number> {
  await ensureOffscreen();
  const url = await mintBlobUrl(bytes, mime);

  // Same extension origin, so the worker can hand this straight to downloads.
  return chrome.downloads.download({ url, filename, saveAs: false });
}

export function downloadPdf(bytes: Uint8Array, filename: string): Promise<number> {
  return downloadBytes(bytes, filename, "application/pdf");
}
