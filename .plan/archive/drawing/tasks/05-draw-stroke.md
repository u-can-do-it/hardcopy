# 05 - The pen

**Goal**: `lib/draw/stroke.ts` turns pointer samples into one `<path d="...">`
via `perfect-freehand`, and the dependency-free half of that is tested.

**Files**
- `package.json` (modify - add the dependency)
- `pnpm-lock.yaml` (modify - by `pnpm add`, not by hand)
- `lib/draw/stroke.ts` (create)
- `tests/draw-stroke.test.ts` (create)

**The dependency**
```bash
pnpm add perfect-freehand@1.2.3
```

Exact pin, no caret - matching `pdf-lib` and `lucide-react` in
`package.json`. **pnpm only, never npm or yarn.** Do not touch
`pnpm-workspace.yaml`: no vite or wxt resolution is involved here.

If `1.2.3` does not resolve, **stop and report it** rather than floating the
range or picking another version - `design.md` §7 quotes measured byte sizes
against that exact release.

**Contracts**: `contracts.md` §5, verbatim - `STROKE_OPTIONS`,
`PATH_PRECISION`, `outlineToPath`, `dotPath`, `strokePath`. Import as
`import { getStroke } from "perfect-freehand"`.

**Out of scope**: rendering the path into an element (task 09), the
highlighter's blend mode (task 09), pointer capture.

**Proof**
```bash
pnpm test tests/draw-stroke.test.ts
```

Cover at least: `outlineToPath([])` is `""`; a three-point outline produces a
closed `d` with coordinates rounded to `PATH_PRECISION` decimals and no
exponent notation; `dotPath` produces a closed circle-ish `d` at the right
place; `strokePath` with one sample equals `dotPath` at that sample;
`strokePath` with several samples returns a non-empty `d` that starts with `M`.
Assert shape and invariants, not perfect-freehand's exact numbers - those are
its business and would make the test a change-detector.

**Depends on**: 02
