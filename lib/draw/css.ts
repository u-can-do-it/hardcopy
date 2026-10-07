/**
 * The drawing feature's two stylesheets, as strings.
 *
 * They live in `lib/draw/` rather than in the injected entrypoint because the
 * rules below are decisions, not decoration - and a decision is testable.
 * `tests/draw-css.test.ts` guards the two that are load-bearing.
 *
 * House style follows `entrypoints/select-area.ts` for anything inside a shadow
 * root: `:host { all: initial }`, a `.root` class, and a system-ui font stack.
 */

import { POPOVER_GAP_PX } from "./geometry";

/** Marks our own nodes, so nothing else has to guess which they are. */
export const LAYER_ATTR = "data-pagepdf-draw";

/** Above every `z-index` a page can name, matching select-area.ts. */
export const Z_INDEX = 2_147_483_647;

/**
 * The font a text label and a pin's number are set in.
 *
 * Here rather than in a renderer because it is the same decision as the stack
 * in `BAR_CSS` below, and because everything that wants it sits *above* this
 * module: both `lib/draw/render.ts` (the `text` kind) and `lib/draw/symbols.ts`
 * (the pin's digits) read it, and neither has to import the other to do so.
 *
 * This module is no longer a leaf - it imports `POPOVER_GAP_PX` from
 * `geometry.ts`, so that the offsets below and the arithmetic that chooses
 * between them cannot drift. So the rule that used to be "nothing here imports
 * anything" is now the one that matters: **nothing in `geometry.ts` may import
 * from here.** There is no cycle today only because that edge runs one way
 * (`geometry`'s own import of `model` is type-only); a stylesheet constant
 * pulled the other way would close the loop.
 *
 * Generic families and system faces only, in the order the rest of the codebase
 * uses them (`BAR_CSS`, `entrypoints/select-area.ts`): whatever the page is, the
 * mark has to render on a stranger's machine with nothing downloaded, and a web
 * font would need a network request from a subtree that has to be paintable the
 * instant the print dialog opens. `sans-serif` on the end is the one entry no
 * platform can fail to resolve.
 *
 * It is a `font-family` on real `<text>`, not a path traced around the glyphs,
 * which is the whole point: Chrome embeds and subsets whichever face resolved
 * and keeps the characters behind it, so the label comes out of both export
 * paths as text you can select and Ctrl+F - `CLAUDE.md`'s one check that
 * matters. A traced outline would look identical and find nothing.
 *
 * Double quotes around the two-word names, because this string is set with
 * `setAttribute` rather than parsed out of markup - nothing re-escapes it on the
 * way in, and an unquoted `Segoe UI` is not a valid family name.
 */
export const LABEL_FONT_FAMILY: string =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * Injected with `injectUnconditionalCss()`, never as `media="print"`: a
 * `media="print"` sheet does not match while the one-click path emulates
 * screen media (README Deviation 11).
 *
 * Forces `print-color-adjust: exact` on our subtree regardless of the
 * `exactColors` setting, so a user who turned that off does not get
 * washed-out marks - and forces `display`/`visibility` so a site whose print
 * stylesheet says `* { display: none }` cannot erase the annotations.
 *
 * Two things it deliberately does **not** do:
 *
 * - It never says `position: fixed`, at any specificity. Chrome repaints fixed
 *   elements on every printed sheet - that is the whole reason
 *   `lib/dom/hide-fixed.ts` exists - and a fixed layer would stamp one arrow
 *   onto all 14 pages. `position` here is `absolute`, forced, because a page is
 *   free to ship `* { position: static !important }` (see select-area.ts).
 * - It never sets `pointer-events`. That belongs to `layerBoxStyle()`'s inline
 *   style, which `setInteractive()` toggles; an `!important` here would beat
 *   the inline value and the region selector could never have the pointer.
 *
 * The bar's host must **not** carry `LAYER_ATTR`: it is hidden around every
 * capture, and a forced `display` would make that impossible. The bar is
 * styled by `BAR_CSS` inside its own closed shadow root instead.
 */
export const LAYER_CSS: string = `
[${LAYER_ATTR}],
[${LAYER_ATTR}] svg {
  /*
   * The annotations outlive a hostile print stylesheet. print-color-adjust
   * is inherited, so setting it here also carries it across the shadow
   * boundary into the marks themselves.
   */
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
  print-color-adjust: exact !important;
  -webkit-print-color-adjust: exact !important;
}
[${LAYER_ATTR}] svg * {
  /*
   * "inline" is the SVG default: on an SVG element every value of display
   * other than "none" simply means "rendered", so this is the safe way to beat
   * a * { display: none !important } rule without disturbing SVG layout.
   */
  display: inline !important;
  visibility: visible !important;
}
[${LAYER_ATTR}] {
  /* Never fixed - see the note above. */
  position: absolute !important;
  z-index: ${Z_INDEX} !important;
  /*
   * The host's offset is measured once at mount, by anchorCorrection(), so a
   * page's own * { margin: 8px } must not move it afterwards.
   */
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  float: none !important;
  transform: none !important;
  clip-path: none !important;
  filter: none !important;
  background: none !important;
  max-width: none !important;
  max-height: none !important;
}
`;

