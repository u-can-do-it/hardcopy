# 23 - The text editor: a box you type into

**Goal**: the text tool opens a framed box, wraps as you type, grows when the
text outgrows it, and `Enter` starts a new line.

**Files**
- `entrypoints/annotate.ts` (modify)

**Contracts**: `contracts.md` §18 (`layoutText`, `createTextMeasure`), §19.1
(`TextShape.rect`, `lines`), §22 (`DrawLayer.setFrame`).

**What changes, in the file's own vocabulary:**

- `Caret` becomes `Editor`, and gains `rect: DrawRect` - **what the user
  dragged**, which `layoutText` grows the height *from* and never shrinks
  below. That is the whole of "a box dragged tall stays tall, and a box dragged
  short grows back to fit".
- `openCaret(at)` places `rect = { x, y, width: DEFAULT_TEXT_WIDTH_PX, height:
  fontSize * TEXT_LINE_HEIGHT }` and calls `layer.setFrame(...)`.
- `editorShape(pen, e, preview)` runs `layoutText` and puts its `rect` and
  `lines` on the shape. `CARET_GLYPH` is still appended in the preview branch
  only - append it to the **text before wrapping**, so the cursor wraps with
  the word it is on.
- `showLive()` also calls `layer.setFrame(editor === null ? null :
  layoutText(...).rect)`, so the frame tracks the grown height on every
  keystroke.
- `commitCaret` / `discardCaret` both `setFrame(null)`. **This is one half of
  the two mechanisms that keep the frame out of a capture** (`.plan/design.md`
  §13.5) - and the three callers that make it work are already in this file and
  already commented: `onBeforePrint`, `PAGE_ANNOTATE_UI { visible: false }`,
  and `save()`. Check all three still commit; add nothing new.
- `typeIntoCaret`: **`Enter` inserts `"\n"`** instead of committing. `Esc`
  still commits, a click away still commits, and `Ctrl/Cmd+Enter` is added as
  the fast commit. `Ctrl/Cmd+Z` still deletes a character. `lib/draw/keys.ts`
  needs no change - `Enter` is handled ahead of `isPrintable`, and
  `dropLastChar` deletes a `\n` like any other single code unit.
- `createTextMeasure()` is called **once**, in `start()`, and held on
  `Session`. Not per keystroke, and not at module scope.

**Out of scope**: moving and resizing the box (task 24 - a press on the frame
still commits, as today, until that task lands). `DrawPrefs.textWidth` (28).
Anything in `lib/`.

**Proof**
```bash
pnpm compile
```

Typecheck-only by nature, and the reason is `CLAUDE.md`'s: this file is glue in
an injected entrypoint, `tests/` is plain vitest with no DOM harness, and every
decision this task makes already has a test one seam down - the wrapping in
`tests/draw-wrap.test.ts`, the lines in `tests/draw-render.test.ts`, the box in
`tests/draw-layer.test.ts`. If you find yourself wanting to write arithmetic or
a predicate in here, it belongs in a `lib/draw/` module with a test beside it.

**Manual check**

1. Draw, T, click. A dashed box appears with a cursor in it.
2. Type past the right edge: the text **wraps** inside the box; no word is cut.
3. Keep typing past the bottom edge: the box **gets taller**, and the frame
   grows with it.
4. Press `Enter`: a new line, and the box grows. It does **not** commit.
5. Press `Esc`: it commits, the frame disappears. Export, Ctrl+F a word from
   the second line - found.
6. Type a label, then press `Ctrl+Enter`: committed.
7. Type a label, then click elsewhere on the page: committed, and the click did
   not also start a stroke you did not want.
8. Type nothing and press `Esc`: nothing is added and undo has no empty step.
9. With the box open, press a colour and then a font size: the label restyles
   in place and **re-wraps** at the new size.
10. Type a single word longer than the box (a long URL): it breaks between
    characters rather than running off the side.

**Depends on**: 20, 21, 22
