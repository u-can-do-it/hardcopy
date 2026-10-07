# DRAWING - design

Plan for `docs/features/DRAWING.md`, **phases 1 and 2**. Phase 3 goes to
`BACKLOG.md` (task 18). Written against the tree at `4399ad7` plus the
uncommitted `CLAUDE.md` / `docs/features/`.

Read `.plan/contracts.md` for the exact seams. Workers code against that file.

---

## 1. The one fact the design rests on

The marks are **real SVG in the real DOM**, not a compositing step bolted onto
the capture. One implementation therefore reaches all four outputs that already
exist, and none of them needs to know the feature is there:

| Output                                   | What carries the marks                   |
| ---------------------------------------- | ---------------------------------------- |
| Free `window.print()`                    | the SVG layer paginates with the content |
| Pro `Page.printToPDF`                    | same, rendered with screen media         |
| Full-page PNG (`Page.captureScreenshot`) | same                                     |
| Region PNG                               | whatever falls inside the rectangle      |

Nothing in `lib/capture/`, `lib/pdf/` or `lib/cdp/` changes. The export paths
change only in *when they prepare and restore the page* (§4).

**This is also the feature's one unproven claim**: that Chrome vectorises SVG
`<text>` into searchable text in both print paths. Everything in phase 2 rests
on it. **Task 01 carries a two-minute manual probe for it** - append one
`<text>` node from the console, export, Ctrl+F - so it is answered before a
line of code is written, not after phase 2 is built on top of it. Per
`CLAUDE.md`, no unit test can answer this and neither can a headless render.

## 2. Permissions: nothing new

`activeTab` + `scripting` + `storage` already cover an injected script that
draws in the tab the user clicked on. `host_permissions` stays `[]`,
`optional_permissions` stays `["tabs", "bookmarks"]`, and the install prompt
does not change - which matters more here than in most projects, per README
Deviation 1.

The annotate script is **injected, never declared**, for the same reason as
`entrypoints/prepare.ts` and `entrypoints/select-area.ts` (README Deviation 3).
A declared content script needs `matches`, and `<all_urls>` would put "read and
change all your data on all websites" on the prompt.

`wxt.config.ts` is not touched, and **`manifest.json` does not change at
all** - not even a `web_accessible_resources` entry. An earlier draft of this
section said it gained one; that was wrong, and it is wrong for `prepare.js`
and `select-area.js` too. `chrome.scripting.executeScript({ files })` under
`activeTab` does not need the file declared, and WXT 0.20 does not declare it.

## 3. The free path stays free of `debugger`

Drawing needs no CDP at all: the pencil is pointer events and an SVG element.
The `CLAUDE.md` invariant holds without effort - the only `debugger` use in the
whole feature is the one already there, reached when someone asks for a PNG or
a Pro PDF (README Deviation 13).

### Tier split

Decided: **free = the plain marks, Pro = the vocabulary.**

| Tier | Tools                                          |
| ---- | ---------------------------------------------- |
| Free | pencil, highlighter, line, rectangle, ellipse  |
| Pro  | symbols (arrow, double arrow, check, cross, exclamation, star, numbered pin), text labels |

Ellipse and highlighter sit on the free side because they are the same two
lines of geometry as rect and pencil; the split falls where DRAWING.md §8 put
it, between marking a page up and annotating it in words.

**How it is enforced, honestly.** The background calls `isPro()` at
`ANNOTATE start` and sends the page the tool set it may offer
(`toolsFor(pro)`); the bar renders the rest locked and never computes
entitlement itself. That is the same shape as the `effectivePageMode` fix in
BACKLOG ("storage records the wish, the one switch decides") - but it is **not
the same strength**. A page mode is re-resolved at export time, so a lapsed key
degrades the export. A mark is already in the DOM by the time anything exports,
and the only way to gate it at export time would be to strip shapes out of the
layer before capture - i.e. to make a user's labels silently vanish from their
PDF. We are not doing that. So:

> The drawing tier gate is a UI gate. It follows `isPro()` on every entry into
> annotate mode, and it can be defeated by anyone willing to open devtools on
> their own page. At $5 with no counter anywhere (PROJECT.md §6.3), that is the
> right trade; it is written down rather than assumed.

So the gate is exactly one thing and no more: **a locked tool button is
`disabled`, carries a `title` that says it is a Pro feature, and on click puts
that same sentence in the bar's note line.** Nothing is re-checked before
printing. No modal, no new tab, no post-export nag (§6.3) - the popup's
existing `ProDialog` is Preact and cannot be reached from a shadow-root
vanilla-TS bar, and `CHECKOUT_URL` is `""` today anyway.

## 4. The part that decides whether this is good or embarrassing

### 4.1 The layer is in document coordinates, and clips

A wrapper sized to exactly `scrollWidth x scrollHeight`, `position: absolute`
at the document origin, `overflow: clip`, `pointer-events` toggled. Two
load-bearing reasons:

1. Chrome repaints `position: fixed` elements on **every** printed sheet - that
   is why `lib/dom/hide-fixed.ts` exists. A fixed annotation layer would stamp
   one arrow onto all 14 pages.
2. The wrapper clips, so a stroke dragged past the bottom edge cannot grow
   `scrollHeight` and quietly change the paper size `planPageFromDocument()`
   and `session.getStableContentSize()` measure.

`clip` rather than `hidden` for that second reason: `hidden` clips the same and
holds scrollable overflow back from the ancestors the same, but it also makes
the wrapper a **scroll container**, which the older CSS fragmentation rules call
monolithic - so the wrapper itself could refuse to break across printed sheets,
the same class of bug as a document-sized `<svg>` one level down (`clip` is
Chrome 90+; `minimum_chrome_version` is 109).

`layerBoxStyle()` (lib/draw/layer.ts) is a pure string builder so both of those
properties are covered by an assertion in `tests/draw-layer.test.ts` rather
than by a comment.

**Anchoring is measured, not assumed.** `position: absolute` resolves against
the nearest positioned ancestor, and a page is free to put `position: relative`
plus a margin or border on `html`. So the host is appended, its own
`getBoundingClientRect()` is read once, and `anchorCorrection()` returns the
`left`/`top` that put it at document `(0, 0)` whatever the page did. One
forced reflow at mount, exact afterwards.

