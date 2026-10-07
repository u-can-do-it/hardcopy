# 18 - Word wrap and auto-grow, as pure logic

**Goal**: `lib/draw/wrap.ts` turns a label and a box into a list of lines and a
box tall enough to hold them, with the measuring injected.

**Files**
- `lib/draw/wrap.ts` (create)
- `tests/draw-wrap.test.ts` (create)

**Contracts**: `contracts.md` §18, verbatim - `TEXT_LINE_HEIGHT`, `Measure`,
`TextLayout`, `wrapLines`, `layoutText`, `createTextMeasure`.

This is a **leaf**. It imports types only from `./model`, plus
`LABEL_FONT_FAMILY` from `./css` inside `createTextMeasure` and nowhere else.
Nothing imports it yet; tasks 21, 22 and 23 do.

**The one thing that makes this testable**: `measure` is a parameter, not a
call. Every test in this suite passes a fake - half an em per code unit is
enough - so the whole of the wrapping is checked with no font, no canvas and no
document. `createTextMeasure()` is the only function here that touches a
document, and it is the one thing in the file a unit test cannot reach.

**Out of scope**: the shape model (task 20), rendering (21), the box the layer
measures (22), the editor (23). Do not touch `lib/draw/model.ts`.

**Proof**
```bash
pnpm test tests/draw-wrap.test.ts
```

Cover, at least:
- a run of words wraps greedily at `maxWidth`; no word is ever split by a soft
  wrap.
- a single word wider than `maxWidth` **is** split, between characters, and
  every resulting line fits.
- `\n` always breaks, wherever it falls; `"a\n\nb"` is three lines, the middle
  one empty.
- `wrapLines("", …)` is `[""]`, never `[]`.
- `maxWidth` of `0`, `-5`, `NaN` and `Infinity` all mean no soft wrapping - and
  the call **returns**, which is the assertion that matters (a wrap loop that
  makes no progress hangs the test runner, so give this suite a timeout).
- a trailing space at a soft break is not in the line it broke.
- `layoutText` never changes `rect.width`, `rect.x` or `rect.y`.
- `layoutText` grows `rect.height` to `lines.length * fontSize *
  TEXT_LINE_HEIGHT` when the text needs more, and **leaves a taller box
  alone** - the reason a box dragged tall stays tall.

**Depends on**: none
