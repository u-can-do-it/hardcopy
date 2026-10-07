# PROJECT.md — Page to PDF Extension

**Name:** Hardcopy (the working name was `pagepdf`; **not** "Web to PDF", three products already use it)
**Timebox:** two weekends. Whatever exists on the second Sunday evening gets published.
**Positioning:** _the one that doesn't count your exports._ Real text, real look, no nag. One click by default; the print dialog, with no debugger at all, for anyone who would rather.

---

## 1. What it does

Turns the current browser tab into a PDF with **selectable, searchable text** (vector, not a screenshot) that **looks like the page on screen**, not like the site's print stylesheet. Optionally as one long page instead of A4 sheets.

> **This file is the brief, kept in step with the code.** Where the two ever
> disagree, `README.md`'s Deviations list is the record of which one won and
> why. Sections marked *shipped* describe what exists today.

### Free (forever, unlimited, no account)

Everything except Draw mode *(README Deviation 24)*.

- **One-click export** — no print dialog, straight to Downloads, over CDP; the default *(shipped)*. Chrome shows its yellow "is debugging this browser" bar while it runs.
- **Screen look** — PDF uses the page's _screen_ CSS, not `@media print` *(shipped)*
- **Single long page** — no page breaks, on the one-click path *(shipped — Deviation 9 says why the print dialog cannot)*
- **The print dialog**, one switch away (`exportMode: "print"`): the page through the browser's native print pipeline *(shipped)*. It requires **no** `debugger` permission and never shows the yellow bar — that is what it is for.
- Pre-processing before print: hide sticky headers/footers/cookie banners, expand `<details>`, trigger lazy-loaded images by scrolling, optional title + URL + date header *(shipped)*
- A curtain over that pre-processing sweep, so the page scrolling itself does not read as a glitch *(shipped — Deviation 22)*
- Full-page and drag-a-region screenshots *(shipped — not in the original brief; Deviation 13)*
- Four keyboard shortcuts for the four things the popup does *(shipped — Deviation 21)*

### Pro — one-time $5 (lifetime, per user)

- **Draw mode, all of it** — mark the page up before saving: pencil, highlighter, line, rectangle, ellipse; the fill modes, including covers that really remove the text underneath from the export *(Deviation 20)*; seven symbols including an auto-incrementing numbered pin; and text labels typed in place that stay searchable in the PDF *(shipped — the gate is Deviation 15)*
- Draw mode needs no permission of its own — not `debugger` either: the marks are SVG in the page, and they reach whichever export path is chosen.

### Out of scope

Editing PDFs, OCR, cloud storage, accounts, analytics, Firefox (later — Firefox has `tabs.saveAsPDF()` and deserves its own path), Safari.

---

## 2. Stack

| Concern           | Choice                                                                   | Notes                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework         | **WXT** (`~0.20.x`, pinned)                                              | Vite-based, MV3, file-based entrypoints, auto-imports, `wxt zip` for store upload. Plasmo is in maintenance mode; CRXJS is a bare Vite plugin. |
| Language          | TypeScript strict                                                        |                                                                                                                                                |
| UI                | Vanilla TS + small CSS (or Preact if the popup grows)                    | Popup is ~5 controls; don't ship React for it                                                                                                  |
| Licensing         | **Lemon Squeezy license keys** (merchant of record)                      | no accounts, no login; key pasted once, stored in `storage.sync`; see §6                                                                       |
| Storage           | `chrome.storage.sync` (settings, licence), `chrome.storage.local` (drawing bar prefs) |                                                                                                                   |
| Tests             | Vitest for pure helpers; manual test matrix (see §9)                     |                                                                                                                                                |
| Publishing        | `wxt zip` → Chrome Web Store dev console (manual for v0.1)               |                                                                                                                                                |

**WXT gotcha:** since 0.20.x, `defineBackground` / `defineContentScript` are imported from `wxt/utils/define-background` and `wxt/utils/define-content-script`, not `wxt/sandbox`. Pin the version; don't scaffold with a floating `@latest`.

---

## 3. Architecture

