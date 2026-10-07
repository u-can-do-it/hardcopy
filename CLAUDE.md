# CLAUDE.md

Hardcopy: a Chrome MV3 extension (WXT + Preact) that saves a page as a PDF with
real, searchable text — plus full-page and area screenshots. Code identifiers
(`data-pagepdf-*`, `__pagepdfInstalled`, CSS names) keep the old working name
`pagepdf` on purpose; only what users see says Hardcopy.

## Read first

The docs below are history as much as reference. For what the product does
*now* - tiers, gates, features - the code is the authority: grep the gates
(`isPro()`, `effectivePageMode`, `settings.exportMode`) and answer from them.
When a doc and the code disagree, trust the code and fix the doc.

- `README.md` — state of the code, the message flow, and a **Deviations** list
  explaining every place the code knowingly departs from the brief. Each entry
  is a decision with a measurement behind it. Read the relevant one before
  changing that area; do not "fix" a deviation back to the brief.
- `project.md` — the product brief (tiers, permissions, §9 manual test matrix).
- `BACKLOG.md` — what was deferred.

## Commands

```bash
pnpm dev                       # loads .output/chrome-mv3 as an unpacked extension
pnpm build                     # production build
pnpm test                      # vitest, all suites
pnpm test tests/urls.test.ts   # one suite
pnpm compile                   # wxt prepare && tsc --noEmit
```

pnpm only — never npm or yarn. Run `pnpm compile` before considering anything
done; `strict`, `noUnusedLocals` and `verbatimModuleSyntax` are all on.

## Architecture rules

- **Logic lives in `lib/`, pure and unit-tested. Entrypoints stay thin.** This
  is why `tests/` is plain vitest with no DOM harness. Preserve it: new logic
  goes in a `lib/` module with a `tests/<topic>.test.ts` beside it, not inline
  in `entrypoints/background.ts`.
- `lib/cdp/` is the only module allowed to touch `chrome.debugger`.
- Tests are flat: `tests/<topic>.test.ts`, importing via the `@/` alias.

## Tiers

**Everything is free except Draw mode.** One-click export (CDP
`Page.printToPDF` with screen media, the default `exportMode`), single long
page, the print-dialog path, screenshots and shortcuts are free. Draw mode is
Pro, all of it, gated once at `ANNOTATE start` in `handleAnnotate`
(`entrypoints/background.ts`) - the only entitlement check the feature makes.
The bar has no tier logic: it always offers every tool, and nothing in
`lib/draw/` knows Pro exists.

**Launch period: `LAUNCH_FREE_FOR_ALL` in `lib/constants.ts` is `true` and is
meant to ship.** `isPro()` answers true for everyone, so Draw is free too, and
the popup's "Pro?" link and the options page's licence card are hidden. It is a
deliberate, temporary product decision - don't flip it, and don't fold it into
`DEV_UNLOCK_PRO`. Turning it off is how Pro comes back.

## Invariants — breaking these is a product bug, not a style issue

- **The print path must never touch `debugger`.** `exportMode: "print"`
  (`entrypoints/prepare.ts` → `window.print()`) is the way out of the yellow
  "is debugging this browser" bar, and it is only that if it stays CDP-free.
  One-click export and screenshots use CDP.
- **The injected script replies to the background *before* calling
  `window.print()`** — `print()` blocks the renderer while the dialog is open.
- **`DEV_UNLOCK_PRO` in `lib/constants.ts` follows the build mode**
  (`import.meta.env.MODE === "development"`): `pnpm dev` unlocks Pro with no
  key, `pnpm build` and `pnpm test` do not. Don't turn it back into a
  hand-edited boolean, and don't widen it to `import.meta.env.DEV` - vitest
  sets that, and a suite that silently runs as Pro proves nothing.
- **The pre-processing script is injected, never declared.** A declared content
  script needs `matches`, and `<all_urls>` would add a host-permission warning
  to the install prompt. `host_permissions` stays `[]`.
- An element holding >20% of the page's text is never hidden as "sticky
  furniture" — without that guard, sites with a `position: sticky` wrapper
  export blank.
- **The drawing layer is `position: absolute` in a clipping wrapper, never
  `fixed`.** A fixed layer repaints on every printed sheet; an unclipped one
  changes the page height the one-click path measures.

## Pinned on purpose

`wxt` 0.20.27 exactly (0.21 moves the entrypoint helpers), and `vite` 6.4.3 via
the `pnpm-workspace.yaml` override (two copies of vite means two incompatible
copies of its types). pnpm 11 reads overrides and build-script approval from
`pnpm-workspace.yaml`, not `package.json`.

`tsconfig.json` `paths` maps react → `preact/compat` so shadcn/Radix resolve.
That map replaces the inherited one rather than merging, so WXT's own aliases
are repeated there — keep them if you touch it.

There is no `lib/utils.ts`; `cn` comes from the `cn` package (README Deviation 6).

## What a unit test cannot tell you

The interactive print dialog is its own code path — headless renders, unit
tests and inspecting injected CSS have all reported single-page mode working
while the real dialog disagreed. Anything touching the dialog needs a human
with Ctrl+P, as does the §9 matrix in `project.md`.

The one check that matters most: open the exported PDF, Ctrl+F, search a word
from the page. Nothing found means the build is broken.

Numbers in code comments (WebP's silent 16,383px truncation, format sizes,
`OffscreenCanvas` limits) were measured in a real Chromium. Trust them over
your own recollection, and if you change one, measure again.

## Planned feature work

`/spec <feature.md>` writes a plan to `.plan/`; `/build` implements it with a
worker + reviewer per task. See `.claude/commands/`, and `docs/SPEC-DRIVEN.md`
for the whole loop - including the docs task that ends every pass, which is not
optional, and the append-only amendment convention for contracts.

Briefs live in `docs/features/`. Batch was dropped from the product, code and
plan both. Finished plans move to `.plan/archive/<feature>/`; a `.plan/contracts.md §N`
citation in a code comment resolves there - see `.plan/README.md`.

What is left before v0.1 ships is **not code**: a hosted privacy policy, store
screenshots, the listing copy and the submission itself. `BACKLOG.md`'s scope
section is the list.
