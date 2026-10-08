/**
 * The only module in this codebase allowed to touch chrome.debugger
 * (project.md §3, rule 1).
 *
 * Detaching is not optional. A leaked debugger session blocks DevTools for the
 * user and looks exactly like malware (§10.5), so the only supported way to
 * attach is `withDebugger`, which detaches in `finally`.
 */

import { base64ToBytes } from "../base64";
import type { PrintToPdfParams } from "../pdf/print-options";
import type { CaptureRect } from "../types";

export const PROTOCOL_VERSION = "1.3";

export interface LayoutMetrics {
  cssContentSize: { x: number; y: number; width: number; height: number };
  cssLayoutViewport: { clientWidth: number; clientHeight: number };
}

export interface PrintToPdfResult {
  /** Empty when transferMode is ReturnAsStream. */
  data: string;
  /** IO stream handle - read with `readStream`. */
  stream?: string;
}

export interface IoReadResult {
  data: string;
  base64Encoded?: boolean;
  eof: boolean;
}

/**
 * Whether `debugger` is actually granted.
 *
 * The original brief (project.md §4.2) planned to call
 * `chrome.permissions.request({ permissions: ["debugger"] })` at first use.
 * That cannot work: Chrome lists `debugger` among the permissions that can
 * never be optional (alongside declarativeNetRequest, devtools, geolocation,
 * mdns, proxy, tts, ttsEngine and wallpaper), so it must be declared as a
 * required manifest permission or not at all.
 *
 * There is therefore no runtime request helper here on purpose - it would
 * always resolve false. The explanation screen §4.2 asks for still has a job,
 * it just has to appear *before* the install or update rather than before a
 * permission prompt. See docs/ARCHITECTURE.md.
 */
export async function hasDebuggerPermission(): Promise<boolean> {
  return chrome.permissions.contains({ permissions: ["debugger"] });
}

export class CdpSession {
  private attached = false;

  constructor(private readonly tabId: number) {}

  get target(): chrome.debugger.Debuggee {
    return { tabId: this.tabId };
  }

