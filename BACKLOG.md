# BACKLOG

Anything not shipped, per PROJECT.md §8: "Anything not ticked on the second
Sunday goes to BACKLOG.md. Ship what exists."

## Scope: what is MVP and what is not

**The feature work is done.** What stands between this code and a published
extension is **not a diff**: it is a vendor dashboard, a hosted page, five
screenshots and a review queue. In the order it has to happen:

- [ ] **A Lemon Squeezy product.** One-time, $5, license keys on, activation
      limit 5 (PROJECT.md §6.1). Step by step, including the two things that
      bite, in [docs/LEMON-SQUEEZY.md](docs/LEMON-SQUEEZY.md). Then paste the
      checkout link into
      `CHECKOUT_URL` in `lib/constants.ts` and the "Get Pro - $5" button appears
      in the Pro dialog on its own - `PRO_AVAILABLE` is already `true` and the
      dialog already degrades to "Not on sale yet" without it. **No code
      changes.** `activate()` / `validate()` / `deactivate()` / `isPro()` are
      written, the cache and offline-grace logic is tested
      (`tests/license.test.ts`), and `components/license-form.tsx` is wired into
      both the popup dialog and the options page, "Lost my key?" included.
- [ ] **Trader status** in the Chrome Web Store developer dashboard. Required
      before charging anything (PROJECT.md §7), and it gates the listing rather
      than the build.
- [ ] **Publish the site and host the privacy policy.** `site/` is a static
      landing page plus `site/privacy.html`, and
      `.github/workflows/pages.yml` deploys it to GitHub Pages on push to
      `main` - so this is: push the repo, turn Pages on with source
      **GitHub Actions**, then put `https://<user>.github.io/<repo>/privacy.html`
      into `PRIVACY_POLICY_URL`. The store requires a hosted policy before a
      paid listing, and the same site answers Lemon Squeezy's "website" field.
      Three `TODO` comments in `site/` need filling first: the Web Store link,
      the repository link, and a **contact address** on the privacy page (the
      one in `docs/privacy-policy.md` was never filled in either).
- [ ] **The listing itself** (§11): the final name, three screenshots, the
      132-character short description, the single-purpose statement and the §5
      permission justifications. The justification text is written in §5 and
      only needs copying; the name is the one real decision left, and §1 rules
      out "Web to PDF".
- [ ] **Run the §9 matrix**, all of it, and then `pnpm zip` -> upload ->
      submit. The row that decides it: open the PDF, Ctrl+F, search a word.

Everything below is deferred by decision, not by accident. Read a section
before reopening it - most entries record a measurement or a trade, not a
to-do.

## Settled: how the extension gets the `debugger` permission

- [x] **Declared required, from the first release.** It cannot be optional
      (README "Deviations", item 1), and the free default needs it: one-click
      export and screenshots both run over CDP (Deviation 24). The alternative
      once weighed - a separate Pro listing that declares it - has nothing left
      to keep it away from, since the tier that uses it is Free. Nothing is
      published yet, so no user is ever prompted to re-accept; the §5
      justification text is written for the install prompt.

## Single-page ceiling - closed, good enough

- Chrome will render a single page far taller than PROJECT.md §4.2's "practical
  ceiling ~200in": verified intact at 190, 200, 213, 250, 300, 400 and 500in on
  Chrome 152. `MAX_PAPER_INCHES` is 500in (48,000px), chosen for render time and
  memory rather than any refusal by Chrome - a 213in page already weighs ~70MB.
- [x] **Not pursuing where it genuinely breaks.** 1000in did not finish
      rendering within 5 minutes here, and a page that tall is a rare case that
      does not have to be perfect - only good enough, which 500in with the
      equal-slice fallback already is. The cap stays where it is.

## Settled

