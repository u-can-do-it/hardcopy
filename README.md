# Hardcopy

A Chrome extension that saves any page as a PDF with **real, searchable text**
that looks like the screen - plus full-page and area screenshots, and a drawing
mode for marking the page up first. Free, unlimited, no account. 100% local: no
server, no analytics, no telemetry; settings live in `chrome.storage.sync`.

Built with [WXT](https://wxt.dev) (Manifest V3), Preact and TypeScript.

## Local setup

Requirements: Node, **pnpm** (version pinned in `package.json`'s
`packageManager` - use pnpm only, never npm or yarn) and Chrome 109+.

```bash
pnpm install    # also runs `wxt prepare`
pnpm dev        # dev build with reload, written to .output/chrome-mv3
```

To load a build by hand: `pnpm build`, then `chrome://extensions` -> Developer
mode -> **Load unpacked** -> `.output/chrome-mv3`.

### Commands

```bash
pnpm dev        # development build, watches and reloads
pnpm build      # production build
pnpm zip        # store-ready archive
pnpm test       # vitest, all suites (pnpm test tests/urls.test.ts for one)
pnpm compile    # wxt prepare && tsc --noEmit - run before calling anything done
pnpm icons      # regenerate public/icon/*.png
```

### Local configuration

- **Build mode decides Pro in development.** `DEV_UNLOCK_PRO` in
  `lib/constants.ts` is `import.meta.env.MODE === "development"`: `pnpm dev`
  unlocks Pro with no licence key, `pnpm build` and `pnpm test` do not. There is
  nothing to toggle by hand.
- **Launch period.** `LAUNCH_FREE_FOR_ALL` in `lib/constants.ts` is `true` and
  meant to ship: everything, Draw mode included, is free and the licence UI is
  hidden. Setting it to `false` brings the Pro tier back.
- **Keyboard shortcuts** are suggestions in `wxt.config.ts`; rebind them at
  `chrome://extensions/shortcuts`. Chrome silently drops any that clash with its
  own.
- **Pinned toolchain.** `wxt` is pinned to 0.20.27 exactly (0.21 moves the
  entrypoint helpers), and `vite` to 6.4.3 via an override in
  `pnpm-workspace.yaml` - pnpm 11 reads overrides and build-script approval
  from there, not from `package.json`. Do not float either.

### Before you ship

Unit tests cover the pure logic in `lib/`; everything that touches the DOM or
Chrome is covered by the manual matrix in `project.md` §9. The one check that
matters most: **open the exported PDF, Ctrl+F, search a word from the page.**
Nothing found means the build is broken.

## Docs

- [project.md](project.md) - the product brief
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - layout, message flow, features, and the numbered decisions behind them
- [docs/TESTING.md](docs/TESTING.md) - what the suites cover and what stays manual
- [BACKLOG.md](BACKLOG.md) - what was deferred, and what is left before release
- [docs/SPEC-DRIVEN.md](docs/SPEC-DRIVEN.md) - how a feature gets from a brief to merged code
- [docs/store-listing.md](docs/store-listing.md), [docs/privacy-policy.md](docs/privacy-policy.md) - Chrome Web Store submission
- [docs/LEMON-SQUEEZY.md](docs/LEMON-SQUEEZY.md) - turning the paid tier on

## License

[FSL-1.1-MIT](LICENSE.md) (Functional Source License, MIT future license): the
code may be read, modified and redistributed for anything except a competing
commercial product, and each released version becomes MIT two years after it
is published. Third-party notices are written to `THIRD_PARTY_LICENSES.txt` in
every build.
