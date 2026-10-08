import { describe, expect, it } from "vitest";
import {
  BACKDROP_CSS,
  BACKDROP_DELAY_MS,
  BACKDROP_NOTE,
  BACKDROP_TITLE,
} from "@/lib/draw/backdrop";
import { BAR_CSS, LABEL_FONT_FAMILY, LAYER_ATTR, LAYER_CSS, Z_INDEX } from "@/lib/draw/css";
import { POPOVER_GAP_PX } from "@/lib/draw/geometry";

/**
 * These are regression guards, not ceremony. Both properties have already cost
 * this project a debugging session in another form: ARCHITECTURE.md Decision 7 (fixed
 * furniture repeated on every sheet) and Decision 11 (a `media="print"` sheet
 * that never matches under the one-click path's screen-media emulation).
 */
describe("LAYER_CSS", () => {
  it("keeps colours exact whatever the exactColors setting says", () => {
    // Both spellings, and the un-prefixed one asserted so that the `-webkit-`
    // declaration cannot satisfy the check on its own.
    expect(LAYER_CSS).toMatch(/(^|\s)print-color-adjust:\s*exact/);
    expect(LAYER_CSS).toMatch(/-webkit-print-color-adjust:\s*exact/);
  });

  it("is never position: fixed", () => {
    // Chrome repaints fixed elements on *every* printed sheet - that is what
    // lib/dom/hide-fixed.ts exists to prevent - so a fixed layer would stamp
    // one arrow onto all 14 pages.
    expect(LAYER_CSS).not.toMatch(/position\s*:\s*fixed/);
    expect(LAYER_CSS).toMatch(/position\s*:\s*absolute\s*!important/);
  });

  it("forces display and visibility so a print stylesheet cannot erase the marks", () => {
    // A site whose print CSS says `* { display: none }` must not be able to
    // blank the annotations.
    expect(LAYER_CSS).toMatch(/display\s*:\s*block\s*!important/);
    expect(LAYER_CSS).toMatch(/visibility\s*:\s*visible\s*!important/);
  });

  it("carries no media query - it is injected unconditionally", () => {
    // injectUnconditionalCss(), not media="print": the one-click path emulates
    // screen media, and a print-conditioned rule would simply not match there.
    expect(LAYER_CSS).not.toMatch(/@media/);
  });

  it("leaves pointer-events to the layer's inline style", () => {
    // setInteractive() toggles pointer-events inline so the region selector can
    // have the pointer; an !important rule here would beat it.
    expect(LAYER_CSS).not.toMatch(/pointer-events/);
  });

  it("selects on LAYER_ATTR, so a rename cannot orphan it", () => {
    expect(LAYER_ATTR).toBe("data-pagepdf-draw");
    expect(LAYER_CSS.trim()).not.toBe("");
    expect(LAYER_CSS).toContain(`[${LAYER_ATTR}]`);
    expect(LAYER_CSS).toContain(`z-index: ${Z_INDEX}`);
  });
});

