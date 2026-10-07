# 17 - Write down what was decided

**Goal**: the three project documents tell the truth about the feature -
including the two places it knowingly departs from what came before.

**Files**
- `README.md` (modify - Layout, a Deviations entry, Testing)
- `BACKLOG.md` (modify - phase 3 and the known gaps)
- `project.md` (modify - one row in the §9 matrix)
- `CLAUDE.md` (modify - one invariant)

**Contracts**: none - this task adds no code.

`README.md`:
- **Layout**: `entrypoints/annotate.ts` and `lib/draw/` in the tree.
- **A new Deviations entry** (§4.1's pre-processing contract): annotate mode
  holds the prepared page and exports reuse the pass rather than re-running it,
  which is the opposite of what `PAGE_PREPARE` did before. Say why: draw first
  and prepare afterwards and every mark below an expanded section drifts by
  however tall that section turned out to be. Say also that the whole seam is
  two optional fields on two page messages, inside `prepare.ts` - the export
  handlers were deliberately left alone.
- **A second Deviations entry** on the tier gate, in the words of
  `design.md` §3: the drawing split is a **UI gate**, unlike
  `effectivePageMode`, because a mark is already in the DOM by the time
  anything exports and the only export-time enforcement available would be to
  make a user's labels silently vanish from their PDF. Free = pencil,
  highlighter, line, rect, ellipse; Pro = symbols, pins, text.
- **Testing**: the ten `tests/draw-*.test.ts` suites, and that the bar, the
  layer mount and the pointer state machine are manual by design.

`BACKLOG.md`, under a new "Drawing" heading - all four phase-3 items with the
reasons from `design.md` §8: select / move / delete an existing mark; edge
auto-scroll while drawing; marks surviving reload via `chrome.storage.session`
keyed by tab and URL; and marks anchored to a DOM element instead of a coordinate
(which is a change to the shape model, not a feature on top of it, and the only
honest way to allow drawing *before* preparation). Plus the accepted
consequences from `design.md` §9 that a user could report as bugs: marks lost
on navigation, the painted-height trim kept alive by a mark in the blank tail,
and fixed furniture that survives hiding sitting elsewhere on paper.

`project.md` §9, one row:

| Page | Why | Pass criteria |
| ---- | --- | ------------- |
| Any article, annotated | the marks must be real text and real vector | bar absent from the output; marks on the right sheets, once each; **Ctrl+F finds the label text** |

`CLAUDE.md`, one line under "Invariants": **the drawing layer is
`position: absolute` in a clipping wrapper, never `position: fixed`** - a fixed
layer repaints on every printed sheet, and an unclipped one changes the page
height the Pro path measures.

**Out of scope**: any code. Do not touch `lib/`, `entrypoints/`, `wxt.config.ts`
or `package.json`.

**Proof**
```bash
pnpm test
```

Docs-only, so the whole suite is the honest check that nothing was edited by
accident. Run `pnpm compile` too.

**Depends on**: 01-16

---

## Carried forward from reviews

Three items reviewers raised that belong in the plan documents rather than in
the code they found them in. Fold them into the edits above.

1. **`.plan/contracts.md` §6 should list `HIGHLIGHT_OPACITY`.** Task 08 exports
   it (0.4) because the contract table says the highlighter carries an
   `opacity` without fixing a value, and the value has to live somewhere
   pinnable - the same treatment `HIGHLIGHT_WIDTH_SCALE` and `PATH_PRECISION`
   already get. Add the line so the next reader does not meet an undeclared
   export. (This is the one place a task may edit `contracts.md`: recording
   what shipped, after the fact.)
2. **`design.md` §9 needs one more known consequence: the highlighter does not
   close the fake-redaction hazard, it only mitigates it.** `mix-blend-mode:
   multiply` never lightens, so four or five passes of the near-black marker
   over one line drive the background to near-black while the text underneath
   stays perfectly selectable in the PDF - which is trap 1 arriving by a
   different door. Opacity 0.4 makes one pass a wash rather than a bar; it
   cannot stop repeated passes, and restricting the palette would not either,
   since the bar has a free colour input. Write it down next to the trap it
   belongs to.
3. **Note the two small duplications as debt**, in the README Testing section
   or beside the deviation entries: `lib/draw/render.ts` carries a private
   `inkWidth` mirroring the private one in `lib/draw/model.ts` (both read the
   one exported `HIGHLIGHT_WIDTH_SCALE`, so only the expression is duplicated -
   the drift risk is `isDegenerate`'s threshold disagreeing with what is
   painted), and a private `num()` mirroring `coord()` in `lib/draw/stroke.ts`
   (verified identical, so the line's `d` and the stroke's `d` round the same
   way today). Both exist because the source module was outside the borrowing
   task's Files list. Say so rather than leaving a future reader to find it.
4. **Record the exports that grew past their contract sections.** All additive,
   all found by reviewers, none a violation - but §§5-11 should say what
   actually shipped:
   - `coord` is now a named export of `lib/draw/stroke.ts` (§5 listed three
     path builders). It moved there to kill a `render -> symbols -> render`
     import cycle: `stroke.ts` is the leaf both modules already sit above.
   - `LABEL_FONT_FAMILY` lives in `lib/draw/css.ts` (§9 fixed that file at two
     strings), for the same leaf reason, next to the identical stack `BAR_CSS`
     already carried.
   - `markSpec` is exported from `lib/draw/layer.ts` (§10) - it is the pure
     half of the per-mark restructure, and it is where the box maths is tested.
   - `BarId` and `parseBarId` are exported from `lib/draw/bar.ts` (§11), so
     `entrypoints/annotate.ts` does not re-declare the button-id grammar as a
     third hand-written reader.
   - `HIGHLIGHT_OPACITY` from `lib/draw/render.ts`, per item 1 above.
   - `POPOVER_GAP_PX`, `DropSide` and `dropSide` from `lib/draw/geometry.ts`
     (§4 fixed that module at two constants and seven functions and named no
     popover at all) - the flip decision is arithmetic, so it belongs beside
     `clampToViewport`, which is the same fact from the other end.
   - `symbolRect` from `lib/draw/symbols.ts` (§7 listed one constant and
     `symbolSpec`). It exists because the symbol-rect arithmetic sitting
     untested in the entrypoint is what let a horizontal arrow silently
     collapse to a 32px diagonal one, with the whole suite green.
   - **`lib/draw/keys.ts` in full** - `dropLastChar`, `isChord`, `isUndoChord`,
     `isPrintable` and `KeyStroke`. Task 16 said it added no new contract;
     these were §14's entrypoint predicates, moved out because they are pure
     rules that regress silently. There is no §1-16 section they belong to, so
     give them one.
5. **README, in the deviation on the drawing layer: say that the layer is one
   small `<svg>` per mark, not one document-sized one, and why.** An `<svg>`
   root in HTML is a *replaced* element, and replaced elements do not fragment
   across printed sheets - a document-tall one risked being laid out on the
   first fragmentainer and clipped, which would have dropped every mark below
   page 1. That is the feature's whole promise, so it is worth a sentence.
   Residual, also worth stating: a single mark taller than one sheet is still
   one unfragmentable `<svg>`.

6. **Two pre-existing `entrypoints/prepare.ts` hazards, for BACKLOG.md.** Both
   predate this feature and neither is in task 13's three-change scope; a
   reviewer found them while checking that the `held` seam did not add them.
   - A `PAGE_RESTORE` landing inside `schedulePrint`'s 50ms window restores
     before `window.print()` is called, so the dialog shows an unprepared page.
     It needs two user actions 50ms apart. Now that a held pass ignores a
     restore without `release`, only an annotate exit can reach it.
   - Two `PAGE_PREPARE`s in flight still double-run `prepareForExport` and
     orphan the first `Prepared`. `held` is only set after the `await`, so the
     `active !== null` guard cannot catch it. Annotate mode's slow lazy-scroll
     prepare plus a popup export makes it marginally easier to reach than
     before.

7. **`lib/draw/css.ts` is no longer a leaf.** It imports `POPOVER_GAP_PX` from
   `lib/draw/geometry.ts`, so the rule that matters now runs the other way:
   nothing in `geometry.ts` may import from `css.ts`. No cycle exists today
   only because that edge is one-way. `lib/draw/render.ts`'s header still calls
   `css.ts` a leaf and should be corrected in passing (its own load-bearing
   point, the one-way `render` -> `symbols` edge, still holds).
