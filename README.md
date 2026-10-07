# pagepdf

Save any page as a PDF with **real, searchable text** that looks like the screen.
Free, unlimited, no account, no export counter.

Working name. See [PROJECT.md](project.md) for the product brief; this file covers
the state of the code and the places where it knowingly departs from that brief.

## Status

**v0.1 is implemented and builds** - the code of both weekends of the
two-weekend plan in §8. What is missing is store work, not code (below).

| §8 Weekend 1                                | State                                            |
| -------------------------------------------- | ------------------------------------------------ |
| WXT init, TypeScript, pinned versions        | done (`wxt` 0.20.27, exact pins)                 |
| Popup with the four toggles + Export         | done                                             |
| Single long page                             | done, via the one-click CDP path (Deviation 9)   |
| Pre-processing + `window.print()` + restore  | done                                             |
| Options page (toggles, filename template)    | done                                             |
| Icons                                        | done - generated, `pnpm icons`                   |
| Store screenshots, short description         | not done - needs a real listing                  |
| Privacy policy page                          | drafted, [docs/privacy-policy.md](docs/privacy-policy.md) - needs hosting |
| `wxt zip` -> upload                          | not done                                         |

> **Pro without a key is a dev-build behaviour, not a flag to remember.**
> `DEV_UNLOCK_PRO` is `import.meta.env.MODE === "development"`, so `pnpm dev`
> makes `isPro()` return true with no licence key and `pnpm build` cannot - the
> constant folds to `false` and the branch is dropped from the bundle (grep the
> production output for the warning string: it is not there). `pnpm test` runs
> as `test` mode, so the suites do not silently run as Pro either.

Weekend 2's code is in, and not as Pro: one-click export, the screen look and
single long page work over CDP (`handleScreenExport` in
`entrypoints/background.ts`) and are **free** - one click is the default
`exportMode`, and the print dialog is one switch away. **Pro is Draw mode, all
of it**, and nothing else (Deviation 24). See [BACKLOG.md](BACKLOG.md) for what was deferred.

**What is left before the first release is not code.** The licence path is
written and wired end to end (`lib/license/`, `components/license-form.tsx`,
`components/pro-dialog.tsx`); what it is missing is a Lemon Squeezy product to
point at, which is an afternoon in a vendor dashboard rather than a diff. The
same is true of the privacy policy, the screenshots and the listing copy.
BACKLOG.md's scope section is the list, in order.

How a feature gets from a brief to merged code is
[docs/SPEC-DRIVEN.md](docs/SPEC-DRIVEN.md).

## Commands

```bash
pnpm dev        # load .output/chrome-mv3 as an unpacked extension
pnpm build      # production build
pnpm zip        # store-ready archive
pnpm test       # vitest, 654 tests in 29 files over the pure helpers
pnpm compile    # tsc --noEmit
pnpm icons      # regenerate public/icon/*.png
```

To load it: `pnpm build`, then `chrome://extensions` -> Developer mode ->
Load unpacked -> `.output/chrome-mv3`.

## Keyboard shortcuts

Four, all rebindable by the user at `chrome://extensions/shortcuts`. The keys
in `wxt.config.ts` are *suggestions* - Chrome assigns at most four per
extension and silently drops any that one of its own shortcuts already owns.

| Command | Suggested | Does |
| --- | --- | --- |
| `save-pdf` | `Ctrl/Cmd+Shift+S` | One-click export, or the print dialog if that is the chosen `exportMode`. |
| `capture-page` | `Ctrl/Cmd+Shift+E` | Full-page screenshot. |
| `capture-area` | `Ctrl/Cmd+Shift+X` | Drag a rectangle, save that. |
| `draw` | `Ctrl/Cmd+Shift+K` | Open the drawing bar. Pro; without a key, a toast says so. |

A command is only ever a shortcut to a request the popup already sends
(`lib/commands.ts` maps name -> `BgRequest`), so a shortcut cannot drift from
the button beside it. Three consequences worth knowing:

- **A shortcut decides nothing.** `save-pdf` sends the same bare `EXPORT` the
  popup's button sends; `handleExport` reads `settings.exportMode` for itself
  and resolves single-page mode through `effectivePageMode`, so a keypress, the
  popup and the drawing bar's Save cannot pick different paths. The one command
  that can come back `PRO_REQUIRED` is `draw`: without a key the background
  refuses `ANNOTATE start` with "Draw mode is a Pro feature.", and
  `commandToast` puts that sentence in the page rather than let the keypress
  look ignored.
- **Outcomes are reported in the page, not in a popup.** `commandToast` decides
  what to say, and mostly says nothing - one rule, that nothing is said twice.
  The print dialog and the drawing bar are their own announcements, and a
  region capture already toasts from inside `handleCapture`, which is why
  `capture-area` is silent for every outcome from the moment the selector goes
  up (the `NO_TAB` / `RESTRICTED_URL` refusals that precede it still speak).
  What it does announce is the file a full-page screenshot or a one-click
  export wrote, and any error nothing else has shown. The toast is hosted by
  `select-area.ts`, injected for the purpose: installing that script adds a
  message listener and nothing else, so it cannot put the page into selection
  mode, and it guards its own double installation.
- **The toast goes to the tab the shortcut fired on**, which
  `chrome.commands.onCommand` hands over as its second argument, resolved
  before the work rather than after it. A one-click export can run for
  seconds; a user who has moved to another tab by then should not find "Saved
  foo.pdf" over a page that had nothing to do with it.

A shortcut fires on the same pages the toolbar button works on: executing a
keyboard shortcut from the commands API is one of the four gestures Chrome
documents as granting `activeTab` (alongside the action, a context-menu item
and an omnibox suggestion), so it is granted exactly as if the icon had been
clicked, `host_permissions` stays `[]`, and `commands` is not a permission -
the install prompt is unchanged.

The one place a shortcut is worse than the popup: **on a page that refuses
injection it is completely silent.** The popup greys its buttons out and says
why; a background worker's only surface is the one the refused injection would
have created. `project.md` §9 has the row.

## Layout

```
entrypoints/
  background.ts     service worker: orchestrates exports, re-checks the tab at every step
  prepare.ts        injected on demand: DOM pre-processing + window.print(); owns the prepared state
  select-area.ts    injected on demand: the drag-a-rectangle overlay for screenshots
  annotate.ts       injected on demand: the drawing bar, the layer, the pointer state machine
  popup/            Preact: single-page and print-dialog rows, Export button, Draw button, two screenshot buttons, PDF settings panel
  options/          Preact: defaults, export mode, hide rules, filename template, licence
lib/
  dom/              pre-processing: hide fixed, expand, un-clip, lazy-load, header, print CSS, viewport units
  draw/             the drawing feature's logic: shape model, geometry, freehand paths, SVG specs,
                    symbols, undo history, the two stylesheets, layer + bar builders, caret keys, prefs,
                    backdrop.ts - the curtain shown over the lazy-image sweep (Deviation 22)
  capture/          screenshot planning (clamp, scale, slice), formats, stitching
  pdf/              printToPDF params + sizing, painted-height scan
  cdp/              the only module that touches chrome.debugger
  license/          Lemon Squeezy activate/validate/deactivate, cached
  settings.ts       storage.sync, validating merge
  filename.ts       {title}-{date} templating and sanitising
  urls.ts           where we may and may not operate
components/ui/      shadcn components
stores/             Preact signals shared by popup and options
```

Message flow: popup -> background (`EXPORT`) -> `chrome.scripting.executeScript`
-> injected script prepares the DOM, replies, *then* calls `window.print()`
(replying first matters: `print()` blocks the renderer while the dialog is open).
That is the print path, `exportMode: "print"`. The default, one click, prepares
the DOM the same way without printing, then drives the tab over CDP -
`Page.printToPDF` with screen media emulated -> offscreen Blob URL ->
`chrome.downloads`.

