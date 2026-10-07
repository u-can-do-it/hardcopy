# 15 - Save from the bar

**Goal**: the bar's save buttons export the marked-up page - without the bar in
the picture, and without re-preparing the page under the marks.

**Files**
- `entrypoints/background.ts` (modify)
- `entrypoints/annotate.ts` (modify)

**Contracts**: `contracts.md` §15 (`handleAnnotateExport`, and the best-effort
`PAGE_ANNOTATE_UI` pair) and §14 (the bar hiding itself, `beforeprint` /
`afterprint`).

`handleAnnotateExport(request, tabId)` is thin on purpose:
- `target: "pdf"` -> the existing export path (`mode: "screen"` when
  `isPro()`, `"print"` otherwise - the same choice the popup makes today).
- `target: "png"` -> the existing `handleCapture({ area: "full" })`.
- Return the underlying `ExportSuccess` / `CaptureSuccess` / `Failure`
  **unchanged**; the bar shows it in `BarState.note`, since there is no popup
  open to report into.

No flags. `prepare.ts` is already holding the pass (task 13), so the export
reuses it and the trailing `PAGE_RESTORE` is ignored. That is the whole reason
the seam was put there instead of here.

**The tab comes from `sender.tab?.id`**, never from `chrome.tabs.query`: this
request originates in the page, the popup is not open, and "the active tab" is
not a safe answer. No `sender.tab?.id` -> `NO_TAB`.

**Keeping the bar out of the output.** It is `position: fixed`, so leaving it
in would repeat it on every printed sheet, and `hideFixedElements` will not
hide it for us - that walk is `document.querySelectorAll("body *")` and both
our hosts hang off `documentElement`, outside `body` and behind a closed shadow
root. Three cheap, stateless mechanisms, no bookkeeping between them:

1. `annotate.ts` hides its own bar before sending `ANNOTATE_EXPORT` and shows
   it again when the reply lands - in a `finally`, so a failed export never
   leaves the user's bar hidden.
2. `annotate.ts` hides the bar on `beforeprint` and shows it on `afterprint`.
   That covers `window.print()` started from anywhere, including the popup,
   with no background involvement at all.
3. `handleCapture` and `handleScreenExport` each send a best-effort
   `PAGE_ANNOTATE_UI { visible: false }` before and `{ visible: true }` in the
   `finally`, wrapped in `try/catch` like the existing `reportInPage`. When
   annotate mode is not running the send fails and nothing happens. This is the
   only change either function gets, and it covers a CDP capture started from
   the popup.

`visible: false` also drops the layer's `pointer-events`, which is what lets
the region selector have the pointer (DRAWING.md trap 2 - two overlays, one
pointer). The layer stays **visible**: the marks are the point.

**Out of scope**: a new download path, a new capture path, anything in
`lib/capture/`, `lib/pdf/` or `lib/cdp/`. The marks are already in the DOM;
there is no compositing step to add.

**Proof**
```bash
pnpm compile
```

Orchestration between two existing paths; no new pure logic. The thing that
matters here cannot be unit tested at all - see the manual check, and
`CLAUDE.md` on what a unit test cannot tell you.

**Manual check** - this is the row that decides whether the feature shipped

1. Annotate a page: a squiggle, a rect around a figure, and (Pro) a label.
2. Save -> PDF from the bar. **The bar is not in the PDF.** The marks are, on
   the sheets their content is on, once each - not repeated on every sheet.
3. Open the PDF, Ctrl+F, search a word from the page, then search the label's
   text. Both must be found. If not, the build is broken.
4. Save -> PNG from the bar: the marks are in the image, the bar is not.
5. Free build: the popup's **Export PDF** while marks are up opens the print
   dialog, and the preview does not show the bar (`beforeprint`).
6. While marks are up, use the popup's **Select area**: the bar disappears, the
   selector takes the drag, the capture contains the marks inside the
   rectangle, and the bar comes back afterwards.
7. Make an export fail - a closed tab, or `DEV_UNLOCK_PRO` on a page CDP
   refuses: the bar comes back rather than staying hidden.

**Depends on**: 12, 13, 14