```
entrypoints/
  background.ts        service worker: orchestrates exports, owns CDP session, downloads
  popup/               main UI: mode selector, options, Export button, Pro upsell (quiet)
  options/             settings page (defaults, element-hiding rules, filename template)
  content.ts           print path: pre-process DOM + window.print(); also used by one-click for pre-scroll
  offscreen.html/.ts   creates Blob URLs for large downloads (service workers can't)
lib/
  cdp/                 thin typed wrappers over chrome.debugger commands
  pdf/                 printToPDF options builder, single-page sizing
  dom/                 pre-processing helpers (hide fixed elements, expand, lazy-load scroll)
  license/             license-key activate/validate wrapper, cached status in storage.sync, offline grace
  filename.ts          `{title}-{date}.pdf` templating, sanitising
```

Message flow: popup → background (`EXPORT { options }`; the background reads `settings.exportMode` itself) → background drives the tab (content script for DOM prep, CDP for one-click) → background produces bytes → offscreen doc makes a Blob URL → `chrome.downloads.download`.

Rules:

- All CDP calls live in `lib/cdp`. Nothing else touches `chrome.debugger`.
- Background never assumes the tab is still there; every step re-checks `tabId` and handles "tab closed" gracefully.
- The print path never attaches `debugger` (§5). It is the way out of the yellow bar, and only that while it stays CDP-free.

---

## 4. How each mode works

### 4.1 Print dialog — native print (`exportMode: "print"`)

1. Content script runs pre-processing (user-configurable):
   - hide `position: fixed|sticky` elements taller than 40px (cookie bars, headers) — collect via `getComputedStyle` walk
   - open all `<details>`, remove `overflow: hidden` from scroll containers
   - scroll to bottom in steps to fire lazy loaders, then back to top
   - optionally prepend a small header block (title / URL / date)
2. Inject `<style media="print">` with user's overrides (default: `* { -webkit-print-color-adjust: exact }`)
3. `window.print()`. The user picks "Save as PDF" and ticks "Background graphics".
4. `afterprint` → undo DOM changes (restore hidden elements).

Limits: paginated A4/Letter, print CSS still applies (we only nudge it), one dialog per export. That's the print-dialog deal: no `debugger`, no yellow bar, and it's still vector text.

### 4.2 One-click, screen look (CDP) — the default (`exportMode: "screen"`)

