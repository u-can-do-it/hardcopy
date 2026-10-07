# 21 - A label renders as lines, and stays searchable

**Goal**: `shapeToSpec`'s `text` case emits one `<tspan>` per entry in
`lines`, positioned by `dy`.

**Files**
- `lib/draw/render.ts` (modify)
- `tests/draw-render.test.ts` (modify)

**Contracts**: `contracts.md` §19.1 (`lines`), §18 (`TEXT_LINE_HEIGHT`).
`NodeSpec` is unchanged - a `<text>` with `children` and no `text` of its own
is already expressible, and `specToElement` already applies `text` before
children so a spec carrying both keeps both.

**The shape of it**: a `<text>` at `rect.x` / `rect.y` with the existing
`fill`, `font-size`, `font-family` and `dominant-baseline:
text-before-edge`, and one `<tspan>` child per line carrying `x = rect.x` and
`dy = 0` on the first line, `fontSize * TEXT_LINE_HEIGHT` on the rest. `x` is
reset on **every** tspan, or each line starts where the previous one ended.

**The one check that matters** (`CLAUDE.md`): a `<tspan>` is text content, so
this must still come out of Chrome as real, searchable text. Nothing goes
through `innerHTML`; the line goes on `NodeSpec.text` of the tspan and nowhere
else, exactly as the single-line label did.

**Out of scope**: the layer's box (22), the editor (23), fills (26). Do not
touch the `rect`, `ellipse`, `stroke`, `line` or `symbol` cases.

**Proof**
```bash
pnpm test tests/draw-render.test.ts
```

Cover, at least:
- a three-line label produces three `<tspan>` children, in order, with the
  lines' text on `NodeSpec.text` and never in an attribute.
- every tspan carries `x = coord(rect.x)`.
- `dy` is `0` on the first and `coord(fontSize * TEXT_LINE_HEIGHT)` on the
  others.
- the `<text>` itself has no `text` of its own when there are tspans.
- an **empty** line renders as a tspan with `""` rather than being dropped -
  otherwise a blank line between two paragraphs closes up.
- a one-line label is one tspan (not a special case).

**Manual check**

Type a label three lines long, export the PDF, and Ctrl+F a word from the
**middle** line. Found. Then Ctrl+F a two-word phrase that straddles a wrap:
this may **not** match, and that is expected and documented
(`.plan/design.md` §13.3, README deviation in task 29). If a *single word*
cannot be found, stop - that is the build being broken.

**Depends on**: 20
