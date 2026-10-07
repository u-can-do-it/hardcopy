/**
 * Base64 <-> bytes, in a module of its own so contexts that only need the
 * conversion (the offscreen document) do not pull in the CDP wrappers.
 */

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Chunked on purpose: `String.fromCharCode(...bytes)` on a multi-megabyte
 * array exceeds the argument limit and throws.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * How many bytes go in one message.
 *
 * `chrome.runtime.sendMessage` rejects anything over 64MiB, and base64 costs a
 * third on top - so the real budget is ~48MiB of bytes. 6MiB leaves room for
 * the browser's own overhead and keeps a stalled transfer cheap to retry.
 *
 * A multiple of 3 on purpose: base64 encodes three bytes to four characters, so
 * chunking on a 3-byte boundary means every chunk decodes on its own with no
 * padding in the middle of the file.
 */
export const CHUNK_BYTES = 3 * 2_097_152; // 6MiB

/**
 * Split a length into `[start, end)` ranges of at most `size` bytes.
 *
 * Ranges rather than copies: the caller encodes straight out of the original
 * array with `subarray`, so a 200MB file is never duplicated in memory just to
 * be sent. A zero-length file still gets one range, because the offscreen
 * document has to hear a `final` message to reply at all.
 */
export function chunkRanges(length: number, size = CHUNK_BYTES): Array<[number, number]> {
  if (!(size > 0)) throw new Error("chunk size must be positive");
  if (length <= 0) return [[0, 0]];

  const ranges: Array<[number, number]> = [];
  for (let start = 0; start < length; start += size) {
    ranges.push([start, Math.min(start + size, length)]);
  }
  return ranges;
}
