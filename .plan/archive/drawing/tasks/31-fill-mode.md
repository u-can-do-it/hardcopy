# 31 - A fill is three states, not a boolean

**Goal**: `RectShape.fill` and `EllipseShape.fill` carry a `FillMode`, and the
renderer draws all three.

**Files**
- `lib/types.ts` (`FillMode` - §24.1 only; `DrawTool` and `DrawPrefs` are task 33)
- `lib/draw/model.ts` (§25.1 - the two fields; `FILL_OPACITY`'s comment)
- `lib/draw/render.ts` (the `rect` and `ellipse` cases, three ways)
- `entrypoints/annotate.ts` (`dragShape` maps the two filled *tools* to modes,
  for now - they are removed in task 33)
- `tests/draw-render.test.ts`, `tests/draw-model.test.ts`

**Contracts**: `contracts.md` §24.1 and §25.1, verbatim.

**What the renderer draws**
- `"none"` -> `fill: "none"`, no `fill-opacity`. Byte-for-byte today's output.
- `"tint"` -> `fill: shape.color` + `fill-opacity: FILL_OPACITY`. Byte-for-byte
  what `fill: true` renders today.
- `"cover"` -> `fill: shape.color`, **no `fill-opacity` and no `opacity`**, and
  the outline stays as it is. A solid block, no alpha anywhere.

`"cover"` must not be *visually* distinguishable from a solid rect drawn some
other way - it is a solid block, that is the point. What makes it a cover is
task 35, and the mode is how task 36 finds it.

**`FILL_OPACITY`'s doc comment currently argues that a translucent fill is what
keeps this from being a redaction that is not one.** That argument is now
half-wrong: `"cover"` is deliberately opaque, and what makes it honest is that
the text underneath is removed rather than that you can read through it.
Rewrite it to say which mode it governs and why the mode beside it is allowed
to be opaque - otherwise the next reader takes it as forbidding `"cover"`.

Keep the migration honest: `dragShape` maps `rect`/`ellipse` to `"none"` and
`rect-fill`/`ellipse-fill` to `"tint"`, so this task changes no behaviour a
user can see. `"cover"` is unreachable from the bar until task 33.

**Out of scope**: `DrawTool` (33), `DrawPrefs.fill` (32), the bar (33),
`coverRects` (34), any DOM (35), the brackets (36). Do not touch
`lib/draw/layer.ts` - a fill still paints inside the outline whose box is
already padded by half the stroke, which task 26 verified; confirm it again
rather than assuming.

**Proof**
```bash
pnpm test tests/draw-render.test.ts
```

Cover, at least:
- all three modes for both kinds, and that `"none"` is unchanged from today.
- `"cover"` sets no `fill-opacity` and no `opacity` - the assertion that a
  cover is genuinely solid. A cover that quietly rendered at 0.35 would look
  almost right and would hide nothing.
- `"tint"` still uses `fill-opacity` and never `opacity`, so the stroke does
  not fade with the interior.
- the outline (`stroke`, `stroke-width`) is identical across all three modes.
- a filled rect dragged up and to the left still normalises, in every mode.
- `FILL_OPACITY` is still strictly between 0 and 1, and now with a message
  saying it governs `"tint"` alone.

**Depends on**: 30
