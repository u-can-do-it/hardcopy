# DRAWING.md - mark the page up before you save it (proposal)

**Status:** proposal. Nothing here is implemented. Written against the tree at
`4399ad7`, and against PROJECT.md's rules (§3 architecture, §5 permissions,
§9 test matrix).

---

## 1. The shape of it

A **Draw** button in the popup puts two things on the page: a floating tool bar
and a transparent SVG layer over the document. You mark the page up - pencil,
line, box, arrow, label - and then export. The marks are in the PDF and in the
screenshot because they are *in the page*: real SVG in the real DOM, not a
separate compositing step bolted onto the capture.

That single fact is what makes this cheap. One implementation reaches all four
outputs the codebase already has:

| Output                                    | What carries the marks                    |
| ----------------------------------------- | ----------------------------------------- |
| Free `window.print()`                     | the SVG layer paginates with the content  |
| Pro `Page.printToPDF`                     | same, rendered with screen media          |
| Full-page PNG (`Page.captureScreenshot`)  | same                                      |
| Region PNG                                | whatever falls inside the rectangle       |

No new permissions. `activeTab` + `scripting` + `storage` are already declared
and already cover an injected script that draws in the tab you clicked on.
Nothing new appears on the install prompt - which, given Deviation 1 in the
README, matters more here than in most projects.

And the marks pass the project's own test: SVG `<text>` prints as **real text**,
so a label you type is findable with Ctrl+F in the exported PDF (§9).

---

## 2. The bar

```
  ┌───────────────────────────────────────────────────────────────────────────┐
  │ ⠿ │  ✏  ╱  ▭  ◯ │ ➤ ▾ │ T │ ▁▃▅ ▾ │ ●●●●● │  ↩  ↪  ⌫ │ ⤓ ▾ │ ✕ │
  └───────────────────────────────────────────────────────────────────────────┘
    │     └ pencil, line, rect, ellipse    │      │        │      │      └ exit
    │                    └ symbols ▾       │      │        │      └ save ▾
    └ drag grip                            │      │        └ undo / redo / clear
                              text ────────┘      └ width ▾ and colour
```

`position: fixed`, dragged by the grip, clamped to the viewport on drag and on
window resize, last position remembered in `storage.local` (one position for
every site, not per page). Lives in its **own** shadow host, separate from the
layer, so it can be hidden for the duration of a capture without touching the
drawing.

### From your sketch, as specified

- **grip** - drag the bar anywhere; it is screen-anchored, so it stays put while
  the page scrolls under it.
- **pencil** - freehand. See §4 for the one library worth adding.
- **line** - straight; Shift snaps to 15°.
- **rectangle** - drag to size; Shift constrains to a square.
- **symbols ▾** - a small palette placed by click or click-drag-to-size: arrow
  (the one everybody actually wants), double-headed arrow, check, cross,
  exclamation, star, and a **numbered pin** that auto-increments 1, 2, 3… The
  pins are the feature that makes a review screenshot readable.
- **width** - three steps (2 / 4 / 8 px) rather than a slider. A slider is a
  fiddly thing to hit on a bar that is floating over someone's page, and nobody
  has ever needed 5px specifically.
- **text** - see the one deviation below.

### Additions I would not ship without

- **colour** - five swatches (red, amber, green, blue, near-black) plus the
  system colour input behind a long-press. Without it, every mark is one colour
  and the arrow pointing at the error looks like the arrow pointing at the fix.
- **undo / redo** - `Ctrl+Z` / `Ctrl+Shift+Z` and buttons. Freehand drawing
  without undo is not a feature, it is a dare.
- **clear** and **✕ / Esc** - clear wipes the marks and keeps the mode; ✕ leaves
  annotate mode and restores the page (§3).
- **ellipse** - one more shape for the cost of two lines of geometry; circling a
  thing is the second most common annotation after the arrow.
- **highlighter** - the pencil with a fat width and `mix-blend-mode: multiply`.
  Roughly free, and it is what people reach for on a page of text.
- **save ▾** - PDF / PNG straight from the bar. Reopening the popup after
  drawing works, but it re-runs the whole preparation pass (§3), and the bar is
  where your hand already is.

### The one deviation from your sketch

You put a **text field on the bar**. I would instead have the text tool place a
caret **on the page**: pick T, click where the label goes, type in place, click
away or press Esc to commit. Same number of interactions, and you see the label
at the size, colour and position it will print at instead of typing it blind in
a bar and finding out afterwards. The bar keeps a font-size control where the
field would have been.

