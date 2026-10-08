# BACKLOG

What is not shipped. Everything below the scope section is deferred on purpose.

## Scope: what is left before v0.1 ships

None of this is code.

- [ ] **Publish the site and host the privacy policy.** `site/` (landing page +
      `site/privacy.html`) deploys to GitHub Pages via
      `.github/workflows/pages.yml` on push to `main`. Push the repo, enable
      Pages with source **GitHub Actions**, then set `PRIVACY_POLICY_URL` in
      `lib/constants.ts` (currently empty). Fill the three `TODO`s in `site/`
      first: Web Store link, repository link, and a contact address in
      `site/privacy.html` (also missing in `docs/privacy-policy.md`).
- [ ] **Store screenshots** (3): popup; before/after (print CSS vs screen look);
      a page marked up with the drawing tools and the PDF it produced.
- [ ] **Listing copy.** Name, short description, single purpose and permission
      justifications are drafted in `docs/store-listing.md` - check the
      permissions against `wxt.config.ts`, and say in the listing that Chrome
      shows a yellow "is debugging this browser" bar (`debugger` is declared, so
      the install prompt comes before any UI of ours can explain it).
- [ ] **Run the §9 matrix** (`project.md`), then `pnpm zip` -> upload -> submit.
      The deciding row: open the PDF, Ctrl+F, search a word.

## When Pro comes back

Not needed while `LAUNCH_FREE_FOR_ALL` (`lib/constants.ts`) is `true`.

- [ ] **Lemon Squeezy product** - one-time $5, license keys on, activation limit
      5. Steps in `docs/LEMON-SQUEEZY.md`. Then set `CHECKOUT_URL` in
      `lib/constants.ts`; no other code changes (`PRO_AVAILABLE` is already
      `true`, licence code and UI are done).
- [ ] **Trader status** in the Chrome Web Store developer dashboard - required
      before charging (`project.md` §7).

## Export

- [ ] **Interior blank gaps are not collapsed.** The painted-height trim
      (`lib/pdf/painted-height.ts`) only cuts the blank tail; an empty ad slot
      mid-page keeps its space. Deciding whose height to remove is a much riskier
      problem.
- [ ] **Skip `paintedHeight` on paginated exports.** On `pageMode !== "single"`
      it only refines a sheet-count estimate. Skipping it there halves how often
      users see the ~1s grey flash the scan causes (accepted cost of the trim -
      `docs/ARCHITECTURE.md` Decision 12; a full-width scan that avoids it costs
      ~8s).
- [ ] **Lazy-load budget is fixed at 8s** (`lib/dom/lazy.ts`). Infinite feeds
      export whatever loaded by then. Not configurable.
- [ ] **Two pre-existing races in `entrypoints/prepare.ts`:** a `PAGE_RESTORE`
      inside `schedulePrint`'s 50ms window prints an unprepared page (only an
      annotate exit can reach it now); two `PAGE_PREPARE`s in flight double-run
      `prepareForExport` because `held` is set only after the `await`.

Single long page is capped at 500in (`MAX_PAPER_INCHES`) with an equal-slice
fallback; 1000in did not render in 5 minutes. Not pursuing taller.

## Screenshots

- [ ] **`position: fixed` content in a region below the fold may paint at the
      top of the capture** (`captureBeyondViewport` anchors it to the clip
      surface). Likely fix: `captureBeyondViewport: false` for regions -
      confirm the clip's coordinate space in a real browser first.
- [ ] **The debugger attaches after the rectangle is picked,** so the yellow
      bar can shift `vh`/fixed content between selection and capture. Attaching
      first means holding the session for the whole drag.
- [ ] No scroll or edge auto-scroll while selecting a region.
- [ ] **No timeout on the selection** (on purpose); a user who walks away may
      outlive the MV3 worker and leave the overlay up until Esc.
- [ ] **Three copies of the image in memory** (worker, offscreen chunks, Blob).
      A transferable or streaming chunks into the Blob would leave one.
