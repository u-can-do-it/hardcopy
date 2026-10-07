# 28 - A text box remembers how wide you made it

**Goal**: `DrawPrefs.textWidth` persists the last width the editor's frame was
resized to, and a new box opens at it.

**Files**
- `lib/types.ts` (modify - `DrawPrefs.textWidth`)
- `lib/draw/prefs.ts` (modify - the default and the validator)
- `tests/draw-prefs.test.ts` (modify)
- `entrypoints/annotate.ts` (modify - open at it, persist on resize)

**Contracts**: `contracts.md` §23, verbatim.

**Width only, and not the height**, and that is the whole design decision: the
height is derived on every keystroke - `layoutText` grows it to fit - so a
stored height would be a number describing how much text was in some previous
label. You size a box once for a page and then keep typing into boxes that size,
and the thing you sized is the width.

`num(r.textWidth, d.textWidth, MIN_TEXT_WIDTH_PX, 2000)` - **clamped**, like
`fontSize` and unlike `bar`. A stored 4 is a width that got out of range, and 40
is the nearest thing we will draw. `mergeDrawPrefs` fills it in for every blob
written before this pass, which is what that function is for, so there is no
migration.

In `entrypoints/annotate.ts`: `openEditor` uses `pen.textWidth` where task 23
used `DEFAULT_TEXT_WIDTH_PX`, and a **resize** (not a move) ends by calling
`persist({ textWidth: editor.rect.width })`. `persist` is already the chained,
never-rejecting write - use it, do not call `saveDrawPrefs` directly, and do not
persist per `pointermove`: once, on the `pointerup` that ends the resize.

**Out of scope**: the bar (no control for this - it is a consequence of a drag,
not a button), `stores/`, the options page, any other pref.

**Proof**
```bash
pnpm test tests/draw-prefs.test.ts
```

Cover, at least:
- `DEFAULT_DRAW_PREFS.textWidth === DEFAULT_TEXT_WIDTH_PX`.
- a blob with **no** `textWidth` (every blob written before this pass) comes
  back with the default - the migration test.
- `textWidth` of `4`, `"240"`, `NaN`, `Infinity`, `null` and `-1` all come back
  as the default or the clamp, never as themselves.
- `textWidth: 9999` clamps to 2000; `textWidth: 320` round-trips.
- `mergeDrawPrefs` still does not alias its input - the existing assertion.

**Manual check**

1. Open a text box, drag it much wider, press `Esc`.
2. Click elsewhere with T: the new box opens at the width you dragged.
3. Reload the page, Draw, T, click: still that width.

**Depends on**: 23, 24
