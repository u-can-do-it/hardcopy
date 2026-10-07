# 41 - Write down the three defects and the two limits

**Goal**: the docs say what a cover does after tasks 38-40, and name the two
places it still cannot reach.

**Files**
- `README.md` (Deviation 20)
- `BACKLOG.md`
- `project.md` (§9 rows)
- `.plan/contracts.md` (**append to §17 only**)

**Contracts**: none added.

**Check every claim against the code as committed**, not against §31 - re-read
`lib/dom/cover.ts` after tasks 38-40 land. `CLAUDE.md` treats numbers in docs as
measured claims, so confirm each in the source or re-measure it.

**README Deviation 20** gains:
- **the ink band**, briefly and with its number: a character's `Range` box is
  the font box, so it includes descent and half-leading that no glyph paints in;
  a cover edge there covers nothing and now hides nothing. Say what went wrong
  before the fix, because a user who saw a paragraph vanish deserves to find it
  written down.
- **a closed shadow root** as the second genuine limit beside the cross-origin
  iframe. Say which is which: an iframe is another document, a closed root is
  this document holding a subtree nothing can reach. Open roots are covered now.
- keep the existing limits (CSS-generated content, `alt`/`title`, the
  `nowrap`-overflow residual) and check each is still accurate.

**BACKLOG** - accepted consequences gain the closed shadow root; strike
anything tasks 38-40 made untrue.

**project.md §9** gains the rows that would have caught this:
- cover the middle of a paragraph with the block's top edge **between two
  lines**, export, and Ctrl+F a word from the line **above** it - found - and a
  word from under the block - not found. At the 8px pen too, which is the worst
  case.
- a cover over a web component's text (open shadow root): not found.
- a cover over an SVG chart label: not found, **and the other labels have not
  moved**.

**Out of scope**: `docs/features/DRAWING.md`, `CLAUDE.md`, any code.

**Proof**
```bash
pnpm compile
```

Docs-only. Then `pnpm test && pnpm compile` over the whole repo as the last act
and report the counts.

**A reviewer should check** `DEV_UNLOCK_PRO` is still `true` in
`lib/constants.ts` and that the README still carries the "before publishing"
warning.

**Depends on**: 38, 39, 40

## Picked up from task 38

**A fourth limit for §21's list: a CSS-transformed subtree.** Inside a subtree
scaled by a CSS transform, the canvas metrics and `getBoundingClientRect()` are
in different spaces, so the measured ink inset can be too large for the box it
is applied to. The 1px band floor is what keeps that from becoming a hole in the
export rather than a cover. Written into `inkBox`'s comment by task 38; decide
whether it earns a line in Deviation 20 or only in `BACKLOG.md`.

**And one consequence worth stating plainly**, because a user will meet it: a
paragraph whose glyphs have descenders has almost no empty descent to inset
away, so at the **8px** pen a cover edge dropped in the top few px of the
leading still takes the line above. That is the greedy rule working correctly -
8px of pen genuinely paints 4px above the edge that was dragged - but it reads
as the old bug unless it is written down. The reported case (the 4px pen) is
fixed outright.

## Picked up from task 39

Alongside the closed shadow root, the walk's reach also stops at any shadow
root whose **host sits inside a `SKIP_TAGS` subtree** - consistent with how the
light-DOM walk treats the same subtree, but worth a line if §21's list is being
made exhaustive rather than illustrative.

## Picked up from task 40's review — pre-existing, not from this pass

**Covering MathML does not reflow back.** A cover over a MathML `<mi>` grows its
rect height (11.16 → 18.5) and it does **not** return on `restore()`. Identical
on the code before task 40 — an HTML `<span>` in both cases — so it is not a
regression from this pass, but it is a "reflows nothing" violation that
*outlives the handle*, which is worse in kind than the limits already listed.
Decide whether it belongs in Deviation 20's limits or as a `BACKLOG.md` bug; it
is the only known case where `restore()` does not put the page back.