---

## 3. How the marks survive the export

This is the part that decides whether the feature is good or embarrassing.

**The layer is absolutely positioned in document coordinates**, inside a
wrapper sized to exactly `scrollWidth × scrollHeight` with `overflow: hidden`
and `pointer-events: none`. Two reasons, both load-bearing:

1. Chrome repaints `position: fixed` elements on *every* printed sheet - that is
   why `lib/dom/hide-fixed.ts` exists. A fixed annotation layer would stamp your
   arrow onto all 14 pages.
2. The wrapper clips, so a stroke dragged past the bottom edge cannot grow
   `scrollHeight` and quietly change the paper size the one-click path
   measures.

**Drawing happens on a prepared page.** Entering annotate mode runs the normal
pre-processing first (`PAGE_PREPARE` with `print: false`), so `<details>` are
open, lazy images are in, and the sticky furniture is gone *before* the first
stroke. Then what you draw on is what gets exported, pixel for pixel. Draw
first and prepare afterwards and every mark below an expanded section drifts by
however tall that section turned out to be. The page visibly rearranging when
you press Draw is not a side effect to apologise for - it is a free preview of
the export, and it is the reason the arrow lands where you put it.

Consequences to wire in:

- annotate mode **holds** the prepared state; the export path must reuse it
  rather than `restore()` + re-prepare (which `entrypoints/prepare.ts` does
  today at the top of every `PAGE_PREPARE`).
- leaving annotate mode restores the page, exactly like `PAGE_RESTORE` does now.

**The bar is hidden for the capture and restored after.** It is fixed, so
leaving it in would repeat it on every sheet, and it is not part of anyone's
document. Note that it will *not* be hidden for us by `hideFixedElements`: that
walk is `document.querySelectorAll("body *")`, and both hosts hang off
`documentElement`, outside `body` and behind a closed shadow root.

**The layer's CSS is injected unconditionally**, not as `media="print"`
(`injectUnconditionalCss` already exists for exactly this): a `media="print"`
sheet never matches while the one-click path emulates screen media. It also
sets `print-color-adjust: exact` on itself regardless of the `exactColors`
setting, so a user who turned that off does not get washed-out marks, and it
defends against sites whose print stylesheet says `* { display: none }`.

**Scrolling while drawing must work.** Unlike `entrypoints/select-area.ts`,
which blocks the wheel mid-drag, the capture surface converts each pointer
event to document space with the *current* `scrollX/scrollY`, so a stroke can
run past the fold. Auto-scroll at the viewport edge is phase 3.

---

## 4. Libraries

**Add one: `perfect-freehand`** (MIT, 1.2.3). Measured from the published
tarball: `dist/esm/index.mjs` is **4,532 bytes raw, 2,074 gzipped**, zero
dependencies. It turns a list of pointer samples into a variable-width outline
polygon, honouring pen pressure and velocity, and it is the entire difference
between "a wobbly 3px stroke" and "a pen". It returns points; we turn them into
one `<path d="…">`. Nothing else in it touches the DOM.

**Everything else is hand-rolled DOM**, matching `entrypoints/select-area.ts`:
vanilla TS, a CSS string, a closed shadow root. Icons are inline SVG paths
lifted from lucide (ISC), which is already a dependency - but `lucide-react`
itself stays out of the injected script; a content script is not the place for
Preact + Tailwind + Radix.

**Rejected, with reasons:**

- **fabric.js / Konva** (~100-300kB) - both are canvas scene graphs. Canvas
  means the marks arrive in the PDF as a bitmap, which is precisely the thing
  this product exists not to do. They would also duplicate a hit-test and a
  transform stack we need about 80 lines of.
- **tldraw** - an application, not a library. Bigger than the extension.
- **rough.js** - lovely sketchy rendering, ~9kB, solves a problem nobody has
  here. Revisit if "hand-drawn look" is ever wanted.
- **svg.js / snap.svg** - a nicer way to type `createElementNS`. Not worth a
  dependency in a script that must stay small and injectable.

Net bundle cost of the whole feature: perfect-freehand plus roughly 10-14kB of
our own code, in a script that is injected on demand and never loaded by
someone who does not press Draw.

---

## 5. Where the code goes

