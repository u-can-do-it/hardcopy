# 26 - A rect and an ellipse can carry a fill

**Goal**: `RectShape` and `EllipseShape` have a `fill` flag, and the renderer
turns it into a translucent interior with the outline left solid.

**Files**
- `lib/draw/model.ts` (modify - §19.2, §19.3)
- `lib/draw/render.ts` (modify - the `rect` and `ellipse` cases)
- `entrypoints/annotate.ts` (modify - `dragShape` sets `fill: false`; the tools
  arrive in task 27)
- `tests/draw-model.test.ts`, `tests/draw-render.test.ts` (modify)

**Read `.plan/design.md` §11.1 before starting.** This is the "cover tool"
that `.plan/tasks/16-phase2-tools.md` put out of scope and that
`lib/draw/render.ts`'s `fill: "none"` line argues against by name. It ships
here, and it ships the way `docs/features/DRAWING.md` §6 trap 1 said it would
have to: **named honestly, and visibly not a redaction.** An opaque box over a
password hides it from the eye and leaves the text underneath perfectly
selectable in the PDF, and that is the one item in this feature that could hurt
a user.

So:
- `FILL_OPACITY = 0.35`, applied as SVG **`fill-opacity`** and never `opacity`,
  so the stroke stays solid. The sibling constant is `HIGHLIGHT_OPACITY = 0.4`
  in `render.ts`, which exists for exactly this reason - read its doc comment.
- `fill: true` renders `fill: shape.color` + `fill-opacity: FILL_OPACITY` and
  keeps the existing `stroke` and `stroke-width`. `fill: false` renders
  `fill: "none"` and is byte-for-byte what it renders today.
- **Do not** rasterise, do not touch the print CSS, do not add anything that
  could be read as removing the covered content.

`fill` is **required**, not optional: a shape the renderer branches on whose
flag depends on which code path built it is a mark that looks different for no
reason a reader can find.

`markBox` in `lib/draw/layer.ts` needs **no change** - a fill does not reach
past the outline it is inside. Do not edit that file.

**Contracts**: `contracts.md` §19.2 and §19.3, verbatim.

**Out of scope**: the two bar tools and the note line (task 27), `DrawTool`,
`lib/draw/bar.ts`, `lib/draw/layer.ts`, any raster or redaction mechanism (it is
in `BACKLOG.md`, and task 29 writes it there).

**Proof**
```bash
pnpm test tests/draw-render.test.ts
```

Cover, at least:
- `fill: false` for both kinds emits `fill: "none"` and no `fill-opacity` - the
  existing assertions, unchanged.
- `fill: true` emits `fill` equal to `shape.color` and `fill-opacity` equal to
  `String(FILL_OPACITY)`.
- `stroke` and `stroke-width` are the same in both cases - the outline does not
  fade with the interior.
- `opacity` is **never** set by either case (that would fade the stroke too).
- a filled rect dragged up and to the left is still normalised, so it still
  paints.
- `FILL_OPACITY` is strictly between 0 and 1 - the assertion that says "this is
  not a redaction tool" out loud, with `.plan/design.md` §11.1 named in the
  test's own message.

**Depends on**: 20, 21 (same two files - serialise)
