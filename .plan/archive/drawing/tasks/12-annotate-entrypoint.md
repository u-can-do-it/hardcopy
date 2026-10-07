# 12 - The injected script: pencil, line, rect

**Goal**: `entrypoints/annotate.ts` puts the bar and the layer on a page and
draws with the pencil, line and rect tools, undo/redo/clear included.

**Files**
- `entrypoints/annotate.ts` (create)

**Contracts**: `contracts.md` §14, verbatim - `defineUnlistedScript`, the
`__pagepdfAnnotateInstalled` guard, and handling exactly
`PAGE_ANNOTATE_START` / `PAGE_ANNOTATE_STOP` / `PAGE_ANNOTATE_UI`.

It is **glue only**. Every decision is already in `lib/draw/`: geometry from
`geometry.ts`, the pen from `stroke.ts`, undo from `history.ts`, the shapes
from `render.ts`, mounting from `layer.ts` and `bar.ts`, persistence from
`prefs.ts`. If you find yourself writing arithmetic or a threshold in this
file, it belongs in a `lib/draw/` module with a test beside it (`CLAUDE.md`).

Behaviour for this task:
- Pointer events converted to document space with the **current**
  `scrollX/scrollY` on every event, so a stroke can run past the fold. Unlike
  `entrypoints/select-area.ts`, **do not block the wheel** - scrolling while
  drawing must work.
- Shift constrains: 15deg snap on a line, square on a rect.
- The in-progress shape goes through `setLive()`; only a committed shape is
  pushed onto the history and rendered by `render()`.
- `isDegenerate()` shapes are discarded rather than pushed, so undo never
  appears to do nothing.
- `Ctrl+Z` / `Ctrl+Shift+Z` as well as the buttons, listened for on `window`
  with `capture: true` and only while a drawing tool is active.
- `Esc` and the bar's X both send `ANNOTATE_EXIT` to the background and await
  it; the background is what restores the page.
- Persist tool, colour, width and bar position through `saveDrawPrefs()`.
- `PAGE_ANNOTATE_UI { visible: false }` hides the bar and calls
  `setInteractive(false)`; `true` puts both back.
- `beforeprint` on `window` hides the bar, `afterprint` shows it. The bar is
  `position: fixed`, so left in place it would repeat on every printed sheet -
  and this covers `window.print()` started from anywhere, with no background
  involvement. (Hiding the bar around the bar's *own* save is task 15.)

**Out of scope**: ellipse, highlighter, symbols and the text caret (task 16 -
the buttons render, pressing them may do nothing yet); the background handler
that starts this (task 14); saving from the bar (task 15); select / move /
delete and edge auto-scroll (phase 3, not in this plan).

**Proof**
```bash
pnpm compile
```

UI-only and unit-testable only through the `lib/draw/` modules it composes,
each of which already carries its own suite (tasks 02-12). There is no DOM
harness in this repo and `CLAUDE.md` asks that it stay that way.

**Manual check**

1. `pnpm dev`, load unpacked, open a long article, and start annotate mode.
2. Draw a freehand squiggle: the line has variable width, follows the pointer,
   and does not lag.
3. Draw a stroke that crosses the fold - scroll mid-drag and confirm the stroke
   continues onto the new content and stays anchored to it afterwards.
4. Draw a line, then hold Shift: it snaps to 15deg steps. Draw a rect with
   Shift: it stays square.
5. Ctrl+Z five times, Ctrl+Shift+Z five times: the marks come back in order.
   Press clear, then Ctrl+Z: they all come back.
6. Click once with the line tool (a stray click): nothing is added, and Ctrl+Z
   still undoes the *previous* mark.
7. Reload the page and start again: tool, colour, width and bar position are
   the ones you left.

**Depends on**: 01, 02, 03, 04, 05, 07, 08, 10, 11
