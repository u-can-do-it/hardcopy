# project.md - Hardcopy

**Name:** Hardcopy (manifest: "Hardcopy - Save Page as PDF"). Working name `pagepdf`, kept in code identifiers. Not "Web to PDF" - three products already use it.
**Positioning:** _the one that doesn't count your exports._ Real text, real look, no nag. One click by default; the print dialog, with no debugger at all, for anyone who would rather.

The code is the authority. The reasons behind non-obvious choices are in `docs/ARCHITECTURE.md`.

---

## 1. What it does

Turns the current tab into a PDF with **selectable, searchable text** (vector, not a screenshot) that **looks like the page on screen**, not like its print stylesheet. Optionally as one long page instead of A4 sheets.

### Free - unlimited, no account

Everything except Draw mode (Decision 24).

- **One-click export** - the default (`exportMode: "screen"`): no dialog, straight to Downloads, over CDP. Chrome shows its yellow "is debugging this browser" bar while it runs.
- **Screen look** - the page's _screen_ CSS, not `@media print`.
- **Single long page** - no page breaks, on by default; one-click path only (Decision 9).
- **The print dialog** (`exportMode: "print"`) - the browser's native print pipeline. Never attaches `debugger`, never shows the yellow bar - that is what it is for.
- Pre-processing: hide sticky headers/footers/cookie banners, expand `<details>`, scroll to trigger lazy images, optional title + URL + date header.
- A curtain over the pre-processing sweep (Decision 22).
- Full-page and drag-a-region screenshots (Decision 13).
- Four keyboard shortcuts for the four things the popup does (Decision 21).

### Pro - one-time $5, lifetime, per user

- **Draw mode, all of it** - pencil, highlighter, line, rectangle, ellipse; fill modes, including covers that remove the text underneath from the export (Decision 20); seven symbols including an auto-numbered pin; text labels that stay searchable in the PDF. Gated once, at `ANNOTATE start` (Decision 15).
- Draw needs no permission of its own: the marks are SVG in the page and reach whichever export path is chosen.

**Launch period:** `LAUNCH_FREE_FOR_ALL` (`lib/constants.ts`) is `true` and ships. `isPro()` answers true for everyone, so Draw is free too, and the popup's "Pro?" link and the options page's licence card are hidden. Turning it off is how Pro comes back.

### Out of scope

Editing PDFs, OCR, cloud storage, accounts, analytics, Safari. Firefox later, on its own path (`tabs.saveAsPDF()`).

---

## 2. Stack

| Concern    | Choice                                                                    |
| ---------- | ------------------------------------------------------------------------- |
| Framework  | **WXT 0.20.27**, pinned exactly (0.21 moves the entrypoint helpers)       |
| Language   | TypeScript strict                                                         |
| UI         | Preact + shadcn/ui + Tailwind (Decision 5)                               |
| Licensing  | Lemon Squeezy licence keys, merchant of record - see §6                   |
| Storage    | `chrome.storage.sync` (settings, licence), `chrome.storage.local` (drawing bar prefs) |
| Tests      | Vitest for `lib/`; manual matrix in §9                                    |
| Publishing | `pnpm zip` -> Chrome Web Store dev console                                |

**WXT gotcha:** since 0.20, `defineBackground` / `defineContentScript` come from `wxt/utils/define-background` and `wxt/utils/define-content-script`, not `wxt/sandbox`. Never scaffold with a floating `@latest`.

---

## 3. Architecture

```
entrypoints/
  background.ts     service worker: orchestrates exports, screenshots, Draw; downloads
  popup/            Export PDF, Draw, two screenshot buttons, prep toggles
  options/          defaults, element-hiding rules, filename template, export mode, licence
  prepare.ts        injected pre-processing (and window.print() on the print path)
  annotate.ts       injected Draw mode
  select-area.ts    injected region-screenshot selector
  offscreen/        Blob URLs for downloads (service workers can't)
lib/
  cdp/              typed chrome.debugger wrappers - the only module that touches it
  pdf/              printToPDF options, single-page sizing
  capture/          screenshot planning, stitching, formats
  dom/              pre-processing helpers, covers
  draw/             Draw mode (layer, bar, shapes) - no tier logic
  license/          activate / validate / deactivate, cached isPro()
  settings.ts, filename.ts, commands.ts, urls.ts, ...
```

Flow: popup or shortcut -> background (`EXPORT`; the background reads `settings.exportMode` itself) -> injected script prepares the page -> CDP capture or `window.print()` -> bytes -> offscreen Blob URL -> `chrome.downloads.download`.

