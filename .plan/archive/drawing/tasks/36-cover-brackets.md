# 36 - Covers on for the capture, off after

**Goal**: every export path hides the covered text for the duration of the
capture and puts it back afterwards.

**Files**
- `entrypoints/annotate.ts`

**Contracts**: `contracts.md` §28, verbatim.

**This is the task that makes a cover a cover.** Until it lands, `"cover"` is
a solid block and Ctrl+F still finds what is under it.

Four brackets, all three of them mechanisms this file already has and already
documents (§4.3, §13.5, §20):

```
onBeforePrint            -> applyCovers()     // window.print() anywhere, Ctrl+P too
onAfterPrint             -> releaseCovers()
PAGE_ANNOTATE_UI{false}  -> applyCovers()     // a Pro CDP capture, the region selector
PAGE_ANNOTATE_UI{true}   -> releaseCovers()
```

A save from the bar reaches one of the two pairs, so it needs no third bracket -
the same reason the three visibility booleans are three and not one: a save is
a print or a capture happening *inside* a third thing. **Both must be
idempotent**, because the brackets overlap in every combination.

`applyCovers` is `hideTextUnder(coverRects(s.history.shapes()), document)` with
the handle on the `Session`. **It must run after `commitEditor()`** in
`onBeforePrint`, so a label finished but not committed is a shape by the time
`coverRects` reads the history.

Held on `Session`, not in a module variable, so `stop()` cannot leave a page
with holes in its text: `stop()` calls `releaseCovers()` beside
`endFrameDrag()` and `discardEditor()`.

**No arithmetic and no predicates of its own** - this file's header promises it,
with one declared exception (`sincePress`). Every decision here is
`coverRects`' or `hideTextUnder`'s. Do not add a second exception.

**Measure `onBeforePrint`.** It is synchronous and on the critical path of
opening the print dialog, and it now does per-character geometry. Time
`applyCovers` on a long article with three large covers and report the number.
If it is visibly slow, the answer is a better pre-filter inside
`hideTextUnder` (task 35 already filters by element box), **not** a move to an
async seam - `beforeprint` does not have one.

**Out of scope**: `lib/` (34 and 35 own it), the bar (33), the background, any
message change. `PAGE_ANNOTATE_UI`'s payload is unchanged.

**Proof**
```bash
pnpm compile
```

Typecheck-only for the reason tasks 23, 24 and 35 give: glue in an injected
entrypoint, no DOM harness in `tests/`, and every decision tested one seam down.

**Manual check - this is the one that matters, and it is `CLAUDE.md`'s own test**

1. Draw, arm Cover, drag a solid block over a paragraph of real text.
2. Save the PDF (free route, Ctrl+P). Open it. **Ctrl+F a word that was under
   the block: NOT found.** Ctrl+F a word from the same paragraph outside the
   block: **found**.
3. Select the covered line in the PDF and copy it. The covered words are not in
   what you pasted.
4. The page itself, after the dialog closes, is **intact** - the text is back,
   nothing reflowed, and the marks are where you left them.
5. Save a PNG: the block is opaque pixels, nothing readable under it.
6. Pro path: save with `mode: "screen"`. Same as step 2.
7. Take a **region** screenshot with a cover on the page: the selector gets the
   pointer, the covers apply, and the region comes out with nothing readable
   under the block - then the page is intact again.
8. Cover a paragraph, then Ctrl+Z until the cover is gone, then export:
   everything is findable again. The covers follow the history.
9. Cover something, then exit annotate mode with the X: the page is restored
   whole.
10. Cover a `<textarea>` with text in it, export: the field's value is not in
    the PDF.

**If step 2 finds the covered word, stop.** Either task 30's probe was wrong or
the brackets are not firing; do not paper over it - a cover tool that does not
cover is the one outcome this whole pass exists to avoid.

**Depends on**: 30, 33, 34, 35

---

## Amended by `.plan/contracts.md` §29

`coverRects` is now **`coverAreas`**, returning `Cover[]` rather than
`DrawRect[]`, so `applyCovers` is
`hideTextUnder(coverAreas(s.history.shapes()), document)`. Nothing else in §28
changes.
