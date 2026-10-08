# 22 - The label's real box, and the frame's DOM

**Goal**: a label's mark box is the box it was fitted to, and the layer can put
a dashed frame with eight handles over the open editor.

**Files**
- `lib/draw/layer.ts` (modify)
- `tests/draw-layer.test.ts` (modify)

**Contracts**: `contracts.md` §22 - `DrawLayer.setFrame`, `frameSpec`, and the
`markBox` `text` case. §21 for `frameHandles` and `FRAME_HANDLE_PX`.

**Three things, in order:**

1. **`markBox`'s `text` case becomes one line**, `outwardBox(positiveBox(
   shape.rect), MARK_PAD_PX)`, and `TEXT_EM_ADVANCE`, `TEXT_EM_LINE` and their
   doc comment are **deleted**. This is a bound *retired*, not loosened: the
   shape now carries the box the text was actually wrapped to, and `overflow:
   visible` on the mark's own `<svg>` still covers a glyph that spills, exactly
   as it did before.
2. **`frameSpec(rect)`** - an `<svg>` at `outwardBox(positiveBox(rect),
   FRAME_HANDLE_PX)`, a dashed `<rect>` on the box itself, and one `<rect>` per
   `frameHandles()` entry carrying `data-zone` and its own `cursor`. Pure and
   exported, for the reason `markSpec` is.
3. **A third container** in the shadow root, after `committed` and `live`, and
   `setFrame(rect | null)` renders into it. Extend `LAYER_SHADOW_CSS` for the
   dashes and the handle fill.

**The frame must never print, and the mechanism is two mechanisms**
(`.plan/design.md` §13.5), which must not share a boolean:
- the container is `display: none` whenever the layer is not `interactive` -
  wire it into `applyBox`/`setInteractive` alongside `pointer-events`;
- and the editor commits before every capture, which clears it (task 23's job).

`@media print { display: none }` is **not** an option: the Pro path emulates
screen media (DEVIATIONS.md Deviation 11).

The handles' `data-zone` and `cursor` are for the pointer cursor only.
`frameZoneAt` stays the authority on what a press hit - do not hit-test the
elements.

**Out of scope**: pointer handling (24), the editor (23), `wrap.ts`.

**Proof**
```bash
pnpm test tests/draw-layer.test.ts
```

Cover, at least:
- `markBox` for a text shape is its `rect` padded by `MARK_PAD_PX` and nothing
  more; a text shape whose `rect` has negative extent is normalised.
- the existing per-kind "the box contains what the mark paints" assertions all
  still pass, and the text one is now derived from `rect` rather than from an em
  estimate.
- `frameSpec`'s box contains every handle rect `frameHandles` reports, with none
  of them clipped.
- every handle in the spec is at the exact rect `frameHandles` puts it at, and
  carries the matching `data-zone` - eight of them, no more.
- the dashed rect is `fill: none` (a filled frame would cover the label it is
  around).

**Manual check** (the DOM half is not unit-testable - `tests/` is plain vitest
on `environment: "node"`, which `CLAUDE.md` asks stay that way):

1. `pnpm compile`, `pnpm dev`, Draw, T, click: a dashed box with eight handles.
2. Hover each handle: the cursor changes, and the corners are diagonal.
3. Ctrl+P while the box is open: **no dashed rectangle and no handles** in the
   preview or the PDF.

**Depends on**: 19, 20
