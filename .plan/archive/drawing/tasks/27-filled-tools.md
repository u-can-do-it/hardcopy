# 27 - Filled rectangle and filled ellipse, on the bar

**Goal**: two new tools place a filled rect and a filled ellipse, and the bar
says what they are honestly.

**Files**
- `lib/types.ts` (modify - `DrawTool` gains `"rect-fill"` and `"ellipse-fill"`)
- `lib/draw/model.ts` (modify - `DRAW_FREE_TOOLS`, `DRAW_TOOL_FREEHAND`)
- `lib/draw/bar.ts` (modify - `TOOL_ICONS`, `TOOL_GROUP`, two lucide icons)
- `entrypoints/annotate.ts` (modify - two `dragShape` cases, `FILL_NOTE`)
- `tests/draw-bar.test.ts`, `tests/draw-model.test.ts` (modify)

**Over the five-file guide, and for a stated reason:** adding a member to
`DrawTool` is a compile-time cross-cut over three deliberately exhaustive
tables - `DRAW_TOOL_FREEHAND` (model.ts), `TOOL_ICONS` (bar.ts) and
`dragShape`'s `switch` (annotate.ts). They are exhaustive precisely so a new
tool cannot arrive without someone answering all three questions, so they land
together or not at all. Each edit is two lines.

**Contracts**: `contracts.md` §19.4, verbatim - including that **both tools are
free**. The tier split is exactly symbols and text labels (`PRO_NOTE`); a
filled box is not a Pro capability, and `DRAW_FREE_TOOLS` must gain both or a
free user has two dead buttons.

**Labels are part of the contract**, not decoration: `"Filled rectangle"` and
`"Filled ellipse"`. Never "cover", never "redact", never "black out"
(`.plan/design.md` §11.1).

`TOOL_GROUP` becomes
`["pencil", "highlighter", "line", "rect", "rect-fill", "ellipse",
"ellipse-fill"]` - each filled tool beside the outline it fills, the way the
highlighter sits beside the pencil because it *is* the pencil.

Icons: lucide `square` and `circle` filled rather than stroked. `BAR_CSS`
strokes `.icon path` and does not fill it, so a filled variant needs either a
second path attribute or a distinguishing mark - a solid inner square/circle
inside the outline reads correctly at 16px and needs no CSS change. **Do not
edit `lib/draw/css.ts`**; if you cannot do it without, stop and report it.

`dragShape`'s two new cases are the existing `rect` / `ellipse` cases with
`fill: true` - the same `normalizeRect` and the same Shift constraint. Read the
note on `normalizeRect` before copying anything from the `symbol` case.

**`FILL_NOTE`**, shown in the bar's note line on the **first** press of either
filled tool in a session and not again:

> A filled shape covers text on screen. The text underneath is still in the
> PDF and still searchable.

One sentence, once, in the channel the bar already has. It is the honest half of
shipping this tool at all.

**Out of scope**: `lib/draw/render.ts` (task 26 did it), `lib/draw/layer.ts`,
`lib/draw/prefs.ts` (`tool()` validates against `DRAW_ALL_TOOLS` and needs no
change - check that it really does), `lib/draw/css.ts`.

**Proof**
```bash
pnpm test tests/draw-bar.test.ts
```

Cover, at least:
- both new tools have a button in the `tools` group, and `TOOL_GROUP`'s order
  is the one above.
- `barGroups(toolsFor(false))` locks **only** the symbol buttons and the text
  button - both filled tools are unlocked. This is the assertion that catches
  the tier split drifting.
- button ids are still unique across the whole bar.
- `parseBarId("tool:rect-fill")` round-trips to `{ kind: "tool", tool:
  "rect-fill" }`.
- in `tests/draw-model.test.ts`: `isFreehand` is `false` for both, and the
  pinned freehand set is unchanged; both are in `DRAW_FREE_TOOLS` and in
  `DRAW_ALL_TOOLS`.

**Manual check**

1. Draw, pick Filled rectangle, drag over a chart: a translucent block with a
   solid outline. The text and lines underneath are **readable through it**.
2. The note line says the `FILL_NOTE` sentence, once. Pick another tool and come
   back to it: it does not say it again.
3. Pick Filled ellipse, Shift-drag: a filled circle.
4. Export the PDF, and Ctrl+F a word **underneath** a filled block: it is
   found. That is the hazard, working exactly as documented.
5. Hover the buttons: the tooltips say "Filled rectangle" and "Filled ellipse".

**Depends on**: 26
