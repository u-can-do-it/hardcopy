/**
 * The preparation curtain (contracts.md §32, widened by §32.2).
 *
 * Pre-processing runs the lazy-image sweep, which scrolls the page to the
 * bottom and back. In annotate mode that ordering is load-bearing and is not
 * changing (`.plan/design.md` §4.2, `docs/features/DRAWING.md` §3): a mark
 * stores a *document* coordinate, so an image that loads above it after it is
 * drawn slides the content down while the mark stays put. The sweep cannot be
 * moved to export time - what it needed was to stop reading as a glitch.
 *
 * So: a backdrop over the viewport, saying what is happening, up for the
 * duration of the preparation and gone before anything uses the prepared page.
 * Translucent, so it dims the moving page rather than hiding it (§32.4) - a
 * look and not a mechanism, decided twice; see the `background` declaration
 * below, which carries the history.
 *
 * **Every sweep, not only annotate mode's** (§32.2). §32.1 scoped it to
 * annotate mode on the grounds that a popup export's scroll is less surprising
 * because the user pressed Export on purpose. That does not survive contact:
 * it is the same sweep moving the page the same way, and the popup has *closed*
 * by then - so there is no UI left on screen saying anything is in progress,
 * which makes an export worse than annotate mode rather than better. The
 * trigger is therefore the sweep itself (`PrepOptions.loadLazyImages`) and not
 * which path asked for the pass.
 *
 * Split the way `.plan/design.md` §6 asks: the stylesheet and the three strings
 * are constants `tests/draw-css.test.ts` can hold, and `showBackdrop()` is the
 * half a unit test cannot reach - a closed shadow root and a timer - exactly
 * like `mountBar()`.
 */

import { Z_INDEX } from "./css";

/**
 * The stylesheet, inside the curtain's own closed shadow root.
 *
 * Exported so `tests/draw-css.test.ts` can hold the one invariant that matters
 * here, which is the **deliberate inversion of the layer's**:
 *
 * - `CLAUDE.md` and `LAYER_CSS` say the drawing layer is `position: absolute`
 *   in a clipping wrapper and *never* `fixed`, because Chrome repaints fixed
 *   elements on every printed sheet - a fixed layer stamps one arrow onto all
 *   14 pages (README Deviation 7, `lib/dom/hide-fixed.ts`).
 * - This must be `fixed` anyway, because it is a *viewport* overlay and not a
 *   document one: it covers what the user is looking at while the page scrolls
 *   underneath it. An absolute curtain would scroll away with the sweep it
 *   exists to hide.
 *
 * The second half is what makes the first half safe, and neither half is worth
 * anything without the other: it is **gone before anything is captured**.
 * `entrypoints/prepare.ts` takes it down in a `finally` around the pass, which
 * is before it answers the background - so it is down before `window.print()`
 * opens the print path's dialog, before the one-click path's CDP capture, and
 * before a single mark can be drawn. Nothing here ever meets a printed sheet,
 * so the reason the layer may not be fixed does not reach it. A curtain that
 * *did* get caught by a print would be exactly the failure the layer's
 * invariant exists to prevent: fixed chrome repeated on all 14 sheets.
 *
 * The host must therefore **not** carry `LAYER_ATTR`: `LAYER_CSS` forces
 * `display: block !important` on anything that does, which would beat every way
 * of taking the curtain down and leave the page behind it. That is the same
 * trap `lib/draw/bar.ts` documents for the bar, and the consequence here is
 * worse - the bar would merely be photographed, the curtain would be permanent.
 */
