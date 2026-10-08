# Architecture

How the extension is put together, and the decisions behind it. "Decision N"
refers to the numbered list under [Decisions](#decisions).

## Layout

```
entrypoints/
  background.ts     service worker: orchestrates exports, re-checks the tab at every step
  prepare.ts        injected on demand: DOM pre-processing + window.print(); owns the prepared state
  select-area.ts    injected on demand: the drag-a-rectangle overlay, and the in-page toast
  annotate.ts       injected on demand: the drawing bar, the layer, the pointer state machine
  offscreen/        assembles downloaded files into a Blob URL for chrome.downloads
  popup/            Preact: export rows, Export, Draw, the two screenshot buttons
  options/          Preact: defaults, export mode, hide rules, filename template, licence
lib/
  dom/              pre-processing: hide fixed, expand, un-clip, lazy-load, header, print CSS,
                    viewport units, page size; cover.ts removes covered text for a capture
  draw/             drawing logic: shape model, geometry, freehand paths, SVG render, symbols,
                    undo history, stylesheets, layer + bar builders, frame, wrap, cursors,
                    keys, prefs, backdrop (the curtain over the lazy-image sweep, Decision 22)
  capture/          screenshot planning (clamp, scale, slice), formats, stitching
  pdf/              printToPDF params + sizing, painted-height scan
  cdp/              the only module that touches chrome.debugger
  license/          Lemon Squeezy activate/validate/deactivate, cached; isPro()
  commands.ts       keyboard command -> BgRequest, and what the toast says
  messages.ts       BgRequest / BgResponse and the page message types
  download.ts       chunked transfer to the offscreen document (base64.ts encodes)
  settings.ts       storage.sync, validating merge
  filename.ts       {title}-{date} templating and sanitising
  urls.ts           where we may and may not operate
  constants.ts      LAUNCH_FREE_FOR_ALL, DEV_UNLOCK_PRO; types.ts holds shared types
components/         license-form, pro-dialog, setting-row; ui/ holds the shadcn components
stores/             Preact signals shared by popup and options
scripts/            third-party licence notices, icon generation
```

## Message flow

**Export, print path** (`exportMode: "print"`): popup -> background (`EXPORT`)
-> `chrome.scripting.executeScript` -> `prepare.js` prepares the DOM, replies,
*then* calls `window.print()` (`print()` blocks the renderer while the dialog is
open). Never touches `debugger`.

**Export, one click** (the default): the DOM is prepared the same way without
printing, then the background drives the tab over CDP - `Page.printToPDF` with
screen media emulated -> offscreen Blob URL -> `chrome.downloads`.

**Screenshots**: popup -> background (`CAPTURE`) -> either the area selector
(`PAGE_SELECT_AREA`, resolves when the drag ends) or the same DOM
pre-processing, then `Page.captureScreenshot` per slice -> stitched in the
worker -> offscreen Blob URL -> `chrome.downloads`.

**Drawing**: popup -> background (`ANNOTATE`) injects `prepare.js` and
`annotate.js`, prepares the page with `hold: true` and sends
`PAGE_ANNOTATE_START`. The bar's Save and X come back as `ANNOTATE_EXPORT` /
`ANNOTATE_EXIT`, with the tab taken from `sender`. A save from the bar runs the
ordinary export or capture path unchanged (Decision 14).

## Keyboard shortcuts

Rebindable at `chrome://extensions/shortcuts`; the keys in `wxt.config.ts` are
suggestions (Chrome assigns at most four and drops any it already owns).

| Command | Suggested | Does |
| --- | --- | --- |
| `save-pdf` | `Ctrl/Cmd+Shift+S` | Export, by whichever `exportMode` is set. |
| `capture-page` | `Ctrl/Cmd+Shift+E` | Full-page screenshot. |
| `capture-area` | `Ctrl/Cmd+Shift+X` | Drag a rectangle, save that. |
| `draw` | `Ctrl/Cmd+Shift+K` | Open the drawing bar. |

- A command sends the same `BgRequest` the popup's button sends
  (`lib/commands.ts`), so a shortcut decides nothing on its own.
- Outcomes are reported by an in-page toast (`commandToast`, hosted by
  `select-area.ts`), sent to the tab the shortcut fired on. Nothing is said
  twice: the print dialog, the drawing bar and a region capture announce
  themselves.
- A shortcut grants `activeTab` like a toolbar click; `commands` adds no
  install warning. Decision 21.
- **On a page that refuses injection a shortcut is silent** - there is no
  surface to report on. `project.md` §9 has the row.

## Screenshots

- **Full page** runs the same DOM pre-processing as an export, freezes scripts,
  trims the tail with the painted-height scan, captures in slices
  (`SLICE_HEIGHT_PX`) and stitches them with `OffscreenCanvas`. A page too tall
  for one image is scaled down and the popup says by how much.
- **Select area** is an overlay in a closed shadow root returning the dragged
  rectangle in document coordinates. It does not pre-process.
- Both use `chrome.debugger` (Decisions 1, 13).

Formats and limits (JPEG default; WebP and PNG in Settings):

- WebP's ceiling is 16,383px (`WEBP_MAX_EDGE`); past it Chromium truncates
  silently, so the planner scales to fit.
- JPEG and PNG take the canvas limit (65,535px); `MAX_IMAGE_AREA_PX` (2^26 px)
  usually bites first.
- Slices are captured as PNG and the stitched image is encoded once.
- `chrome.runtime.sendMessage` refuses over 64MiB, so `lib/download.ts` sends
  6MiB chunks (a multiple of 3, so each base64-encodes alone) and the offscreen
  document assembles the Blob. PDFs take the same path.

## Drawing

Pro, gated once at `ANNOTATE start` in `handleAnnotate` (Decisions 15, 24);
free for everyone while `LAUNCH_FREE_FOR_ALL` is on.

Tools: pencil, highlighter, line, rectangle, ellipse, seven symbols (including
an auto-incrementing numbered pin) and text labels. Undo history is a stack of
snapshots, so clear is undoable. The bar saves as PDF (per `exportMode`), as a
full-page PNG, or a selected area.

The fill is a pen setting (`FillMode`), shared by rectangle and ellipse:

| Menu button               | Interior                   | Text underneath                                    |
| ------------------------- | -------------------------- | -------------------------------------------------- |
| **Not filled**            | outline only               | untouched                                          |
| **Filled - read-through** | translucent, 0.35 alpha    | untouched: still in the PDF, still findable        |
| **Cover - removes text**  | solid pen colour           | hidden from the export and not in its text layer   |

- A cover removes text from the **export** only, on all four outputs. The page
  keeps its text; covers apply for the duration of a capture and come back off.
  It cannot reach inside an embedded frame, and `FILL_NOTE` says so once per
  session. **Read Decision 20 before touching `FillMode`, `FILL_OPACITY` or
  `lib/dom/cover.ts`.**
- Marks are real SVG in the real DOM, so the print dialog, one-click
  `printToPDF`, full-page and region screenshots all get them with no change to
  `lib/capture/`, `lib/pdf/` or `lib/cdp/`.
- Text labels are real `<text>` (one `<tspan>` per wrapped line), so Ctrl+F
  finds them (caveat: Decision 18).
- The bar is hand-rolled DOM in a closed shadow root - no Preact or Tailwind in
  `annotate.js`. Bar panels are dismissed only by the bar (Decision 19).
- One dependency: `perfect-freehand` 1.2.3, which turns pointer samples into
  one `<path>`.
- No `chrome.debugger`, no manifest change: `annotate.js` is injected under
  `activeTab` like the other scripts (Decision 3).

## Licence notices in the build

Every build ships `LICENSE.md` and `THIRD_PARTY_LICENSES.txt`. The list comes
from what the bundles contain: a Vite plugin in `wxt.config.ts` records the
package behind every rendered module, and `scripts/third-party-licenses.ts`
reads each licence file. Packages that publish none have their upstream licence
in `scripts/licenses/`; a new one makes the build warn. `pnpm dev` skips the
notices file, since it does not build the popup and options pages.

## Decisions

The non-obvious choices, each with the reason or measurement behind it. Read
the relevant entry before changing that area. Code comments cite these by
number ("Decision 20"); numbers are permanent - append, don't renumber.

1. **`debugger` is required, not optional.** Chrome refuses it in
   `optional_permissions` (as it does `devtools`, `proxy`, `geolocation` and a
   few others). Free one-click export and screenshots run over CDP, so it is
   declared from the first release and no update triggers a re-consent prompt.
   The way out of Chrome's yellow debugging bar is `exportMode: "print"`.

2. **`downloads` and `offscreen` are required,** since one-click export and
   screenshots write files themselves. There is no `optional_permissions` key.

3. **The pre-processing script is injected, not declared.** A declared content
   script needs `matches`, and `<all_urls>` adds "Read and change all your data
   on all websites" to the install prompt. It is injected via `chrome.scripting`
   under `activeTab`; `host_permissions` stays `[]`.

4. **Tall single pages need no merge, and the ceiling is 500in, not ~200in.**
   `printToPDF` paginates by itself. Chrome 152 produced an intact single page
   at every height up to 500in, so `MAX_PAPER_INCHES` is 500, capped by render
   cost. `lib/pdf/print-options.ts` picks equal slice heights.

5. **Frontend is Preact + shadcn/ui,** not vanilla TS. shadcn
   runs through `preact/compat` aliasing; state is `@preact/signals`.

6. **`cn` comes from the `cn` package.** There is no `lib/utils.ts`, and
   `components.json` has no `utils` alias.

7. **Fixed-element hiding has a content guard:** an element holding more than
   20% of the page's text is never hidden. Without it, a site whose main
   wrapper is `position: sticky` exports blank.

8. **The offscreen document serves the file-writing paths** and reassembles
   large files from 6MiB chunks (ARCHITECTURE.md, Screenshots).

9. **"Single long page" works only on the one-click path.** The print dialog
   takes paper size from its own dropdown and ignores CSS `@page { size }`
   (Chrome 152: `printToPDF` honours it, the dialog paginates to Letter/A4
   regardless). So the two toggles exclude each other: switching either on
   switches the other off in the same write (`exportModePatch` /
   `pageModePatch`), and `effectivePageMode` still resolves a stored `single`
   to `paginated` on the print path, for settings an older version saved.

10. **A single page cannot be sized while `vh` still moves.** In paged media
    `vh` resolves against the page box, so paper cut to the measured height
    grows `100vh` blocks page-tall and Chromium adds a sheet; raising the paper
    raises `100vh` with it. `lib/dom/viewport-units.ts` first pins those lengths
    (and `height: 100%` on the roots) to their on-screen pixels.

11. **Screen-media emulation makes print stylesheets inert, including ours.**
    On the one-click path `BREAK_RESET_CSS` is injected unconditionally
    (`injectUnconditionalCss`), or a site's screen-CSS `break-before: page`
    splits single-page exports. The site's own print CSS stays inert by design.

12. **Paper height is where the page stops painting, not the document
    height.** Ad slots, frozen feeds and holes left by hidden furniture end the
    sheet in a blank strip. `lib/pdf/painted-height.ts` takes a downscaled
    `Page.captureScreenshot` (136ms at 19,000px) and finds the last pixel row
    differing from the bottom edge. It trims only when the bottom edge shows the
    page's own background (full-bleed bands are deliberate), and caps the sheet
    count with `pageRanges`, since short paper otherwise spills onto more sheets.
    A DOM walk cannot do this - it does not see CSS backgrounds.

13. **Screenshots share the export machinery.** Free, built on CDP,
    painted height, the offscreen download path and the filename template.

14. **Draw mode prepares the page once and holds the pass,** instead of
    prepare-then-restore per export. Drawing before preparing would make every
    mark below an expanded `<details>` drift. The seam is `PAGE_PREPARE { hold }`
    and `PAGE_RESTORE { release }`, handled in `entrypoints/prepare.ts`. The
    `window.print()` path needs nothing (the bar hides on `beforeprint`); CDP
    captures are wrapped in a best-effort `PAGE_ANNOTATE_UI` pair
    (`handleScreenExport`, and twice in `handleCapture`). There is no per-tab
    state: navigation takes the marks and the `activeTab` grant with it.

15. **Draw mode's tier gate is checked once, at `ANNOTATE start`, never at
    export.** `handleAnnotate` calls `isPro()` before injecting anything and
    fails with `PRO_REQUIRED`; the popup shows a Pro badge, the shortcut a
    toast. `lib/draw/` and the bar carry no tier logic. `LAUNCH_FREE_FOR_ALL`
    currently makes `isPro()` true for everyone. Export-time enforcement would
    mean silently stripping marks from a user's own PDF, so it is not done.

16. **The drawing layer is one small `<svg>` per mark, never one document-tall
    one.** An `<svg>` in HTML is a replaced element and cannot fragment across
    sheets, so a document-tall one loses every mark below page 1. Each mark's
    `<svg>` is sized to its bounding box (padded, rounded outward), geometry
    moved by `<g transform>` - not `viewBox`, which breaks at zero size and
    scales by Chrome's 1/64px used width. Residual: a mark taller than one sheet
    loses what is below the first break. The wrapper is `position: absolute`,
    sized to `scrollWidth x scrollHeight` and clipped with `overflow: clip`:
    `fixed` repaints on every sheet, an unclipped stroke grows the measured
    paper, and `hidden` makes a scroll container that may refuse to fragment.

17. **The translucent fill hides nothing from the PDF.** "Filled -
    read-through" uses `FILL_OPACITY = 0.35` via `fill-opacity` (never
    `opacity`, so the outline stays solid). Text under it stays selectable and
    findable. Do not raise the alpha to make a cover - `1` looks like a removal
    and performs none. The opaque mode is Cover (Decision 20).

