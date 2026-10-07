# 19 - The editor frame's geometry

**Goal**: `lib/draw/frame.ts` says where the eight handles are, which one a
press hit, and what moving or resizing does to the box.

**Files**
- `lib/draw/frame.ts` (create)
- `tests/draw-frame.test.ts` (create)

**Contracts**: `contracts.md` §21, verbatim - `FrameZone`, `FRAME_HANDLE_PX`,
`MIN_TEXT_WIDTH_PX`, `MIN_TEXT_HEIGHT_PX`, `FRAME_RESIZE_ZONES`,
`frameHandles`, `frameZoneAt`, `moveFrame`, `resizeFrame`.

Pure, types-only imports from `./model`, and written against any `DrawRect` -
not against `TextShape`. `.plan/design.md` §11.2 explains why: phase 3's
select/move will want exactly these four functions, and writing them shaped for
one caller means writing them twice.

**`frameHandles` has two readers and that is the point.** `frameZoneAt` hit-tests
against it and `frameSpec` (task 22) draws from it, so the handle you can see is
the handle you can grab. Do not let either one compute a handle rect of its own.

**Out of scope**: any DOM (task 22 draws the frame), any pointer handling (task
24), `TextShape` (task 20).

**Proof**
```bash
pnpm test tests/draw-frame.test.ts
```

Cover, at least:
- `frameHandles` returns eight entries, one per member of
  `FRAME_RESIZE_ZONES`, each `FRAME_HANDLE_PX` square and centred on the corner
  or edge midpoint it names.
- a rect with **negative** width or height is normalised first, so no handle
  lands on the wrong side.
- `frameZoneAt` on each handle's centre returns that handle's zone.
- **corners beat edges**: the point where the `nw` and `n` handles overlap is
  `"nw"`.
- a point in the middle of the box is `"move"`; a point well outside is `null`.
- `moveFrame` translates and changes nothing else.
- `resizeFrame` moves the right edges for each of the eight zones - assert all
  eight, this is where a transposed sign hides.
- `resizeFrame` past the minimum **pins the opposite edge**: dragging `w` far
  east leaves `x + width` where it was and `width === min.width`; the box is
  never mirrored and `width`/`height` are never negative.
- `resizeFrame(rect, "move", …)` returns `rect` unchanged.

**Depends on**: none