The host hangs off `documentElement`, outside `body` and behind a closed shadow
root. Note what that means for `hideFixedElements`: its walk is
`document.querySelectorAll("body *")`, so it will **not** hide either of our
hosts for us - and equally, a later pre-processing pass cannot accidentally
hide the layer.

### 4.2 Drawing happens on a prepared page

Entering annotate mode runs the normal pre-processing first (`PAGE_PREPARE`
with `print: false`), so `<details>` are open, lazy images are in and the
sticky furniture is gone *before* the first stroke. Draw first and prepare
afterwards and every mark below an expanded section drifts by however tall that
section turned out to be.

The page visibly rearranging when you press **Draw** is not a side effect to
apologise for; it is a free preview of the export, and it is why the arrow
lands where you put it.

Two consequences to wire in, and they are the whole of §5:

- annotate mode **holds** the prepared state, so an export from inside it must
  reuse that pass instead of `restore()` + re-prepare, which is what
  `entrypoints/prepare.ts` does today at the top of every `PAGE_PREPARE`;
- leaving annotate mode restores the page, exactly as `PAGE_RESTORE` does now.

`entrypoints/prepare.ts` stays the single owner of prepared state. Annotate
mode does not import `prepareForExport` itself: two scripts each holding their
own `Prepared` would double-prepend the header block, re-run the lazy scroll
and report a `PrepReport` that describes neither pass.

### 4.3 The bar is hidden for the capture, and so are its pointers

The bar is `position: fixed` and is not part of anyone's document, so it is
hidden around every capture (`PAGE_ANNOTATE_UI { visible: false }`) and put
back afterwards. The same message drops the layer's `pointer-events`, which is
the answer to DRAWING.md trap 2: the region selector and the drawing surface
both want the pointer, so entering the selector suspends the surface and hands
it back after.

The layer itself stays **visible** through a capture - the marks are the point.

### 4.4 The layer's CSS is unconditional

Injected with `injectUnconditionalCss()`, not as `media="print"`, because a
`media="print"` sheet never matches while the Pro path emulates screen media -
the lesson of README Deviation 11. It sets `print-color-adjust: exact` on
itself regardless of the `exactColors` setting, so a user who turned that off
does not get washed-out marks, and it forces `display: block` / `visibility:
visible` on its own subtree so a site whose print stylesheet says
`* { display: none }` cannot erase the annotations.

### 4.5 Scrolling while drawing works

Unlike `entrypoints/select-area.ts`, which blocks the wheel mid-drag, every
pointer event is converted to document space with the *current*
`scrollX/scrollY` (`toDocument()`), so a stroke can run past the fold. Edge
auto-scroll is phase 3.

## 5. Message flow

Three channels now, where `lib/messages.ts` documents two. The new one is the
injected script talking **to** the background - the bar's own save and exit
buttons - which is why `ANNOTATE_EXPORT` / `ANNOTATE_EXIT` join `BgRequest`
rather than `PageRequest`.

```
Entering:
  popup  --ANNOTATE {action:"start"}-->  background
                                          |- canInject(tab.url)
                                          |- isPro()  -> toolsFor(pro)
                                          |- inject prepare.js, annotate.js
                                          |- PAGE_PREPARE {print:false, hold:true} --> prepare.ts
                                          '- PAGE_ANNOTATE_START {prefs, tools}     --> annotate.ts
         <--AnnotateSuccess {active:true, report, tools}--

Saving from the bar (the hand is already there):
  annotate.ts hides its own bar, then
  annotate.ts --ANNOTATE_EXPORT {target}--> background
                                             '- the existing export or capture path, unchanged
                                                -> PAGE_PREPARE reaches a prepare.ts that is
                                                   *holding* a pass: it replies with the held
                                                   report, does not re-prepare, and ignores the
                                                   PAGE_RESTORE that follows
              <--ExportSuccess | CaptureSuccess | Failure--
  annotate.ts shows its bar again and puts the reply in the bar's note.

Leaving:
  annotate.ts --ANNOTATE_EXIT-->  background     (or popup --ANNOTATE {action:"stop"}-->)
                                    |- PAGE_ANNOTATE_STOP            --> annotate.ts (unmount)
                                    '- PAGE_RESTORE {release:true}   --> prepare.ts   (undo the pass)
```

### Kept separate on purpose

An earlier draft of this plan tracked the annotating tabs in
`chrome.storage.session`, put a `keepPrepared` flag on `ExportRequest` and
`CaptureRequest`, threaded it through all three export handlers, and added
`tabs.onRemoved` / `tabs.onUpdated` listeners to clear it. All of that is gone.
The feature is not big enough to earn a presence in every export path.

Instead the entire cross-cutting concern is **two optional fields on two page
messages that already exist**, and it lives inside the one module that is
already the single owner of prepared state:

- `PAGE_PREPARE { hold: true }` - annotate mode owns this pass.
- `PAGE_RESTORE { release: true }` - give it up.

`prepare.ts` reuses a held pass for any later `PAGE_PREPARE` and ignores a
`PAGE_RESTORE` without `release`. Three consequences worth having:

1. An export started from the **popup** while marks are up is correct for free.
   The popup does not know annotate mode exists, and does not have to.
2. There is no per-tab state anywhere, so there is nothing to get out of step
   and nothing to clear. Navigation takes the marks, the injected scripts and
   the `activeTab` grant with it - which is the right outcome and needs no code.
3. `handleExport`, `handleScreenExport` and `handleCapture` keep their bodies.
   The only line they gain is a stateless, best-effort `PAGE_ANNOTATE_UI` pair
   around a CDP capture, so the bar stays out of a screenshot started from the
   popup. `window.print()` needs not even that: the bar hides itself on
   `beforeprint` and comes back on `afterprint`.


## 6. Where the code goes

Following DRAWING.md §5, with three additions noted below.