/**
 * Inside the bar's own closed shadow root, so the page's CSS cannot reach it.
 *
 * Three groups are **popovers** rather than rows - the symbols palette, the
 * label's font size and the shape fill - and the vocabulary for them is the
 * last block below. The first two were flat until task 16: seven marks inline
 * is a bar half the width of a laptop screen, and DRAWING.md §2 draws them as
 * `▾` menus. The fill arrived as a menu already, and for a different reason -
 * three buttons would have fitted in a row, but a row of three
 * shapes-with-interiors beside the row of shape tools reads as six tools, and
 * a fill is a pen *setting* rather than a tool (`lib/draw/bar.ts`'s header,
 * point 4). Everything else stays flat on purpose. Three widths and five
 * swatches are one press each where a menu would be two, and a menu earns its
 * second press only when it is hiding enough buttons to be worth it.
 */
export const BAR_CSS: string = `
:host { all: initial; }
.root {
  position: fixed;
  z-index: ${Z_INDEX};
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.94);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.32);
  font: 500 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #fff;
  -webkit-user-select: none;
  user-select: none;
  touch-action: none;
}
/*
 * setVisible(false) around a capture. The bar is fixed and is not part of
 * anyone's document, so leaving it in would repeat it on every printed sheet.
 */
.root[data-visible="0"] { display: none; }
.group { display: flex; align-items: center; gap: 2px; }
.group + .group {
  margin-left: 4px;
  padding-left: 5px;
  border-left: 1px solid rgba(255, 255, 255, 0.16);
}
.grip { padding: 0 3px; cursor: grab; color: rgba(255, 255, 255, 0.55); }
.root[data-dragging="1"] .grip { cursor: grabbing; }
.btn {
  appearance: none;
  -webkit-appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.btn:hover { background: rgba(255, 255, 255, 0.12); }
.btn[data-active="1"] { background: rgba(255, 255, 255, 0.22); }
.btn:focus-visible { outline: 2px solid #93c5fd; outline-offset: 1px; }
/* Undo and redo with nothing to undo or redo - the only buttons that disable. */
.btn[disabled] { cursor: default; opacity: 0.4; }
.icon {
  display: block;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.swatch {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.35);
}
.btn[data-active="1"] .swatch { border-color: #fff; }
/* The width buttons show the width itself rather than a number. */
.stroke { display: block; width: 16px; border-radius: 999px; background: currentColor; }
.note {
  position: absolute;
  left: 0;
  /* Flipped above the bar by the shared rule below when there is no room. */
  top: calc(100% + ${POPOVER_GAP_PX}px);
  max-width: min(420px, 60vw);
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.94);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  font: 500 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #fff;
}
.note[data-visible="0"] { display: none; }

/*
 * ------------------------------------------------------------- popovers
 *
 * A group that keeps most of its buttons behind a trigger: the symbols palette
 * (its tool:symbol button is the trigger), the label's font size (whose trigger
 * is drawn by mountBar and shows the current size, which is what DRAWING.md's
 * "font-size control where the text field would have been" is for), and the
 * shape fill (whose trigger is drawn the same way and shows the armed mode, so
 * "why is my rectangle solid?" is answered by looking at the bar). Three, not
 * two: the fill group joined them when the fill stopped being a pair of tools.
 *
 * The panel is position: absolute against its own group and so takes no part in
 * the bar's row: the bar's width is what clampToViewport is measured against on
 * every drag and resize, and a panel that widened the row while open would move
 * the bar out from under the pointer.
 */
.group[data-popover] { position: relative; }
/*
 * The ▾ of the sketch, as a border triangle rather than a glyph: it inherits
 * the button's colour, needs no second icon inside a 28px box, and cannot be
 * missing from a font. Tucked into the corner so it does not crowd the icon.
 */
[data-popover-trigger] { position: relative; }
[data-popover-trigger]::after {
  content: "";
  position: absolute;
  right: 3px;
  bottom: 4px;
  border-left: 3px solid transparent;
  border-right: 3px solid transparent;
  border-top: 3px solid currentColor;
  opacity: 0.65;
}
.popover {
  position: absolute;
  left: 0;
  /* Flipped above the bar by the shared rule below when there is no room. */
  top: calc(100% + ${POPOVER_GAP_PX}px);
  /* Opened by the group's data-open, below. */
  display: none;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.94);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.32);
  /*
   * Above .note, which is a later sibling *of .root* and would otherwise paint
   * over a panel opened under it - both hang below the bar at the same offset.
   * .root has a z-index of its own, so this is a local ordering inside the bar
   * and not another entry in the page's stacking order.
   */
  z-index: 1;
}
.group[data-open="1"] > .popover { display: flex; }
/*
 * ...and the flip, which is what makes a panel reachable at all: .root is fixed
 * and the bar may be parked at the bottom of the screen, where anything hanging
 * below it is outside the viewport and a fixed subtree cannot be scrolled to.
 * place() in bar.ts measures and writes data-place from dropSide (geometry.ts).
 * The note shares the rule - same offset off the same .root, same way off the
 * screen, and it is the bar's only feedback channel.
 */
.popover[data-place="above"],
.note[data-place="above"] {
  top: auto;
  bottom: calc(100% + ${POPOVER_GAP_PX}px);
}
/*
 * The font-size buttons and their trigger show the size itself, the way the
 * width buttons show the width: a number is what you are choosing here, so
 * there is no icon to draw. Tabular figures so 12 and 48 are the same width and
 * the trigger does not change size as the bar is used.
 */
.btn.trigger { width: auto; min-width: 28px; padding: 0 11px 0 5px; }
.size {
  display: block;
  font: 500 12px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
  font-variant-numeric: tabular-nums;
}
`;