Rules:

- All CDP calls live in `lib/cdp`.
- The background never assumes the tab is still there; every step re-checks `tabId`.
- The print path never attaches `debugger` (§5).
- Scripts are injected on demand, never declared (Decision 3).

---

## 4. How each mode works

### 4.1 Print dialog (`exportMode: "print"`)

1. Injected pre-processing (each step user-configurable):
   - hide `position: fixed|sticky` elements taller than 40px - except any holding >20% of the page's text (Decision 7)
   - open `<details>`, unlock `overflow: hidden` scroll containers (both off by default)
   - scroll to the bottom in steps to fire lazy loaders, then back
   - optionally prepend a title / URL / date header
2. Inject `<style media="print">` (default: `* { -webkit-print-color-adjust: exact }`).
3. Reply to the background, **then** `window.print()` - it blocks the renderer while the dialog is open.
4. `afterprint` -> undo every DOM change.

Paginated only (Decision 9), print CSS still applies. The deal: no `debugger`, no yellow bar, still vector text.

### 4.2 One-click, screen look (`exportMode: "screen"`, the default)

1. `debugger` is a declared permission (Decision 1); the popup's hint line explains the yellow bar.
2. `chrome.debugger.attach({ tabId }, "1.3")`.
3. Pre-processing as in §4.1.
4. `Emulation.setEmulatedMedia({ media: "screen" })` - the whole trick.
5. Measure the page (Decisions 10, 12).
6. `Page.printToPDF`: `printBackground: true`, zero margins, no header/footer, page width from the content, height A4 or the full page in single-page mode, `transferMode: "ReturnAsStream"`.
7. `IO.read` chunks -> `Uint8Array` -> offscreen Blob URL -> download.
8. `chrome.debugger.detach` in `finally`. Always.

**Single-page ceiling:** 500in (48,000px). Past it `printToPDF` paginates equal slices itself - no merge - and the result notes the split (Decision 4).

---

## 5. Permissions

```ts
// wxt.config.ts
permissions: ["activeTab", "scripting", "storage", "debugger", "downloads", "offscreen"],
host_permissions: [],   // activeTab covers the clicked tab
```

No optional permissions. `debugger` is required: Chrome forbids it as optional (Decision 1), and the free default needs it - one-click export and screenshots run over CDP. Declared from the first release, so no update adds a permission. The print path never attaches it; §9 checks that.

Store justification text (keep it true):