18. **Ctrl+F may not match a phrase across a soft wrap in a label.** Each
    wrapped line is its own `<tspan>` run. Single words always match, except a
    word too wide for its box, which breaks between characters. The §9 check
    searches a word from a line other than the first.

19. **A bar panel is dismissed only by the bar.** Closing on outside press shut
    the symbols palette on the press that used it. The policy is
    `popoverAfterPress` in `lib/draw/bar.ts` (`tests/draw-bar.test.ts`); `Esc`
    closes a panel before mid-drag cancel or exit. A panel open across a capture
    is safe: the whole bar host goes `display: none`. The extension popup
    closing on focus loss is Chrome's, hence the bar's own Save and Done.

20. **Cover removes text from the DOM's text layer; it is not a raster.** A
    raster fails twice: Chrome's PDF text layer comes from the DOM, so text
    under a bitmap stays findable; and a capture needs CDP, which the print path
    must never touch.

    **Mechanism.** At capture time `lib/dom/cover.ts` measures each character
    under a cover with a `Range`, splits the text node and wraps covered runs in
    `visibility: hidden !important`; the shape paints an opaque fill over the
    gap. Layout is unchanged and hidden text is not in the text layer, on
    `window.print()` and `printToPDF` alike (verified by hand at a real print
    dialog). Form fields under a cover are blanked whole. PNGs need nothing.

    **Rules - don't break these:**
    - Wrapper namespace: `<span>`, `<tspan>` inside `<svg><text>`, `<span>`
      under `<foreignObject>`. The wrong one drops glyphs out of layout and
      moves everything after them; only the rect shows it, not computed style.
    - A character is covered if its box **meets** the painted area (greedy).
      `coverAreas` widens by half the stroke; an ellipse is tested as an
      ellipse, not its ~27% larger bounding box.
    - On y, boxes shrink by empty font-box space (`measureText`, element's own
      font), measured **per line, not per node** - otherwise an edge in the
      leading hides the line above. Residual above lines with descenders: 1 / 2
      / 4px of the 5px gap at the 2 / 4 / 8px pens (`tests/draw-model.test.ts`).
    - An empty rect (`display: contents`) means unknown, not nowhere: fall
      through to the per-character test.
    - The walk enters every **open** shadow root, the walk root's own included.
    - Covers go on around each capture (`beforeprint`/`afterprint`, the
      `PAGE_ANNOTATE_UI` pair) and come straight off, so undo stays a stack of
      shapes. `onBeforePrint` is synchronous: ~21-26ms on a 59,000px page,
      measured before the per-line and shadow-root work - re-measure.

    **Where a cover does not reach:**
    - **Cross-origin iframes - a genuine leak.** The block paints over the
      frame, but Chrome prints its text. A cover over an embedded tweet, comment
      widget or payment form hides nothing in the PDF. The bar's note line says
      so the first time Cover is armed in a session.
    - **Closed shadow roots** (`el.shadowRoot` is `null`) - which is also what
      keeps the walk off our own layer and bar.
    - **Shadow roots hosted inside `SKIP_TAGS`** subtrees (`script`, `style`,
      `iframe`, `textarea`, `select`...), whose text is unrendered or blanked.
    - **CSS-generated content** - `::before`/`::after` and list markers belong to
      no node; a covered `<li>` keeps its bullet.
    - **Text overflowing its box** (`nowrap`, `overflow: visible`) - a cover over
      only the spilled part finds nothing.
    - **CSS transforms** skew the ink inset; errs toward hiding, not leaking.
    - `alt`, `title`, `aria-label` are not in the text layer; canvas and image
      text is pixels and genuinely covered.

    It removes text from the export, not the page (screen-sharing hides
    nothing), and is not a certified redaction. The label is "Cover - removes
    text"; never "redact" or "black out". Known bug: covering MathML grows it
    and `restore()` does not undo it (`BACKLOG.md`). `restore()` calls
    `normalize()`, merging all adjacent text nodes in split parents; the wrapper
    forces only `visibility`, so a page `span {}` rule still matches it.