- [x] **Why single-page mode printed two sheets with blank space at the end.**
      Two independent causes, both measured on Chrome 152 through
      `Page.printToPDF` with paper cut to the document:
      viewport-relative lengths (`vh`, `svh`/`lvh`/`dvh`, `vmin`/`vmax`, and
      percentage heights off `html`) resolve against the *page box*, so the
      paper we ask for redefines `100vh` and re-inflates the page it was sized
      from; and the forced-break reset lived in a `media="print"` stylesheet,
      which never matches while screen media is emulated. Fixed by
      `lib/dom/viewport-units.ts` and by injecting `BREAK_RESET_CSS` without a
      media condition. A tighter `SINGLE_PAGE_SLACK_PX` was never the answer -
      the overflow is hundreds of pixels, not rounding.
- [x] **Why the single sheet then ended in a blank strip.** The document is
      routinely taller than the page paints - reserved ad slots, a feed frozen
      mid-load, and holes left where hidden sticky furniture used to be (turning
      "hide sticky bars" off makes the height right, which is what pointed at
      it). `lib/pdf/painted-height.ts` measures the real bottom from a
      downscaled screenshot instead of guessing at the DOM.
- [ ] The trim leaves *interior* blank gaps alone - an ad slot halfway down the
      page still reserves its space, and nothing paints there once scripts are
      frozen. Collapsing those means deciding whose height to take away, which
      is a different and much riskier problem than cutting the tail.
- [x] **Why the page flashes blank grey for about a second between the
      lazy-scroll sweep and the download - accepted, with the cost of removing
      it measured.** It is one call: `Page.captureScreenshot` with
      `captureBeyondViewport: true` and a scaled `clip` - `CdpSession.captureClip`
      in `lib/cdp/index.ts`, reached from `paintedHeight()` in
      `entrypoints/background.ts`. That is the scan behind README Deviation 12,
      so the flash is the price of the blank strip above being gone.
      Chromium composites the tab into a surface the size of the *output image*
      for the duration of the call - `clip.width * scale` by
      `clip.height * scale` - and the scan's scale is
      `pickScanScale(docHeight) = 1400/docHeight`. On the reported page (wp.pl,
      19,793px document, 1137x806 window) that surface is **80x1400 CSS px
      inside a 1137px window**: only the leftmost 80px has anything behind it,
      and the rest of the window is the compositor's own ground. The strip's
      width is predictable as `contentWidth * 1400 / docHeight`, which matched
      the user's screenshot. Duration: 958ms cold on wp.pl, 102-247ms warm - the
      cost tracks raster size, not document height, so a deterministic local
      96,366px page scanned in **81ms** while wp.pl's 19,793px took 958ms
      because of its images. It is invisible to page scripts by construction:
      the export freezes them (`setScriptExecutionDisabled(true)`), so **zero**
      `resize` events are delivered and none are queued for unfreeze; with
      scripts live each capture fires exactly two, enter -> `1x1` and exit ->
      restored, ~16ms apart. The full-page screenshot feature captures at
      scale 1, so its surface is already full width and it never glitches.
      Three ways out, all **rejected on measurement**, which is the part that
      should stop anyone "fixing" this:
      a **full-width sliced scan** (scale 1, 4096-row slices, the shape
      `lib/capture/plan.ts` already uses) genuinely removes it - no surface
      measured was ever narrower than the window - but costs **8,094ms and
      41.6MB** against **81ms and 7kB** on the same page, which trades a
      one-second flash for an eight-second stall;
      **scanning only the tail** is not cheaper - the bottom 6,000px took
      *longer* (315-354ms vs 102-107ms) and the surface was still narrow
      (265px);
      and **the preparation curtain cannot cover it**, twice over - it is
      removed before the background's reply, so it is already gone by the time
      the scan runs, and being DOM it could not hide a compositor-level change
      anyway. Were it up during the capture it would be *in* the output.
      What was **not** verified: this reproduced the mechanism by firing the
      same CDP calls at a throwaway Chrome, not by driving the built extension
      end to end. The confirmation still owed is that the flash a user sees is
      `contentWidth * 1400 / docHeight` wide.
