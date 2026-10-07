# 09 - Symbols, numbered pins and text labels

**Goal**: the Pro half of the vocabulary renders: seven symbols including the
auto-incrementing numbered pin, and a text label as a real `<text>` node.

**Files**
- `lib/draw/symbols.ts` (create)
- `lib/draw/render.ts` (modify - the `symbol` and `text` cases only)
- `tests/draw-symbols.test.ts` (create)
- `tests/draw-render.test.ts` (modify - add the `text` case)

**Contracts**: `contracts.md` §7 verbatim (`DEFAULT_SYMBOL_SIZE_PX`,
`symbolSpec`), plus the `symbol` and `text` rows of §6's table.

`arrow` and `arrow-double` are drawn along the rect's diagonal - so a
click-drag aims them - using `arrowHead` from `lib/draw/geometry.ts`. `check`,
`cross`, `bang` and `star` are unit-square path templates scaled into the rect.
`pin` is a `circle` plus a centred `<text>` carrying `String(shape.index ?? 1)`:
real text, so a pin number is findable with Ctrl+F too.

**Out of scope**: the bar's symbols dropdown and the in-place text caret (task
16); tool gating (task 14 decides the tool set, task 11 renders it).

**Proof**
```bash
pnpm test tests/draw-symbols.test.ts
```

Cover: every `SymbolKind` returns a `g` with at least one child and no `NaN`
in any attribute value; `arrow` points from the rect's origin corner toward its
opposite corner, and reversing the rect reverses the head; `pin` contains a
`text` child whose `text` is the index, defaulting to `"1"` when `index` is
absent; a zero-size rect does not produce `Infinity` or `NaN` (scale guards).
In `tests/draw-render.test.ts`, cover that a `text` shape's label arrives as
`spec.text` and never inside an attribute.

**Depends on**: 03, 08
