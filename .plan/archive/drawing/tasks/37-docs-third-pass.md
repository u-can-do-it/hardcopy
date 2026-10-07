# 37 - Write down what a cover does, and where it does not

**Goal**: the docs describe the cover tool exactly, including the one limit
that can hurt somebody.

**Files**
- `README.md`
- `BACKLOG.md`
- `project.md` (§9 matrix rows)
- `.plan/contracts.md` (**append to §17 only**)

**Contracts**: none added. This records what shipped.

**README - the Drawing section**: the fill menu with its three options, and
what each does to the text underneath. Be exact: a cover removes the covered
characters from the **exported** PDF's text layer, and the page itself keeps
its text while you work.

**README - a new Deviation 20**, after 19. It has to carry all of
`.plan/design.md` §21, and §17.1 - the part where the instruction named a
raster and a raster is not what does the job:

- a raster over a paragraph leaves the paragraph's text runs in the PDF, so
  Ctrl+F still finds them: the pixels are covered and the text is published.
- a raster also needs `Page.captureScreenshot`, which is CDP, on a path
  `CLAUDE.md` says must never depend on `debugger`.
- what works instead is `visibility: hidden` on the covered runs - layout
  preserved, nothing painted, nothing in the text layer - plus an opaque fill.
- **a cover cannot reach inside a cross-origin iframe.** Its own sentence, not
  a clause in a list. This is a genuine leak and the one item here a user could
  be harmed by.
- it is not a certified redaction: no claim about metadata or embedded objects.
- `alt`, `title` and `aria-label` are not hidden, because Chrome does not put
  them in the text layer - and if that changes, this is where to look.

**Also fix three stale README items** task 29 flagged and could not touch, and
which this pass changes again anyway:
- **Deviation 15** enumerates Free as five tools. After task 33 it is five
  tools again (the filled pair became a menu), so check what it says against
  the code rather than assuming either number.
- **"Commands"/"Testing"** say `pnpm test` is "465 tests" and the drawing
  feature is "eleven suites". Re-measure both.
- the `annotate.js` bundle figure. Re-run `pnpm build` and quote what you see,
  or drop it - do not leave a third stale measurement.

**BACKLOG**:
- **Strike** the "opaque rasterising cover tool" phase-3 item - it is built,
  differently and for the reasons in §17.1.
- **Strike** the `DRAW_TOOL_FILLED` deferral - task 33 deleted `isFilledTool`
  outright, so there is nothing left to move.
- **Add**: a blurred or pixelated cover, if ever wanted for its own sake, is
  Pro-only on the CDP path and needs its own spec - it has to combine a real
  raster with the text hiding this pass built (§22).
- **Add** to accepted consequences: the cross-origin iframe limit; that a
  cover is applied around the export and not while drawing, so screen-sharing
  while annotating has hidden nothing; and `onBeforePrint`'s synchronous cost
  with the number task 36 measured.

**project.md §9** gains the rows that are the whole point:
- cover a paragraph, export the PDF, **Ctrl+F a covered word - not found** -
  and a word beside it in the same paragraph - found.
- after the export, the page is intact and nothing reflowed.
- the same over a region screenshot and over the Pro screen path.
- a cover over a `<textarea>`: its value is not in the PDF.

**Out of scope**: `docs/features/DRAWING.md` (the original proposal, a
historical document), `CLAUDE.md`, and any code.

**Proof**
```bash
pnpm compile
```

Docs-only. Then run `pnpm test && pnpm compile` over the whole repo as the last
act of the build and report the counts.

**A reviewer should check** that `DEV_UNLOCK_PRO` is still `true` in
`lib/constants.ts` and that the README still carries the "before publishing"
warning - the same check task 29 ran, for the same reason: a docs task is where
that could get tidied away by accident.

**Depends on**: every other task

**One more comment to revisit**, found by task 31's review:
`lib/draw/render.ts`'s `HIGHLIGHT_OPACITY` calls the opaque bar over a line of
text "the redaction tool this product deliberately does not ship". After tasks
34-36 the product ships a cover that *does* remove the text. The sentence is
still defensible under §21.3 - a cover is not a certified redaction - but it
reads as describing a thing that does not exist. Add
`lib/draw/render.ts` to this task's Files list for that one comment, and say
what the difference is: the highlighter is translucent because nothing is
removed under it, and the cover is opaque because something is.

---

## Picked up from task 33's review

1. **`lib/draw/css.ts`'s comments now contradict `lib/draw/bar.ts`.** Two places
   (the header, and the `.popover` block) still say "Two groups are popovers -
   the symbols palette and the label's font size". There are three now, and
   bar.ts's own header was correctly rewritten to say so. Add `lib/draw/css.ts`
   to this task's Files list for those two comments. **Do not touch the CSS
   itself** - `tests/draw-css.test.ts`'s two load-bearing guards must keep
   passing.

2. **Say out loud that the cover warning has no automated guard.** Task 33's
   reviewer deleted the session-start branch of `FILL_NOTE` outright and
   **625/625 tests still passed with a clean compile.** The text is asserted
   nowhere; the closest thing pins only the premise (that the pen persists).
   That is inherent - the trigger lives in an entrypoint with no DOM harness,
   which `CLAUDE.md` asks stay that way - but it means the once-per-session
   cover warning is protected by the §9 manual matrix alone. The §9 rows this
   task adds must include it explicitly, and `BACKLOG.md` should record that
   the sentence a user's privacy depends on is guarded by a human step.

3. **A manual-check line about the fill trigger's shape.** `.btn.trigger` was
   written for the font-size control's tabular numbers (`width: auto;
   min-width: 28px; padding: 0 11px 0 5px`), and the fill trigger holds a 16px
   icon instead - so it renders wider than the 28px buttons either side with
   the icon a few px off centre. Not a defect and not worth a CSS change; it
   belongs in the §9 row that looks at the bar.

## Picked up from task 35's review

4. **`.plan/design.md` §21 is short by one honest limit: CSS-generated text.**
   `::before` / `::after` `content` and list markers are text no `Range`
   reaches, and Chrome does put them in the printed text layer - the same class
   as the `<select>` that §30 escalated, but unfixable from where the walker
   stands rather than one word away. Low severity in practice (a covered
   `<li>`'s marker survives; a `content: attr(data-...)` leak is rare), and it
   belongs in README Deviation 20's limits list beside the cross-origin iframe.
   Say which of the two is which: the iframe is somebody else's document, this
   is our own document painting text that has no node.

5. **Two comment-level notes from the same review**, both correct as shipped and
   neither worth a code change - record them in Deviation 20 or BACKLOG rather
   than losing them:
   - `restore()`'s `normalize()` merges every descendant text node of a split
     parent, not only the nodes it split. Contract-mandated, and harmless for a
     page that is about to be left alone - but a framework holding references
     to adjacent text nodes it rendered separately would find them merged.
   - the wrapper `<span>` forces only `visibility`, so a page-wide `span { }`
     type rule still applies to it. "Adds no box of its own" is a claim about
     the default UA style, not a guarantee.
