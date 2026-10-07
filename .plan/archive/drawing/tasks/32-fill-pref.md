# 32 - The armed fill survives a reload

**Goal**: `DrawPrefs.fill` stores the fill mode the next shape will get.

**Files**
- `lib/types.ts` (§24.3 - `DrawPrefs.fill`)
- `lib/draw/prefs.ts` (the default and the validator)
- `tests/draw-prefs.test.ts`

**Contracts**: `contracts.md` §24.3, verbatim.

Default is `"none"` - a shape is an outline unless somebody asked otherwise,
and that is what every rect and ellipse drawn before this existed is.

Validate it the way `symbolKind` is validated and **not** the way `color` is: a
lookup whose completeness the *compiler* keeps, so a fourth `FillMode` fails to
build until it is named here rather than silently falling back at runtime.
`SYMBOL_KINDS` in the same file is the pattern - a
`Readonly<Record<FillMode, true>>` plus `Object.hasOwn`, never `in`.

`mergeDrawPrefs` fills it in for every blob written before this pass. No
migration; that is what the function is for.

**Out of scope**: the bar's menu (33), the note line (33), anything that reads
the pref (33 and 36).

**Proof**
```bash
pnpm test tests/draw-prefs.test.ts
```

Cover, at least:
- `DEFAULT_DRAW_PREFS.fill === "none"`.
- a blob with **no** `fill` key comes back `"none"` - the migration case, and
  it must assert the key really is absent rather than present-and-default.
- each of the three modes round-trips.
- `"solid"`, `""`, `"COVER"`, `null`, `0`, `{}` and an array all come back
  `"none"` - a stored mode this module never wrote must not arrive as one.
- `"constructor"` and `"toString"` come back `"none"`. `Object.hasOwn`, not
  `in` - the hazard the file already documents for `SYMBOL_KINDS`.
- `mergeDrawPrefs` still does not alias its input.

**Depends on**: 31
