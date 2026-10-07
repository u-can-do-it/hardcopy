# 08 - Shape to SVG

**Goal**: `lib/draw/render.ts` turns a `Shape` into a DOM-free `NodeSpec`, plus
a ten-line adapter that makes the element - covering stroke, line, rect and
ellipse.

**Files**
- `lib/draw/render.ts` (create)
- `tests/draw-render.test.ts` (create)

**Contracts**: `contracts.md` §6, verbatim - `SVG_NS`, `NodeSpec`,
`shapeToSpec`, `specToElement`, and the per-kind attribute table for `stroke`,
`line`, `rect` and `ellipse`. `symbol` and `text` land in task 10; until then
`shapeToSpec` may throw for them, but the union must still typecheck
exhaustively (a `switch` with every case present).

Two things the table means and the implementation must honour:
- a `stroke` is a **filled outline**, not a stroked line - `fill` is the colour
  and `stroke` is `none`. That is what `perfect-freehand` returns and it is why
  the pen has a variable width.
- the highlighter is the pencil with `mix-blend-mode: multiply`, which is what
  makes it work over a page of text.

**Nothing goes through `innerHTML`**, ever. `specToElement` uses
`createElementNS`, `setAttribute` and `textContent`.

**Out of scope**: `lib/draw/symbols.ts` and the `text` case (task 10);
mounting, measuring or appending anything (task 11).

**Proof**
```bash
pnpm test tests/draw-render.test.ts
```

Cover `shapeToSpec` for each of the four kinds: the tag; `fill: "none"` on
line/rect/ellipse and `stroke: "none"` on a stroke; the colour and width
landing on the right attributes; an ellipse's `cx`/`cy`/`rx`/`ry` derived
correctly from its rect; a highlighter stroke carrying `mix-blend-mode:multiply`
and a plain pencil stroke not carrying it. Assert on the returned spec - the
point of the split is that this needs no DOM.

**Depends on**: 02, 05