- [ ] **`paintedHeight` runs on every export, and the paginated path does not
      need it.** For `pageMode !== "single"` the trim only refines a sheet-count
      estimate - `planPrintToPdf` uses A4 paper and `capSheets` is false - so
      skipping the scan there loses the estimate and nothing else: purely
      internal, no contract change. It does not help the single-long-page case,
      where the flash was reported and where the trim is load-bearing, but it
      halves how often anyone meets the flash at all.

- [x] **Can the print-dialog path do "single long page"? No.** Chrome's print
      dialog takes its paper size from its own dropdown and discards
      `@page { size }`, so `window.print()` always paginates to Letter/A4.
      Chromium's printToPDF path *does* honour it (1 page of 10.42x31.25in
      vs 3 Letter pages for the same document, px and in alike), which is what
      `preferCSSPageSize` is for. So it is a one-click feature: the popup and
      the options page disable the row, with the reason, while the print dialog
      is chosen (README Deviation 9).
- [x] **The single-page rule is enforced at export time, not in the UI.** A
      disabled row gates nothing on its own: `settings.pageMode` lives in
      `storage.sync`, so `single` stays stored when the user switches to the
      print dialog, and follows the profile onto another browser.
      `effectivePageMode(stored, mode, override)` (lib/settings.ts) resolves it
      against the export mode on every export instead - storage records the
      wish, the export path decides - and a `print` export degrades to
      `paginated` rather than failing. It was first written as a tier gate,
      against `isPro()`; Deviation 24 made single long page free and moved the
      rule to the one thing that really cannot do it.

## Screenshots

- [ ] **A `position: fixed` element inside a region selected below the fold may
      paint at the top of the capture.** `captureBeyondViewport` renders the
      clip as its own surface, and viewport-anchored elements anchor to that
      surface rather than to where they were on screen. Full-page shots are
      unaffected in practice (sticky furniture is hidden by the pre-processing),
      and region shots of anything without a fixed overlay are fine. The likely
      fix is `captureBeyondViewport: false` for regions - a selection is always
      inside the current viewport - but the clip's coordinate space in that mode
      has to be confirmed in a real browser before switching.
- [ ] The debugger attaches *after* the rectangle is picked, so Chrome's yellow
      bar appears between the selection and the capture. It shrinks the viewport,
      which can move `vh`-sized or fixed content. Attaching first would make the
      selection match the capture exactly, at the cost of holding a debugger
      session for as long as the user takes to drag.
- [ ] Region capture is limited to what is on screen - there is no scroll while
      dragging, and no auto-scroll at the edges.
- [ ] The service worker waits on the selection with no timeout. An open message
      port keeps it alive, but MV3 workers have a hard ceiling; a user who walks
      away mid-drag and comes back much later may find the reply goes nowhere.
      The overlay would then sit there until Esc.
- [ ] The image is held whole in the worker, whole again as chunks in the
      offscreen document, and once more as a Blob. Three copies of a large
      screenshot at the same moment; a transferable, or streaming the chunks
      into the Blob, would leave one.
- [ ] Quality is fixed per format (0.92 WebP, 0.94 JPEG). No slider, on the
      theory that nobody wants to tune a screenshot - revisit if anyone asks.

## Drawing

Phase 3 of `docs/features/DRAWING.md`, deferred with reasons rather than
forgotten (`.plan/design.md` §8).

- [ ] **Select / move / delete an existing mark.** Everything shipped is
      write-then-undo: a mark is committed and the only way back is Ctrl+Z or
      Clear. Selection needs hit-testing per kind, a handle set, and a shape
      whose geometry can be edited after the fact - which is a second editor on
      top of the first, not a button.
- [ ] **Edge auto-scroll while drawing.** A stroke can already run past the fold
      because every pointer event is converted with the scroll as it is at that
      moment, but you have to do the scrolling yourself (wheel or trackpad,
      which is deliberately not blocked - unlike `select-area.ts`). Dragging
      into the bottom edge should carry the page with it.
- [ ] **Marks surviving a reload,** via `chrome.storage.session` keyed by tab
      and URL. Today navigation takes the marks with it, along with the injected
      scripts and the `activeTab` grant. Keying it is the whole problem: the
      same tab at a different URL must not inherit marks, and a coordinate-based
      shape restored onto a page that reflowed is worse than no restore.
