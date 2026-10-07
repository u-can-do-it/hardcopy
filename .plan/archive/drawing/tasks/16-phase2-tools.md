# 16 - Phase 2: the vocabulary, wired up

**Goal**: ellipse, highlighter, the symbols dropdown with numbered pins, and
the in-place text caret all work from the bar.

**Files**
- `entrypoints/annotate.ts` (modify)
- `lib/draw/bar.ts` (modify - the highlighter button, the symbols dropdown and
  the font-size control)
- `lib/draw/css.ts` (modify - the popover vocabulary the dropdowns need)
- `tests/draw-bar.test.ts` (modify)
- `tests/draw-css.test.ts` (modify)

**Contracts**: `contracts.md` §11 (`barGroups` grows the symbols group's
members and the text group's font-size control), §3 (`nextPinIndex`,
`HIGHLIGHT_WIDTH_SCALE`), §7 (`DEFAULT_SYMBOL_SIZE_PX`, `symbolSpec`) - all
already landed by tasks 02, 09 and 11. This task adds no new contract.

**Two gaps in this plan that task 11 found, and this task closes:**

1. **The highlighter has no button yet.** Task 11's group list was written from
   DRAWING.md §7's phase-1 tools (`pencil, line, rect, ellipse`), but
   `highlighter` is in `DRAW_FREE_TOOLS` - so a *free* tool is currently
   unreachable from the bar. Its label and icon are already sitting in
   `bar.ts`'s compiler-checked `TOOL_ICONS`, waiting for a home. Add it to the
   `tools` group. It is free, so it must not render locked.
2. **Do not reach for `normalizeRect` for a symbol drag.** `symbolSpec` aims an
   arrow from the rect's *signed* diagonal, so normalising the drag silently
   makes every arrow point down and to the right - it still renders and still
   passes every test. Task 12 will already have written
   `normalizeRect(start, current)` on the adjacent line for rect and ellipse,
   which is exactly how this gets copied by mistake. Store a symbol drag as
   `{ x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y }`.
   The note on `normalizeRect` in `lib/draw/geometry.ts` spells it out; the
   only automated backstop is Manual check 4 below.
3. **`BAR_CSS` has no popover vocabulary**, so task 11 rendered every group
   flat - all seven symbols, three widths and five swatches inline. That is
   why `lib/draw/css.ts` is in this task's Files list: the dropdown behaviour
   and the stylesheet it needs arrive together. Extend `BAR_CSS` rather than
   restructuring it, and keep `tests/draw-css.test.ts`'s two load-bearing
   guards passing (`LAYER_CSS` still never `position: fixed`, still forces
   `print-color-adjust: exact`).

4. **`dragShape() === null` cannot express the two click-to-place tools, and
   its comment currently promises it can.** The conflation of "no preview" with
   "not implemented" works for `ellipse` and `highlighter`, and not for the
   other two: a `symbol` is placed by a *click* at `DEFAULT_SYMBOL_SIZE_PX`, so
   `from === to` and any rect it returns is degenerate and thrown away; a
   `text` caret has no drag preview to return at all. Expect to restructure
   `pointerdown` / `endDrag` for those two rather than adding two cases.
5. **Esc currently exits annotate mode unconditionally**, and takes the key
   with `stopPropagation()`. `isDegenerate`'s `text` case is documented as
   reached when a caret is committed "by clicking away or pressing Esc", so the
   caret can never see it as things stand. Ctrl+Z is already narrowed for
   `text`; Esc is the asymmetry that will bite. Narrow it the same way - and
   while you are there, consider whether a mid-drag Esc should cancel the
   stroke instead of leaving the mode.

Behaviour:
- **ellipse** - drag to size, Shift constrains to a circle. Two lines of
  geometry that are already in `geometry.ts`.
- **highlighter** - the pencil at `HIGHLIGHT_WIDTH_SCALE x` the selected width,
  with the blend mode `render.ts` already emits. Roughly free, and it is what
  people reach for on a page of text.
- **symbols** - a dropdown; a symbol is placed by click (at
  `DEFAULT_SYMBOL_SIZE_PX`) or by click-drag to size. `pin` takes its number
  from `nextPinIndex(history.shapes())` so pins auto-increment 1, 2, 3... The
  pins are the feature that makes a review screenshot readable.
- **text** - pick T, click where the label goes, type **in place**, click away
  or press Esc to commit; empty labels are discarded by `isDegenerate()`. This
  is DRAWING.md's one deviation from the sketch and it is deliberate: you see
  the label at the size, colour and position it will print at, instead of
  typing it blind in a bar and finding out afterwards. The bar keeps the
  font-size control where the sketch's text field was.

The in-place caret must not use `contenteditable` on a page element - it goes
in our own layer, so the host page's CSS and its own key handlers cannot reach
it, and so the committed shape is a `<text>` node like every other mark.

While the text caret is open, the Ctrl+Z handler must not fire - the user is
typing.

**Out of scope**: editing or moving a committed mark (phase 3); a redact or
cover tool, under any name (`design.md` §8 - an opaque box over a password
leaves the text underneath perfectly selectable, and that is the one item in
DRAWING.md that could hurt a user).

**Proof**
```bash
pnpm test tests/draw-bar.test.ts
```

Extend the suite for the grown groups: every `SymbolKind` has a button in the
`symbols` group; the font-size control is in the `text` group; ids are still
unique; `toolsFor(false)` still locks every symbol button and the text button
and nothing else.

**Manual check**

1. Draw an ellipse; Shift makes it a circle.
2. Highlight a paragraph of text: the text stays readable through the mark
   (multiply, not opaque).
3. Place four pins: they read 1, 2, 3, 4. Undo twice, place another: it reads 3.
4. Place an arrow by click-drag: it points where you dragged. Place one by
   click: it is `DEFAULT_SYMBOL_SIZE_PX` and still aimed sensibly.
5. Type a label with the text tool, press Esc, export, **Ctrl+F the label** -
   found. Type a label and immediately press Esc without typing: nothing is
   added.
6. With the caret open, press Ctrl+Z: the character is deleted (the browser's
   own undo), no mark disappears.

**Depends on**: 09, 12, 15
