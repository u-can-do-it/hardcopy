/** Reversible inline-style overrides. */

export type Undo = () => void;

/**
 * Apply `!important` declarations to an element and hand back an exact undo.
 *
 * The undo restores the whole `style` attribute rather than clearing the
 * properties we set, because the page may well have had its own inline value
 * for the same property, and `removeProperty` would drop it.
 */
export function overrideStyle(el: HTMLElement, decls: Array<[string, string]>): Undo {
  const previous = el.getAttribute("style");
  for (const [prop, value] of decls) {
    el.style.setProperty(prop, value, "important");
  }
  return () => {
    if (previous === null) el.removeAttribute("style");
    else el.setAttribute("style", previous);
  };
}

/** Run undos newest-first; one failure must not strand the rest. */
export function undoAll(undos: Undo[]): void {
  for (let i = undos.length - 1; i >= 0; i--) {
    try {
      undos[i]?.();
    } catch {
      // The element may be gone, or the page may have replaced it. Nothing to do.
    }
  }
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