- [ ] **Marks anchored to a DOM element instead of a coordinate.** This is a
      change to the shape model rather than a feature on top of it, and it is
      the only honest way to allow drawing *before* pre-processing - an anchored
      mark moves with the section that expanded under it. It deserves its own
      spec, and it is a precondition for the reload item above being worth much.
- [x] **An opaque cover tool that really removes what it covers - built, and
      *not* by rasterising.** This item said a fill that removes what it covers
      "needs a per-region raster and a way to drop the covered DOM out of the
      print". Half right: the second half is the whole mechanism and the first
      half is wrong, and getting it wrong would have shipped a tool that looks
      like it redacts and does not. A raster leaves the paragraph's text runs in
      the PDF, so Ctrl+F still finds them, and it needs `Page.captureScreenshot`
      on a path that must never depend on `chrome.debugger`. What ships is
      `visibility: hidden` on the covered runs plus an opaque fill, applied
      around the capture and taken off after (`lib/dom/cover.ts`,
      `.plan/design.md` §17.1, README Deviation 20). The security claim is made,
      narrowly and in the button's own label - "Cover - removes text" - and
      Deviation 20 is the list of places it does not reach.
- [ ] **A blurred or pixelated cover, if it is ever wanted for its own sake.**
      Not a substitute for the above and not reachable from it: showing the
      *shape* of what was there - a face, a chart, the length of a redacted
      name - is a different request, and a blur that leaves the text layer alone
      is the same leak as a raster. So it can only exist on the **CDP paths**
      (one click and the screenshots, never the print dialog), it needs its own
      spec, and the spec has to combine a real raster with the
      text hiding that already exists (`.plan/design.md` §22). Nobody has asked
      for it yet.
- [ ] **Drag-to-create a text box.** Today a click places one at
      `DrawPrefs.textWidth` and the eight handles size it, which is the
      behaviour `.plan/design.md` §13.6 chose. Drag-to-create would mean the
      text tool starting a `Drag` after all, and `DragTool` is
      `Exclude<DrawTool, "text">` precisely so that a drag and an open editor
      are never both live - so it is a restructure of the pointer state machine
      for very little.
- [ ] **Re-wrapping a committed label,** and editing one at all. The frame, the
      wrap and the resize handles belong to the **open** editor and are gone the
      moment the label commits; the colour, size and width buttons restyle the
      label being typed and a committed one is fixed. This is still the
      select/move item at the top of this list, which the second pass **narrowed
      rather than retracted** (`.plan/design.md` §11.2): what shipped is one box,
      the one under the hand, so there is no hit-testing over a `Shape[]` and no
      per-kind handle set. `frameZoneAt`, `resizeFrame` and `frameHandles` in
      `lib/draw/frame.ts` take any `DrawRect` for exactly that reason, so phase 3
      reuses them rather than writing them twice.

Small deferrals from the second pass's reviews. Each is a note rather than a
bug - nothing here is wrong today, and each is a second copy of something that
already has an owner:

- [x] **`isFilledTool` - deleted rather than moved, so there is nothing left to
      do.** It wanted a `DRAW_TOOL_FILLED` table in `lib/draw/model.ts` beside
      `isFreehand`, because a predicate in an entrypoint whose own header
      disclaims them is the second copy of a classification the model already
      knows how to hold. The fill then stopped being a *tool*: it is
      `DrawPrefs.fill`, one menu serving the rectangle and the ellipse, so
      `"rect-fill"` and `"ellipse-fill"` went out of `DrawTool` and the
      predicate went with them. `DRAW_TOOL_FREEHAND` still has to answer for
      every tool, which is the exhaustiveness this item was really asking for.
      Retired by the change rather than fixed - the best outcome available, and
      worth noting that the tidier one (move it) would have been work spent on
      code that was about to be deleted.