```
entrypoints/annotate.ts     unlisted script: message listener + the pointer
                            state machine. Glue only, like select-area.ts.
lib/draw/model.ts           Shape union, tool tables, the tier split. Plain JSON, no DOM.
lib/draw/geometry.ts        shift-snap, square constraint, arrowheads, anchor
                            correction, clamp-to-viewport, client -> document
lib/draw/stroke.ts          perfect-freehand -> path `d`
lib/draw/render.ts          Shape -> NodeSpec (pure) + a 10-line DOM adapter
lib/draw/symbols.ts         symbol path geometry, kept out of render.ts        (added)
lib/draw/history.ts         undo/redo/clear over the shape list
lib/draw/css.ts             the layer's and the bar's stylesheets, as strings
lib/draw/layer.ts           mounts the document-coordinate SVG layer           (added)
lib/draw/bar.ts             builds the bar and its groups                      (added)
lib/draw/prefs.ts           bar position + last pen, storage.local             (added)
```

The additions exist so `CLAUDE.md`'s rule holds - **logic lives in `lib/`,
pure and unit-tested; entrypoints stay thin**. `layer.ts` and `bar.ts` are DOM
builders in the same spirit as `lib/dom/header.ts`, and each exports the pure
half that carries its test (`layerBoxStyle`, `barGroups`). `render.ts` splits
the same way, into `shapeToSpec` (pure, fully tested, no DOM) and
`specToElement` (`createElementNS` + `setAttribute` + `textContent`).

Nothing goes through `innerHTML`. A text label is `textContent` on a real
`<text>` node - which is both the safe way to handle a string the user typed
and the only way it comes out searchable.

## 7. Dependencies

**One added: `perfect-freehand`, pinned exactly to `1.2.3`** (MIT, zero
dependencies, 4,532 bytes raw / 2,074 gzipped per DRAWING.md §4). It turns
pointer samples into a variable-width outline polygon; we turn the polygon into
one `<path d="...">`. It never touches the DOM.

Pinned without a caret, matching `pdf-lib` and `lucide-react` in
`package.json`. `pnpm-workspace.yaml` is not touched - no vite or wxt
resolution is involved.

Everything else is hand-rolled DOM matching `entrypoints/select-area.ts`:
vanilla TS, a CSS string, a closed shadow root. Icons are inline SVG paths
lifted from lucide (ISC, already a dependency), but **`lucide-react` itself
stays out of the injected script** - a content script is not the place for
Preact, Tailwind and Radix.

Rejected, per DRAWING.md §4: fabric.js / Konva (canvas scene graphs - the marks
would arrive in the PDF as a bitmap, precisely what this product exists not to
do), tldraw (an application, bigger than the extension), rough.js (solves a
problem nobody has here), svg.js / snap.svg (a nicer way to type
`createElementNS`).

## 8. Deliberately not doing

- **All of phase 3**: select / move / delete an existing mark, edge auto-scroll
  while drawing, marks surviving reload via `storage.session`, and marks
  anchored to a DOM element instead of a coordinate. The last one is a change
  to the shape model, not a feature on top of it, and it is the only honest way
  to allow drawing *before* preparation - it deserves its own spec. Task 18
  writes all four to BACKLOG.md with these reasons.
- **A redact tool, under any name.** DRAWING.md trap 1 is the one item in the
  document that could hurt a user: an opaque black rectangle over a password
  hides it from the eye and leaves the text underneath perfectly selectable in
  the PDF. A "cover" rectangle is exactly what the rect tool already is, and we
  are not going to name anything in this UI after redaction. If it is ever
  wanted, it has to rasterise the region it covers.
- **Marks in `storage.sync`.** `DrawPrefs` is `storage.local` on purpose: a bar
  position is per-device, and a position synced from a 34-inch monitor onto a
  laptop is a bar off the edge of the screen. (It is clamped on load anyway -
  `clampToViewport` - but syncing it would still be wrong.)
- **Touching the capture or PDF pipeline.** No compositing, no second render
  pass, no changes to `lib/capture/`, `lib/pdf/`, `lib/cdp/`.
- **A text field on the bar.** Per DRAWING.md's own deviation, the text tool
  places a caret on the page: pick T, click where the label goes, type in
  place, Esc or click away to commit. Same number of interactions, and you see
  the label at the size, colour and position it will print at. The bar keeps a
  font-size control where the field would have been.

## 9. Known consequences, written down rather than discovered

1. **Marks are lost on reload or navigation**, along with the `activeTab` grant
   itself. Accepted for v1; `storage.session` survival is phase 3.
2. **Annotations defeat the painted-height trim where they land.** A stroke in
   the blank tail of a page keeps that tail alive, because it genuinely paints
   there (`lib/pdf/painted-height.ts` looks at pixels, not at the DOM). Correct
   behaviour, surprising the first time.
3. **Fixed furniture that survives hiding** - anything over the 20% text share
   guard (README Deviation 7) or under `stickyMinHeight` - sits somewhere else
   on paper than on screen, so marks anchored to it look misplaced. Nothing to
   do beyond knowing why.
4. **Cross-origin iframes** can be drawn over but not into. Fine: the layer is
   above them and the capture is of the composited page.
5. **Scroll containers.** A mark is anchored to the document, not to an inner
   scroller, so scrolling a widget moves content out from under its mark.
   `unlockScrollContainers` un-clips most of them before the first stroke,
   which removes most of the problem.
6. **Two `chrome.runtime.onMessage` listeners in one page.** `prepare.js`,
   `select-area.js` and now `annotate.js` all listen in the same document; each
   returns `false` for types it does not own, so the message sets must stay
   disjoint. They are (`PAGE_ANNOTATE_*` is ours). Worth knowing before adding
   a fourth.
7. **The held pass is prepared for the tier, so Pro sees the export's layout
   at Draw.** `handleAnnotate` sends `screenMedia: pro` on its holding
   `PAGE_PREPARE`, matching the `screenMedia: true` `handleScreenExport` sends
   on every Pro export. It has to be decided here rather than at export time:
   prepare.ts answers a held pass with the report it already has and never
   re-prepares, so a later `screenMedia: true` is ignored and the pass would
   lack `freezeViewportUnits()` and the unconditional `BREAK_RESET_CSS` -
   README Deviations 10 and 11 by a side door. The tier decides it because that
   is what decides the renderer: Pro renders through CDP with screen media
   emulated, free renders through `window.print()`, which emulates nothing.
   The visible consequence is that a Pro user with single-page mode on watches
   the page re-lay-out when they press **Draw** - that pair is exactly what
   triggers the viewport-unit freeze. Per §4.2 that is the free preview of the
   export, and it is why a mark below a `100vh` hero lands where they put it.