21. **Keyboard shortcuts add no permission.**
    `commands` is a manifest field, and a command grants `activeTab` like a
    click. `lib/commands.ts` only maps names to existing `BgRequest`s.
    `commandToast` stays quiet where another surface already spoke:
    `select-area.ts` has one removal timer, so a second toast sticks the first.

22. **A curtain covers the pre-processing sweep, and it is `position: fixed`.**
    `lib/draw/backdrop.ts` shows a 50% overlay after `BACKDROP_DELAY_MS` (180ms)
    so the lazy-load scroll does not look like breakage. Being `fixed` is safe
    only because `entrypoints/prepare.ts` removes it in a `finally` **before**
    replying to the background - before any print, capture or mark.

23. **The bar's save buttons carry no `PDF`/`PNG` lettering.** At 16px the
    letters smear and hide the arrow telling the icons apart. They use
    `file-down`, `image-down` and `crop`, with the full sentence in tooltip and
    accessible name. To reopen, use a wider labelled button
    (`.plan/contracts.md` §33.3-§33.4), not smaller letters.

24. **Everything is free except Draw mode.** Free:
    one-click export, single long page, the print-dialog path, screenshots,
    shortcuts, all pre-processing. Pro: Draw mode, all of it (Decision 15),
    currently open to all via `LAUNCH_FREE_FOR_ALL`.
    - **The export path is a setting.** `settings.exportMode` is `"screen"`
      (default) or `"print"`; `handleExport` reads it, so every entry point
      agrees. `effectivePageMode` paginates every `"print"` export.
    - **The default shows Chrome's yellow debugging bar;** the popup says so.
      The print path is the way out only because it never attaches `debugger`.