- [ ] **`deltaOf` in `lib/draw/geometry.ts`.** `moveFrame` and `resizeFrame` take
      a `Vec2` of *movement*, `geometry.ts` exports no vector difference to build
      one with, and `lib/` was out of scope for the task that needed it - so it
      landed as `sincePress` in `entrypoints/annotate.ts`, and that file's "no
      arithmetic and no predicates of its own" header was amended to declare the
      exception. The right call for that task, but the deferral currently lives
      only in a doc comment. A `deltaOf(from, to): Vec2` with a test beside it
      would de-duplicate **three** call sites - `constrainSquare` and `snapAngle`
      compute the same `dx`/`dy` inside `geometry.ts` itself, plus `sincePress` -
      and would let the entrypoint's claim stand with no exception at all.
- [ ] **A redundant reflow per press inside an open panel.** `onClick` in
      `lib/draw/bar.ts` calls `setOpen` unconditionally, and `setOpen` ends in
      `place()` - which measures boxes and so forces a layout. A press that
      cannot change which panel is open still pays for one, so placing five
      arrows out of the symbols palette costs five of them. An
      `if (id === openId) return;` at the top of `setOpen` removes it. Inside
      `place()`'s documented "a layout per press rather than per frame" budget
      either way, which is why this is a note and not a bug.

Accepted consequences of what shipped. All twelve are correct behaviour that a
user could reasonably report as a bug, so they are written down rather than
discovered (`.plan/design.md` §9, §16, §21):

- [ ] **A cover cannot reach inside a cross-origin iframe, and that is a real
      leak.** The drawing layer paints over the frame, so it looks covered; the
      frame's text is in another document that this extension cannot touch, and
      Chrome prints it. This is the one entry in the whole feature a user could
      be **harmed** by - a solid block over an embedded tweet, comment widget or
      payment form hides nothing in the exported PDF. The bar says it in one
      sentence the first time a cover is armed in a session, README Deviation 20
      says it at length, and there is nothing to fix: reaching into that
      document would need host permissions this extension does not have and does
      not want. Same class, different verdict: a `<select>`'s option label was
      also text no `Range` reaches, and *that* one was fixable from here and was
      fixed. The limits that are **not** fixable from here are of two kinds, and
      Deviation 20 keeps them apart: another document (this entry, and the closed
      shadow root below), and our own document painting text that belongs to no
      node - CSS-generated content (`::before`/`::after`, list markers), which is
      the main one of those.
- [ ] **A cover cannot reach inside a *closed* shadow root.** `attachShadow({mode:
      "closed"})` hands a page a subtree nothing outside it can enumerate -
      `el.shadowRoot` is `null` for one - so a cover over a closed component's
      text paints a block and leaves the words in the PDF. Same shape as the
      iframe above, from inside our own document. **Open** roots are walked, and
      that is the ordinary case: until task 39 neither `createTreeWalker` nor
      `querySelectorAll` crossed a shadow boundary, so a cover over a web
      component hid nothing, and a page rendered into
      `document.body.attachShadow({mode: "open"})` had nothing hidden at all.
      Nothing to fix here either, and one reason not to want it fixed: our own
      layer and bar are closed roots, which is what keeps this walk off the text
      of our own labels. Two smaller cases sit with it - a shadow root whose host
      is inside a `SKIP_TAGS` subtree is not entered (the walk rejects the
      subtree before it sees the host), and inside a CSS-transformed subtree the
      ink inset is measured in a different space from the boxes it shrinks, which
      errs towards hiding rather than leaking because an over-large inset keeps a
      1px band instead of collapsing.
- [ ] **A cover hides text from the export, not from the page**, so
      screen-sharing while annotating has hidden nothing. The covers go on at
      `beforeprint` / `PAGE_ANNOTATE_UI{false}` and come off again immediately
      after, which is deliberate and is what keeps undo a stack of shapes with
      nothing to keep in step and lets annotate mode restore the page whole on
      exit. The alternative - hiding at commit time - would need un-hiding on
      Ctrl+Z, on redo and on Clear, four more places to leave a page with holes
      in its text.