Screenshots take a second route: popup -> background (`CAPTURE`) -> either the
area selector (`PAGE_SELECT_AREA`, which resolves when the user finishes the
drag) or the same DOM pre-processing, then `Page.captureScreenshot` per slice ->
stitched in the worker -> offscreen Blob URL -> `chrome.downloads`.

Drawing adds a third direction to the flow rather than a third route through it:
the injected script also talks *to* the background. Popup -> background
(`ANNOTATE`) injects `prepare.js` and `annotate.js`, prepares the page with
`hold: true` and sends `PAGE_ANNOTATE_START`; the bar's own Save and X come back
as `ANNOTATE_EXPORT` / `ANNOTATE_EXIT` with the tab taken from `sender`, because
no popup is open by then. An export from inside annotate mode runs the ordinary
export path unchanged - see Deviation 14.

## Screenshots

Two buttons under Export, both saving an image through the same download path
as the PDF and naming it from the same filename template:

- **Full page** pre-processes the DOM first - hidden sticky bars, expanded
  sections, lazy images, the optional header - because those settings are as
  useful in a picture as in a PDF, freezes scripts so the page cannot grow
  between the measurement and the capture, and trims the tail with the same
  painted-height scan the PDF export uses. Long pages are captured in slices
  (`SLICE_HEIGHT_PX`) and stitched back together in the service worker with
  `OffscreenCanvas`; a page past what one image can hold is scaled down and the
  popup says by how much, rather than failing or losing the bottom.
- **Select area** injects an overlay in a closed shadow root, dims the page and
  returns the rectangle the user drags, in document coordinates. It deliberately
  does *not* pre-process: the user drew a box around what is on screen, and
  moving the content out from under it would be the wrong picture. Picking an
  area means clicking on the page, which dismisses the popup - so the popup
  closes itself on purpose and the result is reported in the page instead.

Both need `chrome.debugger`, which the manifest declares (Deviation 1) and
one-click export needs as well; a build that ever drops it has to fall back to
`chrome.tabs.captureVisibleTab`, which cannot see below the fold.

**Format.** WebP by default, JPEG and PNG in Settings. This is not a
preference-for-its-own-sake setting: a full-page shot is a big picture, and PNG
is worst at exactly what a screenshot contains. Measured on Chrome 152, the same
1280x4000 canvas of text over a gradient: **PNG 4.8MB, JPEG 2.1MB, WebP 1.2MB.**
The first version saved PNG only and a real full-page export died with
`Message exceeded maximum allowed size of 64MiB` on the way to the offscreen
document - which is fixed properly (chunked transfer, below) but was also a
signal that PNG is the wrong default.

Slices are always captured as PNG and the *stitched* image is encoded once, so
nothing is compressed twice. Each format's own ceiling is respected when
planning the capture, because one of them is a trap: **WebP stores dimensions in
14 bits and Chromium truncates past 16,383px without a word** - a 1280x20000
canvas comes back as a 1280x16383 WebP with the bottom 3,617px simply gone. A
page taller than the chosen format allows is scaled to fit and the popup says by
how much. JPEG and PNG take the canvas's own limit (65,535px; 70,000 throws),
and in practice `MAX_IMAGE_AREA_PX` - 2^26 px, ~268MB of RGBA in the worker -
bites first.

**Large files cross in chunks.** `chrome.runtime.sendMessage` refuses anything
over 64MiB, so `lib/download.ts` sends 6MiB pieces under one transfer id and the
offscreen document assembles the Blob when the `final` chunk lands. The chunk
size is a multiple of 3 so each piece base64-encodes independently. PDFs take
the same path.

## Drawing

**Draw** in the popup marks the page up before it is saved, and it is the one
Pro feature - all of it (Deviations 15 and 24): pencil, highlighter, line,
rectangle, ellipse, the three fills below, seven symbols including an
auto-incrementing numbered pin, and text labels typed in place on the page.
Without a key the button carries a "Pro" badge and opens the Pro dialog
instead. Undo history is a stack of snapshots rather than of operations, which
is what makes **clear** itself undoable for one line of code.

**The fill is a pen setting, not a tool.** One menu on the bar serves both the
rectangle and the ellipse, with three options and a trigger that shows which one
is armed - so "why is my rectangle solid?" is answered by looking at the bar:

| Menu button               | The interior             | The text underneath                                    |
| ------------------------- | ------------------------ | ------------------------------------------------------ |
| **Not filled**            | outline only             | untouched                                              |
| **Filled - read-through** | translucent, 0.35 alpha  | untouched: still in the PDF, still findable            |
| **Cover - removes text**  | solid pen colour, no alpha | **hidden from the export, and not in its text layer** |

All three come with Draw mode, on the same side of the tier line as the pencil.
A tint is the mark for pointing at a region of a chart and claims nothing more -
you can read through it, which is what makes it obvious to the person drawing it that
nothing was taken out.

A **cover** is the one that makes a claim, and the claim is narrow and exact:
the characters it paints over are removed from the **exported** PDF's text
layer, so Ctrl+F in the saved file does not find them, and neither does a text
extractor. The same holds on all four outputs - the print dialog's
`window.print()`, one-click `printToPDF`, full-page PNG and region PNG. The **page** keeps its own text the
whole time you work: the covers go on for the duration of a capture and come
straight back off (which is what keeps undo a stack of shapes with nothing to
keep in step, and what makes exiting annotate mode safe), so screen-sharing
while annotating has hidden nothing yet.
The bar says the one limit that can hurt somebody in a sentence the first time a
cover is armed in a session - it cannot reach inside an embedded frame.
**Deviation 20 is the whole of what a cover does and where it does not reach.
Read it before touching `FillMode`, `FILL_OPACITY` or `lib/dom/cover.ts`.**

**A text label is a box, not a point.** A click places one - at the width the
last box was dragged to, 240px until you drag one - and while it is open it
carries a dashed frame with eight handles: drag the middle to move it, an edge
or a corner to resize it. The text **wraps** inside the box, with a word too
wide for the box broken between characters rather than run off the side of the
page, and the box **grows taller** as lines are added while keeping whatever
height you dragged it to. `Enter` inserts a newline; `Esc`, `Ctrl/Cmd+Enter` or
a click away commits. The frame is chrome, not a mark: it is not in the undo
history, and it never reaches a PDF or a screenshot - the label commits before
every capture, and the frame is hidden for as long as the layer is not
interactive.

**Every tool has its own cursor.** The pencil and the highlighter are their bar
icons, drawing from the nib; the line, the shapes, the symbols and the text tool
are a crosshair with a small badge of the tool, because each of those starts its
mark exactly at the press point. Black on a white halo so it reads on any page,
and a data-URL SVG with a keyword behind it - `crosshair`, or the I-beam for
text - for a page whose CSP refuses `data:` images (`lib/draw/cursor.ts`).

**Three saves on the bar.** **Save as PDF** takes whichever path `exportMode`
picks, **Save as PNG** is the full-page screenshot, and **Save selected area**
puts the area selector up over the marks and saves the rectangle you drag - the
popup's two screenshots, reached from where your hand already is. `Esc` during
the selection cancels the selection, never annotate mode.

**A bar panel is dismissed only by the bar.** The symbols palette stays up while
you place five marks out of it, and it survives a `<select>` or a menu in the
page underneath; its own trigger, another group's control, or `Esc` puts it away.
Deviation 19.

The marks are **real SVG in the real DOM**, which is the whole design: one
implementation reaches all four outputs that already exist - the print
dialog's `window.print()`, one-click `printToPDF`, full-page PNG and region
PNG - and none of them knows the feature is there. `lib/capture/`, `lib/pdf/` and `lib/cdp/` are
untouched. A label comes out of both print paths as a real `<text>` node in a
real font - one `<tspan>` per wrapped line - so **Ctrl+F finds it** (with the
one caveat in Deviation 18); a canvas overlay would have looked identical and
found nothing.