export const BACKDROP_CSS: string = `
:host { all: initial; }
.root {
  /*
   * Fixed on purpose - see the note on BACKDROP_CSS. The page scrolls
   * underneath this; it is removed before anything is captured.
   */
  position: fixed;
  inset: 0;
  z-index: ${Z_INDEX};
  display: flex;
  align-items: center;
  justify-content: center;
  /*
   * It eats the pointer while it is up: a click landing mid-sweep would hit
   * whatever the scroll happened to put under the cursor. Said out loud rather
   * than left to the initial value, because it is the behaviour and not a side
   * effect of the host's "all: initial".
   */
  pointer-events: auto;
  cursor: progress;
  /*
   * Translucent on purpose, at 50% (§32.4): the page is meant to be visible
   * behind the curtain, dimmed rather than hidden.
   *
   * The alpha has been chosen twice. It started at rgba(15, 23, 42, 0.55);
   * §32.3 made it solid #0f172a on the user's call, on the grounds that a dim
   * page still showed the sweep; §32.4 is the user asking for translucent
   * again, at 0.5. It is a look, and theirs to decide.
   *
   * Nothing depends on the alpha either way: an overlay - opaque or not -
   * changes nothing about what the sweep loads, because IntersectionObserver
   * ignores occlusion. That was measured when the question first came up.
   */
  background: rgba(15, 23, 42, 0.5);
  font: 500 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #fff;
  -webkit-user-select: none;
  user-select: none;
}
.card {
  max-width: min(420px, 76vw);
  padding: 14px 18px;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.94);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.32);
  text-align: center;
}
.title { font-size: 15px; }
.note { margin-top: 4px; opacity: 0.78; }
/*
 * An indeterminate bar, because the sweep has no progress to report and a
 * still card for eight seconds reads as a hung page rather than a working one.
 */
.spinner {
  margin-top: 10px;
  height: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  overflow: hidden;
}
.spinner::after {
  content: "";
  display: block;
  width: 40%;
  height: 100%;
  border-radius: inherit;
  background: rgba(255, 255, 255, 0.85);
  animation: pagepdf-backdrop-sweep 1.1s ease-in-out infinite;
}
@keyframes pagepdf-backdrop-sweep {
  from { transform: translateX(-100%); }
  to { transform: translateX(250%); }
}
@media (prefers-reduced-motion: reduce) {
  .spinner::after { width: 100%; animation: none; opacity: 0.5; }
}
`;

/**
 * How long preparation must run before the curtain appears, in ms.
 *
 * A page with no lazy images prepares in a few ms and never scrolls, and a
 * curtain that flashes up and away is worse than the thing it was hiding. So it
 * is shown on a timer rather than immediately, and a fast preparation finishes
 * first and shows nothing at all.
 *
 * Chosen, not measured: long enough that no instant preparation reaches it,
 * short enough that a sweep does not get going unannounced first.
 */
export const BACKDROP_DELAY_MS = 180;

/** What the curtain says. */
export const BACKDROP_TITLE = "Preparing the page...";

/**
 * The second line, and it is the point of the whole feature.
 *
 * The scroll is not noise to be hidden - it is the page being made ready, and
 * saying so turns a glitch into an explanation. It also tells the user why it
 * is worth waiting for, which is the thing they cannot see.
 *
 * **True on every path it appears on** (§32.3). This read "Loading images so
 * your marks stay where you put them.", which names marks to a user who pressed
 * Export PDF and has none - and §32.2 had already widened the curtain to cover
 * exports. `tests/draw-css.test.ts` asserts that neither string may name a mode
 * the user might not be in; this is that rule one word over. The sentence still
 * says the thing the user cannot see, which is why the wait is worth it.
 */
export const BACKDROP_NOTE = "Loading images so the whole page is in the export.";

export interface BackdropHandle {
  /** Take it down. Idempotent, and safe before the delay has elapsed. */
  remove(): void;
}

/**
 * The curtain this module last put up, so a second `showBackdrop()` takes the
 * first one down instead of stacking a second one over it.
 *
 * The same move as `mountLayer`'s `current?.unmount()` and
 * `entrypoints/select-area.ts`'s `cancelActive?.("restarted")`, for the same
 * reason: one live overlay and a stale handle is a much better failure than two
 * overlays, one of which nothing can reach.
 *
 * It is a module-level handle rather than a per-call local because a local is
 * exactly what did not work (§32.3). `entrypoints/prepare.ts` holds its handle
 * for the length of one pass, and nothing at the top of a pass took down a
 * curtain an earlier *in-flight* pass had put up. The sweep budget is 8s
 * (`lib/dom/lazy.ts`) and `entrypoints/background.ts` serialises nothing per
 * tab, so the overlap window is seconds wide: press Draw on a long article,
 * reopen the popup, Export. Pass B removed only B's curtain and replied, and
 * `window.print()` - or the one-click path's CDP capture - fired with **A's
 * curtain still in the document**: `position: fixed` chrome on every printed
 * sheet.
 *
 * This does **not** fix the underlying hole. Two `PAGE_PREPARE`s in flight
 * still double-run the pass and scramble `active`/`held`, which `BACKLOG.md`
 * already records. It stops that hole from putting fixed chrome into a PDF.
 */