describe("BAR_CSS", () => {
  it("is screen-anchored, which is why it is hidden for a capture", () => {
    // The opposite of the layer: the bar *is* fixed, so it has to be taken down
    // around every capture rather than allowed onto the paper.
    expect(BAR_CSS).toMatch(/position\s*:\s*fixed/);
    expect(BAR_CSS).toMatch(/\.root\[data-visible="0"\]\s*\{\s*display:\s*none/);
  });

  it("keeps the shadow-root house style of select-area.ts", () => {
    expect(BAR_CSS.trim()).not.toBe("");
    expect(BAR_CSS).toContain(":host { all: initial; }");
    expect(BAR_CSS).toContain(".root {");
    expect(BAR_CSS).toContain(".btn {");
    expect(BAR_CSS).toContain(`z-index: ${Z_INDEX}`);
  });
});

/**
 * The vocabulary the two dropdowns need. `barGroups` is flat and stays flat -
 * a group is a list of buttons, and which of them sit behind a trigger is a
 * layout decision `mountBar` and this stylesheet make between them - so these
 * declarations are the whole of the mechanism, and none of them is reachable
 * from a test that cannot mount a shadow root.
 */
describe("BAR_CSS - the popovers", () => {
  it("hides a panel until its group says it is open", () => {
    // The mechanism, in two rules: `.popover` is `display: none` and the
    // group's `data-open` is the only thing that shows it. Without the first,
    // a bar mounted before `paint()` ran would flash both panels open.
    expect(BAR_CSS).toMatch(/\.popover\s*\{[^}]*display:\s*none/);
    expect(BAR_CSS).toMatch(/\.group\[data-open="1"\]\s*>\s*\.popover\s*\{\s*display:\s*flex/);
  });

  it("takes the panel out of the bar's row, so an open menu cannot move the bar", () => {
    // `position: absolute` against its own group. The bar's box is measured on
    // every drag and every resize and clamped to the viewport
    // (`clampToViewport`, and `rememberSize`'s note about the cached box being
    // *exact*): a panel that widened the row while open would move the bar out
    // from under the pointer and then persist the new position.
    expect(BAR_CSS).toMatch(/\.popover\s*\{[^}]*position:\s*absolute/);
    expect(BAR_CSS).toMatch(/\.group\[data-popover\]\s*\{\s*position:\s*relative/);
  });

  it("paints an open panel over the note, not under it", () => {
    // Both hang below the bar at the same offset, and `.note` is a later
    // sibling of `.root` than any group - so without this a panel opened while
    // a note is showing is behind it.
    expect(BAR_CSS).toMatch(/\.popover\s*\{[^}]*z-index:\s*1/);
  });

  it("marks a trigger, so the caret is drawn by the stylesheet and not by an icon", () => {
    // The `▾` of DRAWING.md §2's sketch. A border triangle rather than a glyph,
    // and keyed off the attribute `mountBar` sets, so the same rule covers the
    // symbols trigger (a `.btn`) and the font-size trigger (drawn by the bar).
    expect(BAR_CSS).toMatch(/\[data-popover-trigger\]::after\s*\{[^}]*content:\s*""/);
    expect(BAR_CSS).toMatch(/\[data-popover-trigger\]::after\s*\{[^}]*border-top:[^;]*currentColor/);
  });

  it("draws a font size as its own number, the way a width is drawn at its own thickness", () => {
    // `.size` is the text group's `.stroke`: the value is the icon, which is
    // why those buttons carry no `icon` at all (tests/draw-bar.test.ts checks
    // the other half).
    expect(BAR_CSS).toMatch(/\.size\s*\{/);
    expect(BAR_CSS).toMatch(/\.btn\.trigger\s*\{[^}]*width:\s*auto/);
  });

  it("opens a panel upwards when there is no room below it", () => {
    // `.root` is fixed and `clampToViewport` may park the bar at
    // `viewportHeight - barHeight - 8`, so without this rule the symbols
    // palette opened *entirely outside* the viewport - and a fixed subtree
    // cannot be scrolled to. `top: auto` as well as the `bottom`, or the
    // `top: calc(100% + Npx)` above would still be in force and win.
    expect(BAR_CSS).toMatch(
      /\.popover\[data-place="above"\][^{]*\{[^}]*bottom:\s*calc\(100% \+ \d+px\)/,
    );
    expect(BAR_CSS).toMatch(/\.popover\[data-place="above"\][^{]*\{[^}]*top:\s*auto/);
  });

  it("flips the note the same way, because it is the bar's only feedback line", () => {
    // Same offset off the same `.root`, so it leaves the screen for the same
    // bar - and a save that failed, or the Cover warning, is as much use
    // off-screen as a menu is. One rule covers both.
    expect(BAR_CSS).toMatch(/\.note\[data-place="above"\]\s*\{[^}]*top:\s*auto/);
    expect(BAR_CSS).toMatch(/\.note\[data-place="above"\]\s*\{[^}]*bottom:\s*calc/);
  });

  it("takes the gap from the constant the flip arithmetic counts", () => {
    // `dropSide` (geometry.ts) adds POPOVER_GAP_PX to the panel's height before
    // deciding there is room, so a gap edited in this stylesheet alone would
    // flip a panel that then did not fit. Interpolated, not typed: all three
    // offsets - the note's, the panel's and the flipped one - are this number.
    const gap = `calc(100% + ${POPOVER_GAP_PX}px)`;
    expect(BAR_CSS.match(/calc\(100% \+ \d+px\)/g)).toEqual([gap, gap, gap]);
  });

  it("keeps all of it in the bar's sheet and none of it in the layer's", () => {
    // The bar is furniture and is hidden for every capture; the layer is the
    // marks and is printed. A popover rule that landed in LAYER_CSS would be
    // injected into the page itself, unconditionally and with `!important`.
    for (const fragment of ["popover", "trigger", "data-open", "data-place"]) {
      expect(LAYER_CSS, fragment).not.toContain(fragment);
    }
  });
});

/**
 * The preparation curtain (contracts.md §32, §32.2), and the one invariant here
 * is the **deliberate inversion** of the layer's - which is why it is written
 * down in this file, beside the rule it inverts, rather than anywhere else.
 */
describe("BACKDROP_CSS", () => {
  it("is position: fixed - the inversion of the layer's rule, and safe only because it is gone before any capture", () => {
    // Both halves, because either one alone is an argument for the wrong thing:
    //
    // 1. It MUST be fixed. It is a *viewport* overlay, not a document one: it
    //    covers what the user is looking at while the lazy-image sweep scrolls
    //    the page to the bottom and back underneath it. An absolute curtain
    //    would scroll away with the very thing it exists to hide.
    // 2. That is safe ONLY because it is gone before anything is captured.
    //    `entrypoints/prepare.ts` removes it in a `finally` around the pass,
    //    which closes before it answers the background - so it is down before
    //    `window.print()` opens the print path's dialog and before the
    //    one-click path's CDP capture. Chrome repaints fixed elements on every
    //    printed sheet (ARCHITECTURE.md Decision 7, lib/dom/hide-fixed.ts); a curtain
    //    still up at print time would be grey chrome on all 14 pages, which is
    //    exactly what LAYER_CSS's never-fixed rule above exists to prevent.
    //
    // So do NOT "fix" this to match the layer. If the removal ever stops being
    // ahead of the reply, this rule is the thing that has to change with it.
    expect(BACKDROP_CSS).toMatch(/position:\s*fixed/);
    expect(BACKDROP_CSS).toMatch(/inset:\s*0/);
  });

  it("is translucent, so the page is deliberately dimmed rather than hidden", () => {
    // This assertion has been both ways round, which is the reason it is
    // written as intent rather than as a value. It started translucent at
    // 0.55; §32.3 made it solid, because a dimmed page still showed the sweep
    // the curtain exists to cover; §32.4 is the user asking for translucent
    // again, at 50%. It is a look, not a mechanism - nothing depends on the
    // alpha, because IntersectionObserver ignores occlusion and the sweep
    // loads the same page either way.
    //
    // So what is pinned here is that the choice between dimming and hiding was
    // made on purpose - an alpha, present and under 1 - and NOT the number. Do
    // not tighten this to `0.5`; the next person to change their mind about the
    // shade should not have to edit a test to do it.
    //
    // Scoped to `.root`, which is the full-viewport sheet. `.card`'s own
    // background sits on top of this one and is not what the page shows
    // through.
    const root = BACKDROP_CSS.match(/\.root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(root).not.toBe("");
    const background = root.match(/[;{\s]background:\s*([^;]+);/)?.[1] ?? "";
    expect(background).not.toBe("");
    // An alpha channel, in whichever spelling carries one: `rgba()`, `hsla()`,
    // or the modern `rgb(15 23 42 / 50%)` slash form - all of which put it
    // last inside the parentheses.
    const args = background.match(/^(?:rgba?|hsla?)\(([^)]*)\)$/)?.[1] ?? "";
    const parts = args.split(/[,/]/).map((part) => part.trim());
    expect(parts, `"${background}" carries no alpha channel`).toHaveLength(4);
    const written = parts[3] ?? "";
    const alpha = written.endsWith("%")
      ? Number.parseFloat(written) / 100
      : Number.parseFloat(written);
    expect(Number.isFinite(alpha), `"${written}" is not a number`).toBe(true);
    // Under 1: the page shows through, which is the decision. Above 0: a
    // curtain nobody can see is not a curtain.
    expect(alpha).toBeLessThan(1);
    expect(alpha).toBeGreaterThan(0);
    // And the translucency is declared once, in the colour. A sheet-wide
    // `opacity` would be a second, undeclared dimmer compounding with it - and
    // would fade the card and its words along with the scrim.
    expect(root).not.toMatch(/opacity:\s*(0?\.\d|0\b)/);
  });

  it("eats the pointer while it is up", () => {
    // A click landing mid-sweep would hit whatever the scroll happened to put
    // under the cursor. Said out loud in the sheet rather than left to the
    // initial value, so that it reads as the behaviour it is.
    expect(BACKDROP_CSS).toMatch(/pointer-events:\s*auto/);
    expect(BACKDROP_CSS).not.toMatch(/pointer-events:\s*none/);
  });

  it("never carries LAYER_ATTR, which would make it impossible to take down", () => {
    // LAYER_CSS forces `display: block !important` on anything carrying the
    // attribute - the same trap lib/draw/bar.ts documents for the bar, except
    // that the bar would merely be photographed while the curtain would be
    // permanent. The host's half of this is in `showBackdrop()`, which is DOM
    // and out of a vitest suite's reach; this is the half that is a string.
    expect(BACKDROP_CSS).not.toContain(LAYER_ATTR);
    expect(LAYER_CSS).not.toContain("backdrop");
  });

  it("keeps the shadow-root house style of select-area.ts", () => {
    expect(BACKDROP_CSS.trim()).not.toBe("");
    expect(BACKDROP_CSS).toContain(":host { all: initial; }");
    expect(BACKDROP_CSS).toContain(".root {");
    expect(BACKDROP_CSS).toContain(`z-index: ${Z_INDEX}`);
  });
});

describe("the curtain's timing and its words", () => {
  it("waits, so a page with no lazy images shows nothing at all", () => {
    // A page that prepares in a few ms never scrolls, and a curtain that
    // flashes up and away is worse than the thing it was hiding. Zero would
    // put one on every export.
    expect(BACKDROP_DELAY_MS).toBeGreaterThan(0);
    // And an upper bound, because a delay longer than the sweep means the
    // curtain never appears on the pages it was written for.
    expect(BACKDROP_DELAY_MS).toBeLessThan(1_000);
  });

  it("says what is happening and why it is worth the wait", () => {
    // A curtain with no explanation is just a grey box. The second line is the
    // point of the whole feature: the scroll is not noise to be hidden, it is
    // the page being made ready, and saying so turns a glitch into a reason.
    expect(BACKDROP_TITLE.trim()).not.toBe("");
    expect(BACKDROP_NOTE.trim()).not.toBe("");
    // True of an export as much as of annotate mode (§32.2), so neither string
    // may name a mode the user might not be in - nor anything only that mode
    // has. The note read "Loading images so your marks stay where you put
    // them." right up until §32.3, which passed this test and still named
    // marks to someone who pressed Export PDF and has none: the rule was
    // right and the word list was one word short.
    for (const line of [BACKDROP_TITLE, BACKDROP_NOTE]) {
      for (const word of ["annotate", "mark"]) {
        expect(line.toLowerCase(), `"${line}" names ${word}`).not.toContain(word);
      }
    }
  });
});

describe("LABEL_FONT_FAMILY", () => {
  it("names only faces a stranger's machine already has", () => {
    // A text label and a pin's number are set in this, and both have to paint
    // the instant the print dialog opens - a web font would need a network
    // request from a subtree that has no time for one.
    expect(LABEL_FONT_FAMILY).not.toMatch(/url\(|@import/);
    // A generic family last, the one entry no platform can fail to resolve.
    expect(LABEL_FONT_FAMILY).toMatch(/(sans-serif|serif|monospace)$/);
    // Two-word names quoted: this string is set with `setAttribute`, so
    // nothing re-escapes it, and an unquoted `Segoe UI` is not a valid family.
    expect(LABEL_FONT_FAMILY).toContain('"Segoe UI"');
  });

  it("leads with the same stack the bar is set in", () => {
    // It lives in this module because it is the same decision as BAR_CSS's
    // font, not because a stylesheet interpolates it.
    expect(LABEL_FONT_FAMILY.startsWith('system-ui, -apple-system, "Segoe UI"')).toBe(true);
    expect(BAR_CSS).toContain('system-ui, -apple-system, "Segoe UI"');
  });
});

describe("Z_INDEX", () => {
  it("is the maximum, matching select-area.ts", () => {
    expect(Z_INDEX).toBe(2_147_483_647);
  });
});