One dependency: `perfect-freehand`, pinned to `1.2.3` (MIT, no dependencies),
which turns pointer samples into a variable-width outline polygon that becomes
one `<path>`. The whole injected script - bar, layer, symbols, freehand, the
wrap, the frame, the cursors and the cover walker - builds to `annotate.js` at
**54.4 kB**, against 14.23 kB for `prepare.js` and 5.39 kB for
`select-area.js`. Measured with `pnpm build` on this commit; re-measure rather
than adjust the number by eye. No Preact, no Tailwind, no
lucide-react in there: the bar is hand-rolled DOM in a closed shadow root, like
`select-area.ts`, and its icons are inline lucide path data.

Nothing here touches `chrome.debugger`, and the manifest does not change - not
a permission, not a `web_accessible_resources` entry. `annotate.js` is injected
under `activeTab` exactly as `prepare.js` and `select-area.js` are (Deviation
3).

## Deviations from PROJECT.md

Each of these is a place where the brief could not be implemented as written, or
where following it would have hurt. Flagged rather than silently absorbed.

1. **`debugger` cannot be an optional permission.** §4.2 step 1 plans to call
   `chrome.permissions.request({ permissions: ["debugger"] })` at first Pro use,
   and §5 first listed it under `optional_permissions`. Chrome forbids it:
   `debugger` is on the list of permissions that can never be optional, together with
   `declarativeNetRequest`, `devtools`, `geolocation`, `mdns`, `proxy`, `tts`,
   `ttsEngine` and `wallpaper`. So what the brief planned as a per-user Pro
   opt-in became a whole-extension cost, and two answers were weighed: *(a)*
   declare it required, so every user sees the warning on install, or *(b)* a
   **separate Pro listing** that declares it, sharing this codebase.
   **Taken: (a)**, and it has stopped being a choice. One-click export - the
   free default since Deviation 24 - and screenshots (Deviation 13) both run
   over CDP, so the free tier needs `debugger` itself and a separate listing
   would have nothing left to keep it away from. It is declared from the first
   release, so no update ever adds it and no user gets a re-consent prompt.
   What a user who does not want Chrome's yellow "is debugging this browser"
   bar has instead is the print path, `exportMode: "print"`, which never
   attaches it.
2. **`downloads` and `offscreen` were left out at first, and are required
   now,** as §5 lists them. The first v0.1 cut used neither - Chrome's own print
   dialog saves the file - and shipping unused permissions invites a review
   bounce. That ended when one-click export and screenshots - both free now -
   began writing files themselves. There is no `optional_permissions` key in
   the manifest at all any more.
3. **The pre-processing script is injected, not declared.** §3 lists
   `entrypoints/content.ts`. A declared content script needs `matches`, and
   `<all_urls>` would put "Read and change all your data on all websites" on the
   install prompt - contradicting §5's `host_permissions: []`. It is an unlisted
   script injected via `chrome.scripting` under `activeTab` instead: same code,
   same reach, no warning.
4. **Tall single-page exports need no pdf-lib merge, and the ceiling is much
   higher than §4.2 says.** Two corrections. First, no merge is necessary:
   `printToPDF` paginates by itself, so asking for short paper on a long page
   returns *one* PDF of several sheets. Second, the "practical ceiling ~200in"
   is wrong - Chrome 152 produced an intact single page at every height tried
   up to 500in, and a competitor exports the same news homepage as one 213in
   page. `MAX_PAPER_INCHES` is therefore 500in, capped by render cost rather
   than by Chrome.
   `lib/pdf/print-options.ts` picks equal slice heights (avoiding a near-empty
   final sheet) and lets Chromium slice.
5. **Frontend is Preact + shadcn/ui,** which contradicts §2 ("Vanilla TS + small
   CSS... Popup is ~5 controls; don't ship React for it"). Done on request after
   the initial vanilla implementation. shadcn is React/Radix, so it runs through
   `preact/compat` aliasing; state is `@preact/signals`.
6. **`cn` comes from the `cn` package,** not a local `clsx` + `tailwind-merge`
   helper, per the first entry of the shadcn changelog (September 2026). There is
   no `lib/utils.ts`, and `components.json` has no `utils` alias.
7. **Fixed-element hiding has a content guard** not in §4.1: an element holding
   more than 20% of the page's text is never hidden, however sticky it is.
   Without it, a site whose main wrapper is `position: sticky` exports a blank
   PDF - and "content present, not blank" is a row in the §9 test matrix.
8. **The offscreen document arrived late.** §3 lists it; the first v0.1 cut had
   no use for it, because the print dialog saves its own file. It came with the
   first paths that write a file themselves - one-click export and screenshots -
   and it is also where large files are reassembled from 6MiB chunks
   (Screenshots, above).
9. **"Single long page" needs the one-click path - the print dialog cannot make
   one tall sheet.** This was briefly implemented in the print-dialog path on
   the assumption that CSS
   `@page { size: <w> <h> }` would size the sheet for `window.print()`, avoiding
   the `debugger` permission. It does not work, and the measurement is worth
   keeping: on Chrome 152 the same document rendered through `printToPDF` comes
   back as **1 page of 10.42x31.25in** with the CSS rule and **3 Letter pages**
   without it, in `px` and `in` alike - but through the *interactive dialog* it
   paginates to Letter/A4 regardless, because the dialog takes its paper size
   from its own dropdown. That is exactly why CDP exposes `preferCSSPageSize`.
   The row is therefore disabled, with the reason in its description, while
   the print dialog is chosen, and `effectivePageMode` resolves a stored
   `single` to `paginated` on that path rather than failing;
   `planSinglePageSize`, `lib/dom/page-size.ts` and the `pageMode` setting
   serve the one-click path unchanged. It was Pro until Deviation 24 made one
   click free; the limit was never the tier, it is the dialog.
10. **A single page cannot be sized while `vh` still moves.** §4.2 treats
   single-page mode as a measurement problem - measure the document, ask for
   that much paper. It is not, and this is what made "single long page" come
   back as two sheets with a band of blank space after the content. In paged
   media `vh` resolves against the *page box*, so the paper cut to the measured
   height becomes the new meaning of `100vh`: a `min-height: 100vh` wrapper or
   a full-height hero is re-laid-out page-tall, everything under it is pushed
   past the bottom edge, and Chromium adds a sheet. No paper size fixes it -
   raising the paper raises `100vh` with it. `lib/dom/viewport-units.ts` pins
   those lengths to the pixels they occupy on screen first, which is a no-op on
   screen and reversible. `height: 100%` on `html` is the same trap spelled
   differently, so the roots are pinned too. Confirmed on Chrome 152 against
   `Page.printToPDF`; the cases are listed in that module.
12. **The document's height is not where the page stops painting.** §4.2 sizes
   the sheet from the measured page, and on an ad-heavy site that measurement
   is far taller than anything visible: slots hold space their ads never fill,
   a feed frozen mid-load keeps the room it reserved, and hiding sticky
   furniture can leave a hole its parent still reserves height for. The paper
   is then one tall sheet ending in a blank strip - reported on wp.pl, and it
   goes away with "hide sticky bars" off. `lib/pdf/painted-height.ts` answers
   the question by measurement rather than heuristics: it takes a downscaled
   `Page.captureScreenshot` of the very page Chromium is about to print (136ms
   for a 19,000px page, 35ms for a 44,000px one) and finds the last row of
   pixels that differs from the bottom edge. A first attempt walked the DOM for
   elements with text or media in them; it could not see CSS backgrounds, so it
   needed guards against clipping, and the guards are what made it unreliable.
   Two things keep the pixel version safe: it only trims when the bottom edge
   still shows the page's own background somewhere (a full-bleed colour band is
   deliberate, and must not be cut), and a trimmed export caps its sheet count
   with `pageRanges`, because paper shorter than the document otherwise puts
   the remainder on *more* sheets - the very bug being fixed.