8. **No IME, so a text label cannot be typed in Chinese, Japanese, Korean or
   Vietnamese.** The caret reads `event.key` and there is no `contenteditable`
   anywhere (§8's deliberate choice, for the reasons given there), so no
   composition session can start: a CJK user gets the latin keystrokes their IME
   was meant to consume, or nothing. It follows from that choice rather than
   being a second decision, and it is the one consequence in this list that
   makes a tool unusable rather than surprising - a `<foreignObject>` with a
   real editable in it is the way out, and it is phase 3 at the earliest.
9. **The highlighter mitigates §8's fake-redaction trap; it does not close
   it.** `mix-blend-mode: multiply` never lightens, so four or five passes of
   the near-black marker over one line drive the background to near-black while
   the text underneath stays perfectly selectable in the PDF - trap 1 arriving
   by a different door than a rect tool. `HIGHLIGHT_OPACITY` (0.4, in
   `lib/draw/render.ts`) is what makes *one* pass a wash you can read through
   rather than a bar, which is the whole reason the constant exists; it cannot
   stop repeated passes, and restricting the palette would not either, since the
   bar carries a free colour input. Nothing in the UI is named after redaction
   and nothing rasterises - so a user who covers a password this way has hidden
   it from their own eye only, exactly as §8 says.

## 10. Test strategy

Per `CLAUDE.md`: the pure halves under `tests/`, flat, plain vitest, no DOM
harness. Ten new suites, one per `lib/draw/` module
(`tests/draw-<topic>.test.ts`). The DOM and Chrome-facing halves - the bar, the
layer mount, the pointer state machine - get `pnpm compile` plus explicit
**Manual check** steps in their task files, and one new row in the PROJECT.md
§9 matrix:

> annotate a page (pencil, rect, a label), export, **Ctrl+F the label text**.
> If the label is not found, the feature is broken - same rule as the page.

---

# DRAWING, second pass - design

Sections 11-16 are a **second spec pass** over the same feature, written
against the tree at `5d5c23b` (tasks 01-17 shipped and committed). Sections
1-10 above still describe the design; nothing in them is retracted. The four
things asked for:

1. the symbols palette stays up while the symbol tool is in use - and, more
   generally, nothing that happens **in the page** dismisses a bar panel;
2. a filled rectangle and a filled ellipse;
3. the text tool gets a real **box**: a draggable, resizable frame, word wrap
   inside it, and a height that grows when the text outgrows it.

Tasks are numbered from 18 so that the code comments pointing at
`.plan/tasks/12-…` and `.plan/tasks/16-…` keep pointing at the right file.

## 11. Where this contradicts what is already written down

Two places, and both are the same decision seen from different sides. Read
these before starting task 26.

### 11.1 A filled shape is the "cover tool" the first pass refused to ship

`.plan/tasks/16-phase2-tools.md` **Out of scope** says, in as many words: *"a
redact or cover tool, under any name (`design.md` §8 - an opaque box over a
password leaves the text underneath perfectly selectable, and that is the one
item in DRAWING.md that could hurt a user)"*. `lib/draw/render.ts`'s `rect`
case says the same thing on the line that sets `fill: "none"`, and
`docs/features/DRAWING.md` §6 trap 1 is where it started.

A filled rectangle **is** that box. The request is legitimate - a colour block
is how you point at a region of a chart, and circling a thing in a solid colour
is a normal annotation - so this pass ships it, and it ships it the way
DRAWING.md said it would have to be shipped: **named honestly, and visibly not
a redaction.**

- **`FILL_OPACITY = 0.35`** on the *fill only*, via SVG's `fill-opacity`, so the
  outline stays solid. The precedent is `HIGHLIGHT_OPACITY = 0.4`
  (`lib/draw/render.ts`), which exists for exactly this reason: at full alpha a
  near-black mark over a line of text is indistinguishable from a redaction.
  You can read through a 0.35 fill, which is what makes it obvious that it did
  not remove anything.
- The buttons are labelled **"Filled rectangle"** and **"Filled ellipse"**.
  Never "redact", never "cover", never "black out".
- The first press of either tool in a session puts `FILL_NOTE` in the bar's
  note line: *"A filled shape covers text on screen. The text underneath is
  still in the PDF and still searchable."* One sentence, once per session, in
  the channel the bar already has.

**Rejected: an opaque fill that rasterises what it covers.** That is the other
half of DRAWING.md's sentence and it is a genuinely different feature - it
needs a per-region raster, a way to drop the covered DOM out of the print, and
a name that promises something we would then have to be sure of. It is a
security claim, not a drawing tool. Written down in `BACKLOG.md` rather than
built here.

If the product decision is instead "opaque fill, and we accept the hazard",
that is one constant (`FILL_OPACITY = 1`) and one label change - but it is a
decision to take deliberately, not to arrive at by not thinking about it.

### 11.2 A draggable box is "select / move a mark", which is deferred

`BACKLOG.md` defers *"select / move / delete an existing mark"* to phase 3,
with the reason: *"selection needs hit-testing per kind, a handle set, and a
shape whose geometry can be edited after the fact - which is a second editor on
top of the first, not a button."*

That reason still stands, and this pass does **not** retract it. What ships here
is narrower on purpose: the frame belongs to the **open editor**, the label
being typed right now. It appears when the text tool places a box, it is
draggable and resizable while the box is open, and it is gone the moment the
label commits. A committed label is still write-then-undo, like every other
mark.

So there is no hit-testing over a `Shape[]`, no per-kind handle set and no
geometry editing after the fact - one box, the one under the hand. The parts
that phase 3 will want (`frameZoneAt`, `resizeFrame`, `frameHandles` in
`lib/draw/frame.ts`) are written to take any `DrawRect`, so they are reusable
rather than a down payment on the same work twice.

## 12. Nothing dismisses a bar panel except the bar

The reported symptom: open the symbols palette, place a mark, and the palette
is gone - so placing five arrows is five presses of the trigger. And a second
one from the same cause: with a panel open, click a **select or menu in the
page** and the panel closes, so a bar panel cannot survive using the page it is
floating over.

Both are one line, `onWindowPointerDown` in `lib/draw/bar.ts`:

```
const onWindowPointerDown = (event: PointerEvent): void => {
  if (openId === null) return;
  if (event.composedPath().includes(host)) return;
  setOpen(null);
};
```

Every press in the page closes the open panel, and the press that *starts a
stroke* is such a press - which is written down on that listener as the reason
it is `pointerdown` and not `click`. That was right for a menu you visit and
leave. It is wrong for a palette you are working out of.

**The new rule, and it is uniform:** a panel is opened and closed by the bar,
and by nothing else.

- its own trigger toggles it;
- a press **inside the open panel** keeps it open - that is the symbols fix, and
  it is the same for any panel;
- a press on **another** group's control closes it, because that panel is now in
  the way;
- a press on the bar's chrome (the grip, the note) changes nothing;
- **Esc** closes it, and only then falls through to what Esc already does;
- nothing in the page - a stroke, a `<select>`, a JS menu, a focus trap - closes
  anything.

`onWindowPointerDown` and `POPOVER_LISTENER` go away with it, which also
retires a capture-phase `window` listener from every page annotate mode is
running on.

The decision is a pure function, `popoverAfterPress` (contracts §20), so the
five bullets above are five assertions in `tests/draw-bar.test.ts` rather than
five branches inside a closure a unit test cannot reach. `mountBar` calls it and
does the DOM.

Two consequences, both accepted:

- **A panel can be up while a capture happens.** `setVisible(false)` no longer
  closes it - the whole bar host goes to `display: none`, panel included, so
  nothing of it reaches the output, and the bar comes back as it was left, which
  is what the existing comment on `setVisible` asks for and could not have. The
  `place()` call on the way back in still re-decides which side it hangs on.
- **A panel overlaps the page and eats presses in its own area.** It is inside
  the bar's fixed host, so that was already true of the bar; a permanently open
  panel makes the bar bigger. The grip is the answer, and it already exists.

### 12.1 What this does *not* fix

If the dropdown that disappears is the **extension popup** - the one with the
Draw button in it - that is Chrome closing a browser-action popup because focus
left it, and no extension can prevent it. Annotate mode is designed around
exactly that: everything you need while drawing is on the in-page bar, which is
why the bar has its own save buttons (task 15). Nothing in this pass changes it,
and nothing can.

## 13. The text tool gets a box

Today a label is a point: `TextShape.at`, one line, no wrapping, `Enter`
commits. `entrypoints/annotate.ts` says why - *"an SVG `<text>` node does not
wrap: a second line would need `<tspan>`s and a line height, which is a change
to `render.ts` and to the box `layer.ts` measures"*. This is that change.

### 13.1 The model: a label is a rect, and carries its own line breaks

`TextShape.at: Vec2` becomes **`rect: DrawRect`** - the same type every other
boxed kind already uses, and `at` was already the box's top-left in all but
name. Alongside it, **`lines: readonly string[]`**: the label as laid out, one
entry per rendered line.

`text` stays the source of truth (with `\n` for the breaks the user typed);
`lines` is a **layout cache**, and `lib/draw/wrap.ts` is its only producer. The
duplication is deliberate and unavoidable: wrapping needs advance widths,
advance widths need a font, and `lib/draw/render.ts` is pure and runs without a
document. So the measuring happens once, on the side of the seam that has a
document, and the answer travels on the shape.

### 13.2 Wrapping: pure logic, injected measurement

`lib/draw/wrap.ts` (contracts §18):

- `wrapLines(text, maxWidth, fontSize, measure)` - split on `\n` first, so a
  hard break is always honoured and a blank line survives; then greedy-wrap
  each segment; a single word wider than the box is broken between characters,
  so a long URL cannot run off the side. `maxWidth <= 0` or non-finite means no
  soft wrapping at all, which is what keeps a degenerate box from looping.
- `layoutText(text, rect, fontSize, measure)` - `wrapLines`, then
  `height = max(rect.height, lines.length * fontSize * TEXT_LINE_HEIGHT)`.
  **The width is never changed.** This is "if the text exceeds height,
  automatically make the text area higher", and it is one `Math.max`.
- `measure` is a parameter. Every test passes a fake (half an em per
  character), so the whole of the wrapping is unit-tested with no font and no
  DOM.
- `createTextMeasure()` is the real one, and the only thing in the file that
  touches a document: a cached 2D canvas context with
  `font = "<size>px " + LABEL_FONT_FAMILY`. The same split as
  `shapeToSpec` / `specToElement` in `render.ts`.

**Canvas `measureText` and not `getComputedTextLength`** on a live `<text>`:
`measureText` is synchronous and forces no layout, and it can be called for
every keystroke without the layer reflowing. It is an *approximation* of what
SVG will do - shaping, kerning across a run and bidi reordering can each move a
line a hair wider than the box it was fitted to. That is survivable and does not
need a fudge factor, because a mark's own `<svg>` is `overflow: visible`
(`lib/draw/layer.ts`): a line a pixel too wide paints, it does not clip. The
box only has to get right which *sheet* the label prints on.

`LABEL_FONT_FAMILY` is a system stack with no web font in it, so there is no
font-loading race to lose.

### 13.3 Rendering: one `<text>`, one `<tspan>` per line

`shapeToSpec`'s `text` case becomes a `<text>` at `rect.x`/`rect.y` with one
`<tspan>` child per entry in `lines`: `x` reset to `rect.x` on every tspan (or
each line inherits the previous one's advance) and `dy` of `0` on the first and
`fontSize * TEXT_LINE_HEIGHT` on the rest.

Still **real text**, which is the whole point and `CLAUDE.md`'s one check that
matters: `<tspan>` is text content, so Chrome embeds the face and Ctrl+F finds
the words in the exported PDF. Nothing goes through `innerHTML` - `specToElement`
already puts `NodeSpec.text` on `textContent`, and a spec with both `text` and
`children` applies the text first, so a `<text>` whose content is entirely in
its tspans simply omits its own.

**One caveat, and it goes in the README:** each `<tspan>` is its own text run, so
Ctrl+F for a phrase that **straddles a wrap** may not match. A word is never
split by a soft wrap, so single words always match. This is how every wrapped
text in every PDF behaves; it is written down because somebody will find it.

### 13.4 The box's own measurement gets simpler

`markBox`'s `text` case (`lib/draw/layer.ts`) is today the only one that is an
*estimate*: `TEXT_EM_ADVANCE = 1` em per character and `TEXT_EM_LINE = 1.5` em
of line box, both upper bounds, because nothing there could measure a font.

With a real `rect` on the shape it becomes `outwardBox(positiveBox(shape.rect),
MARK_PAD_PX)` - the same one line as `rect` and `ellipse`. Both `TEXT_EM_*`
constants and the paragraph explaining them go away. That is a bound retired,
not a bound loosened: the box is now what the text was actually fitted to, and
`overflow: visible` covers the pathological glyph that spills, exactly as it
covered it before.

### 13.5 The frame is chrome, and must never print

The editor's box is drawn as a dashed rectangle with eight handles. It is not a
mark: it is not in the history, it is not a `Shape`, and it must not appear in a
PDF or a screenshot.

- It lives in a **third container** in the layer's shadow root, after
  `committed` and `live` (contracts §19). Not in `live`, because `setLive` takes
  a `Shape` and the frame is not one.
- **It is cleared when the editor commits**, and every path that captures
  commits the editor first. All three already exist and are already documented
  in `entrypoints/annotate.ts`: `onBeforePrint` (which covers `window.print()`
  from anywhere, Ctrl+P included), `PAGE_ANNOTATE_UI { visible: false }` (the
  Pro CDP capture and the region selector), and `save()` from the bar.
- **And its visibility follows the layer's `interactive` flag**, which is the
  second, independent mechanism. `setInteractive(false)` is sent exactly when
  something else in the page wants the pointer or a capture is in flight, so the
  frame is `display: none` for the duration whatever else happened. Two
  mechanisms with separate causes, in the spirit of §4.3's three - what they must
  not do is share one boolean.

`@media print { display: none }` is **not** an option and never was: the Pro
path emulates screen media, so a print-media rule never matches (README
Deviation 11, design §4.4).

### 13.6 Placing, moving, resizing

**Placed by a click, not by a drag.** The text tool stays `Exclude<DrawTool,
"text">`'s exception - the one tool that does not start a `Drag` - so the
invariant that a drag and an editor are never both open holds unchanged. A click
puts a box `DrawPrefs.textWidth` wide (default 240) and one line tall at the
click, and the handles are how you size it. Drag-to-create is a `DragTool`
restructure for very little, and it is in `BACKLOG.md` instead.

**Moved and resized by its own drag**, which is a third pointer state -
`frameDrag` - beside `drag` and `editor`, not a fourth `Drag` tool:

```
pointerdown on the layer
  -> editor open, and frameZoneAt(editor.rect, at) !== null
       ? start a frameDrag (move or resize); the editor stays open
       : commitEditor(), then the tool's own business as today
```

That one branch is the whole of it, and it goes **before** the
`commitEditor()` that "click away to commit" relies on - which is exactly right:
a press on the frame is not a click away.

The geometry is `lib/draw/frame.ts` (contracts §21), pure and tested:
`frameHandles` (the eight handle rects), `frameZoneAt` (which zone a point is
in - corners beat edges, inside the rect is `"move"`, outside is `null`),
`moveFrame`, and `resizeFrame` (moves the named edges and clamps against
`MIN_TEXT_WIDTH_PX` / `MIN_TEXT_HEIGHT_PX` by pinning the opposite edge, so
dragging past the minimum stops instead of flipping the box inside out).

`frameHandles` has two readers - `frameZoneAt` for the hit test and
`frameSpec` for the DOM - which is the point of exporting it: the handle you
can see and the handle you can grab are the same rect, from one function.

**The dragged height is kept, and the rendered height is grown from it.**
`Editor.rect.height` is what the user asked for; `layoutText` returns
`max(that, content)`. So a box dragged tall stays tall after you delete a line,
and a box dragged short grows straight back to fit what is in it. Both are the
requested behaviour, and neither needs a second field.

### 13.7 `Enter` is now a newline

It commits today, and the comment says why: there was nowhere for a second line
to go. There is now. So:

| key            | before          | after                    |
| -------------- | --------------- | ------------------------ |
| `Enter`        | commit          | insert `\n`              |
| `Esc`          | commit          | commit (unchanged)       |
| click away     | commit          | commit (unchanged)       |
| `Ctrl/Cmd+Enter` | -             | commit                   |
| `Ctrl/Cmd+Z`   | delete a char   | delete a char (unchanged)|

`Esc` is still the primary commit and is what the §9 matrix already tells a
tester to press. `Ctrl+Enter` is added because `Enter` was the fast one and
somebody's hand will look for it.

`lib/draw/keys.ts` does not change: `Enter` is handled ahead of `isPrintable`,
and `dropLastChar` already deletes a `\n` like any other single code unit.

## 14. Message flow: unchanged

**No new messages, no changed payloads, no manifest change, no permission
change.** Everything in §§12-13 happens inside `entrypoints/annotate.ts` and
`lib/draw/`, between a pointer and an SVG element. The three
`PAGE_ANNOTATE_*` messages, `ANNOTATE_EXPORT`, `ANNOTATE_EXIT`, the `hold` /
`release` prepare seam and the background's handlers are all untouched, and
`contracts.md` §§1-2 and §§13-16 stand as written.

The one seam that grows is in-process: `BarHandle` gets `closePanels()`, so the
entrypoint's `Esc` handler can put a panel away before it reaches the drag or
the exit (contracts §20).

`chrome.storage.local` gains one key inside the existing `drawPrefs` blob:
`textWidth` (contracts §22). `mergeDrawPrefs` fills it in for every blob written
before this pass, which is what that function is for.

## 15. What this pass deliberately is not doing

- **Editing a committed mark.** Still phase 3, still for the reason in
  `BACKLOG.md`. The frame is the open editor's, and it goes when the label
  commits. §11.2.
- **An opaque, rasterising redact tool.** §11.1.
- **Drag-to-create a text box.** A click places one and the handles size it.
- **Rotating a mark.** Eight handles, no rotation handle. Nobody asked, and a
  rotated `<text>` is a transform on the box the printer paginates against.
- **Rich text.** One colour, one size, one face per label. A `<tspan>` per
  *line*, not per run.
- **IME.** Still no composition support, and a text box makes it no better and
  no worse. It is the one accepted consequence in `BACKLOG.md` that makes a tool
  unusable rather than surprising, and `<foreignObject>` is still the way out and
  still not this pass.
- **Justification or right-to-left alignment.** Left-aligned, `text-anchor`
  untouched. A label typed in Arabic renders with Chrome's own bidi in each
  tspan, which is right for the line and does not make the *wrap* right.
- **Re-wrapping a committed label** when the fontSize or the colour buttons are
  pressed after it committed. Those restyle the *open* editor, as they do today,
  and a committed label is fixed.

## 16. Known consequences, written down rather than discovered

1. **Ctrl+F across a soft wrap may not match.** §13.3. Single words always do.
2. **The wrap is measured with canvas metrics and painted with SVG shaping**, so
   a line can sit a pixel or two past the box. It paints (`overflow: visible`);
   it does not clip. §13.2.
3. **A permanently open panel is more bar.** §12. The grip moves it.
4. **A filled shape hides text on screen and not in the PDF.** §11.1. This is
   the one item in the pass that could mislead a user, which is why it has an
   opacity, a label and a note line.
5. **The frame is in the layer, and the layer stays visible through a print.**
   Two independent mechanisms clear it (§13.5). If a dashed rectangle ever turns
   up in an exported PDF, that is the bug to look for, and the test for it is the
   §9 matrix row task 29 adds.
6. **A box dragged narrower than one word** wraps that word character by
   character. Ugly, deliberate, and better than a word running off the side of
   the page. `MIN_TEXT_WIDTH_PX` keeps it from getting silly.

---

# DRAWING, third pass - the cover that actually covers

Sections 17-22 are a **third spec pass**, written against `c02ccc9` (tasks
18-29 shipped). Sections 1-16 stand; §11.1 is the one this pass overturns, and
it is overturned **on the user's instruction after the concern was put to
them**, which is the right way for it to happen.

Tasks are numbered from 30.

## 17. What changed, and who decided

§11.1 shipped a translucent fill and wrote down why an opaque one was refused:
*"a filled rectangle over a password would hide it from the eye and leave it
selectable in the PDF"*. The concern was raised, the user's answer was that a
filled shape **must** cover the text underneath and that the area has to be
rasterised. That is their call to make, and this pass makes it work.

### 17.1 Rasterising is not the mechanism, and saying so is the point

The instruction named a raster. A raster does not achieve what it was asked
for, and building one would have shipped a tool that looks like it redacts and
does not:

- Chrome's print paths emit a **text layer** built from the DOM. Painting a
  bitmap *over* a paragraph does not remove the paragraph's text runs from that
  layer, so `Ctrl+F` still finds every word, and so does any PDF text
  extractor. The pixels would be covered and the text would be published.
- A raster of the covered region needs `Page.captureScreenshot`, which is CDP,
  which is `chrome.debugger` - and `CLAUDE.md`'s first invariant is that the
  free path never depends on it. It would have made the free tier's cover tool
  either impossible or a second Deviation-13 exception.

So the raster buys nothing here and costs the invariant. **What removes text
from the PDF is removing it from the DOM's text layer**, and there is a way to
do that which reflows nothing:

> **`visibility: hidden` on the covered text runs.** It preserves layout
> exactly - the box is still there, still the same size, still holding its
> place - and hidden content is not painted, so Chrome has nothing to put in
> the text layer for it. Then an **opaque** fill paints over the gap.

No CDP, no raster, no reflow, and it works identically on the free
`window.print()` route and the Pro `printToPDF` one because it is a property of
the DOM rather than of the capture. The PNG paths need nothing at all: a
screenshot has no text layer, so an opaque fill was always a true cover there.

### 17.2 This claim is unverified, and task 30 exists to verify it

That Chrome omits `visibility: hidden` text from the printed text layer is the
load-bearing assumption of this whole pass, and **nothing in this repository
can check it.** `CLAUDE.md` is explicit: *"headless renders, unit tests and
inspecting injected CSS have all reported single-page mode working while the
real dialog disagreed"*, and *"the one check that matters most: open the
exported PDF, Ctrl+F, search a word from the page"*.

So task 30 is a probe a human runs at Ctrl+P, before a line of this is built -
the same shape as task 01's probe, and the same rule: **if the probe fails,
stop and report it.** The fallbacks are all worse and all change the design:
removing the text nodes and inserting same-size spacers (fragile, and it has to
survive undo), `display: none` and accepting reflow (moves every mark below the
cover), or `clip-path` on the covered element (clips its siblings too). None of
them should be reached for on a guess.

## 18. The bar: one fill menu for both shapes

The user asked for one menu common to rectangle and circle, with three options.
So `rect-fill` and `ellipse-fill` - the two tools task 27 added - go away
again, and the fill becomes a **pen setting**, like the width, the colour and
the label size:

| menu option              | `FillMode` | paints                          | the text underneath          |
| ------------------------ | ---------- | ------------------------------- | ---------------------------- |
| **Not filled**           | `"none"`   | outline only                    | untouched                    |
| **Filled**               | `"tint"`   | translucent, `FILL_OPACITY`     | untouched, still searchable  |
| **Cover - removes text** | `"cover"`  | **solid pen colour, no alpha**  | **hidden, and not in the PDF** |

`"tint"` is exactly what tasks 26/27 shipped, kept because the user asked to
keep it: a read-through block is the right mark for pointing at a region of a
chart, and it is not pretending to be anything else.

Two consequences of making this a pen setting rather than two more tools, both
improvements on what task 27 did:

- **`DrawTool` goes back to seven members**, and the exhaustive tables in
  `model.ts` and `bar.ts` shrink with it. The `isFilledTool` predicate the task
  27 review flagged for living in the entrypoint disappears entirely rather
  than being moved - there is no filled *tool* any more.
- **One control, three states, and the state is visible.** The trigger shows
  which mode is armed the way the font-size trigger shows the size, so
  "why is my rectangle solid?" is answerable by looking at the bar.

The menu is a popover with its **own trigger** (`POPOVER_GROUPS`'
`"own-trigger"`, as the text group's size control is), because the shape tools
have to stay reachable with one press. It is live whatever tool is selected -
not locked, not dimmed - for the reason the font-size control is: it is a pen
setting, and the gate is on tools that make marks. Both `"tint"` and `"cover"`
are **free**; the tier split stays exactly symbols and text labels.

## 19. Hiding the covered text

`lib/dom/cover.ts` - **`lib/dom/`, not `lib/draw/`**. This is surgery on the
user's page, in the family of `hide-fixed.ts`, `expand.ts` and `lazy.ts`, and
it is nothing to do with what a mark *is*.

It splits the way every module in that directory splits, and the way
`CLAUDE.md` asks: a pure decision that a unit test can reach, and a thin DOM
walker that it cannot. `shouldHideFixed` / `hideFixedElements` is the exact
precedent - the first takes a plain record and is covered by
`tests/hide-fixed.test.ts`, the second walks the document and is not.

### 19.1 The pure half: which characters are covered

`coveredRuns(charBoxes, covers)` takes the per-character boxes of one text node
and the cover rects, and returns the index runs to hide. Plain arrays in, plain
arrays out, no DOM (contracts §26).

**A character is covered if its box intersects a cover rect at all** - not if
it is contained, and not by its centre. Greedy on purpose, and the reasoning is
asymmetric:

- Over-hiding is **invisible**. The extra character is under an opaque block.
- Under-hiding is **a leak**. Half a glyph of a password showing at the edge of
  the box is the failure this tool exists to prevent, and it is the kind
  somebody notices after they have sent the file.

For a tool whose whole job is removal, the safe direction is the only
defensible default. Runs are merged and returned in order, so a cover rect
straddling two words yields one run and one wrapping element.

### 19.2 The DOM half: split, wrap, and be undoable

`hideTextUnder(covers, doc)` walks text nodes whose element intersects any
cover rect, measures each character with a `Range`, asks `coveredRuns`, then
splits the node and wraps each covered run in a
`<span style="visibility:hidden">`. It returns a **handle with `restore()`**,
and that is not a nicety:

- annotate mode restores the page on exit, and a page left with holes in its
  text would be a page this extension broke.
- the covers are applied *around a capture* and taken off after (§20), so
  `restore()` runs on every single use, not on a rare error path.

`restore()` must put the text back as it was - `normalize()` on each touched
parent, so a paragraph that was split into five nodes is one node again and a
second pass measures the same geometry as the first.

**Form controls are handled too, and separately.** An `<input>`'s value is not
a text node, and Chrome prints it. So an `<input>` or `<textarea>` whose box
intersects a cover gets `visibility: hidden` on the element itself. Coarser
than the character-level split - the whole field goes - which is right for a
field: a half-hidden password box is not a thing anyone wants.

## 20. When the covers are applied: around the capture, never while drawing

Not at commit time. The DOM is mutated **only** for the duration of an export,
bracketed by the three mechanisms `entrypoints/annotate.ts` already has and
already documents (§4.3, §13.5):

| bracket                                    | covers on                | covers off               |
| ------------------------------------------ | ------------------------ | ------------------------ |
| `window.print()` from anywhere, Ctrl+P too  | `onBeforePrint`          | `onAfterPrint`           |
| a Pro CDP capture, and the region selector | `PAGE_ANNOTATE_UI{false}`| `PAGE_ANNOTATE_UI{true}` |
| a save from the bar                        | reaches one of the above | the same                 |

Three reasons this is the right seam and commit time is not:

1. **Undo stays simple.** A cover that hid text at commit would have to un-hide
   it on Ctrl+Z, on Clear, and on a redo - four more places for the page to be
   left broken. Here the history is just shapes, exactly as it is today.
2. **Nothing moves under the user's hand.** `visibility: hidden` preserves
   layout, but a mid-drawing DOM rewrite is still a risk taken for no gain.
3. **The restore already exists and is already paired.** `beforeprint`/
   `afterprint` and `{visible:false}`/`{visible:true}` are both symmetric pairs
   that this file already relies on for the bar.

`onBeforePrint` is **synchronous** and this does per-character geometry, so it
is on the critical path of opening the print dialog. Bounded by the number of
cover marks and the text under them - a cover over one line is a handful of
`Range` measurements - but it is a real cost and task 36 measures it rather
than assuming. If a page with many large covers is visibly slow, the answer is
a cheap pre-filter (skip elements whose bounding box misses every cover, which
`hideTextUnder` does first anyway), not a move to an async seam that
`beforeprint` does not have.

## 21. The honest limits, which go in the README

A tool that claims to remove text has to be exact about where it does not.

1. **A cover cannot reach into a cross-origin iframe.** The layer paints *over*
   one, so it looks covered; the iframe's own text is in its own document,
   which we cannot touch, and Chrome prints it. **This is a genuine leak** and
   the one limit in this list a user could be harmed by. It gets its own
   sentence in the README, and the note line says it the first time a cover is
   armed.
2. **It removes text from the export, not from the page.** The page under the
   bar still has its text while you work - that is what makes the cover
   undoable and the restore safe. Anyone screen-sharing while annotating has
   not hidden anything yet.
3. **It is not a certified redaction.** No claim is made about metadata,
   embedded objects, or a PDF consumer that reconstructs text some other way.
   The name on the button is "Cover", and the deviation says plainly what it
   does: the covered characters are not in the exported PDF's text layer.
4. **`alt`, `title` and `aria-label` are not hidden**, because Chrome does not
   put them in the text layer. If that ever changes, this list is where to look.
5. **Text painted into a `<canvas>` or baked into an image is pixels**, so an
   opaque cover genuinely removes it - the one case that needs nothing.

## 22. Deliberately not doing

- **A raster, blur or pixelate cover.** §17.1: it does not remove text, and it
  needs CDP on a path that must not have it. If a *blurred* cover is ever
  wanted for its own sake - showing the shape of what was there - it is a
  Pro-only feature on the CDP path and it needs its own spec, because it has
  to combine a real raster with the text hiding this pass builds.
- **Redacting the page itself**, rather than the export. §21.2.
- **Covering with a pattern or a label** ("REDACTED"). One solid block.
- **A cover on any shape but the rectangle and the ellipse.** A covered
  freehand scribble is a mask, not a box, and `coveredRuns` takes rects.
