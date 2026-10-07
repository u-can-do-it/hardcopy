# 34 - Which characters are under a cover

**Goal**: `coveredRuns` turns per-character boxes plus cover rects into the
index runs to hide, and `coverRects` finds the covers in a `Shape[]`.

**Files**
- `lib/dom/cover.ts` (create - the **pure half** only: `Box`, `Run`,
  `intersects`, `coveredRuns`)
- `lib/draw/model.ts` (§25.2 - `coverRects`)
- `tests/cover.test.ts` (create)
- `tests/draw-model.test.ts` (extend - `coverRects`)

**Contracts**: `contracts.md` §26.1 and §25.2, verbatim.

**Why the split.** `lib/dom/` modules divide into a pure decision a unit test
can reach and a DOM walker it cannot - `shouldHideFixed` / `hideFixedElements`
in `lib/dom/hide-fixed.ts` is the exact precedent, and
`tests/hide-fixed.test.ts` tests the first with a plain record. This task is the
first half. Task 35 is the walker, and it will have no logic left to get wrong.

**The rule, and it is the whole task**: a character is covered if its box
**intersects** a cover at all - not if it is contained, not by its centre.
Greedy, and the asymmetry is the argument: an extra character hidden is
invisible, under an opaque block; a character missed is a leak - half a glyph
of a password at the edge of the box, found after the file was sent. Read
`.plan/design.md` §19.1 and put the reasoning on `coveredRuns`, not just the
behaviour.

`coverRects` lives in `model.ts` because it is a fact about a `Shape[]`, and
because it is the one place that decides which kinds can cover: `"cover"` on a
stroke would be a mask rather than a box.

**Out of scope**: any DOM at all - no `document`, no `Range`, no `Node`. This
file must not import anything but types until task 35. The bar (33), the
brackets (36).

**Proof**
```bash
pnpm test tests/cover.test.ts
```

Cover, at least:
- `intersects` - touching edges, shared corners, one box inside another, and
  zero-area boxes on both sides. Say in the test which way each boundary case
  goes and why, because the greedy rule lives or dies on them.
- a cover over the middle of a line yields one run with the right bounds.
- a cover over two words with a space between yields **one** merged run, not
  two - a cover straddling them is one wrapping element.
- adjacent runs merge; overlapping covers merge; runs come back ascending.
- a cover missing every character yields `[]`.
- a cover over everything yields one run spanning the whole node.
- **two separate covers on one line yield two runs**, and they do not merge
  across the gap between them.
- a zero-area character box (a collapsed space, a soft hyphen) is left alone;
  a zero-area cover covers nothing. Neither throws.
- a character box that only *touches* a cover's edge **is** covered - pin the
  greedy direction explicitly, with the leak reasoning in the message.
- `coverRects`: picks only `"cover"` rects, skips `"none"` and `"tint"`, skips
  every other kind including a stroke, normalises a rect dragged up and to the
  left, and returns `[]` for an empty list.

**Depends on**: 31
