# 43 - PDF and PNG on the save buttons - NOT DONE, decided against

> **Outcome: built, measured, reverted.** The lettering is a grey smear at
> 16px, and it swallows the down-arrow that currently distinguishes the two
> buttons - so shipping it would be worse than shipping nothing. The full
> measurement is in `.plan/contracts.md` §33.4, which retracts §33. The
> buttons stay as they are. Do not re-open this without reading §33.4 first.

---

**Goal**: the two save buttons say which format they save, without growing.

**Files**
- `lib/draw/bar.ts` (`BarButton.iconLabel`, `iconElement`, the two save buttons)
- `lib/draw/css.ts` (one rule for `.icon text`)
- `tests/draw-bar.test.ts`
- `tests/draw-css.test.ts`

**Contracts**: `contracts.md` §33, §33.1, §33.2, verbatim.

At 16px the two buttons read as "two save buttons" before they read as which is
which. The user picked lettering inside the glyph over a wider labelled button,
so the bar's geometry does not change: both stay 28px.

**Why it cannot be a path.** `BAR_CSS` strokes `.icon path` at 2px with no fill,
which is why task 27 drew its filled squares as concentric outlines. Letterforms
traced as stroked paths at this size are a smudge. So the label is a real
`<text>` node, filled with `currentColor` and with `stroke: none` stated
explicitly - without it the text inherits the 2px stroke and blooms shut.

**Do not unify the two glyphs.** `PDF` and `PNG` differ only in their last two
letters, and at this size `D`/`N` and `F`/`G` are nearly the same shape. The
`file-down` / `image-down` silhouette is what actually distinguishes the
buttons; the letters confirm. Replacing both with one rectangle because "the
letters say which is which" trades a working differentiator for one that does
not survive the render.

`label` is unchanged - it is the accessible name and the tooltip, and it stays
the sentence it is. `iconLabel` is only the thing you can read without hovering.

**Out of scope**: every other icon, `valueElement`, `.btn.trigger`, the bar's
layout, and the popover machinery.

**Proof**
```bash
pnpm test tests/draw-bar.test.ts
```

Cover, at least:
- both save buttons carry an `iconLabel`, `"PDF"` and `"PNG"`, and no other
  button carries one.
- their `label`s are unchanged - the tooltip is still the sentence.
- `barGroups` is otherwise identical: same ids, same order, same groups, same
  tier gate (`toolsFor(false)` still locks exactly the nine).
- in `tests/draw-css.test.ts`: `BAR_CSS` fills `.icon text` and sets its stroke
  to `none` - the assertion that catches the blooming - and the two existing
  load-bearing guards still pass untouched (`LAYER_CSS` never
  `position: fixed`, still forces `print-color-adjust: exact`).

**The check a test cannot make**

Whether three letters are legible at 16px is for a rendering engine, not for
this file. **Render it in a real Chromium at 16, 24, 64 and 128px** - the method
that caught task 27's corner notches at 128px, and `CLAUDE.md`'s rule about
trusting measurement over recollection. You have a browser pane
(`mcp__Claude_Browser__*`); the esbuild shim in this tree is broken, so call the
platform binary under `node_modules/.pnpm/@esbuild+darwin-arm64@*/` directly if
you need to bundle. Screenshot all four sizes and report what you actually see.

**If it is a smudge at 16px, say so and stop.** Do not ship an unreadable
button and do not quietly shrink the glyph to make room until the glyph stops
reading either. §33.3 names the fallback - the wider labelled button, the option
the user did not take - and reopening it is the honest outcome, not a
workaround.

**Manual check**

1. `pnpm build`, load the extension, Draw: the two save buttons are still 28px
   and the bar has not moved.
2. Read them at normal zoom, without hovering. If you cannot tell PDF from PNG
   without the tooltip, that is the failure this task exists to fix and it has
   not been fixed.
3. Hover each: the tooltip is still the full sentence.
4. Save a PDF with marks on the page and confirm the bar is absent from it - the
   buttons are chrome and this task must not have changed that.

**Depends on**: 42 (shares `tests/draw-css.test.ts`)