```
entrypoints/annotate.ts     unlisted script: bar + layer + pointer handling,
                            same injection story as prepare.ts and select-area.ts
lib/draw/model.ts           Shape union (stroke | line | rect | ellipse |
                            symbol | text), plain JSON, no DOM
lib/draw/geometry.ts        arrowheads, shift-snap, hit-test, clamp-to-viewport
lib/draw/stroke.ts          perfect-freehand -> path `d`
lib/draw/render.ts          Shape -> SVGElement (pure; the DOM-free half is
                            the string it produces)
lib/draw/history.ts         undo/redo stack over the shape list
lib/draw/css.ts             the bar's stylesheet, as a string
```

New messages in `lib/messages.ts`, following the existing naming:

- `PAGE_ANNOTATE_START` / `PAGE_ANNOTATE_STOP`
- `PAGE_ANNOTATE_UI { visible }` - background hides the bar around a capture
- and a flag on the export request so the background skips re-preparing a page
  that annotate mode already prepared.

Tests go where the project already puts them: the pure halves (`geometry`,
`stroke`, `history`, `model` validation) under `tests/` with Vitest; the rest is
a new row in the §9 manual matrix - *annotate a page, export, Ctrl+F the label
text*. If the label is not found, the feature is broken, same rule as the page.

---

## 6. Traps, found while reading the code

1. **A black "redact" box does not redact.** Drawing an opaque rectangle over a
   password in a PDF hides it from the eye and leaves the text underneath
   perfectly selectable. If a cover/redact tool ships, it must either be named
   honestly ("cover") or rasterise the region it covers. This is the one item
   here that could hurt a user.
2. **Two overlays, one pointer.** Region screenshot and annotate mode both want
   the pointer. Entering the area selector must suspend annotate's capture
   surface and hide the bar, then hand it back.
3. **Marks are lost on reload or navigation**, along with the `activeTab` grant
   itself. Acceptable for v1; say so plainly rather than pretending otherwise.
   Phase 3 can mirror the shape list into `storage.session` keyed by tab and URL.
4. **Annotations defeat the painted-height trim** where they land: a stroke in
   the blank tail of a page keeps that tail alive, because it genuinely paints
   there. Correct behaviour, surprising the first time.
5. **Fixed page furniture that survives hiding** (anything under the 20% text
   guard, or under `stickyMinHeight`) sits at a different place on paper than on
   screen. Marks anchored to it will look misplaced. Nothing to do about it
   beyond knowing why.
6. **Cross-origin iframes** can be drawn *over* but not *into*. Fine - the layer
   is above them and the capture is of the composited page.
7. **Scroll containers**: an annotation is anchored to the document, not to the
   inner scroller, so scrolling a widget moves content out from under its mark.
   `unlockScrollContainers` already un-clips most of them before you draw, which
   removes most of the problem.

---

## 7. Phasing

**Phase 1 - the tool.** Bar shell (drag, position memory, hide-for-capture),
layer in document coordinates, pencil + line + rect, width, colour, undo/redo,
clear, prepared-page entry and restore on exit, export from the bar. This is
the demoable half and is worth about one evening plus a debugging session.

**Phase 2 - the vocabulary.** Symbols dropdown with arrows and numbered pins,
text tool with in-place editing, ellipse, highlighter. Half a day; it is mostly
`render.ts` and a palette.

**Phase 3 - the polish.** Select / move / delete an existing mark, edge
auto-scroll while drawing, `storage.session` survival across reload, marks
anchored to a DOM element instead of to a coordinate (survives a re-layout, and
is the only honest way to allow drawing *before* preparation).

---

## 8. The one decision that is not mine

**Free, or Pro?**

I would ship it **free**. It costs no CDP, no permission and no service-worker
work; it is the most screenshot-able thing the extension could have; and Pro's
pillars (one-click, screen look, single long page) are untouched by it.
An annotation tool in the free tier is an install argument, and this product's
whole positioning is "the one that doesn't count your exports".

The alternative - free pencil/line/rect, Pro for symbols, text and pins - is
defensible and would take one `isPro()` call at `PAGE_ANNOTATE_START`. It is
also the kind of split that makes a $5 tool feel mean. Your call; everything
else in this document is the same either way.

> **Answered, twice.** It shipped with the split above - five free tools,
> symbols and labels Pro - and then the tiers turned around: Draw mode is now
> the Pro feature, all of it, and everything else is free. README Deviations
> 15 and 24.
