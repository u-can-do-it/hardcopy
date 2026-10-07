/**
 * Make lazy-loaded media exist before we print it (PROJECT.md §4.1).
 *
 * Two mechanisms cover almost everything in the wild: native `loading="lazy"`,
 * which we switch to eager, and IntersectionObserver-based loaders, which only
 * fire if the viewport actually passes over the element - hence the scroll.
 */

import { sleep } from "./style";

export interface LazyOptions {
  /** Fraction of a viewport to advance per step. */
  stepRatio?: number;
  stepDelayMs?: number;
  /** Hard ceiling on the whole operation - a page can grow forever. */
  budgetMs?: number;
}

export interface LazyResult {
  forced: number;
  warnings: string[];
}

function groupThousands(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const DEFAULTS = { stepRatio: 0.9, stepDelayMs: 90, budgetMs: 8000 };

/**
 * Guards against infinite scroll.
 *
 * Scrolling to the bottom to wake lazy loaders is the same gesture that makes
 * a feed load its next batch, so on a site like a news homepage the document
 * grows for as long as we keep scrolling. Left alone that produces a PDF of
 * hundreds of sheets from a page that looked like ten.
 */
export const MAX_GROWTH_FACTOR = 3;
export const MAX_HEIGHT_PX = 60_000;

/** Pure - covered by tests/lazy.test.ts. */
export function shouldStopGrowing(startHeight: number, currentHeight: number): boolean {
  if (currentHeight >= MAX_HEIGHT_PX) return true;
  if (startHeight > 0 && currentHeight > startHeight * MAX_GROWTH_FACTOR) return true;
  return false;
}

function scrollTo(y: number): void {
  window.scrollTo({ top: y, left: 0, behavior: "instant" as ScrollBehavior });
}

function docHeight(): number {
  const el = document.scrollingElement ?? document.documentElement;
  return Math.max(el.scrollHeight, document.body?.scrollHeight ?? 0);
}

/** Wait for in-flight images, but never longer than `timeoutMs`. */
async function settleImages(timeoutMs: number): Promise<boolean> {
  const pending = Array.from(document.images).filter((img) => !img.complete);
  if (pending.length === 0) return true;

  const waits = pending.map(
    (img) =>
      new Promise<void>((resolve) => {
        const done = (): void => {
          img.removeEventListener("load", done);
          img.removeEventListener("error", done);
          resolve();
        };
        img.addEventListener("load", done);
        img.addEventListener("error", done);
      }),
  );

  let timedOut = false;
  await Promise.race([
    Promise.all(waits),
    sleep(timeoutMs).then(() => {
      timedOut = true;
    }),
  ]);
  return !timedOut;
}

export async function loadLazyImages(options: LazyOptions = {}): Promise<LazyResult> {
  const { stepRatio, stepDelayMs, budgetMs } = { ...DEFAULTS, ...options };
  const warnings: string[] = [];
  const startedAt = Date.now();
  const originalY = window.scrollY;

  let forced = 0;
  for (const el of Array.from(
    document.querySelectorAll<HTMLImageElement | HTMLIFrameElement>(
      'img[loading="lazy"], iframe[loading="lazy"]',
    ),
  )) {
    el.loading = "eager";
    forced++;
  }
  for (const img of Array.from(document.images)) {
    // Async decode can leave an image blank at print time.
    img.decoding = "sync";
  }

  const step = Math.max(200, Math.floor(window.innerHeight * stepRatio));
  const startHeight = docHeight();
  let y = 0;
  let exhausted = false;
  let runaway = false;

  /**
   * Only ever scroll as far as the page's *original* bottom.
   *
   * Scrolling to the bottom is what makes an infinite feed load its next
   * batch, so following the bottom as it moves means exporting a page the user
   * never saw - and on a news homepage it never ends. The job here is to wake
   * the lazy images inside the page as it stood when Export was pressed.
   */
  while (y < Math.min(docHeight(), startHeight)) {
    if (Date.now() - startedAt > budgetMs) {
      exhausted = true;
      break;
    }
    if (shouldStopGrowing(startHeight, docHeight())) {
      runaway = true;
      break;
    }
    scrollTo(y);
    await sleep(stepDelayMs);
    y += step;
  }

  if (!exhausted && !runaway) {
    scrollTo(Math.min(docHeight(), startHeight));
    await sleep(stepDelayMs);
  }

  const remaining = Math.max(500, budgetMs - (Date.now() - startedAt));
  const settled = await settleImages(remaining);

  try {
    await Promise.race([document.fonts.ready, sleep(1500)]);
  } catch {
    // No font loading API, or it rejected. Not worth failing the export over.
  }

  scrollTo(originalY);

  if (docHeight() > startHeight * 1.2) {
    warnings.push(
      `This page loaded more content as it scrolled, so it is now ${groupThousands(
        docHeight(),
      )} px tall.`,
    );
  } else if (runaway) {
    warnings.push(
      `This page keeps loading more as you scroll, so only the first ${groupThousands(
        docHeight(),
      )} px were captured.`,
    );
  } else if (exhausted) {
    warnings.push("The page was still growing after 8s - some images may be missing.");
  } else if (!settled) {
    warnings.push("Some images had not finished loading.");
  }

  return { forced, warnings };
}
