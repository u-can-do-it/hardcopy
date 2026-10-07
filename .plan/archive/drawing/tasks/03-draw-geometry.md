# 03 - Geometry: snap, square, arrowheads, anchoring, clamping

**Goal**: `lib/draw/geometry.ts` answers every pure spatial question the tool
has, so neither the entrypoint nor the bar does arithmetic.

**Files**
- `lib/draw/geometry.ts` (create)
- `tests/draw-geometry.test.ts` (create)

**Contracts**: `contracts.md` §4, verbatim - `SNAP_STEP_DEG`, `BAR_MARGIN_PX`,
`toDocument`, `anchorCorrection`, `normalizeRect`, `constrainSquare`,
`snapAngle`, `arrowHead`, `clampToViewport`.

**Out of scope**: hit-testing and shape selection (phase 3 - do not add a
`hitTest`), edge auto-scroll, anything DOM.

**Proof**
```bash
pnpm test tests/draw-geometry.test.ts
```

Cover at least: `toDocument` adds the current scroll; `anchorCorrection`
returns `{0,0}` for a host already at the document origin and the exact
negation for a host displaced by an `html` margin; `normalizeRect` normalises a
drag made in any of the four directions and does **not** round (contrast
`rectFromPoints` in `lib/capture/plan.ts`, which rounds outwards on purpose);
`constrainSquare` keeps the drag's sign in both axes; `snapAngle` snaps 43deg to
45deg, leaves an exact 15deg multiple alone, preserves length, and returns `to`
unchanged for a zero-length drag; `arrowHead` barbs are symmetric about the
line and `size` away from the tip; `clampToViewport` keeps a bar inside with
`margin` respected on all four edges, and pins a bar wider than the viewport to
`margin` rather than going negative.

**Depends on**: 02
