# 29 - Write down what this pass decided

**Goal**: `README.md`, `BACKLOG.md`, `project.md` and `contracts.md` describe
the tool as it now is, including the two places this pass overrode an earlier
decision.

**Files**
- `README.md` (modify - the Drawing section, and Deviations 17-19)
- `BACKLOG.md` (modify - the Drawing section)
- `project.md` (modify - §9 manual test matrix rows)
- `.plan/contracts.md` (modify - **append to §17 only**, "what shipped past
  §§1-16 - recorded after the fact"; do not edit §§18-23)

**README - the Drawing section** gains: filled rectangle and ellipse in the free
list; the text tool described as a *box* (draggable, resizable, wraps, grows,
`Enter` is a newline and `Esc` commits); and the note that the symbols palette
stays up while you use it.

**README - three new deviations**, numbered 17, 18 and 19 after the existing 16:

17. **A filled shape ships, and `.plan/tasks/16` said it would not.** The
    reason it can (`FILL_OPACITY`, honest labels, the note line) and the reason
    it still is not a redaction tool: the covered text is in the PDF and
    searchable. `.plan/design.md` §11.1. This is the one entry a user could be
    hurt by getting wrong, so write it plainly.
18. **Ctrl+F may not match a phrase that straddles a soft wrap.** Each
    `<tspan>` is its own text run. A single word is never split by a soft wrap,
    so single words always match. Every wrapped text in every PDF behaves this
    way; it is here because somebody will find it.
19. **A bar panel is dismissed only by the bar.** Nothing in the page closes
    one - which is a deliberate reversal of the first pass's
    close-on-outside-press, and it means a panel can be open across a capture
    (it is inside the hidden host, so it does not reach the output).

**BACKLOG - the Drawing section** gains, under phase 3:
- **An opaque, rasterising cover tool.** The other half of
  `docs/features/DRAWING.md` §6 trap 1: a fill that actually removes what it
  covers needs a per-region raster and a way to drop the covered DOM out of the
  print, and it makes a security claim we would have to be sure of. Not a
  drawing tool.
- **Drag-to-create a text box.** Today a click places one at
  `DrawPrefs.textWidth` and the handles size it. Drag-to-create is a `DragTool`
  restructure for very little.
- **Re-wrapping a committed label**, and editing one at all - still the phase-3
  select/move item, which this pass narrowed rather than retracted
  (`.plan/design.md` §11.2).

And under accepted consequences: the wrap being measured with canvas metrics
and painted with SVG shaping (a line can sit a pixel past the box; it paints,
it does not clip), and the straddled-phrase Ctrl+F caveat.

**project.md §9** gains three rows, each phrased as something a human does and
sees - `CLAUDE.md` is explicit that a unit test cannot tell you any of this:
- annotate a page, type a **wrapped, multi-line** label, export, **Ctrl+F a word
  from a line that is not the first**. Not found means the build is broken.
- open a text box, Ctrl+P with the frame still on screen: **no dashed rectangle
  and no handles** in the preview or the PDF.
- open the symbols palette, place five marks and use a menu in the page: the
  palette is still up, and it is not in an exported PDF or screenshot.

**Out of scope**: `docs/features/DRAWING.md` (it is the original proposal and
stays as written - a historical document, not a spec), `CLAUDE.md`, and any
code at all.

**Proof**
```bash
pnpm compile
```

Docs-only, so there is nothing to test. Run `pnpm test && pnpm compile` over the
whole repo as the last act of the build and report the count.

**A reviewer should check** that `DEV_UNLOCK_PRO` is still `true` in
`lib/constants.ts` and that the README still carries the "before publishing"
warning about it. Nothing in this pass touches the tier split, and a docs task
is exactly where that could get tidied away by accident.

**Depends on**: every other task

---

## Picked up from the reviews, and this task owns them

Both are docs, and both come from task 25's review.

1. **Reword `contracts.md` §20.4's `setState` bullet to the transition form.**
   It currently states the bare test - "closes an open panel whose group's tool
   is no longer selected". The shipped code fires only on a *transition* (the
   previously selected tool was the open group's, and the next one is not), and
   it has to: `paint()` calls `setState` on every pref, note and history
   change, and the text group's own-trigger dispatches no tool, so the size
   panel opens with (say) the pencil active. Under the bare test, the first
   `setState` after opening it - including the one caused by picking a size out
   of it - closes the panel, which is §20.1 rule 3 undone by the very press it
   protects. Rule 3 outranks §20.4's phrasing, and §20.4's own rationale is
   already transition language ("a tool *changed* from anywhere but a press").
   Fix the wording so nobody "fixes" the code back into the bug. Append the
   record to §17 as well.

2. **`BACKLOG.md`: a redundant reflow per press inside an open panel.**
   `onClick` calls `setOpen` unconditionally, so a press that cannot change
   which panel is open still runs `place()` and forces a layout - placing five
   arrows costs five of them. An `if (id === openId) return;` at the top of
   `setOpen` removes it. Within `place()`'s documented "a layout per press"
   budget either way, so it is a note and not a bug.

3. **A stale clause left by task 22, in two files task 22 could not touch.**
   `lib/draw/wrap.ts` and `tests/draw-wrap.test.ts` both say `layer.ts`'s
   `TEXT_EM_LINE = 1.5` bound is "still live there until task 22 retires it".
   Task 22 retired it. Drop the clause in both; the 1.2 em figure the
   `TEXT_LINE_HEIGHT` argument rests on is unaffected and stays. Add
   `lib/draw/wrap.ts` and `tests/draw-wrap.test.ts` to this task's Files list
   for that one edit each - it is a comment correction, so `pnpm compile`
   remains the right proof, but re-run `pnpm test` since one of them is in a
   test file.

4. **`BACKLOG.md`: `deltaOf` in `lib/draw/geometry.ts`.** Task 24 needed a
   vector difference and `geometry.ts` exports none, so it landed as
   `sincePress` in `entrypoints/annotate.ts` and the file header's "no
   arithmetic and no predicates of its own" was amended to declare it. That is
   the right call for a task whose Out of scope said "anything in `lib/`", but
   the deferral currently lives only in a doc comment. Record it: a
   `deltaOf(from, to): Vec2` in `geometry.ts` with a test would de-duplicate
   **three** call sites - `constrainSquare` and `snapAngle` in `geometry.ts`
   itself, plus `sincePress` - and would let task 23's "no arithmetic" claim
   stand without an exception.

5. **`BACKLOG.md`, accepted consequences: dead travel on the N/S handles of a
   wrapped label.** `FrameDrag`'s baseline is `editor.rect` - the height the
   user asked for - which is what makes a box dragged tall stay tall, and is
   required (baselining on the laid-out rect is the bug task 24's correction
   section forbids). The consequence: on a two-line label `editor.rect.height`
   is 22.4px while the frame is 44.8px, so the first 22.4px of a south-handle
   drag produces no visible change, because `layoutText` clamps the result
   back up to the content height. 44.8px on a three-line label;
   `laidOut.height - rect.height` in general. A **north** drag spends the same
   span sliding the box up instead of growing it, for the same reason - so it
   is both y handles, not only the south one. Correct
   behaviour, surprising the first time - the pattern the existing four
   accepted consequences follow. **Also note it against §9 manual check 3**:
   "drag the south handle down, then delete a line" only exercises the intended
   path cleanly on a *one-line* label; on a wrapped one the start of the drag
   looks broken.

6. **A dangling cross-reference to fix, in two places.** `entrypoints/annotate.ts`
   and `.plan/design.md` §15 both say drag-to-create a text box "is in
   `BACKLOG.md` instead". It is not - `BACKLOG.md` has no such item. Item 2 of
   this task's main list already asks you to add it; when you do, both
   pointers become true. If you decide against adding it, drop the pointer in
   `annotate.ts` instead of leaving it dangling.

7. **`BACKLOG.md`: `isFilledTool` belongs in `lib/draw/model.ts`, beside
   `isFreehand`.** Task 27 landed it in `entrypoints/annotate.ts` as
   `tool === "rect-fill" || tool === "ellipse-fill"`. That is a predicate in an
   entrypoint, which the file's own header disclaims, and more to the point it
   is the shape `DRAW_TOOL_FREEHAND` exists to avoid: an exhaustive
   `Record<DrawTool, boolean>` makes a new tool a compile error until somebody
   answers the question, whereas a two-way `||` lets a third filled tool arrive
   silently unfilled. Not a bug today - the tool set is closed and
   `tests/draw-bar.test.ts` pins it - but it is the second copy of a
   classification the model already knows how to hold. Moving it is a
   `DRAW_TOOL_FILLED` table in `model.ts`, an `isFilledTool` beside
   `isFreehand`, and one import.
