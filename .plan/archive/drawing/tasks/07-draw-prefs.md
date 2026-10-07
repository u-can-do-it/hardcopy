# 07 - Bar position and last-used pen

**Goal**: `lib/draw/prefs.ts` stores the bar's position and the pen it was last
holding in `chrome.storage.local`, with a validating merge in the shape of
`mergeSettings`.

**Files**
- `lib/draw/prefs.ts` (create)
- `tests/draw-prefs.test.ts` (create)

**Contracts**: `contracts.md` §12, verbatim - `DRAW_PREFS_KEY`,
`DEFAULT_DRAW_PREFS`, `mergeDrawPrefs`, `loadDrawPrefs`, `saveDrawPrefs`,
including the clamping rules.

`storage.local`, **not `sync`**, and the reason belongs in the file's doc
comment: one position for every site, and a position synced from a 34-inch
monitor onto a laptop is a bar off the edge of the screen.

`loadDrawPrefs` must fall back to defaults when storage is unreachable, exactly
as `loadSettings` does - a `try`/`catch` that returns a fresh copy.

**Out of scope**: `chrome.storage.sync` and `lib/settings.ts` - `DrawPrefs` is
not part of `Settings` and must not be added to it. No UI.

**Proof**
```bash
pnpm test tests/draw-prefs.test.ts
```

Cover `mergeDrawPrefs` only (it is the pure half): `null`, `undefined`, a
string and `{}` all give the defaults; an unknown `tool` or `symbol` falls back
to the default for that one field while the rest of a valid blob survives; a
`width` of `3` or `"4"` snaps to the nearest member of `DRAW_WIDTHS`; a
`fontSize` of `2` and of `500` clamp into 8..96; a negative or `NaN` `bar.x`
falls back; an empty-string `color` falls back. The returned object must never
alias its input.

**Depends on**: 01, 02