1. `chrome.permissions.request({ permissions: ['debugger'] })` on first use; explain why in the popup _before_ the browser prompt. *(Not possible — `debugger` cannot be optional, so it is declared and the prompt is the install prompt: README Deviation 1. The popup's hint line says what the yellow bar is.)*
2. `chrome.debugger.attach({ tabId }, '1.3')`
3. Content-script pre-processing as in Free (scroll for lazy load).
4. `Emulation.setEmulatedMedia({ media: 'screen' })` ← the whole trick. Page renders with screen CSS.
5. `Page.getLayoutMetrics` → `cssContentSize` for sizing.
6. `Page.printToPDF` with:
   ```ts
   {
     printBackground: true,
     preferCSSPageSize: false,
     paperWidth:  cssContentSize.width  / 96,   // inches
     paperHeight: pageMode === 'single' ? cssContentSize.height / 96 : 11.69, // A4 = 8.27 x 11.69
     marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
     displayHeaderFooter: false,
     transferMode: 'ReturnAsStream'          // avoids huge base64 strings for big pages
   }
   ```
7. Read stream via `IO.read` chunks → `Uint8Array` → offscreen Blob URL → download.
8. `chrome.debugger.detach` in `finally`. Always.

**Single-page trap:** Chromium refuses absurd paper sizes (practical ceiling ≈ 200 in ≈ 19,200 px). For taller pages, fall back to chunks of ≤ 190 in and merge with `pdf-lib`. Show a note in the result ("page was split into 3 sheets — it was 31,000 px tall"). *(Only the note survived. The ceiling is 500 in, and past it `printToPDF` paginates equal slices by itself, so nothing is merged — README Deviation 4.)*

**Why this beats the competitors:** real text + screen appearance + no dialog. Competing free extensions either rasterise (html2canvas fallbacks) or apply print CSS.

---

## 5. Permissions

`manifest` (via `wxt.config.ts`):

```ts
// as shipped, in wxt.config.ts
permissions: ['activeTab', 'scripting', 'storage', 'debugger', 'downloads', 'offscreen'],
host_permissions: []          // none. activeTab covers the current tab on click.
```

There are no optional permissions: everything the extension uses is declared.

**`debugger` is required, not optional.** Chrome will not grant it through
`permissions.request()` at runtime (README Deviation 1), and the free default
needs it anyway: one-click export and screenshots both run over CDP. So it is
declared from the first release — one listing, one review queue, and no
re-consent prompt on a later update, because no update adds it. The print
path never attaches it, and that invariant is what the §9 matrix checks rather
than assumes.

Store justification text (write it once, keep it true):

- `activeTab`, `scripting` — run DOM pre-processing, and `window.print()` when the print dialog is chosen, on the tab the user clicked on.
- `downloads` — save the PDF or the screenshot.
- `storage` — settings, the licence key, and the drawing bar's preferences.
- `offscreen` — create Blob URLs for downloads (service workers can't).
- `debugger` (required) — one-click PDF export and screenshots: used exclusively for `Page.printToPDF`, `Emulation.setEmulatedMedia` and `Page.captureScreenshot` on tabs the user chose to export or photograph; attached only for the duration of that one export, detached immediately after; never reads network traffic or cookies. Not attached at all when the user picks the print dialog.

Review with `debugger` is slower and sometimes bounces. The original plan was to keep it out of v0.1 entirely and add it with Pro in v0.2; that is no longer the shape of the build, because one-click export and screenshots are free and use it (README Deviations 13 and 24). So v0.1 declares it and carries the slower review once, and nothing planned adds a permission after it — the better of the two update stories in any case.

---

## 6. Licensing — license keys, no accounts, no login

**Principle:** the user never creates an account and never logs in. Pro is unlocked by a license key that arrives by email after purchase and is pasted once into the popup.

### 6.1 v0.2 — vendor-issued keys (zero backend)

- **Lemon Squeezy** as merchant of record (handles EU VAT per buyer country), single one-time product, **$5**, license keys enabled, activation limit **5**.
- Purchase flow: popup "Get Pro" → opens LS checkout in a new tab → LS emails receipt + key → user pastes key into popup → done.
- `lib/license`:
  - `activate(key)` → `POST https://api.lemonsqueezy.com/v1/licenses/activate` with `instance_name = <browser> <os>`; on success store `{ key, instanceId, paid: true, checkedAt }` in **`chrome.storage.sync`**.
  - `isPro()` → read cache; if `checkedAt` older than 7 days, call `/v1/licenses/validate` in the background (never block an export on the network); if the network is down, keep the cached answer (**offline grace 30 days**).
  - `deactivate()` → `/v1/licenses/deactivate` from the options page, frees an activation slot.
- **Storage in `sync`, not `local`**, on purpose: the key follows the user's Chrome profile to every device and survives reinstalls. Reinstalling resets nothing — the exact opposite of a local counter.
- Popup has "I have a key" and "Lost my key?" → the LS license-recovery page (by email). Zero support load for you.

### 6.2 Later — self-signed offline keys (optional)

If you ever want independence from the vendor's API at runtime:

- Key format: `base64url(payload) + "." + base64url(signature)`; payload `{ p: "pagepdf", id: "<order id>", iat: <unix> }`.
- Sign with **ECDSA P-256** (works in every Chrome via WebCrypto; Ed25519 also works but check the target Chrome version) using a private key that lives only in the issuing service.
- Issuing service: a Cloudflare Worker receiving the payment webhook (`order_created`) → signs → emails the key via Resend. ~30 lines, but it is _your_ backend and _your_ on-call.
- Verification in the extension is fully offline:

```ts
const PUB_JWK = {
  /* embedded public key */
} as JsonWebKey;

export async function verifyKey(
  key: string,
): Promise<{ ok: true; id: string } | { ok: false }> {
  const [p, s] = key.split(".");
  if (!p || !s) return { ok: false };
  const pub = await crypto.subtle.importKey(
    "jwk",
    PUB_JWK,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    pub,
    b64url(s),
    b64url(p),
  );
  if (!valid) return { ok: false };
  const payload = JSON.parse(new TextDecoder().decode(b64url(p)));
  return payload.p === "pagepdf" ? { ok: true, id: payload.id } : { ok: false };
}
```

- Trade-off: no revocation without an online check, no activation limits. At $5, acceptable.

### 6.3 Rules that apply to both

- Gate **features**, not counters. There is no export counter anywhere in this codebase; `isPro()` is the only switch, and it guards exactly one feature — Draw mode, at the one place annotate mode starts.
- Never call home on export. License checks happen on popup open (rate-limited) or in the background, never in the export path.
- Pro upsell is quiet: a "Pro" badge on the Draw button and one link in the popup's footer. The Pro dialog opens only when someone taps one of them — never on its own, never a post-export nag.
- **Piracy stance:** a $5 key will be shared within a week. Don't fight it — no hardware binding, no phone-home, just the activation limit. People who pay $5 do it because they want to; the others were never customers (see: reinstalling the competitor to reset its counter).
- Store `key` and cached status in `chrome.storage.sync`; store nothing about the license in `local`.

**Merchant note:** with Lemon Squeezy (or Paddle) as merchant of record you are not the seller of record — they handle VAT/OSS. With ExtensionPay/Stripe _you_ are, and EU VAT on digital goods to consumers applies per buyer country. This is why LS is the v0.2 default. Confirm the Polish side (działalność nierejestrowana thresholds, etc.) with an accountant, not with this file.

---

## 7. Privacy

- 100% local. No server, no analytics, no telemetry, no remote config.
- Privacy policy (public URL, required by the store) says exactly that, in five sentences.
- Register **trader status** in the Chrome Web Store developer dashboard before charging. It costs nothing and gives EU buyers normal consumer rights. Competitors didn't; be the one who did.

---

## 8. Two-weekend plan, and where it actually landed

Kept much as written, with the state of each line. The scope grew by three
features that were not in this file at all — screenshots, drawing and keyboard
shortcuts (README Deviations 13, 15-20, 21). The tiers moved too: weekend 2's
one-click export, screen look and single long page shipped free, and Pro is
Draw mode (§1, README Deviation 24). What stands between the code and the store
is the listing work, not a feature.

### Weekend 1 → v0.1 in the store (Free only)

- [x] `pnpm dlx wxt@0.20 init`, TypeScript, pin versions, repo, README
- [x] Popup: Export button, "hide sticky elements" / "expand details" / "load lazy images" / "add header" toggles — plus Draw and two screenshot buttons; every other setting lives on the options page
- [x] Content script pre-processing + `window.print()` + `afterprint` restore — injected, never declared (Deviation 3)
- [x] Options page: default toggles, filename template (now used by the one-click PDF and both screenshot paths), and the export mode
- [ ] Icons done (`pnpm icons`); store screenshots (3), 132-char short description and the single-purpose statement are not
- [ ] Privacy policy drafted in `docs/privacy-policy.md`; not hosted, and `PRIVACY_POLICY_URL` is empty
- [ ] `wxt zip` → upload → submit for review

### Weekend 2 → v0.2 (Pro)

- [x] `lib/cdp` wrappers, `Emulation.setEmulatedMedia`, `printToPDF` stream path, offscreen Blob download (chunked, after a 64MiB message limit bit)
- [ ] Explanation screen before the permission moment. The permission itself is declared, not optional — see §5
- [x] Single-page mode with an equal-slice fallback and no merge, ceiling 500in (Deviation 4)
- [ ] Lemon Squeezy product + `CHECKOUT_URL`, "I have a key" / "Lost my key?" UI. `activate()`/`validate()`/`deactivate()`/`isPro()` are written and the cache logic is tested
- [ ] Trader status, updated permission justifications, submit v0.2

Anything not ticked on the second Sunday goes to `BACKLOG.md`. Ship what exists.

---

## 9. Manual test matrix (run before every submit)

| Page                                                 | Why                                            | Pass criteria                                                        |
| ---------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| explore.jobs.netflix.net job posting                 | dark theme, print CSS strips it, cookie banner | one click: dark look preserved; both paths: banner hidden; **Ctrl+F finds text** |
| A long Medium / Substack article                     | lazy images, sticky header                     | all images present, header not repeated                              |
| GitHub README                                        | code blocks, wide tables                       | no clipped tables in single-page mode                                |
| A React SPA dashboard (any)                          | client-rendered, no print CSS                  | content present, not blank                                           |
| Page with `position: fixed` chat widget              | element hiding                                 | widget gone, restored after print                                    |
| 60,000 px tall page, single long page on             | the single-page ceiling, 500 in ≈ 48,000 px    | split into equal sheets of ≤ 500 in in one PDF, nothing merged, note shown |
| "Use the print dialog" on (`exportMode: "print"`): Export PDF from the popup, `Ctrl/Cmd+Shift+S`, and — as Pro — Save from the drawing bar | the print path's one invariant, at all three entry points: it never attaches `debugger`. The mode is read in one place, so no entry point may pick the other path | Chrome's print dialog opens every time. **No** "started debugging this browser" bar, ever. "Single long page" is greyed out with its reason, and a single-page choice made before switching gives paginated sheets, not an error. Save, then Ctrl+F a word from the page in the PDF |
| Any article, annotated (pencil, rect, a label)       | the marks must be real text and real vector    | bar gone; marks once each, right sheets; **Ctrl+F finds label text** |
| The same article, with a label typed until it **wraps** onto 3-4 lines | one `<tspan>` per line; the later lines are what can stop being text | all lines present, in order; **Ctrl+F finds a word from a line that is not the first** — not found means broken |
| A text box left **open**, then Ctrl+P; then again via a one-click export | the editor frame is chrome, not a mark, and must never print | **no dashed rectangle and no handles** in the preview, the PDF or a full-page screenshot; the label itself is there |
| Symbols palette open: place 5 marks, then use a page `<select>` or menu | only the bar dismisses a panel — nothing in the page does | palette **still up** after all 5 marks and after the page's menu; its trigger or Esc closes it; absent from PDF and screenshot |
| A paragraph of real text with a **cover** dragged over it (arm "Cover - removes text"), saved to PDF via Ctrl+P | the whole point of the feature. An opaque block that leaves the words in the text layer is worse than no tool at all — it looks like a redaction and publishes the text | **Ctrl+F a word that was under the block: NOT found.** Ctrl+F a word beside it in the same paragraph: **found**. Select the covered line in the PDF and copy it: the covered words are not in what you pasted |
| The same page **after** the print dialog closes, then again after exiting annotate mode with the X | covers are applied around the capture and taken off after; a page left with holes in its text is a page this extension broke | all the text is back, **nothing reflowed** — the words after the block are exactly where they were — and the marks are where you left them. Both times |
| The same cover over a **region screenshot**, and over the **one-click path** (`exportMode: "screen"`) | three capture brackets, not one: a save from the bar is a `window.print()` or a CDP capture happening inside a third thing | region PNG: nothing readable under the block, page intact afterwards. One-click PDF: the same two Ctrl+F results as the row above |
| A page with a `<textarea>` holding text **and** a `<select>` with a chosen option, both covered | neither value is a text node any `Range` reaches — a `<select>`'s option label is painted by the browser's own widget — and Chrome prints both | the **whole** control is blank in the export and its value is not in the PDF, for **both**. A `<select>` still showing its option is the leak §30 closed reopening |
| A cover over a **cross-origin iframe** | README Deviation 20's one genuine leak: confirm it is still exactly this and no worse, and that the bar still warns about it | the frame's own text **is** still in the PDF (expected, and documented); nothing outside the frame leaks, and the bar's note line said so |
| A cover dropped in the middle of a paragraph with its top edge **between two lines** — run it at the **4px** pen and again at **8px** | the user's reported bug, and the one a unit test cannot reach: a character's `Range` box is the font box, so an edge in the empty leading paints over nothing and used to hide the whole line above — and the inset that fixes it is measured per line against the page's real font | Ctrl+F a word from the line **above** the block: **found**, at both pens. Ctrl+F a word from under the block: **not found**. The 8px pen paints 4px above the edge you dragged, so give it a couple of px of clearance; the line above disappearing when the edge is clearly below its glyphs is the bug back |
| The same, on a paragraph whose **line above the block has descenders** in it (a `p`, a `g`, a `y`) | that line's ink really does reach almost to the bottom of its font box, so it is the thin case — about 4px of a 5px gap at the 8px pen genuinely is painted over | the line above goes only when the block's own ink lands on it. Written down in Deviation 20 with the swept numbers; this row is where it is seen rather than argued |
| A cover over the text of a **web component** (`attachShadow({mode: "open"})` — build one in the console if no page to hand has one) | neither `createTreeWalker` nor `querySelectorAll` crosses a shadow boundary, so this hid nothing at all before task 39 | the covered word: **not found**; an `<input>` inside the component is blanked whole too. Repeat with `{mode: "closed"}`: the word **is** found — expected and documented. Then draw a **text label of our own** over the covered area: its text is still in the PDF and still findable, or the walk has reached inside our own layer |
| A page whose entire content is inside `document.body.attachShadow({mode: "open"})` | the walk root is the one node a `TreeWalker` never returns, so missing *its* shadow root leaked the whole document at once — `runs: 0`, the markup byte-identical under a cover | a cover over any paragraph of it hides it: Ctrl+F the covered words, **not found**, and the words beside the block **found** |
| A cover over an **SVG chart label** (`<svg><text>`, e.g. an axis label), on a chart with several | `createElement` is namespace-blind: an HTML `<span>` inside the SVG namespace renders nothing, so the glyphs left layout instead of staying hidden in place and the label's box collapsed | the covered label: **not found** in the PDF — **and the other labels have not moved**, axis by axis, against the page on screen. A neighbour that shifted means the wrapper collapsed the `<text>`'s box. If the page has a `<foreignObject>` with text in it, cover that too: same two checks |
| The fill menu: open it, arm each of the three modes, then reload the page and Draw again | the armed mode is read off the trigger, the labels are a contract, and the cover warning is asserted in **no test** — this row is its only guard | trigger icon changes with the mode and its accessible name reads "Shape fill - " plus the button's own label **verbatim**; the cover sentence appears **once per session** — on the press that arms Cover, or when a session opens already armed on it after the reload — and never twice. The trigger renders wider than the 28px buttons with its icon a few px off centre: expected, `.btn.trigger` was written for the font-size control's tabular numbers |
| `chrome://extensions/shortcuts` on a fresh profile, then each of the four keys on an ordinary article | the suggested keys are only *suggestions*: Chrome binds at most four per extension and silently drops any that one of its own shortcuts already owns, so a key can ship dead and no build, test or log will say so | all four commands listed, **none of them blank**, and the keys are the ones in `wxt.config.ts`. Press each: the PDF or the print dialog, a full-page shot, the drag selector, the drawing bar (or, with no key, the Pro toast). A blank row is not a bug to fix in code — rebind it there and change the suggestion |
| `Ctrl/Cmd+Shift+S`, then `Ctrl/Cmd+Shift+K`, on a `pnpm build` with one click chosen (the default) and no key pasted — `DEV_UNLOCK_PRO` is false there | the tier boundary, at the two shortcuts either side of it: saving is free and must never ask for a key; drawing is Pro and must say so rather than do nothing | `S`: the PDF lands in Downloads with no dialog and **no** Pro upsell — a keypress that answers with one is the bug. The yellow bar shows while it runs and is gone after. Ctrl+F a word from the page in the PDF. `K`: no drawing bar, the page unchanged, and exactly **one** toast in it: "Draw mode is a Pro feature." In the popup, Draw shows a "Pro" badge and opens the Pro dialog |
| `Ctrl/Cmd+Shift+X`, and again on a capture you make fail (start the drag, then close and reopen a devtools window over it, or pick a strip a few px tall) | the region path reports itself in the page because the popup is gone by then, so a shortcut that also reports duplicates it — and `select-area.ts` keeps one removal timer, so the **duplicate is the one that never leaves** | exactly **one** toast, whichever way it ends, and it fades after about 4s. Two toasts, or one still sitting there a minute later, means `commandToast` stopped keeping quiet for `capture-area` |
| Any shortcut on `chrome://extensions`, the Web Store, and a `.pdf` in the built-in viewer | nothing can be injected there, so there is nothing to report *into* — this row exists to confirm the silence is total and harmless rather than half a broken overlay | **nothing happens at all**: no toast, no overlay, no changed page, and no uncaught error in the service worker's console. Compare with the popup on the same page, which greys its buttons out and says why. The difference is documented, not a regression |
| `Ctrl/Cmd+Shift+S` with one click chosen, on a long page, then switch to another tab while it runs — one you have used the extension on before, so it holds its own `activeTab` grant | the toast is addressed from the tab the keypress fired on, resolved before the work; re-reading it afterwards put a slow export's "Saved" over whatever page the user had moved to | "Saved ….pdf" appears on the tab you **started from** (switch back to it), and **never** on the tab you moved to |
| As Pro: `Ctrl/Cmd+Shift+K`, then the same key again, then `Ctrl/Cmd+Shift+X` without leaving the bar | a shortcut can arrive on a page that is already in a mode, which no unit test reaches | the second press does not stack a second bar or move the marks; the region capture hides the bar for the shot and brings it back, and the shot has the marks in it but no bar |
| An article with many lazy images, exported from the popup and then again with Draw — and once more on a short page with **Load lazy images off** | the curtain is the only thing standing between the user and a page that scrolls itself to the bottom for no visible reason, and a curtain that outlives its sweep is worse than none | the dimmed overlay with "Preparing the page..." appears **over the viewport** while the page scrolls, both times, and is **gone** before the print dialog, the download or the drawing bar. With the sweep off, or on a page fast enough to finish inside 180ms, it never appears at all. Nothing of it is in the PDF or the screenshot |
| The same, with the print dialog left open a while, then cancelled | the curtain comes down in a `finally` before the background is answered, so a dialog that sits open must not be sitting on top of one | no overlay behind or around the dialog, and the page is back to normal after Cancel |

After any export: open the PDF, **Ctrl+F**, search a word from the page. If nothing is found, the build is broken. With a cover on the page the check runs both ways, and the second half is the one that can hurt somebody: a covered word that **is** found means the cover is broken.

---

## 10. Known traps

1. **Service workers can't `URL.createObjectURL`.** Use the offscreen document for Blob URLs, or `data:` URLs only for small files (< ~2 MB).
2. **`printToPDF` base64 on huge pages** will blow memory — use `transferMode: 'ReturnAsStream'` + `IO.read`.
3. **`chrome.debugger` can't attach** to `chrome://`, the Web Store, other extensions' pages, or the built-in PDF viewer. Detect and show a clear message.
4. **The yellow infobar** is unavoidable on the one-click path; the popup's hint line says so, so nobody thinks it's malware, and the print dialog is the way to avoid it.
5. **Detach in `finally`.** A leaked debugger session blocks DevTools for the user and looks exactly like malware.
6. **`Emulation.setEmulatedMedia` persists** for the session — detaching resets it, but if you ever keep the session, reset with `{ media: '' }`.
7. **Popup closes** when focus moves — on purpose for an area capture and for Draw — so anything that outlives the click is reported in the page or kept in storage, never in popup memory.
8. **Filenames**: strip `/ \ : * ? " < > |`, cap at 120 chars, fall back to hostname.
9. **WXT 0.20 import paths** (see §2).
10. **Don't add analytics "just to see usage."** The privacy line is part of the product.

---

## 11. Store listing skeleton

- **Name:** TBD (short, own, no "Web to PDF")
- **Short description (≤132):** "Save any page as a PDF with real, searchable text that looks like the screen. Free, unlimited, no nagging."
- **Single purpose:** Export the current web page to a PDF file.
- **Category:** Productivity
- **Screenshots:** popup; before/after (print CSS vs screen look); a page marked up with the drawing tools and the PDF it produced
- **Privacy tab:** all data handling = "not collected"; justify each permission with the §5 text
- **Trader:** yes

---

_Two weekends. Free tier first. Ctrl+F is the test. Ship._