- [ ] **`onBeforePrint` is synchronous, and the cover pass runs inside it.**
      Opening the print dialog on a page with covers costs per-character
      `Range` geometry that nothing can move off the critical path -
      `beforeprint` has no async seam. Measured rather than assumed, on an M4
      Pro at 1280x900 against a 59,000px article (~179k characters, 16.8k
      elements): three 752x400px covers hiding 195 runs cost **21-26ms**, the
      restore 3-5ms, and one cover over one line costs ~14ms of that because
      the element pre-filter dominates. Covers tiled over the whole document
      hide 9,584 runs at **~330ms**, ~96% of it `Range` measurement on elements
      that genuinely intersect a cover - which is exactly what no pre-filter may
      reject. So a cheaper pre-filter buys the fast end and none of the slow
      one; the only lever on the tail is measuring fewer characters per covered
      node. **Those numbers predate tasks 38-40** and have not been taken again:
      the pass now also runs a handful of canvas `measureText` calls per covered
      node (the per-line ink inset) and walks the page's open shadow roots. Both
      are small beside the per-character `Range` loop, and neither excuses
      quoting a figure nobody re-measured. Re-measure if the pre-filter changes,
      and before relying on the figures above.
- [ ] **The once-per-session cover warning is guarded by a human step and
      nothing else.** `FILL_NOTE` - the sentence saying a cover cannot reach
      inside an embedded frame - is asserted in no test. During task 33 a
      reviewer deleted its session-start branch outright and **625/625 tests
      still passed with a clean compile**; the closest test pins only the
      premise, that the pen persists across a reload. That is inherent rather
      than an oversight - both triggers live in `entrypoints/annotate.ts`, and
      `CLAUDE.md` asks that `tests/` stay plain vitest with no DOM harness - but
      it means a sentence a user's privacy leans on is protected by the §9
      matrix alone, where it now has a row of its own. Worth knowing before
      anyone refactors the note line.

- [ ] **No IME, so a text label cannot be typed in Chinese, Japanese, Korean or
      Vietnamese at all.** The caret reads `event.key` and there is no
      `contenteditable` anywhere - that is what keeps the page's CSS and key
      handlers away from the label and makes the thing you typed into the thing
      that prints - but it also means no composition session can ever start: a
      CJK user gets the latin keystrokes their IME was meant to consume, or
      nothing. This is the one item in the list that makes a tool *unusable*
      rather than surprising. A `<foreignObject>` with a real editable inside it
      is the way out, and it is phase 3 at the earliest.
- [ ] **Marks are lost on reload or navigation,** along with the `activeTab`
      grant itself. Accepted for v1; see the `storage.session` item above.
- [ ] **A mark in the blank tail keeps that tail alive.** The painted-height
      trim looks at pixels, not at the DOM (`lib/pdf/painted-height.ts`), and a
      stroke in the tail genuinely paints there - so the sheet the trim would
      have cut is now the sheet the mark is on. Correct, and surprising the
      first time.
- [ ] **Fixed furniture that survives hiding sits somewhere else on paper than
      on screen,** so a mark anchored to it looks misplaced. Anything over the
      20% text-share guard (README Deviation 7) or under `stickyMinHeight` stays
      put on screen and lands wherever the print layout puts it. Nothing to do
      beyond knowing why.
- [ ] **Ctrl+F may not find a phrase that straddles a soft wrap in a label.**
      Each rendered line is its own `<tspan>` and so its own text run in the
      PDF. Single words always match - a soft wrap never splits one - and the
      exception is a word too wide for its box, which is broken between
      characters deliberately, because a URL running off the side of the page is
      worse. Every wrapped text in every PDF behaves this way; README
      Deviation 18 is the entry for it.
- [ ] **The wrap is measured with canvas metrics and painted with SVG shaping,**
      so a line can sit a pixel or two past the box it was fitted to. Canvas
      `measureText` is synchronous and forces no layout, which is what lets the
      label re-wrap on every keystroke without the layer reflowing; SVG then
      shapes, kerns across a run and reorders bidi, and any of the three can
      move a line a hair wider. It **paints** rather than clips - a mark's own
      `<svg>` is `overflow: visible` - and no fudge factor is wanted, because
      all the box has to get right is which printed sheet the label lands on.