11. **Screen-media emulation makes the print stylesheet inert, including
   ours.** The one-click path renders with the site's screen CSS - the whole
   "looks like the screen" feature - so a `media="print"` `<style>` never
   matches. The forced-break reset that single-page mode relies on was
   therefore doing nothing there, and a `break-before: page` in a site's
   *screen* CSS split the export in two. `BREAK_RESET_CSS` is now injected
   unconditioned for that path (`injectUnconditionalCss`). The site's own print CSS stays inert, which is
   correct and is the point of the emulation.

13. **Screenshots are not in PROJECT.md at all.** Added on request: "save this
   page" means a picture about as often as it means a PDF, and every piece the
   feature needs was already here - CDP, the painted-height measurement, the
   offscreen download path, the filename template. They were free from the
   start, which made them for a while the one free feature that used the
   `debugger` permission above, while CDP was otherwise Pro's. Since Deviation
   24 one-click export is free too, so they are no longer an exception.

14. **Annotate mode inverts §4.1's pre-processing contract: the page is
   prepared once, and the pass is *held*.** Drawing is not in PROJECT.md at
   all, like screenshots - but unlike screenshots it changes something the
   brief does specify, which is why it is here.
   Every `PAGE_PREPARE` until now began by undoing the previous pass and
   re-running it, and every export ended with a `PAGE_RESTORE`; a mark cannot
   survive either. Pressing **Draw** therefore prepares the page *first* -
   `<details>` open, lazy images in, sticky furniture gone - and holds that
   pass, so an export from inside annotate mode reuses it instead of
   re-preparing. The order is the reason the feature works at all: draw first
   and prepare afterwards, and every mark below an expanded section drifts by
   however tall that section turned out to be. The page visibly rearranging
   when you press Draw is not a side effect to apologise for, it is a free
   preview of the export.
   The seam is deliberately tiny. An earlier plan tracked annotating tabs in
   `chrome.storage.session`, put a `keepPrepared` flag on `ExportRequest` and
   `CaptureRequest`, threaded it through all three export handlers and added
   `tabs.onRemoved` / `onUpdated` listeners to clear it. All of that is gone.
   What shipped is **two optional fields on two page messages that already
   existed** - `PAGE_PREPARE { hold }` and `PAGE_RESTORE { release }` - handled
   inside `entrypoints/prepare.ts`, which was already the single owner of
   prepared state. All three export handlers keep their bodies, and the
   `window.print()` path in `handleExport` gains nothing at all: the bar hides
   itself on `beforeprint`, so that path needs no help. What the two
   CDP paths gain is a stateless, best-effort `PAGE_ANNOTATE_UI` pair around
   each thing they photograph, so the bar stays out of the picture - one pair in
   `handleScreenExport`, and two in `handleCapture`, which photographs twice:
   one around `askForArea` in the region branch, because the selector wants the
   pointer, and one around the full-page capture itself. Two things fall out
   for free: an export started from the **popup** while marks are up is correct
   without the popup knowing annotate mode exists, and there is no per-tab
   state anywhere to get out of step or to clear - navigation takes the marks,
   the injected scripts and the `activeTab` grant with it, which is the right
   outcome and needs no code.

15. **The drawing tier gate is the door into annotate mode, checked once, and
   that is weaker than an export-time check on purpose.** Draw mode is Pro, all
   of it (Deviation 24). `handleAnnotate` calls `isPro()` at `ANNOTATE start`,
   before the URL check and before anything is injected, so a free browser gets
   the same `PRO_REQUIRED` - "Draw mode is a Pro feature." - on every page. The
   popup's Draw button shows a "Pro" badge and opens the Pro dialog rather than
   start a session the background would refuse, and the `Ctrl/Cmd+Shift+K`
   shortcut shows the refusal as a toast in the page. All three fill modes, **Cover included**, are on the same side of
   that line as the pencil: gating the honest mode separately from the
   translucent one would be exactly backwards.
   It used to be a split *inside* the bar. Five free tools - pencil,
   highlighter, line, rectangle, ellipse; the number moved and came back when a
   filled rectangle and a filled ellipse were briefly two more tools, before the
   fill became a pen setting (Deviation 20) - and Pro for the seven symbols and
   text labels, which the bar rendered locked. Once the whole mode went behind
   the door that machinery locked nothing, and it has been removed: the bar
   always offers every tool and carries no tier logic of its own.
   What the gate does not do is worth stating rather than assuming. **A mark is
   already in the DOM by the time anything exports**, so the only export-time
   enforcement available would be to strip shapes out of the layer before
   capture - i.e. to make a user's labels silently vanish from their own PDF.
   We are not doing that. Nothing is re-checked before printing, a key that
   lapses mid-session leaves that session open, and anyone willing to open
   devtools on their own page can draw a pin. At $5 with no counter anywhere
   (§6.3), that is the right trade.

16. **The drawing layer is one small `<svg>` per mark, never one document-tall
   one.** An `<svg>` root inside HTML is a **replaced element**, and a replaced
   element is monolithic: CSS fragmentation cannot split it across two printed
   sheets. A single `<svg>` covering an 8,000px document is therefore laid out
   on the first fragmentainer and clipped, and *every mark below page 1
   disappears* - which is the entire feature. So each mark gets its own
   absolutely positioned `<svg>`, sized and offset to that mark's own bounding
   box in document coordinates, with the geometry translated into the box's
   local space by a `<g transform>` (a `viewBox` would divide by the box's own
   width and height - zero for either disables rendering per the spec - and
   would also scale by Chrome's 1/64px used width, putting every mark a hair off
   the word it was drawn around). A 40px box only straddles a page boundary by
   accident of where it landed, so Chrome puts each mark on the sheet its
   coordinates fall on. The box is padded outward per kind and rounded outward
   to whole pixels, because a box a hair too tight shaves the edge off the mark
   inside it.
   **The residual:** a single mark taller than one printed sheet is still one
   unfragmentable `<svg>`, so one very long vertical drag loses everything below
   the first break. One `<svg>` per mark is already the smallest box each mark
   can have; splitting a single shape's geometry per sheet is the only fix and
   it is not worth what it costs.
   The wrapper around them all is `position: absolute` and sized to exactly
   `scrollWidth x scrollHeight`, for two separate reasons: a `fixed` layer would
   repaint on every printed sheet (which is what `lib/dom/hide-fixed.ts` exists
   to undo), and the clip stops a stroke dragged past the bottom edge from
   growing `scrollHeight` - that number *is* the paper size the one-click path
   measures. It clips with `overflow: clip` rather than `hidden` because
   `hidden` also makes the box a **scroll container**, and a scroll container is
   monolithic under the older fragmentation rules - so the wrapper itself might
   have refused to break across sheets, the same class of bug as the
   document-tall `<svg>` one level down. `clip` clips identically and still
   keeps scrollable overflow from reaching an ancestor, so nothing is given up;
   it is Chrome 90+ against a `minimum_chrome_version` of 109.

