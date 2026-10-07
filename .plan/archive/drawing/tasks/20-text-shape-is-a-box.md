# 20 - A label is a box, not a point

**Goal**: `TextShape` carries a `rect` and its laid-out `lines` instead of a
bare `at`, and the whole tree compiles and tests green on it.

**Files**
- `lib/draw/model.ts` (modify - §19.1)
- `lib/draw/render.ts` (modify - **mechanical only**: `shape.at.x/y` become
  `shape.rect.x/y`)
- `lib/draw/layer.ts` (modify - **mechanical only**: the same two reads in
  `markBox`'s `text` case)
- `entrypoints/annotate.ts` (modify - `caretShape` builds a `rect` from the
  click and calls `layoutText`)
- `tests/draw-model.test.ts`, `tests/draw-render.test.ts`,
  `tests/draw-layer.test.ts` (modify - the `TextShape` fixtures)

**This task is deliberately over the five-file guide.** Removing a field from a
shape in the union is a cross-cut the compiler will not let anyone land in
pieces: `at` has three readers and one writer, and every suite that builds a
`TextShape` gains two required fields the same moment. Four of the seven files
are one- or two-line edits, and done-ness is one sentence - *`TextShape` is a
box, and `pnpm test` is green*. Tasks 21 and 22 do the real work in `render.ts`
and `layer.ts` afterwards.

**Contracts**: `contracts.md` §19.1 verbatim, and §18's `layoutText` as the
only producer of `lines`.

**What `caretShape` becomes** (the minimum that compiles and is correct - the
editor proper is task 23):
- the click places `rect = { x, y, width: DEFAULT_TEXT_WIDTH_PX, height:
  fontSize * TEXT_LINE_HEIGHT }`;
- `layoutText(text, rect, fontSize, measure)` supplies `rect` and `lines` on
  the shape it returns;
- `createTextMeasure()` is called **once per session**, not per keystroke, and
  the result is held on the `Session`.

At the end of this task, wrapping already works end to end even though a label
still renders as a single line - which is what task 21 fixes.

**Out of scope**: `<tspan>` rendering (21), the box `markBox` computes (22), the
frame and the drag (22-24), `Enter` (23), `DrawPrefs.textWidth` (28), fills
(26-27). Do not delete `TEXT_EM_ADVANCE` or `TEXT_EM_LINE` here - task 22 owns
that.

**Proof**
```bash
pnpm test tests/draw-model.test.ts
```

Then `pnpm test` over the whole suite must also be green - the fixtures in the
other two suites are in this task's Files list precisely so it is.

**Depends on**: 18