  async attach(): Promise<void> {
    await chrome.debugger.attach(this.target, PROTOCOL_VERSION);
    this.attached = true;
  }

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.attached) throw new Error(`CDP session is not attached (${method}).`);
    const result = await chrome.debugger.sendCommand(this.target, method, params);
    return result as T;
  }

  async detach(): Promise<void> {
    if (!this.attached) return;
    this.attached = false;
    try {
      await chrome.debugger.detach(this.target);
    } catch {
      // The tab may already be gone, which is the outcome we wanted anyway.
    }
  }

  // --- the four commands this product actually needs ------------------------

  /**
   * The whole trick behind "screen look" (§4.2 step 4): render with screen CSS
   * instead of the site's print stylesheet.
   *
   * Note (§10.6): this persists for the session. Detaching resets it, which is
   * why `withDebugger` is the only entry point.
   */
  async emulateScreenMedia(): Promise<void> {
    await this.send("Emulation.setEmulatedMedia", { media: "screen" });
  }

  async resetEmulatedMedia(): Promise<void> {
    await this.send("Emulation.setEmulatedMedia", { media: "" });
  }

  /**
   * Stop the page running scripts.
   *
   * Measuring an infinite-scroll page is otherwise a moving target: it keeps
   * appending content between `getLayoutMetrics` and `printToPDF`, so the paper
   * is sized to a fraction of what actually gets laid out and the surplus
   * overflows onto extra sheets. Freezing scripts first makes the measurement
   * describe the same page that will be printed. Content already loaded stays;
   * in-flight images are network work and finish regardless.
   *
   * Reset on detach, and explicitly re-enabled by the caller either way.
   */
  async setScriptExecutionDisabled(disabled: boolean): Promise<void> {
    await this.send("Emulation.setScriptExecutionDisabled", { value: disabled });
  }

  /**
   * Evaluate an expression in the page.
   *
   * Still works with script execution disabled: that switch stops the *page's*
   * scripts, the same way DevTools' "Disable JavaScript" leaves its console
   * usable.
   */
  async evaluate<T>(expression: string): Promise<T | undefined> {
    const result = await this.send<{ result?: { value?: T } }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: false,
    });
    return result?.result?.value;
  }

  async getLayoutMetrics(): Promise<LayoutMetrics> {
    return this.send<LayoutMetrics>("Page.getLayoutMetrics");
  }

  /**
   * Measure the page only once it has stopped changing size.
   *
   * A single `getLayoutMetrics` is a snapshot, and lazy/infinite-scroll sites
   * keep appending content after our scroll pass ends. Measuring too early
   * sizes the paper to a fraction of what `printToPDF` will actually lay out,
   * and the difference comes back as extra sheets - a page measured at 9,713px
   * but printed at ~29,140px produced three sheets instead of one.
   *
   * Gives up after `tries` and returns the last reading: a page that never
   * settles still has to be exported.
   */
  async getStableContentSize(
    { tries = 8, gapMs = 250, tolerancePx = 4 } = {},
  ): Promise<LayoutMetrics["cssContentSize"]> {
    let last = (await this.getLayoutMetrics()).cssContentSize;

    for (let i = 0; i < tries; i++) {
      await new Promise((resolve) => setTimeout(resolve, gapMs));
      const next = (await this.getLayoutMetrics()).cssContentSize;
      const settled =
        Math.abs(next.height - last.height) <= tolerancePx &&
        Math.abs(next.width - last.width) <= tolerancePx;
      last = next;
      if (settled) break;
    }

    return last;
  }

  /**
   * A downscaled PNG of the whole page, below the fold included.
   *
   * Used to find where the page stops painting (lib/pdf/painted-height.ts).
   * `captureBeyondViewport` is what makes it the whole document rather than a
   * screenful, and `scale` keeps the image small enough to decode cheaply - a
   * 44,000px page comes back in ~35ms and 15kB at the scale picked for it.
   */
  async captureScaledPage(
    width: number,
    height: number,
    scale: number,
  ): Promise<Uint8Array | undefined> {
    try {
      return await this.captureClip({ x: 0, y: 0, width, height }, scale);
    } catch {
      // Chromium refuses very large surfaces, and a page can go away mid-call.
      // The scan is an improvement on the measurement, not a prerequisite.
      return undefined;
    }
  }

  /**
   * A PNG of one rectangle of the document, below the fold included.
   *
   * `captureBeyondViewport` is what lets the clip reach past the visible
   * screenful, and the clip is in document coordinates - the same space the
   * area selector reports its rectangle in. Throws rather than returning
   * undefined: for the screenshot feature this *is* the product, so the caller
   * has to hear about a failure instead of quietly saving nothing.
   */
  async captureClip(clip: CaptureRect, scale = 1): Promise<Uint8Array> {
    const result = await this.send<{ data?: string }>("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale },
    });
    if (!result?.data) throw new Error("Chromium returned an empty screenshot.");
    return base64ToBytes(result.data);
  }

  async printToPdf(params: PrintToPdfParams): Promise<PrintToPdfResult> {
    return this.send<PrintToPdfResult>(
      "Page.printToPDF",
      params as unknown as Record<string, unknown>,
    );
  }

  /**
   * Drain an IO stream into bytes (§4.2 step 7, §10.2). Streaming exists to
   * avoid a multi-hundred-megabyte base64 string for a tall page.
   */
  async readStream(handle: string, chunkSize = 512 * 1024): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let total = 0;

    try {
      for (;;) {
        const chunk = await this.send<IoReadResult>("IO.read", { handle, size: chunkSize });
        if (chunk.data) {
          const bytes = chunk.base64Encoded === false
            ? new TextEncoder().encode(chunk.data)
            : base64ToBytes(chunk.data);
          chunks.push(bytes);
          total += bytes.length;
        }
        if (chunk.eof) break;
      }
    } finally {
      try {
        await this.send("IO.close", { handle });
      } catch {
        // Stream already closed by the browser.
      }
    }

    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/**
 * Attach, run, detach - always. The only sanctioned way in.
 */
export async function withDebugger<T>(
  tabId: number,
  run: (session: CdpSession) => Promise<T>,
): Promise<T> {
  const session = new CdpSession(tabId);
  await session.attach();
  try {
    return await run(session);
  } finally {
    await session.detach();
  }
}

export { base64ToBytes };
