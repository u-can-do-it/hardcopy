# 02 - The shape model and the tier split

**Goal**: `lib/draw/model.ts` holds the `Shape` union, the pen tables and the
free/Pro tool split as plain JSON with no DOM in sight.

**Files**
- `lib/draw/model.ts` (create)
- `tests/draw-model.test.ts` (create)

**Contracts**: `contracts.md` §3, verbatim - including `MIN_SHAPE_PX`,
`DRAW_FREE_TOOLS` / `DRAW_ALL_TOOLS` with exactly the members listed, and
`isDegenerate`'s per-kind thresholds.

`DrawTool`, `SymbolKind` and `StrokeWidth` are **imported from
`../types`**, not redeclared here.

**Out of scope**: rendering, geometry, history, anything that touches a
`Document`. No entrypoint, no background.

**Proof**
```bash
pnpm test tests/draw-model.test.ts
```

Cover at least: `toolsFor(false)` is exactly `DRAW_FREE_TOOLS` and excludes
`symbol` and `text`; `toolsFor(true)` is `DRAW_ALL_TOOLS`; `nextPinIndex`
returns 1 on an empty list, 1 on a list with no pins, and `n + 1` counting only
`symbol: "pin"` shapes; `isDegenerate` true for each degenerate case and false
for a deliberate one-sample dot that spans more than `MIN_SHAPE_PX`, for a
legitimate line, rect, ellipse and non-empty label.

**Depends on**: 01