17. **A filled shape ships, and the plan for the phase before it said it would
   not.** `.plan/tasks/16-phase2-tools.md` put "a redact or cover tool, under
   any name" out of scope, and `lib/draw/render.ts`'s `rect` case used to say
   the same thing on the line that set `fill: "none"`. A filled rectangle *is*
   that box, so read this before touching `FILL_OPACITY`.
   The request is legitimate - a colour block is how you point at a region of a
   chart, and circling something in solid colour is a normal annotation - so it
   ships on the three terms `docs/features/DRAWING.md` §6 said it would have to
   ship on (`.plan/design.md` §11.1): **`FILL_OPACITY = 0.35`** on the interior
   only, via SVG `fill-opacity` and never `opacity`, so the outline stays solid
   and you can read through the fill (the precedent is `HIGHLIGHT_OPACITY = 0.4`,
   which exists for the same reason); the buttons never say "redact" or "black
   out"; and the bar's note line says the limit in one sentence, once per
   session, at **both** ends of it. The plan's "first press of either tool"
   alone would have leaked: the pen persists, so a bar left armed starts every
   later visit already holding it, and a press-only trigger would say the
   sentence once *ever* - on the visit where the button was first pressed - and
   stay silent on all the visits where the blocks actually got drawn. So it is
   also the line the bar opens on when a session starts out armed, and one
   session flag keeps the two triggers from saying it twice.
   **Plainly, because it is what the translucent fill still means: a tint hides
   text from the eye and does not remove it.** Text under a
   *"Filled - read-through"* shape is still in the exported PDF, still
   selectable and still findable with Ctrl+F. Anyone who covers a password, a
   name or an account number with a tint and then sends the PDF has published
   it. Do not raise the alpha to fix that - `FILL_OPACITY = 1` gives you a block
   that looks like a removal and performs none, which is strictly worse than
   either honest mode.
   **Superseded in part by Deviation 20.** Two of the sentences above were
   written when a fill could only ever be a tint, and both have since been
   overtaken on the user's instruction. There is no "Filled rectangle" or
   "Filled ellipse" button any more - the fill is a pen setting with one
   three-option menu, so the labels are *"Not filled"*, *"Filled -
   read-through"* and *"Cover - removes text"* - and the note line's sentence is
   now the cover's, because a tint needs no warning it does not earn. And the
   opaque mode this entry sent to `BACKLOG.md` **is built**, though not as the
   raster described there: read Deviation 20 for what actually removes the text
   and where it fails to. What survives unchanged is everything in this entry
   about the *tint*, which is why the entry stays.
18. **Ctrl+F may not match a phrase that straddles a soft wrap.** A wrapped
   label is one `<text>` node with one `<tspan>` per rendered line, and each
   `<tspan>` is its own text run - so searching the exported PDF for a phrase
   whose words fall on either side of a line break can come back empty. **A
   single word is never split by a soft wrap, so single words always match**,
   and a word too wide for its box is the one exception: it is broken between
   characters on purpose, because a URL running off the side of the page is
   worse. This is how every wrapped text in every PDF behaves - it is not
   something this feature does to you - and it is written down because somebody
   will find it. The check in §9 of PROJECT.md is deliberately a word from a
   line that is *not* the first: that catches a build where the later lines are
   not real text at all, which is the failure that matters.
19. **A bar panel is dismissed only by the bar,** which is a deliberate reversal
   of the first pass's close-on-outside-press. Nothing that happens in the page
   closes a panel: not a stroke, not a `<select>`, not a JS menu, not a focus
   trap. The first version closed on any `pointerdown` outside the bar's host,
   and the press that *starts a stroke* is such a press - so the symbols palette
   shut itself the moment you used what you had just picked out of it, and
   placing five arrows was five presses of the trigger. The whole policy is now
   `popoverAfterPress` in `lib/draw/bar.ts`, pure and asserted rule by rule in
   `tests/draw-bar.test.ts`: a group's own trigger toggles its panel, a press
   inside the open panel keeps it open, a press on another group's control puts
   it away, the bar's own chrome changes nothing, and `Esc` closes it before it
   can reach the mid-drag cancel or the exit. A capture-phase `window` listener
   went away with the rule, on every page annotate mode runs on.
   Two consequences, both accepted. A panel **can be open across a capture** -
   `setVisible(false)` no longer closes it - and that is safe rather than
   lucky: the whole bar host goes to `display: none`, panel included, so nothing
   of it reaches the output, and the bar comes back as it was left. And a panel
   left open is simply more bar, sitting over the page and eating presses in its
   own area; the grip is the answer and it already exists.
   What this does **not** fix is the extension popup closing when focus leaves
   it. That is Chrome closing a browser-action popup and no extension can
   prevent it - which is why the in-page bar carries its own Save and Done
   (Deviation 14).

