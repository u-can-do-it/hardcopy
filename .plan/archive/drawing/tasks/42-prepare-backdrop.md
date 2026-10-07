# 42 - A curtain over the preparation sweep

**Goal**: entering annotate mode shows a semi-transparent backdrop saying what
is happening, instead of appearing to lurch to the bottom of the page.

**Files**
- `lib/draw/backdrop.ts` (create)
- `entrypoints/prepare.ts` (modify - up before the pass, down in a `finally`)
- `tests/draw-css.test.ts` (extend)

**Contracts**: `contracts.md` §32 and §32.1, verbatim.

**The sweep is not moving.** `.plan/design.md` §4.2 and
`docs/features/DRAWING.md` §3 are why: a mark stores a document coordinate, so
an image loading above it after it is drawn slides the content down and leaves
the mark pointing at nothing. The user asked for the scroll to move to export
time; it cannot, and this is the answer instead.

**The one invariant here is the opposite of the layer's.** `CLAUDE.md` says the
drawing layer is `position: absolute` in a clipping wrapper, never `fixed` -
because a fixed layer repaints on every printed sheet. The curtain **must** be
`fixed`: it covers the viewport while the page scrolls underneath it. That is
safe only because it is gone before anything is captured, and the test in
`tests/draw-css.test.ts` is where both halves of that get written down.

The host must **not** carry `LAYER_ATTR`. `LAYER_CSS` forces
`display: block !important` on anything that does, which would make the curtain
impossible to take down - the same trap `lib/draw/bar.ts` documents for the bar.

**Shown on a delay** (`BACKDROP_DELAY_MS`), so a page with no lazy images -
which prepares in a few ms and never scrolls - shows nothing at all. A curtain
that flashes up and away is worse than the thing it was hiding.

**It eats the pointer** while up: a click landing mid-sweep would hit whatever
the scroll put under the cursor.

`remove()` goes in a `finally`. A preparation that throws must not leave the
page behind a curtain nobody can dismiss - that is the worst outcome available
here, worse than the jank it replaces.

**Verify, do not assume**: §32.1 says `hold` is set only by annotate mode. Check
it. If some other caller has started setting it, STOP and report rather than
showing a curtain over an export.

**Out of scope**: `lib/dom/lazy.ts` and the sweep itself, `lib/draw/css.ts`
(keep `tests/draw-css.test.ts`'s two existing load-bearing guards passing -
`LAYER_CSS` still never `position: fixed`, still forces
`print-color-adjust: exact`), the popup export path, any message or contract
change beyond §32.

**Proof**
```bash
pnpm test tests/draw-css.test.ts
```

Cover, at least:
- `BACKDROP_CSS` **is** `position: fixed` - the deliberate inversion, with the
  reason in the test's own message so nobody "fixes" it to match the layer.
- it sets `pointer-events` such that it blocks the page.
- it does not reference `LAYER_ATTR`.
- `LAYER_CSS` is still never `position: fixed` and still forces
  `print-color-adjust: exact` - the two existing guards, untouched.
- `BACKDROP_DELAY_MS` is above zero, and `BACKDROP_NOTE` is non-empty: a
  curtain with no explanation is just a grey box.

**Manual check**

1. `pnpm build`, load the extension, open a long article with lazy images,
   press Draw. The curtain appears, the page scrolls behind it, the curtain
   goes, and the bar is there. No visible lurch.
2. Press Draw on a short page with no lazy images: **no curtain at all** - it
   finishes inside the delay.
3. Draw a mark, export, and confirm **no curtain in the PDF**. It is gone long
   before this, but it is `fixed`, so check rather than assume.
4. Exit and re-enter annotate mode: the curtain comes back, and is removed
   again. Nothing accumulates on `documentElement`.
5. Export from the **popup** (not annotate mode): no curtain, per §32.1.

**Depends on**: none