- [ ] **The first part of a north or south handle drag on a *wrapped* label does
      nothing visible.** `FrameDrag`'s baseline is `Editor.rect` - the height the
      user asked for - and that is required rather than incidental: baselining on
      the laid-out rect instead would make merely pressing a handle adopt the
      grown height as the request, so a box would stay tall after a line was
      deleted though nobody had ever dragged it tall. The price: on a two-line
      label at the default 16px pen, `Editor.rect.height` is 22.4px
      (`16 * TEXT_LINE_HEIGHT`, 1.4) while the frame on screen is 44.8px, so the
      first 22.4px of a **south** drag grow the asked-for rect from 22.4 and
      `layoutText` clamps every one of them straight back to 44.8. It is 44.8px
      on a three-line label, and `laidOut.height - rect.height` in general. A
      **north** drag spends the same span sliding the box up instead of growing
      it, because the bottom edge it pins is one the text is still holding down -
      so it is both y handles, not only the south one. Correct, and surprising
      the first time.
      Worth knowing when running task 24's manual check 3 ("drag the south
      handle down, then delete a line: the box stays tall"): it exercises the
      intended path cleanly only on a **one-line** label, where the two rects
      agree. On a wrapped one the start of the drag looks broken, and is not.

One **bug**, kept out of the list above on purpose: every entry there is a place
a cover fails to remove text, and this is the page not coming back afterwards,
which outlives the handle.

- [ ] **Covering MathML reflows it, and `restore()` does not put it back.** A
      cover over an `<mi>` grows its rect from 11.16 to 18.5 tall, and the height
      stays after the covers come off - the only known case where `restore()`
      leaves the page changed. It **predates** tasks 38-40, and the task 40
      reviewer measured it both ways round to be sure: the MathML namespace is
      neither of the two `inSvg` decides between, so the wrapper is an HTML
      `<span>` on the code before the namespace fix and on the code after it, and
      the rect moves identically. Task 40 neither caused it nor fixed it. It
      breaks `.plan/design.md` §17.1's "reflows nothing", which is the promise
      `visibility: hidden` was chosen to keep, and it is worse in kind than
      anything on the limits list: a covered equation that stays the wrong size
      is damage a user keeps. Not fixed here because the cause is not yet known -
      whether a MathML layout context can carry an inline wrapper at all, and if
      not, whether the answer is `<mrow>`, `<mtext>`, or blanking the element
      whole the way a form field is. Whoever picks it up should measure first,
      in a real Chromium, the way the numbers above were.

Two hazards in `entrypoints/prepare.ts` that **predate** this feature - found
by a reviewer checking that the held-pass seam did not add them. Both are races
in the existing message handler, and annotate mode changes how easy each is to
reach rather than whether it exists:

- [ ] A `PAGE_RESTORE` landing inside `schedulePrint`'s 50ms window restores
      before `window.print()` is called, so the dialog shows an unprepared page.
      It needs two user actions 50ms apart. Now that a held pass ignores a
      restore without `release`, only an annotate exit can reach it at all.
- [ ] Two `PAGE_PREPARE`s in flight still double-run `prepareForExport` and
      orphan the first `Prepared`, which is a header block prepended twice and a
      `PrepReport` describing neither pass. `held` is only set after the
      `await`, so the `active !== null` guard cannot catch it. Annotate mode's
      slow lazy-scroll prepare plus a popup export makes it marginally easier to
      hit than before.

## v0.2 - the CDP path and the licence (§4.2, §6)

- [x] Wire `lib/cdp` into a real export: screen media emulation ->
      `getLayoutMetrics` -> `printToPDF` -> `IO.read` -> offscreen download.
- [x] Offscreen document for Blob URLs (§10.1), plus the `offscreen` and
      `downloads` permissions.