let current: BackdropHandle | null = null;

/**
 * Put the curtain up after `BACKDROP_DELAY_MS`, and hand back its handle.
 *
 * Its own closed shadow root on `documentElement`, positioned inline with
 * `important` the way `entrypoints/select-area.ts` does it - a page shipping
 * `* { position: static !important }` reaches the host, though not the
 * stylesheet behind the boundary. Fixed rather than static for a second reason
 * as well: a host in `documentElement`'s flow would add its own height to a
 * document the sweep is watching for growth (`MAX_GROWTH_FACTOR`).
 *
 * `remove()` must be called from a `finally`: a preparation that throws must
 * not leave the page behind a curtain it cannot dismiss. That is the worst
 * outcome available here - worse than the jank the curtain replaces, because
 * the jank ends by itself and this would not. The `finally` must also close
 * before the caller is told the page is ready, or the curtain is still up when
 * the print dialog opens or the CDP capture fires.
 *
 * Not unit tested, and cannot be: `tests/` is plain vitest on `environment:
 * "node"` with no DOM harness, which `CLAUDE.md` asks stay that way - the same
 * position `mountBar()` is in. The constants above carry what is testable;
 * `pnpm compile` plus the Manual check in `.plan/tasks/42-prepare-backdrop.md`
 * cover the rest.
 *
 * **One at a time.** Whatever is already up comes down first - see the note on
 * `current` for the overlap this closes, and for the larger one it does not.
 */
export function showBackdrop(doc: Document = document): BackdropHandle {
  current?.remove();

  const host = doc.createElement("div");
  // The select-area treatment: the host takes no part in the page's layout and
  // says so at a specificity a page's own `* { position: static !important }`
  // cannot beat. `BACKDROP_CSS`'s `.root` is safe behind the shadow boundary;
  // the host is not - and it is deliberately not carrying `LAYER_ATTR` to be
  // forced for it, because `LAYER_CSS`'s forced `display` would make the
  // curtain impossible to remove.
  host.style.setProperty("all", "initial", "important");
  host.style.setProperty("position", "fixed", "important");
  host.style.setProperty("z-index", String(Z_INDEX), "important");

  const shadow = host.attachShadow({ mode: "closed" });
  const style = doc.createElement("style");
  style.textContent = BACKDROP_CSS;
  shadow.append(style);

  const root = doc.createElement("div");
  root.className = "root";
  // Announced without being focused: the hand is on the page, and the curtain
  // is telling the user what the page is doing, not asking them anything.
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");

  const card = doc.createElement("div");
  card.className = "card";

  const title = doc.createElement("div");
  title.className = "title";
  title.textContent = BACKDROP_TITLE;

  const note = doc.createElement("div");
  note.className = "note";
  note.textContent = BACKDROP_NOTE;

  const spinner = doc.createElement("div");
  spinner.className = "spinner";
  spinner.setAttribute("aria-hidden", "true");

  card.append(title, note, spinner);
  root.append(card);
  shadow.append(root);

  // Built now, shown later: the whole subtree exists before the timer so that
  // the moment it is appended it paints, and a preparation that beats the
  // timer throws all of it away without it ever having been in the document.
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    timer = undefined;
    doc.documentElement.append(host);
  }, BACKDROP_DELAY_MS);

  const handle: BackdropHandle = {
    // Idempotent in both of its states, which is what lets it sit in a
    // `finally` that may run before the delay has elapsed: `clearTimeout` of a
    // fired or cleared timer does nothing, and `remove()` on a node that was
    // never appended - or already removed - does nothing either.
    remove(): void {
      // Only if this handle is still the live one. A pass whose curtain a later
      // `showBackdrop()` already replaced must not clear the *replacement* out
      // of `current` when its own `finally` finally runs - that would be the
      // stacking bug again, one indirection along.
      if (current === handle) current = null;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      host.remove();
    },
  };
  current = handle;
  return handle;
}
