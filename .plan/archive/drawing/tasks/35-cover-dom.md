# 35 - Hide the covered text, reversibly

**Goal**: `hideTextUnder` wraps the covered runs in `visibility: hidden` and
hands back a handle that puts the page back exactly as it was.

**Files**
- `lib/dom/cover.ts` (extend - the DOM half: `CoverHandle`, `hideTextUnder`)

**Contracts**: `contracts.md` §26.2, verbatim.

**The mechanism, and why each half of it**:
- **`visibility: hidden`, never `display: none`.** It preserves layout exactly,
  so nothing reflows and every mark below the cover stays where it was drawn -
  and hidden content is not painted, so Chrome has nothing to put in the text
  layer for it. Task 30 is the human check that the second clause is true; do
  not start this task until it has passed.
- **Character-level, via `Range.getClientRects()`.** A cover over half a
  paragraph must hide half a paragraph, so the text node is split at the run
  boundaries `coveredRuns` returns.
- **Client coordinates throughout.** `covers` arrive in document coordinates,
  as marks do; convert once with the current scroll and then stay in client
  space, because that is what `getClientRects()` speaks and converting both
  sides is two conversions for the same answer.
- **Pre-filter by element box first.** Skip any element whose bounding box
  misses every cover before measuring a single character. This is what keeps
  `onBeforePrint` (task 36, synchronous) off a per-character walk of the whole
  document.

**`restore()` is not an error path - it runs on every single use** (the covers
go on around a capture and off after, `.plan/design.md` §20) and annotate mode
restores the page on exit. So:
- it must `normalize()` every parent it split, or a second pass measures
  different geometry from the first;
- it must be idempotent;
- it must leave no attribute, class or wrapper of ours behind.

**Form controls, separately and coarsely.** An `<input>`'s or `<textarea>`'s
value is not a text node and Chrome prints it, so an element whose box
intersects a cover gets `visibility: hidden` on the *element*. The whole field
goes - the right answer for a field, since a half-hidden password box is not
something anyone wants. Counted in `CoverHandle.fields` separately from `runs`.

**Out of scope**: the brackets that call this (36), the bar (33), any change to
`coveredRuns` or `coverRects` (34 owns them - if either is wrong, STOP and
report it rather than working around it). Do not touch `entrypoints/`.

**Proof**
```bash
pnpm compile
```

Typecheck-only, and the reason is the one `lib/dom/hide-fixed.ts` already
lives by: `tests/` is plain vitest on `environment: "node"` with no DOM
harness, which `CLAUDE.md` asks stay that way, and the walker's every decision
is `coveredRuns`' or `intersects`', both fully tested by task 34. **If you find
yourself writing a geometry test or a merge rule in here, it belongs in the
pure half** - stop and say so.

**Manual check**

1. `pnpm dev`, open a text-heavy article, Draw, arm Cover, drag a rect over the
   middle of a paragraph. Nothing reflows: the words after the block are where
   they were.
2. In the console, `document.querySelectorAll('[style*="visibility"]')` - the
   wrapped runs are there while the cover is applied, and gone after.
   (Until task 36 you will need to call `hideTextUnder` by hand from the
   console to see this; that is expected.)
3. Call the handle's `restore()`: the paragraph is one text node again
   (`p.childNodes.length` back to what it was) and reads exactly as before.
4. Do it twice in a row over the same paragraph: the second pass hides the same
   words as the first. If it does not, `normalize()` is missing.
5. Over a form: a cover across an `<input>` hides the whole field.
6. Over a cross-origin iframe: **nothing inside it is hidden.** This is
   `.plan/design.md` §21.1 and it is expected - task 37 documents it.

**Depends on**: 30, 34

---

## Amended by `.plan/contracts.md` §29

`hideTextUnder` takes `readonly Cover[]`, not `readonly Box[]` - a cover now
carries the shape that drew it, so the hit test can be exact about an ellipse
instead of using its bounding box (§29.3). The per-character test is
`coversBox`, which task 34 provides; this task still writes no geometry of its
own.

Two consequences for the walker:

- **The pre-filter is still `intersects` against `cover.box`.** Skipping an
  element whose bounding box misses every cover's *box* is correct and cheap -
  an element outside the box is outside the ellipse too. Only the per-character
  test needs to be shape-aware.
- **The boxes arrive already widened by half the stroke** (`coverAreas`), so
  this file must not add padding of its own.