- `activeTab`, `scripting` - run DOM pre-processing, and `window.print()` when the print dialog is chosen, on the tab the user clicked on.
- `downloads` - save the PDF or the screenshot.
- `storage` - settings, the licence key, and the drawing bar's preferences.
- `offscreen` - create Blob URLs for downloads (service workers can't).
- `debugger` (required) - one-click PDF export and screenshots: used only for `Page.printToPDF`, `Emulation.setEmulatedMedia` and `Page.captureScreenshot` on tabs the user chose to export or photograph; attached for that one export, detached immediately after; never reads network traffic or cookies. Not attached at all when the user picks the print dialog.

---

## 6. Licensing - keys, no accounts, no login

Pro is unlocked by a licence key emailed after purchase and pasted once. Dormant during the launch period (§1).

### 6.1 Lemon Squeezy keys (zero backend)

- Lemon Squeezy as merchant of record (EU VAT per buyer country); one one-time product, **$5**, licence keys on, activation limit **5**. Setup: `docs/LEMON-SQUEEZY.md`. `CHECKOUT_URL` is empty until the product exists.
- Flow: Draw's Pro badge or the popup's "Pro?" -> Pro dialog -> checkout tab -> key by email -> paste -> done. "Lost my key?" -> the LS recovery page.
- `lib/license`: `activate(key)` (`instance_name = <browser> <os>`), cached in `storage.sync`; `isPro()` answers from cache and revalidates in the background after 7 days, with 30 days of offline grace; `deactivate()` from the options page frees a slot.
- `sync`, not `local`: the key follows the profile and survives reinstalls.

### 6.2 Later - self-signed offline keys

Only if vendor-API independence is ever wanted: ECDSA P-256 signed payload verified offline with WebCrypto, issued by a webhook worker. No revocation, no activation limit - acceptable at $5. Not built.

### 6.3 Rules

- Gate **features**, not counters. There is no export counter. `isPro()` is the only switch, checked once, where annotate mode starts.
- Never call home on export.
- The upsell is quiet: a "Pro" badge on Draw and one footer link. The Pro dialog opens only when tapped - never a modal on its own, never a post-export nag.
- **Piracy:** a $5 key will be shared. No hardware binding, no phone-home - just the activation limit.
- Licence key and cached status in `storage.sync`, nothing in `local`.

**Merchant note:** with LS as merchant of record they are the seller and handle VAT/OSS. Confirm the Polish side (działalność nierejestrowana thresholds) with an accountant.

---

## 7. Privacy

- 100% local. No server, no analytics, no telemetry, no remote config.
- Privacy policy (public URL, required by the store) says exactly that. Draft: `docs/privacy-policy.md`; `PRIVACY_POLICY_URL` is empty until it is hosted.
- Register **trader status** in the developer dashboard before charging anything.

---

## 8. Plan

What is left is listed in `BACKLOG.md`.

---

## 9. Manual test matrix (run before every submit)

| Page | Why | Pass criteria |
| --- | --- | --- |
| explore.jobs.netflix.net job posting | dark theme, print CSS strips it, cookie banner | one click: dark look kept; both paths: banner hidden; **Ctrl+F finds text** |
| A long Medium / Substack article | lazy images, sticky header | all images present, header not repeated |
| GitHub README | code blocks, wide tables | no clipped tables in single-page mode |
| A React SPA dashboard | client-rendered, no print CSS | content present, not blank |
| Page with a `position: fixed` chat widget | element hiding | widget gone, restored after print |
| 60,000px tall page, single long page on | the 500in (48,000px) ceiling | equal sheets of <= 500in in one PDF, note shown |
| Print dialog on: Export PDF from the popup, `Ctrl/Cmd+Shift+S`, and Save from the drawing bar | the print path never attaches `debugger`, at all three entry points | print dialog every time; **no** debugging bar, ever. turning the print dialog on turns "Single long page" off, and turning that on turns the dialog off; a single-page choice saved by an older version gives paginated sheets, not an error. Ctrl+F a word in the PDF |
| Any article, annotated (pencil, rect, a label) | marks must be real text and real vector | bar gone; each mark once, on the right sheet; **Ctrl+F finds the label** |
| Same article, a label typed until it wraps to 3-4 lines | one `<tspan>` per line | all lines present, in order; **Ctrl+F finds a word from a later line** |
| A text box left **open**, then Ctrl+P; again via one-click | the editor frame is chrome, not a mark | **no dashed rectangle or handles** in preview, PDF or full-page screenshot; the label is there |
| Symbols palette open: place 5 marks, then use a page `<select>` or menu | only the bar dismisses a panel | palette **still up**; its trigger or Esc closes it; absent from PDF and screenshot |
| Real text under a **cover** ("Cover - removes text"), saved via Ctrl+P | a cover that leaves the words in the text layer publishes them | **Ctrl+F a covered word: NOT found.** A word beside it: **found**. Copying the covered line does not paste the covered words |
| Same page after the print dialog closes, and after exiting Draw with the X | covers come off after the capture | all text back, **nothing reflowed**, marks where you left them. Both times |
| Same cover over a **region screenshot** and the **one-click path** | three capture brackets, not one | region PNG: nothing readable under the block, page intact after. One-click PDF: same two Ctrl+F results |
| A covered `<textarea>` with text **and** a covered `<select>` with a chosen option | neither value is a text node; Chrome prints both | the **whole** control blank, value not in the PDF, for **both** |
| A cover over a **cross-origin iframe** | Decision 20's one known leak - confirm it is no worse | the frame's text **is** in the PDF (documented); nothing outside it leaks; the bar's note line warned |
| A cover whose top edge sits **between two lines**, at the 4px pen and the 8px pen | a `Range` box is the font box; the inset is measured per line | the line **above**: **found**, both pens. Under the block: **not found**. The 8px pen paints 4px above the edge - allow a couple of px |
| Same, with **descenders** (`p`, `g`, `y`) on the line above | the thin case: that ink nearly reaches the gap | the line above goes only when the block's ink lands on it (Decision 20 has the numbers) |
| A cover over text in an open **shadow root** (build one in the console if needed) | tree walks don't cross shadow boundaries | covered word **not found**; an `<input>` inside is blanked whole. `{mode: "closed"}`: the word **is** found (documented). A label of ours over the area: still findable |
| A page whose whole content is in `document.body.attachShadow({mode: "open"})` | the walk root's own shadow root | a covered paragraph: **not found**; words beside it **found** |
| A cover over an **SVG chart label** (`<svg><text>`) on a chart with several | the wrapper must be in the SVG namespace | covered label **not found**, **other labels unmoved**. Same two checks on any `<foreignObject>` text |
| Fill menu: arm each of the three modes, reload, Draw again | the cover warning has no test; this row is its guard | trigger icon follows the mode; accessible name is "Shape fill - " + the button's label verbatim; cover sentence **once per session**, never twice. Trigger slightly wider than 28px buttons is expected |
| `chrome://extensions/shortcuts` on a fresh profile, then each of the four keys | Chrome silently drops a suggested key it already owns | all four listed, **none blank**, keys match `wxt.config.ts`; each does its thing. A blank row: rebind there and change the suggestion |
| `Ctrl/Cmd+Shift+S`, then `Ctrl/Cmd+Shift+K`, on a `pnpm build`, one click chosen, no key | the tier boundary at the two shortcuts either side of it | `S`: PDF in Downloads, no dialog, **no** Pro upsell; yellow bar only while it runs; Ctrl+F works. `K`: with `LAUNCH_FREE_FOR_ALL` on, the drawing bar opens. With it off: no bar, exactly **one** toast "Draw mode is a Pro feature.", and Draw in the popup shows a "Pro" badge that opens the Pro dialog |
| `Ctrl/Cmd+Shift+X`, and on a capture made to fail (a strip a few px tall) | the region path reports in-page; a duplicate toast is the one that never leaves | exactly **one** toast either way, gone after about 4s |
| Any shortcut on `chrome://extensions`, the Web Store, and a `.pdf` in the built-in viewer | nothing can be injected there | **nothing happens**: no toast, no overlay, no service-worker error. The popup greys its buttons out there instead - documented, not a regression |
| `Ctrl/Cmd+Shift+S` on a long page, then switch to another tab (one with its own `activeTab` grant) while it runs | the toast targets the tab the key fired on | "Saved ....pdf" on the tab you **started from**, never on the one you moved to |
| Draw: `Ctrl/Cmd+Shift+K`, the same key again, then `Ctrl/Cmd+Shift+X` without leaving the bar | a shortcut arriving mid-mode | no second bar, marks unmoved; the region shot hides the bar and has the marks but no bar |
| Many lazy images, exported from the popup and with Draw; once more on a short page with **Load lazy images off** | a curtain that outlives its sweep is worse than none | "Preparing the page..." dims the viewport while it scrolls, both times, and is **gone** before the dialog, download or bar. Sweep off, or done inside 180ms: never appears. Not in the PDF or screenshot |
| Same, print dialog left open a while, then cancelled | the curtain comes down before the background is answered | no overlay around the dialog; page normal after Cancel |

After any export: open the PDF, **Ctrl+F** a word from the page. Nothing found means the build is broken. With a cover, check both ways: a covered word that **is** found means the cover is broken.

---

## 10. Known traps

1. **Service workers can't `URL.createObjectURL`.** Blob URLs come from the offscreen document.
2. **`printToPDF` base64 on huge pages** blows memory - use `ReturnAsStream` + `IO.read`.
3. **`chrome.debugger` can't attach** to `chrome://`, the Web Store, other extensions' pages or the built-in PDF viewer. Detect and say so (`lib/urls.ts`).
4. **The yellow infobar** is unavoidable on the one-click path; the popup's hint line says so, and the print dialog avoids it.
5. **Detach in `finally`.** A leaked debugger session blocks DevTools and looks like malware.
6. **`Emulation.setEmulatedMedia` persists** for the session; detaching resets it.
7. **The popup closes** when focus moves - on purpose for area capture and Draw - so anything outliving the click reports in the page or in storage, never in popup memory.
8. **Filenames:** strip `/ \ : * ? " < > |`, cap at 120 chars, fall back to hostname.
9. **WXT 0.20 import paths** (§2).
10. **No analytics "just to see usage."** The privacy line is part of the product.

---

## 11. Store listing

- **Name:** Hardcopy - Save Page as PDF
- **Short description (<= 132):** "Save any page as a PDF with real, searchable text that looks like the screen. Free, unlimited, no nagging."
- **Single purpose:** Export the current web page to a PDF file.
- **Category:** Productivity
- **Screenshots:** popup; before/after (print CSS vs screen look); a marked-up page and the PDF it produced
- **Privacy tab:** all data "not collected"; justify each permission with the §5 text
- **Trader:** yes

Draft: `docs/store-listing.md`.