20. **A cover that really removes the text - and the instruction that asked for
    it named a raster, which is not what does the job.** Deviation 17 refused an
    opaque fill and wrote down why: a filled rectangle over a password would
    hide it from the eye and leave it selectable in the PDF. The concern was put
    to the user, and their answer was that a filled shape **must** cover the
    text underneath and that the area has to be rasterised. That is their call
    to make. The mechanism is not, and this is the entry that says why the
    mechanism is different from the one named
    (`.plan/design.md` §17.1 and §21).

    **A raster does not do it.** Two independent reasons, either one fatal:
    - Chrome's print paths emit a **text layer built from the DOM**. Painting a
      bitmap *over* a paragraph does not remove that paragraph's text runs from
      the layer, so `Ctrl+F` still finds every word of it and so does any PDF
      text extractor. The pixels would be covered and the text would be
      published - a tool that looks like it redacts and does not, which is worse
      than the tint it replaced, because the tint at least looks like what it is.
    - A raster of the covered region needs `Page.captureScreenshot`, which is
      CDP, which is `chrome.debugger` - and `CLAUDE.md`'s first invariant is
      that **the print path never touches it**. A cover has to hold on
      `window.print()` as much as on `printToPDF`, so a raster cover would have
      been impossible on one of the two routes it must work on. It costs the
      invariant and buys nothing.

    **What removes text from the PDF is removing it from the DOM's text layer.**
    `lib/dom/cover.ts` measures every character under a cover with a `Range`,
    splits the text node, and wraps each covered run in an element carrying
    `visibility: hidden !important`; then the shape paints an **opaque** fill
    over the gap. `visibility: hidden` preserves layout exactly - the box is
    still there, still the same size, still holding its place - and hidden
    content is not painted, so Chrome has nothing to put in the text layer for
    it. No CDP, no raster, and no reflow except in the one case at the end of
    this entry. It behaves identically on `window.print()` and on `printToPDF`
    because it is a property of the DOM rather than of the capture. The PNG
    paths needed nothing at all: a screenshot has no text layer, so an opaque
    fill was always a true cover there.

    **The wrapper is a `<span>`, or a `<tspan>` inside an `<svg><text>`**, and
    that is not a nicety. `createElement` is namespace-blind, so a cover over an
    SVG chart label used to wrap the glyphs in an *HTML* `<span>` sitting in the
    SVG namespace - an element SVG renders nothing for and lays out none of the
    children of. The `<text>`'s rect collapsed from `[40, 206, 214, 24]` to
    `[40, 200, 0, 0]`: the glyphs **left layout** instead of staying hidden in
    place, and every label after them on the chart moved. `getComputedStyle`
    read `visibility: hidden` in the broken case too, so only measuring the rect
    caught it. `<foreignObject>` is subtracted from that test and is the same
    bug mirrored - it is in the SVG namespace like everything else under
    `<svg>`, but it is the one SVG element whose children lay out as HTML, so a
    bare text child of it needs a `<span>` and got a `<tspan>`
    (`[10, 470, 203.11, 20.5]` to `[0, 0, 0, 0]`).

    **A character's `Range` box is not its ink, and that cost a user a whole
    paragraph.** The box is the *font box* - the ascent and descent of the whole
    face, plus any half-leading the line box adds - not the extent of the glyph
    in it. Measured on the article that produced the report, 18px Roboto in a
    724px column at `line-height: 26px`: the box is 21px tall (ascent 17,
    descent 4) while the lines sit 26px apart, so there is a **5px gap of empty
    leading** between one character's box and the box of the character below it,
    and the ink inside the box reaches 13.5px above the baseline and 3.84px
    below it for a glyph with a descender, 0.18px for one without. A cover edge
    dropped in that gap paints over neither line. It took one anyway: the drawn
    block `{y: 1386, h: 52}` at the default 4px pen becomes `{y: 1384, h: 56}`
    once `coverAreas` widens it by half the stroke, and a painted top of 1384
    sits 3.8px below line 1's last ink and exactly level with the bottom of its
    font box - which `intersects` counts as a hit, because a shared edge counts.
    Every character on a line shares one `y`, so all 83 characters of that line
    were called covered at once; `coveredRuns` then merged them with the lines
    actually under the block into one run, and the paragraph became a single
    hidden element. Every word gone from the export, including the line above
    the block that nothing was ever painted over. That is what "a cover ate my
    paragraph" was.

    **The fix tests the ink, and it measures it per line.** The walker measures
    how much of each character box is empty - canvas `measureText`,
    `fontBoundingBox*` minus `actualBoundingBox*`, in the element's own computed
    font, never ours - and `coveredRuns` shrinks each box vertically by that
    before testing it. The x axis is untouched and stays greedy: a character
    clipped at its left or right edge is still covered. **Per line, not per
    node**, because `actualBoundingBox*` is the union over every glyph in the
    string it is handed, so one descender anywhere in a paragraph collapses the
    bottom inset to about 0.16px for *every* line in it - including the lines
    that have none, whose ink really stops 3.82px above their font box. Measured
    whole, the reported cover cleared the line above it by 0.16px, one step of
    the 0.25px sweep, which is a coincidence and not a fix; measured per line it
    clears by 3.82px. Swept across the whole 5px gap at each pen, the share of
    it that still takes the line above went from 1.25 / 2.25 / 4.25px to
    **0 / 0 / 0.25px** (`tests/draw-model.test.ts`, on §31.1's fixture).

    **What is left of that, exactly, because it is not nothing.** A cover's
    *painted* top edge is half a pen above the edge that was dragged - 4px at
    the 8px pen - and a line whose own glyphs descend has only ~0.16px of empty
    descent to inset away. So on a paragraph whose **line above the block**
    holds a `p` or a `y`, the same sweep leaves 1px, 2px and 4px of the 5px gap
    taking that line at the 2px, 4px and 8px pens; on a line with no descender -
    the reported case - it leaves 0, 0 and 0.25px. (`1 / 2 / 4` is the row
    `tests/draw-model.test.ts` files under "the node measured whole", and the two
    are the same arithmetic: what the share depends on is the inset of the line
    *above* the block, and measuring whole is what gives that line its
    neighbour's descender.) In every one of those
    positions the block's own ink really does land on that line's deepest glyph,
    and the rest of the line goes with it under the greedy rule below. Note what
    changed about this sentence: before the per-line measurement the whole
    residual was written down as "the greedy rule working", and it was not -
    2px of the 4px pen's gap were still taking a line nothing was painted over.
    That half was a defect and it is gone; what is quoted here is the half that
    is the pen.

    **A cover reaches into the page's open shadow roots. It cannot reach into a
    closed one.** Neither `createTreeWalker` nor `querySelectorAll` crosses a
    shadow boundary on its own, so a cover dragged over a web component's text
    painted an opaque block and left every word of it in the PDF - and a page
    that renders itself inside `document.body.attachShadow({mode: "open"})` had
    **nothing** hidden at all: `runs: 0`, `fields: 0`, its markup byte-identical
    under a cover. That is the under-hiding direction, the one the feature
    exists to prevent, and it was a leak rather than a limit because the root
    was there to be walked all along. The walk now enters every open root it
    finds - including the walk root's own, which is the case the whole-document
    version of that leak hid in - and the field pass sweeps each of them too, so
    an `<input>` inside a component is blanked like any other.

    **A human verified this at a real print dialog, and that is the only reason
    it is known to be true.** Nothing in this repository can check it -
    `CLAUDE.md` is explicit that headless renders, unit tests and inspecting
    injected CSS have all reported the dialog working while the dialog
    disagreed. So `.plan/tasks/30-probe-hidden-text.md` was run by hand before a
    line of the feature was built: a word inside a `visibility: hidden` span, a
    word either side of it, exported to PDF from Ctrl+P and searched in the PDF
    viewer. The hidden word returns **0/0**; both visible words are found, and
    they sit either side of a gap exactly the width of the hidden one. Recorded
    with its own caveat, which is not glossed here either: the probe ran the
    synthetic case, where it built the span itself, and not the
    wrap-a-run-inside-a-real-paragraph case the shipped tool performs. There is
    no reason to expect them to differ - same computed style, same kind of
    inline box - and the §9 matrix rows below are where it would show up.

    **The covers are applied around a capture and taken straight off again**,
    bracketed by `beforeprint`/`afterprint` and by the `PAGE_ANNOTATE_UI` pair
    the CDP paths already use, never at commit time. Undo therefore stays a
    stack of shapes with nothing to keep in step, nothing rewrites the DOM under
    the user's hand mid-drawing, and `restore()` runs on every single use rather
    than on a rare error path. `onBeforePrint` is synchronous, so this is on the
    critical path of opening the print dialog and it was measured rather than
    assumed: on a 59,000px Wikipedia article (~179k characters, 16.8k elements)
    three 752x400px covers hiding 195 runs cost **21-26ms**, with the restore at
    3-5ms. Nearly all of that is the element pre-filter, not the covers - one
    cover over one line of the same page costs ~14ms. Covers tiled over the
    whole document hide 9,584 runs at ~330ms, which is a page nobody draws.
    Those numbers were taken **before** the three fixes above: the pass now also
    runs a handful of `measureText` calls per covered node and walks the page's
    open shadow roots, neither of which has been timed. Both are small beside
    the per-character `Range` loop that dominates, and neither is a reason to
    quote a number that was not re-measured - re-measure before relying on these.

    **Now the limits, because a tool that claims to remove text has to be exact
    about where it does not.** They are two different kinds and the difference is
    worth keeping straight: a cover cannot reach **another document**, and it
    cannot hide **text in this document that no node owns**. The first kind is
    about reach, the second about there being nothing there to hide.

    *Another document.*

    **A cover cannot reach inside a cross-origin iframe.** The drawing layer
    paints *over* the frame, so on screen it looks covered; the frame's text
    belongs to another document that this extension cannot touch, and Chrome
    prints it. **This is a genuine leak, and it is the one item here a user
    could be harmed by**: a solid block over an embedded tweet, video card,
    comment widget or payment form hides nothing in the exported PDF. The bar
    says exactly this in its note line the first time a cover is armed in a
    session - *"Cover hides the text under it from the export. It cannot reach
    inside an embedded frame."*

    **A cover cannot reach inside a closed shadow root**, and that is the same
    *shape* of limit from inside our own document. `attachShadow({mode:
    "closed"})` hands a page a subtree that nothing outside it can enumerate -
    `el.shadowRoot` is `null` for one, and there is no other way in - so a cover
    over a closed component's text paints a block and leaves the words in the
    PDF. **Open** roots are covered now, which is the ordinary case: a web
    component, or a whole page rendered into `document.body.attachShadow`. Two
    things keep this from reading worse than it is. It takes a page that
    deliberately closed its own components, which is rare next to the open
    default. And it is exactly what keeps this walk **off our own marks** - the
    drawing layer and the bar are closed roots, so a label's own text is the one
    thing in the capture that cannot be split and hidden by mistake. Related and
    much smaller: a shadow root whose **host sits inside a skipped subtree** -
    `SKIP_TAGS`, the eight the walker never enters - is not entered either,
    because the walk rejects the subtree before it ever returns the host. That is
    consistent rather than costly: those subtrees are skipped precisely because
    their text is never laid out (`<script>`, `<style>`, `<noscript>`,
    `<template>`, `<datalist>`, and an `<iframe>`'s unrendered fallback) or is
    blanked whole by the form-control pass instead (`<textarea>`, `<select>`).
    It is listed for completeness rather than because anyone is likely to meet
    it.

    *Text no node owns.*

    **CSS-generated content is not hidden.** `::before` / `::after` `content`
    strings and list markers are text that belongs to **no node**: there is
    nothing for a `Range` to measure and nothing to wrap, so the walker cannot
    even tell which generated strings a cover paints over - and Chrome does put
    them in the printed text layer. A covered `<li>`'s bullet or number
    survives, and so would a `content: attr(data-...)` string. Low severity in
    practice, and unfixable from where the walker stands, which is why it is
    written down rather than asserted away. The class of failure is real - a
    `<select>`'s selected option is painted by the browser's own widget and had
    exactly this shape, but that one *was* fixable from here and was fixed:
    `input, textarea, select` are all blanked whole, since a half-hidden field
    is not something anyone wants.

    **`alt`, `title` and `aria-label` are not hidden**, because Chrome does not
    put them in the text layer. If that ever changes, this list is where to
    look. **Text painted into a `<canvas>` or baked into an image is pixels**,
    so an opaque cover genuinely removes it - the one case that needs nothing.

    *And two places the walker is pointed at the right document and still
    misses.*

    An element that *has* a box but paints text outside it - `white-space:
    nowrap` spilling out of a narrow block with `overflow: visible` - has a
    non-empty rect that genuinely misses the cover, so a cover over the spilled
    part alone finds nothing to hide. (An element with **no** box, `display:
    contents` most obviously, is handled: an empty rect means *unknown*, not
    *nowhere*, so the pre-filter falls through to the exact per-character test
    instead of skipping the subtree. It skipped it once, and a cover over
    `<div style="display:contents">secret</div>` painted a block and published
    every word of it.)

    And inside a subtree scaled by a **CSS transform**, the ink inset above is
    measured in the wrong space: `getBoundingClientRect()` is in the transformed
    space and canvas `measureText` is not, so the inset can come out larger than
    the box it is applied to. It errs towards *hiding* rather than leaking - a
    box left with no height keeps a 1px band at its ink centre instead of
    collapsing, because a zero-height box is invisible to the test and that is
    the under-hiding direction - so the symptom is a line hidden slightly more
    readily than elsewhere, not a word left in the file.

    **It removes text from the export, not from the page.** The page under the
    bar keeps its text the whole time you work - that is what makes a cover
    undoable and the restore safe. Anyone screen-sharing while annotating has
    hidden nothing yet.

    **It is not a certified redaction.** No claim is made about metadata, about
    embedded objects, or about a PDF consumer that reconstructs text some other
    way. The button says "Cover - removes text" and that is the whole of the
    claim: the covered characters are not in the exported PDF's text layer.
    Never "redact", never "black out".

    **One known bug, which is not a limit and is not on that list.** Covering a
    **MathML** expression grows it and does not put it back: a cover over an
    `<mi>` takes its rect from 11.16 to 18.5 tall, and `restore()` leaves it
    there. Every item above is about text a cover fails to remove; this one is
    the page not coming back, which outlives the handle and is worse in kind, so
    it is filed as a bug in `BACKLOG.md` rather than written up here as accepted
    behaviour. It predates this pass - the same wrapper, an HTML `<span>`, in
    both the before and after of the namespace fix - and it is the only known
    case where `restore()` does not put the page back.

    **Two smaller things it does to your page, both correct and neither worth a
    code change.** `restore()` calls `normalize()` on each parent it split,
    which is contract-mandated and is what makes a second pass measure the same
    geometry as the first - but `normalize()` merges *every* descendant text
    node of that parent, not only the ones this pass created, so a framework
    holding references to adjacent text nodes it rendered separately would find
    them merged. And the wrapper - `<span>`, or `<tspan>` in SVG - forces only
    `visibility`, so a page-wide `span { }` type rule still matches it: "adds no
    box of its own" is a claim about the default UA style, not a guarantee. Forcing
    a full reset instead would trade a rare page for a certain one -
    `display: inline !important` is the wrong answer inside a flex or grid
    container - so the narrow declaration stands and the claim is qualified.

    Three things about the geometry, because they are what keep "hidden" and
    "painted" the same set of characters - the third being the ink inset above,
    which is the same argument on the y axis. A character is covered if its box
    **meets** the cover at all, not if it is contained and not by its centre:
    over-hiding is invisible under an opaque block, while under-hiding is half a
    glyph of a password showing at the edge, noticed after the file was sent. And
    the region tested is the one actually painted - `coverAreas` widens each box
    by half its stroke width, since SVG centres a stroke on its path, and an
    **ellipse is tested as an ellipse** rather than through its bounding box.
    The bounding box is about 27% larger (4/π) and all of the difference is in
    the four corner lobes, so the approximation hid words with nothing painted
    over them: gone from the export, with a blank where they were.

21. **Keyboard shortcuts are not in PROJECT.md either,** and they add no
    permission. §5's `host_permissions: []` survives untouched because
    `commands` is a manifest field rather than a permission, and because Chrome
    counts executing one of them as an extension invocation - so `activeTab` is
    granted on the keypress exactly as it is on a toolbar click, and the
    install prompt does not change. They were built to be the thinnest possible
    layer: `lib/commands.ts` maps a name to the `BgRequest` the popup already
    sends and decides nothing. Everything - the tab, the export path
    (`settings.exportMode`, Deviation 24), the page mode, the restrictions, and
    the one tier check, Draw's - is decided by handlers that existed before.
    The one thing genuinely new is where the answer goes. There is no popup, so
    `commandToast` reports in the page through the area selector's shadow root,
    and it stays quiet wherever some other surface has already spoken. That is
    not politeness: `select-area.ts` keeps a single removal timer, so a second
    toast clears the first one's timer while removing only its own host, and
    the duplicate is the one that stays on the page until the user navigates.

22. **A curtain covers the pre-processing sweep, and it is `position: fixed` -
    the one thing the drawing layer may never be.** Lazy-loading scrolls the
    page to the bottom and back, which read as the extension breaking the page.
    `lib/draw/backdrop.ts` puts a translucent (50%) overlay in its own closed
    shadow root over the viewport for the duration of the pass, with a title and
    a line saying why, after a 180ms delay so a fast page never flashes one. It
    is `fixed` because it covers the *viewport* while the document scrolls
    underneath; an absolute curtain would scroll away with the sweep it exists
    to hide. That is safe only because of the second half: `entrypoints/
    prepare.ts` takes it down in a `finally` **before** it answers the
    background, so it is gone before `window.print()`, before any CDP capture
    and before a mark can be drawn. Nothing here ever meets a printed sheet.
    It is shown for **every** sweep, not only annotate mode's: a popup export
    has already closed its popup by then, so it is the path with *less* on
    screen, not more. Translucency and the wording were each decided twice -
    the history is in the module's own comments and `.plan/contracts.md` §32.2
    to §32.4, and it belongs there rather than in the code as an option.

23. **The save buttons on the drawing bar are not labelled, and that was
    measured rather than assumed.** `.plan/contracts.md` §33 specified `PDF`
    and `PNG` lettered inside the glyphs so the buttons say which is which
    without a hover. It was built, rendered at 16, 24, 64 and 128px, and
    retracted in §33.4: at the bar's real 16px the three letters are a grey
    smear, and they swallow the down-arrow that is currently the only thing
    distinguishing the two silhouettes - so it made the bar worse, not better.
    The buttons keep `file-down` / `image-down` and the full sentence in their
    tooltip and accessible name. The third, **Save selected area**, came later
    and follows the same rule with lucide's `crop` - the popup's own "Select
    area" icon, and a silhouette nothing else on the bar shares. §33.3's fallback, a wider labelled button, is
    the honest way to reopen this; shrinking the glyph to fit letters is not.
    Do not re-attempt it without reading §33.4 first.

24. **Everything is free except Draw mode - §1's tiers, turned around.** §1
    put the CDP path behind the $5: one-click export, the screen look and
    single long page. What ships splits the other way. **Free:** one-click
    export over CDP (`Page.printToPDF` with screen media emulated, straight to
    Downloads), the screen look, single long page, the print-dialog path, both
    screenshots, the four shortcuts and all of the pre-processing. **Pro:**
    Draw mode, all of it - every tool, every fill including Cover, the symbols
    and the text labels (Deviation 15 has the gate). The licence flow did not
    change; only what the key unlocks did.
    - **The export path is a setting, not a tier.** `settings.exportMode` is
      `"screen"` - one click, the default - or `"print"`, Chrome's dialog.
      `ExportRequest` carries no mode: `handleExport` reads the setting itself,
      so the popup, the shortcut and the drawing bar's Save cannot disagree.
      The popup's main view has two rows, "Single long page" and "Use the
      print dialog", and the options page the same pair; single long page is
      disabled while the dialog is chosen (Deviation 9), and
      `effectivePageMode(stored, mode, override)` paginates every `"print"`
      export whatever is stored.
    - **The free default now shows Chrome's yellow "is debugging this browser"
      bar while it runs.** That is the price of one click, and the popup's hint
      line says so under the Export button. The print path is the way out, and
      it is only that because it never attaches `debugger` - `CLAUDE.md`'s
      first invariant, which used to read "the free path" and now reads "the
      print path".

    Batch was dropped from the product rather than deferred, and `pdf-lib`,
    which by then only batch's merge needed (Deviation 4), went with it.

## Toolchain notes

- `wxt` is pinned to **0.20.27** exactly. Per §2, do not float it: 0.21 moves the
  entrypoint helpers again. In 0.20, `defineBackground` and friends come from
  `wxt/utils/define-background`.
- `vite` is pinned to **6.4.3** via a pnpm override. wxt 0.20 would otherwise
  resolve vite 8 while vitest 3 pins vite ^6, and two copies of vite means two
  incompatible copies of its types. Every consumer here accepts 6.x.
- pnpm 11 no longer reads the `pnpm` field in `package.json`; build-script
  approval and overrides live in `pnpm-workspace.yaml`.

## Testing

`pnpm test` covers the pure logic: filename sanitising, URL gating, the
fixed-element predicate, printToPDF planning and slice maths, licence cache
expiry, settings migration, and `effectivePageMode` against both export modes.

`tests/capture-plan.test.ts` and `tests/capture-format.test.ts` cover the
screenshot planner the same way: drag normalisation, clamping to the document,
the fit-to-one-image scale (including WebP's much lower ceiling), the slice
maths, the format table, the PNG header reader and the transfer chunking.

Three things there were measured in a real Chromium rather than assumed, and the
numbers are in the code comments: the format sizes above, WebP's silent 16,383px
truncation, and that `OffscreenCanvas` allocates at 65,535px but not at 70,000.
The overlay was driven by hand in a harness page (drag, Esc, the size badge, the
status toast) and the stitch was run end-to-end there too - two PNG slices in,
one WebP out, seam and dimensions checked. What still needs the extension loaded
in Chrome is the part only CDP can do: the clips themselves and the saved file.

`tests/commands.test.ts` is the one suite that reaches outside `lib/`: it
imports `wxt.config.ts` and pins the `commands` block against `CommandName` -
four names, matching exactly, each with a description and a `mac` key, none
`global`. That seam is otherwise invisible. A command in the manifest that
`isCommandName` rejects is a key the user presses and nothing happens, and
nothing else in the build would have said so.

The drawing feature is thirteen suites, one per `lib/draw/` module
(`tests/draw-<topic>.test.ts`): the shape model, the geometry (shift-snap, the
square constraint, arrowheads, the measured anchor correction,
clamp-to-viewport, the popover flip), the freehand path builders and their
rounding, `shapeToSpec` for all six kinds and all three fill modes, the symbol
geometry, the undo history, the two stylesheets' load-bearing rules,
`layerBoxStyle` and `markSpec`, the caret's keyboard predicates, the bar's
groups, the prefs merge, the label wrap, and the editor frame's zones and
resize maths. A fourteenth, `tests/cover.test.ts`, covers the pure half of
`lib/dom/cover.ts` - which characters a cover removes, including the exact
ellipse hit test - and it is named for its module rather than as a `draw-`
suite because hiding a page's own text is surgery on the page, in the family of
`hide-fixed.ts`. `markSpec`'s suite is the one worth knowing about: it re-derives each
kind's painted extent from the `d` and attributes the renderer produced and
asserts the mark's box contains it, which is the check a box too tight to hold
its own mark cannot pass.

**What is manual there, by design.** The bar, the layer mount and the pointer
state machine get `pnpm compile` and a human, not a harness - they are DOM and
pointer plumbing, and `tests/` is plain vitest with no DOM harness on purpose.
The entrypoint is also where the one bug that mattered lived: the symbol tool
borrowed `isDegenerate` as its "that was a click" test, so every deliberate
horizontal or vertical drag committed as a small down-right arrow instead, and
there was nothing in a fully green suite for it to fail on. That arithmetic is
now `symbolRect` in `lib/draw/symbols.ts` with a test beside it, which is the
general lesson: anything with a decision in it goes to `lib/draw/`.

**One thing in there has no automated guard at all, and it is a sentence a
user's privacy leans on.** `FILL_NOTE` - the once-per-session line saying a
cover cannot reach inside an embedded frame - is asserted nowhere. A reviewer
deleted its session-start branch outright during task 33 and all 625 tests
passed with a clean compile; the nearest test pins only the premise, that the
pen persists. That is inherent rather than an oversight: both triggers live in
`entrypoints/annotate.ts`, and `tests/` has no DOM harness on purpose. So the
note is protected by the §9 matrix and by nothing else, which is why §9 now has
a row for it - said once when a session opens already armed on Cover, said once
on the press that arms it, and never twice.

**One duplication left as debt - three copies, not two.** `lib/draw/render.ts`
and `lib/draw/layer.ts` each carry a private `inkWidth` mirroring the private
one in `lib/draw/model.ts`. All three read the one exported
`HIGHLIGHT_WIDTH_SCALE`, so only the expression is duplicated. If the three ever
disagree, the failure that bites hardest is `layer.ts`'s, because that copy is
what sizes the mark's box: a highlighter measured at the pen's width gets a box
that **clips six sevenths of the ink away**. The milder drift is
`isDegenerate`'s threshold disagreeing with what is actually painted, i.e. a
mark discarded as nothing that would have been visible, or kept as a dot that is
not. It exists because `model.ts` was outside the borrowing task's Files list
rather than because any one of the three is right - and fixing only `render.ts`
and `model.ts` leaves the clipping copy as the one still standing.

Everything DOM- and Chrome-facing is covered by the manual matrix in §9 of
PROJECT.md, which should be run before every submit. The one test that matters
most: **open the PDF, Ctrl+F, search a word from the page.** If nothing is
found, the build is broken.

The §9 row for a page past the single-page ceiling exercises single-page mode
on the one-click path; the split maths it exercises is unit-tested already
(`tests/page-size.test.ts`).

A note on method, since it cost a round trip: the interactive print dialog is
its own code path and cannot be checked from a unit test, a headless render, or
by inspecting injected CSS. All three said single-page mode worked; the dialog
disagreed. Anything that depends on the dialog needs a human with Ctrl+P.

## Privacy

100% local. No server, no analytics, no telemetry, no remote config, no account.
Settings live in `chrome.storage.sync` so they follow the browser profile.

## License

[FSL-1.1-MIT](LICENSE.md) (Functional Source License, MIT future license).
The code may be read, modified and redistributed for anything except a
competing commercial product; each released version becomes MIT two years
after it is published. The build copies `LICENSE.md` into the extension
(`wxt.config.ts`, `build:publicAssets`), because FSL applies to the versions it
ships with.

Third-party dependencies keep their own licences (MIT, ISC, Apache-2.0).
