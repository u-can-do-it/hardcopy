# 14 - Starting and stopping annotate mode

**Goal**: the popup has a **Draw** button, and the background enters annotate
mode on a held, prepared page with the tool set this browser is entitled to.

**Files**
- `entrypoints/background.ts` (modify)
- `entrypoints/popup/store.ts` (modify)
- `entrypoints/popup/App.tsx` (modify)

**Contracts**: `contracts.md` §15 (`handleAnnotate`, `handleAnnotateExit`,
`ANNOTATE_SCRIPT`, the `sender` rename) and §16 (`startAnnotate`, the Draw
button).

`handleAnnotate({ action: "start" })`:
1. `getActiveTab()`, then `canInject(tab.url)` - `RESTRICTED_URL` on refusal.
   **`canInject`, not `canAttachDebugger`**: drawing needs no CDP, and the free
   path must never depend on `debugger` (`CLAUDE.md`).
2. `isPro()` once, then `toolsFor(pro)`. The background is the only place
   entitlement is decided; the bar never re-derives it (`design.md` §3).
3. Inject `PREPARE_SCRIPT` and `ANNOTATE_SCRIPT`.
4. `PAGE_PREPARE` with `print: false` **and `hold: true`**, so annotate mode
   enters on a page that is already expanded, lazy-loaded and de-stickied, and
   so nothing later tears that pass down.
5. `PAGE_ANNOTATE_START { prefs, tools }`, prefs from `loadDrawPrefs()`.
6. Reply `AnnotateSuccess { active: true, report, tools }`.

Starting when already started is **not an error**: re-send
`PAGE_ANNOTATE_START` and reply `active: true`. The injection guards make it
idempotent.

`handleAnnotate({ action: "stop" })` and `handleAnnotateExit(tabId)` both send
`PAGE_ANNOTATE_STOP`, then `PAGE_RESTORE { release: true }`, and reply
`AnnotateSuccess { active: false }`. Best-effort on each, the way
`reportInPage` already is - a tab that has navigated away simply hears nothing.

The popup's Draw button closes the popup after a successful start, the way
`runCapture("region")` does: drawing means clicking on the page, which
dismisses the popup either way, so it closes deliberately rather than being
dismissed mid-sentence.

**Out of scope**: saving from the bar (task 15). Do not add `keepPrepared` to
any request, do not add per-tab tracking, and do not add `tabs.onRemoved` or
`tabs.onUpdated` listeners - navigation takes the marks, the scripts and the
`activeTab` grant with it, which is the correct outcome and needs no code
(`design.md` §5). `handleExport`, `handleScreenExport` and `handleCapture` keep
their current bodies in this task.

**Proof**
```bash
pnpm compile
```

Background orchestration plus one Preact button; no pure logic is added here -
`toolsFor` is tested in task 02 and `mergeDrawPrefs` in task 07.

**Manual check**

1. Popup -> **Draw** on an ordinary article. The page visibly re-arranges
   (sticky bars gone, sections open) and the bar appears. The popup closes.
2. Set `DEV_UNLOCK_PRO = false` in `lib/constants.ts` and rebuild: the symbols
   and text buttons are `disabled`, hovering shows the Pro tooltip, and
   clicking one shows the note instead of activating it. Pencil, line, rect and
   ellipse work. Set it back to `true` and confirm nothing is locked.
3. Press the bar's X: the bar and layer disappear **and the page is restored** -
   sticky bars back, sections as they were, header block gone.
4. Press Draw on a `chrome://` tab: the popup shows the restricted-URL message
   and no script is injected.
5. Press Draw twice: the second press does not stack a second bar.
6. With marks up, use the popup's **Export PDF**: the page does not visibly
   re-arrange, the header block appears once, and the marks are where you left
   them. Afterwards the bar and the marks are still there and you can keep
   drawing. (This is task 13's `held` path, reachable for the first time here.)

**Depends on**: 01, 02, 07, 12, 13