- [ ] Quality is fixed (WebP 0.92, JPEG 0.94, `lib/capture/format.ts`). Add a
      slider only if someone asks.

## Drawing

Phase 3 of `.plan/archive/drawing/DRAWING.md`.

- [ ] **Select / move / delete / edit a committed mark** (including re-wrapping
      a label). Needs per-kind hit-testing and handles. `frameZoneAt`,
      `resizeFrame` and `frameHandles` in `lib/draw/frame.ts` already take any
      `DrawRect` for reuse.
- [ ] **Edge auto-scroll while drawing.** Manual scrolling mid-stroke works.
- [ ] **Marks anchored to DOM elements instead of coordinates.** A shape-model
      change needing its own spec; a precondition for the next item.
- [ ] **Marks surviving reload** via `chrome.storage.session`, keyed by tab and
      URL. Today navigation drops marks along with the `activeTab` grant.
- [ ] **IME support.** Labels read `event.key` with no `contenteditable`, so CJK
      and Vietnamese input does not work at all. Way out: a real editable in a
      `<foreignObject>`.
- [ ] **Blurred / pixelated cover**, only if asked for. CDP paths only (never
      the print dialog), and must also hide the text layer, not just raster
      over it. Needs its own spec.
- [ ] **Drag-to-create a text box.** Would restructure the pointer state
      machine (`DragTool` excludes `"text"`) for little gain.

**Bug:**

- [ ] **Covering MathML reflows it and `restore()` does not put it back** (an
      `<mi>` grows 11.16 -> 18.5px tall and stays). Cause unknown - the wrapper
      is an HTML `<span>` inside MathML; options are `<mrow>`, `<mtext>`, or
      blanking the element whole. Measure in a real Chromium first.

**Small cleanups:**

- [ ] **`deltaOf(from, to): Vec2` in `lib/draw/geometry.ts`** with a test.
      Replaces `sincePress` in `entrypoints/annotate.ts` and the inline `dx`/`dy`
      in `constrainSquare` and `snapAngle`.
- [ ] **Redundant reflow per press in an open panel.** `setOpen` in
      `lib/draw/bar.ts` always ends in `place()`; add
      `if (id === openId) return;`.

**Accepted limits** (correct behaviour a user may report as a bug):

- **A cover cannot reach inside a cross-origin iframe or a closed shadow
  root** - the words stay in the PDF. Not fixable without host permissions. The bar
  warns once per session (`FILL_NOTE`, `entrypoints/annotate.ts`); that warning
  is covered by a §9 matrix row only, no unit test. Full list of cover limits:
  `docs/ARCHITECTURE.md` Decision 20.
- **A cover hides text from the export, not the page** - screen-sharing while
  annotating hides nothing. Covers apply at print time and come off right after.
- **The cover pass runs synchronously in `beforeprint`** - ~21-26ms for a few
  covers, ~330ms for covers tiled over a 59,000px article (measured before
  tasks 38-40; re-measure before relying on it).
- **A mark in the blank tail keeps that tail** - the trim looks at pixels.
- **Fixed furniture not hidden** (Decision 7 text-share guard, or under
  `stickyMinHeight`) prints elsewhere than on screen, so marks on it look
  misplaced.
- **Ctrl+F may miss a phrase across a soft wrap in a label** - each line is its
  own text run (Decision 18).
- **A wrapped line can sit 1-2px past its box** - canvas metrics measure, SVG
  shaping paints. No fudge factor wanted.
- **The first part of a north/south handle drag on a wrapped label does
  nothing visible** - the drag baselines on the requested height, not the laid-out
  one. Reproduce on a one-line label.

## Later / maybe

- [ ] Firefox, via `tabs.saveAsPDF()` (`project.md` §1).
- [ ] Self-signed offline license keys (`project.md` §6.2) if vendor-API
      independence is ever wanted; the cost is running an issuing service.
- [ ] Revisit whether Preact earns its place if the popup stays this small.
