/**
 * Hide sticky headers, cookie bars and chat widgets (project.md §4.1).
 *
 * Chrome repaints `position: fixed` elements on *every* printed sheet, so a
 * cookie banner left in place is a cookie banner on all 14 pages.
 */

import { overrideStyle, undoAll, type Undo } from "./style";

/**
 * An element holding more than this share of the page's text is treated as the
 * content itself, not furniture, and is left alone however sticky it is.
 *
 * Not in the spec, but without it a site whose main wrapper is `position:
 * sticky` exports a blank PDF - and "content present, not blank" is a row in
 * the §9 test matrix.
 */
export const MAX_TEXT_SHARE = 0.2;

/** Table furniture is legitimately sticky and legitimately wanted. */
const KEEP_TAGS = new Set(["THEAD", "TR", "TH", "TD", "TFOOT"]);

export interface FixedCandidate {
  position: string;
  height: number;
  /** 0..1 - this element's text length over the whole body's. */
  textShare: number;
}

/** Pure decision function - covered by tests/hide-fixed.test.ts. */
export function shouldHideFixed(c: FixedCandidate, minHeight: number): boolean {
  if (c.position !== "fixed" && c.position !== "sticky") return false;
  if (!(c.height > minHeight)) return false;
  if (c.textShare > MAX_TEXT_SHARE) return false;
  return true;
}

export interface HideOptions {
  minHeight: number;
  extraSelectors: string[];
}

export interface HideResult {
  count: number;
  warnings: string[];
  undo: Undo;
}

export function hideFixedElements(opts: HideOptions): HideResult {
  const undos: Undo[] = [];
  const warnings: string[] = [];
  const seen = new Set<Element>();

  const bodyTextLength = (document.body?.textContent ?? "").replace(/\s+/g, " ").trim().length;

  const hide = (el: HTMLElement): void => {
    if (seen.has(el)) return;
    seen.add(el);
    undos.push(overrideStyle(el, [["display", "none"]]));
  };

  // User-supplied selectors are hidden unconditionally - they asked for it.
  for (const selector of opts.extraSelectors) {
    try {
      document.querySelectorAll<HTMLElement>(selector).forEach(hide);
    } catch {
      warnings.push(`Ignored an invalid hide selector: ${selector}`);
    }
  }

  for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    if (KEEP_TAGS.has(el.tagName)) continue;

    const position = getComputedStyle(el).position;
    if (position !== "fixed" && position !== "sticky") continue;

    const height = el.getBoundingClientRect().height;
    const textLength = (el.textContent ?? "").replace(/\s+/g, " ").trim().length;
    const textShare = bodyTextLength > 0 ? textLength / bodyTextLength : 0;

    if (shouldHideFixed({ position, height, textShare }, opts.minHeight)) hide(el);
  }

  return {
    count: undos.length,
    warnings,
    undo: () => undoAll(undos),
  };
}
