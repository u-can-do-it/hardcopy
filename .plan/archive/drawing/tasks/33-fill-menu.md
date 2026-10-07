# 33 - One fill menu, and the two filled tools go away

**Goal**: a single menu on the bar arms the fill for both the rectangle and the
ellipse, and `rect-fill` / `ellipse-fill` stop being tools.

**Files**
- `lib/types.ts` (§24.2 - `DrawTool` back to seven)
- `lib/draw/model.ts` (`DRAW_FREE_TOOLS`, `DRAW_TOOL_FREEHAND` lose both)
- `lib/draw/bar.ts` (§27.1, §27.2 - the `fill` group, `BarId`, `BarState`,
  `parseBarId`, `isSelected`; `ICON_RECT_FILL` / `ICON_ELLIPSE_FILL` deleted)
- `entrypoints/annotate.ts` (`case "fill"`, `dragShape` reads `pen.fill`,
  `isFilledTool` **deleted**, `FILL_NOTE` becomes the cover's - §27.3)
- `tests/draw-bar.test.ts`, `tests/draw-model.test.ts`

**Over the five-file guide**, for the mirror of task 27's reason: *removing* a
`DrawTool` member is the same compile-time cross-cut over the same three
exhaustive tables, and they have to move together or nothing builds.

**Contracts**: `contracts.md` §24.2, §27.1, §27.2, §27.3 - verbatim, including
the three labels. `"Cover - removes text"` says what it does and claims nothing
more; never "redact", never "black out".

**This task deletes what task 27 built**, deliberately and on the user's
instruction: two tools become one menu with three options. What survives is the
`"tint"` rendering (task 31) and the note-at-session-start mechanism, which
`"cover"` now needs for the same reason `"tint"` did - the pen persists, so
somebody who left the bar armed on a cover must be told again what it does.

`POPOVER_GROUPS.fill` is `"own-trigger"`: the shape tools must stay one press
away, so the menu cannot hijack one of their buttons. The trigger shows the
armed mode the way the font-size trigger shows the size. All three buttons are
**free** - the tier split stays exactly symbols and text labels.

`isFilledTool` is **deleted, not moved**. There is no filled tool any more, so
the predicate the task 27 review flagged for living in an entrypoint stops
existing - which also retires `BACKLOG.md`'s `DRAW_TOOL_FILLED` item (task 37
strikes it).

`case "fill"` sets `s.pen.fill`, persists it, and calls `showLive()`, because it
is a pen setting and behaves like the width and the colour: it restyles a live
drag and an open editor rather than committing anything.

**Out of scope**: `lib/draw/css.ts` - the popover and trigger vocabulary
already exists for the text group; if the menu cannot be built without a CSS
change, STOP and report it. `coverRects` (34), any DOM (35), the brackets (36).

**Proof**
```bash
pnpm test tests/draw-bar.test.ts
```

Cover, at least:
- the `fill` group has exactly three buttons, with the three labels verbatim.
- no button label anywhere on the bar contains "redact" or "black out", and
  `"Cover - removes text"` contains "removes text".
- `parseBarId("fill:cover")` -> `{ kind: "fill", fill: "cover" }`;
  `fill:solid`, `fill:`, `fill:COVER` are all `null`.
- `barGroups(toolsFor(false))` locks **only** the seven symbol buttons and the
  text button - all three fill buttons unlocked. This is the assertion that
  catches the tier split drifting, and it must not weaken now the ids changed.
- `tool:rect-fill` and `tool:ellipse-fill` no longer parse and no longer have
  buttons.
- `TOOL_GROUP` is back to the five, in order; `isSelected` lights the armed
  mode and nothing else.
- ids are still unique across the whole bar.

**Manual check** (the mount half is not unit-testable - `tests/` is plain
vitest on `environment: "node"`, which `CLAUDE.md` asks stay that way):

1. Draw, open the fill menu: three options, the armed one lit, the trigger
   showing it.
2. Arm **Filled - read-through**, drag a rect over a paragraph: translucent,
   text readable through it. Arm **Not filled**, drag another: outline only.
3. Arm **Cover - removes text**: the note line says the cover sentence,
   including the embedded-frame limit. Drag a rect: a solid block.
4. Exit, reload, Draw again: the menu comes back armed on Cover, and the note
   line says the sentence again without a press.
5. Arm the ellipse and check all three modes work on it from the same menu.
6. At this point a cover is only a solid block - it does **not** yet remove
   text, and Ctrl+F still finds what is under it. That is task 36.

**Depends on**: 31, 32

---

## Found by task 31's review, and this task must handle it

`lib/draw/bar.ts` (around the `PRO_NOTE` / label region) still says the labels
are "never 'cover', never 'redact'", citing `.plan/design.md` §11.1. That was
true of the bar task 27 built. §18 now names a menu option **"Cover - removes
text"**, so the sentence has to be rewritten rather than left standing over a
button that contradicts it. Keep the "never redact, never black out" half - it
is still the rule - and say what changed and why the word "cover" is now
allowed: the mark genuinely removes the covered characters from the export.
