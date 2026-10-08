# 10 - The layer, in document coordinates

**Goal**: `lib/draw/layer.ts` mounts a clipping, document-anchored SVG layer
whose marks paginate with the content and cannot change the page's height.

**Files**
- `lib/draw/layer.ts` (create)
- `tests/draw-layer.test.ts` (create)

**Contracts**: `contracts.md` §10, verbatim - `LayerSize`, `layerBoxStyle`,
`DrawLayer`, `mountLayer`.

The three things this task exists to get right (`design.md` §4.1):

1. **`position: absolute`, never `fixed`.** Chrome repaints fixed elements on
   every printed sheet - that is why `lib/dom/hide-fixed.ts` exists - and a
   fixed layer would stamp one arrow onto all 14 pages.
2. **`overflow: clip` on a wrapper sized to exactly `scrollWidth x
   scrollHeight`.** A stroke dragged past the bottom edge must not grow
   `scrollHeight`, or it quietly changes the paper size that
   `planPageFromDocument()` and `session.getStableContentSize()` measure.
   `clip` and not `hidden`: both clip, and both keep scrollable overflow off
   the ancestors, but `hidden` also makes the wrapper a **scroll container**,
   which the older CSS fragmentation rules call monolithic - a wrapper that may
   then refuse to break across sheets. `clip` is Chrome 90+ and
   `minimum_chrome_version` is 109.
3. **Anchoring is measured, not assumed.** Append the host to
   `document.documentElement`, read its own `getBoundingClientRect()` once, and
   correct `left`/`top` with `anchorCorrection()` - a page is free to put
   `position: relative` plus a margin on `html`.

The host hangs off `documentElement`, behind a **closed** shadow root, matching
`entrypoints/select-area.ts`. Inject `LAYER_CSS` with
`injectUnconditionalCss()` from `lib/dom/print-css.ts` - never as
`media="print"`, which does not match while the Pro path emulates screen media
(DEVIATIONS.md Deviation 11).

`setLive()` updates one element in place; `render()` rebuilds the committed
shapes. Do not re-render the committed list on every pointer move.

**Out of scope**: the bar (task 11), pointer handling (task 12), symbols and
text (already rendered by task 09).

**Proof**
```bash
pnpm test tests/draw-layer.test.ts
```

Cover `layerBoxStyle` - it is pure so these two invariants are guarded by an
assertion rather than by a comment: the string contains `position:absolute`
(and never `fixed`), contains `overflow:clip` (and never `hidden`),
`pointer-events` is present, and the width/height/left/top are the exact px the
size and offset asked for.

**Manual check** (the mount half cannot be unit tested - there is no DOM
harness in this repo, by design)

1. `pnpm dev`, load the unpacked build, open a long article.
2. From the extension's context, mount the layer and append one stroke near the
   bottom of the page. Confirm `document.documentElement.scrollHeight` is
   **unchanged** before and after mounting, and unchanged again after a stroke
   is drawn past the bottom edge.
3. Confirm the layer's box lines up with the document at scroll 0 and at the
   bottom of the page - a mark placed next to a heading stays next to it.
4. Ctrl+P on a document **several sheets long** - check the dialog's page count
   reads 4 or more before looking at anything else - carrying a mark **near the
   bottom of the last sheet**, and page down to it. The mark has to be *there*.
   One screenful proves nothing and an arrow on sheet 1 proves less: a layer
   that does not paginate at all still prints sheet 1 perfectly and drops
   everything below it, which is what an `<svg>` spanning the whole document
   does (a replaced element is monolithic - `lib/draw/layer.ts` point 4, one
   `<svg>` per mark, is what makes this step pass). Then confirm the mark
   appears **once**, on the sheet its content is on, and not on every sheet.
   If marks below the first sheet still go missing, the wrapper is no longer
   the suspect - `overflow: clip` is not a scroll container, so it is not
   monolithic the way `overflow: hidden` would have been. What is left is the
   other bet: every mark is an **absolutely positioned descendant of a
   fragmented containing block**, and how Chrome assigns such a box to a sheet
   is the thing to go after next.
5. Known residual, to record rather than to fix: **one mark taller than a
   printed sheet** - a single vertical drag the height of the window, or a
   stroke run down the length of a scroll - is still one `<svg>`, and a
   replaced element cannot be split across two sheets. Draw one that crosses a
   page break, print, and note what Chrome actually did (clipped at the break,
   or the whole box moved to the next sheet). Whichever it is, it is a
   documented limit of drawing marks as real SVG; carry it into
   `docs/features/DRAWING.md` when task 17 writes it.

**Depends on**: 02, 06, 08
