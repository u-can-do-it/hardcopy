/**
 * Reveal content the page has collapsed or clipped (PROJECT.md §4.1).
 */

import { overrideStyle, undoAll, type Undo } from "./style";

export interface ExpandResult {
  count: number;
  undo: Undo;
}

/** Open every `<details>`, remembering which were closed. */
export function expandDetails(): ExpandResult {
  const closed = Array.from(document.querySelectorAll("details")).filter((d) => !d.open);
  for (const d of closed) d.open = true;
  return {
    count: closed.length,
    undo: () => {
      for (const d of closed) {
        try {
          d.open = false;
        } catch {
          /* detached */
        }
      }
    },
  };
}

/** How much taller than its box an element must be before we un-clip it. */
const CLIP_TOLERANCE_PX = 8;

const CLIPPING = new Set(["hidden", "auto", "scroll", "clip", "overlay"]);

/**
 * Un-clip scroll containers so their full content prints.
 *
 * Only touches elements that are *actually* clipped - `scrollHeight` beyond
 * `clientHeight` - so decorative `overflow: hidden` (rounded corners, clearfix)
 * is left alone.
 */
export function unlockScrollContainers(): ExpandResult {
  const undos: Undo[] = [];

  // A modal's scroll lock lives here and silently truncates print to one page.
  for (const root of [document.documentElement, document.body]) {
    if (!root) continue;
    const cs = getComputedStyle(root);
    if (CLIPPING.has(cs.overflowY) || CLIPPING.has(cs.overflowX)) {
      undos.push(
        overrideStyle(root, [
          ["overflow", "visible"],
          ["height", "auto"],
          ["max-height", "none"],
          ["position", cs.position === "fixed" ? "static" : cs.position],
        ]),
      );
    }
  }

  for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    const cs = getComputedStyle(el);

    // `content-visibility: auto` leaves offscreen subtrees unrendered, which
    // prints as blank space.
    if (cs.contentVisibility === "auto" || cs.contentVisibility === "hidden") {
      undos.push(
        overrideStyle(el, [
          ["content-visibility", "visible"],
          ["contain-intrinsic-size", "auto none"],
        ]),
      );
    }

    const clipped = CLIPPING.has(cs.overflowY) || CLIPPING.has(cs.overflowX);
    if (!clipped) continue;

    const overflowsY = el.scrollHeight > el.clientHeight + CLIP_TOLERANCE_PX;
    const overflowsX = el.scrollWidth > el.clientWidth + CLIP_TOLERANCE_PX;
    if (!overflowsY && !overflowsX) continue;

    undos.push(
      overrideStyle(el, [
        ["overflow", "visible"],
        ["max-height", "none"],
      ]),
    );
  }

  return { count: undos.length, undo: () => undoAll(undos) };
}
