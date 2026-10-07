# 06 - The two stylesheets

**Goal**: `lib/draw/css.ts` holds the layer's unconditional CSS and the bar's
shadow-root CSS as strings, and a test guards the two rules that are load-bearing
rather than cosmetic.

**Files**
- `lib/draw/css.ts` (create)
- `tests/draw-css.test.ts` (create)

**Contracts**: `contracts.md` §9, verbatim - `LAYER_ATTR`, `Z_INDEX`,
`LAYER_CSS`, `BAR_CSS`.

`LAYER_CSS` must set, on our own subtree: `print-color-adjust: exact` **and**
`-webkit-print-color-adjust: exact` regardless of the user's `exactColors`
setting; `display` and `visibility` forced, so a site whose print stylesheet
says `* { display: none }` cannot erase the annotations. It must **not** contain
`position: fixed` anywhere - see `design.md` §4.1.

**Out of scope**: injecting it (that is `injectUnconditionalCss` in
`lib/dom/print-css.ts`, called by task 11), mounting anything.

**Proof**
```bash
pnpm test tests/draw-css.test.ts
```

Assert: `LAYER_CSS` contains `print-color-adjust: exact`; `LAYER_CSS` does not
match `/position\s*:\s*fixed/` (a fixed layer repaints on every printed sheet -
that is what `lib/dom/hide-fixed.ts` exists to prevent, and it would stamp one
arrow onto all 14 pages); both strings are non-empty and mention `LAYER_ATTR`
/ the bar's own class prefix so a rename cannot silently orphan them.

These are real regression guards, not ceremony: both properties have already
cost this project a debugging session in another form (README Deviations 7 and
11).

**Depends on**: none
