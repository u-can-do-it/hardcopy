# Testing

```bash
pnpm test                      # vitest, all suites
pnpm test tests/urls.test.ts   # one suite
pnpm compile                   # wxt prepare && tsc --noEmit
```

## Unit-tested

`pnpm test` covers the pure logic in `lib/`, one flat `tests/<topic>.test.ts`
per module:

- **Export and pages**: filename templating, URL gating, the fixed-element
  predicate, lazy-load, viewport units, print CSS, printToPDF params, page size,
  painted height, settings migration, licence cache expiry.
- **Screenshots**: `capture-plan` (drag normalisation, clamping, fit-to-one-image
  scale including WebP's ceiling, slice maths) and `capture-format` (format
  table, PNG header reader, transfer chunking).
- **Drawing**: one `draw-<topic>` suite per `lib/draw/` module, plus `cover`
  for the pure half of `lib/dom/cover.ts`.
- **Seams**: `commands` pins the `wxt.config.ts` commands block against
  `CommandName`; `third-party-licenses` covers the notice builder.

**Anything with a decision in it goes into `lib/` with a test beside it.**
Entrypoints stay thin.

## Manual, by design

- The bar, the layer mount and the pointer state machine in
  `entrypoints/annotate.ts` are DOM and pointer plumbing: `pnpm compile` and a
  human. `tests/` has no DOM harness on purpose.
- The CDP side - the clips and the saved file - needs the extension loaded in
  Chrome.
- The interactive print dialog is its own code path. Unit tests, headless
  renders and inspecting injected CSS cannot check it; it needs a human with
  Ctrl+P.
- Run the `project.md` §9 matrix before every submit.
- The check that matters most: **open the exported PDF, Ctrl+F, search a word
  from the page.** Nothing found means the build is broken.

## Known gaps

- `FILL_NOTE` (the once-per-session line that a cover cannot reach inside an
  embedded frame) has no automated guard. Its triggers live in
  `entrypoints/annotate.ts`; only the §9 matrix protects it.
- `inkWidth` exists in three private copies - `lib/draw/render.ts`,
  `lib/draw/layer.ts` and `lib/draw/model.ts` - all reading
  `HIGHLIGHT_WIDTH_SCALE`. If they drift, `layer.ts`'s copy sizes the mark's box
  and can clip a highlighter's ink. Fix all three together.
