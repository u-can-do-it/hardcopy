# 38 - A character is its ink, not its font box

**Goal**: a cover edge landing in the leading between two lines stops taking
the whole neighbouring line.

**Files**
- `lib/dom/cover.ts` (the `inset` parameter on `coveredRuns`, and the walker
  measuring it per text node)
- `tests/cover.test.ts`
- `tests/draw-model.test.ts` (the composed sweep - see Proof)

**Contracts**: `contracts.md` §31.1, verbatim.

**This is the user's reported bug**, and it made the feature unusable: a cover
over the middle of a paragraph hid the paragraph, including a line that sat
above the block and was never painted over.

The measurement is in §31.1 and it was taken on the page that produced the
report - re-read it rather than re-deriving it. The short version: a character's
`Range` box is the font box (ascent + descent), the line box is taller still,
so consecutive character boxes have a gap of empty leading between them, and
`intersects`' `<=` counts a cover edge in that gap as a hit on the line above
or below. One touch takes every character on that line, because they all share
one `y`, and `coveredRuns` then merges it with the covered lines into one run.

**The rule stays pure, the measurement is the walker's.** `coveredRuns` gains
an optional `InkInset` and shrinks each box vertically before testing. The
walker measures the inset **once per text node** with a canvas `measureText`
(`fontBoundingBox*` minus `actualBoundingBox*`), never per character.

**Keep the x axis greedy and keep `<=`.** A character clipped at its left or
right edge is covered; §19.1's argument is right about that, and this changes
only the axis where the box contains space no glyph paints in. The point of the
fix is that it is strictly better on both axes, the way §29 was - it removes an
over-hide and gives up no leak-prevention.

Read `lib/draw/css.ts`'s `LABEL_FONT_FAMILY` note before you reach for a font
string: the walker needs the *element's* computed font, not ours.

**Out of scope**: shadow roots (task 39), the SVG wrapper (task 40), `coverAreas`
(it is correct - the half-stroke widening amplified this bug but is not it),
`entrypoints/annotate.ts`.

**Proof**
```bash
pnpm test tests/cover.test.ts
```

The existing suite could not have caught this, and the reason is worth knowing:
its one relevant test picks a cover top in the *safe* half of the gap, and
nothing in the repo composes `coverAreas` with `coveredRuns` - they are tested
in separate files. So write both of these:

- **A sweep across the whole inter-line gap** in `tests/cover.test.ts`: for a
  two-line fixture, put the cover's top edge at every position in the gap and
  require line 1 untouched at every one of them. Today the low end of that
  sweep returns line 1 as covered.
- **The same sweep composed through `coverAreas`**, at each of `DRAW_WIDTHS`,
  so the half-stroke widening is in the picture. §31.1's numbers say the 8px pen
  is where it is worst - assert that a cover drawn anywhere in the gap at any
  pen width leaves the neighbouring line alone.
- a character clipped at its left or right edge is **still** covered - the x
  axis must not have been quietly softened.
- a cover that genuinely overlaps a line's ink still takes the whole line.
- `inset` omitted behaves exactly as before (the contract's stated default).
- an inset taller than the box keeps a 1px band rather than collapsing - the
  safe error is hiding, not missing.

**Manual check**

The one that matters, on a real page with the built extension: cover the middle
of a paragraph so the block's top edge sits **between two lines**, export the
PDF, and Ctrl+F a word from the line **above** the block - it must be **found**.
A word from under the block must not be. Repeat at the 8px pen, which §31.1
says is the worst case. This is the user's exact report; if the line above is
still missing, the fix did not land.

**Depends on**: none