- [x] **`DEV_UNLOCK_PRO` follows the build mode.** It is
      `import.meta.env.MODE === "development"`, so `pnpm dev` unlocks Pro
      without a key and `pnpm build` folds the branch out of the bundle. There
      is no longer a line to remember to flip before publishing.
- [x] **The PDF crossed to the offscreen document as base64 in a single
      message.** It hurt sooner than expected, and from the screenshot side: a
      full-page PNG hit `Message exceeded maximum allowed size of 64MiB` after
      all the work was done. `lib/download.ts` now sends 6MiB chunks (a multiple
      of 3, so each encodes independently) under one transfer id, and the
      offscreen document assembles the Blob from the parts. Both file types go
      through it.
- [x] **Explanation before the permission moment (§4.2 step 1).** It is the
      popup's hint line under Export: with one click chosen it says the PDF goes
      straight to Downloads and that Chrome shows a yellow debugging bar while it
      runs (§10.4), and the options page says the same beside "Use Chrome's
      print dialog". It started in `components/pro-dialog.tsx` and moved when
      one-click became free. The *moment* moved too, though: `debugger` is
      declared rather than requested (Deviation 1), so the prompt now happens
      at install, before any dialog of ours can be shown. The same sentence therefore has to appear in
      the **store listing**, and that is tracked under "Store listing" below,
      not here.
- [x] Single-page mode over CDP: same `pageMode` setting, with screen CSS and no
      dialog. `handleScreenExport` resolves it through `effectivePageMode` and
      hands it to `planPrintToPdf`; `planSinglePageSize` is shared by both paths
      and the split note reaches the popup. Ceiling 500in with the equal-slice
      fallback (Deviation 4).
- [ ] Lemon Squeezy product, then fill in `CHECKOUT_URL` in `lib/constants.ts`.
      `PRO_AVAILABLE` is **already** `true`, so the checkout link is the only
      thing missing. `activate`/`validate`/`deactivate`/`isPro` are written; the
      cache-expiry logic is tested. Now the first item in the scope section at
      the top of this file.
- [x] "I have a key" and "Lost my key?" UI. `components/license-form.tsx`,
      shared by the Pro dialog and the options page so there is one activation
      implementation to get right; "Lost my key?" points at
      `LICENSE_RECOVERY_URL`, and the options page can deactivate to free a slot.
- [ ] Trader status in the developer dashboard before charging (§7). Also in the
      scope section.

## Known gaps in what is written

- [x] **`renderFilename` is wired.** `handleScreenExport` names the one-click
      PDF with it and both screenshot paths name their image with it
      (`entrypoints/background.ts`). The print path hands naming to Chrome's
      print dialog by design and cannot use it.
- [ ] Lazy-load gives up after 8s with a warning. An infinite-scroll feed
      exports whatever had loaded by then, which is the right trade but is not
      configurable.

## Store listing (§11)

- [x] Final name: Hardcopy (manifest name "Hardcopy - Save Page as PDF"). "pagepdf" was the working name; §1 ruled out "Web to PDF".
- [ ] 3 screenshots: popup, before/after (print CSS vs screen look), a page
      marked up with the drawing tools and the PDF it produced.
- [ ] Host the privacy policy at a public URL and put it in `PRIVACY_POLICY_URL`.
- [ ] Single-purpose statement and the §5 permission justifications. The
      justification text is written in §5 and is true as shipped; it needs
      copying, not rewriting.
- [ ] **Say in the listing that Chrome shows a yellow "is debugging this
      browser" bar.** `debugger` is declared, so the install prompt arrives
      before any UI of ours can explain it (§4.2 step 1, Deviation 1). The
      popup's hint line carries the sentence for people already installed; the
      listing has to carry it for everyone else.

## Later / maybe

- [ ] Firefox, which has `tabs.saveAsPDF()` and deserves its own path (§1).
- [ ] Self-signed offline license keys (§6.2) if vendor-API independence is ever
      wanted. ECDSA P-256 verify is ~20 lines; the cost is running the issuing
      service.
- [ ] Preact is now in the bundle for a small popup. If the popup stays this
      small, revisit whether it earns its place (§2 said it would not).
