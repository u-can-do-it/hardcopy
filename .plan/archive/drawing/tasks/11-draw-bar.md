# 11 - The bar

**Goal**: `lib/draw/bar.ts` builds the floating tool bar in its own closed
shadow root - draggable, clamped, and rendering Pro tools locked when this
browser is not Pro.

**Files**
- `lib/draw/bar.ts` (create)
- `tests/draw-bar.test.ts` (create)

**Contracts**: `contracts.md` §11, verbatim - `BarAction`, `BarButton`,
`BarGroup`, `barGroups`, `BarState`, `BarHandle`, `BarOptions`, `mountBar`.

Groups, in this order (DRAWING.md §2): grip, tools (pencil, line, rect,
ellipse), symbols, text, width, colour, history (undo / redo / clear), save,
exit.

- `position: fixed`, dragged by the grip, clamped with `clampToViewport()` on
  drag **and** on window resize, and `onMove` fired with the clamped result so
  the caller can persist it.
- Its **own** shadow host, separate from the layer's, so it can be hidden for
  the duration of a capture without touching the drawing.
- Icons are inline SVG path data lifted from lucide (ISC). **`lucide-react`
  must not be imported here** - a content script is not the place for Preact,
  Tailwind and Radix.
- A locked button renders `disabled`, carries a `title` attribute saying it is
  a Pro feature, and on click puts that same sentence in `BarState.note`
  instead of activating the tool. That is the entire gate - nothing is
  re-checked later, and if someone tricks their own page into drawing a pin
  they get their pin (`design.md` §3). No modal, no new tab, no post-export nag
  (PROJECT.md §6.3), and no attempt to reach the popup's Preact `ProDialog`
  from a shadow root.

**Out of scope**: deciding which tools are unlocked (the background does that -
task 14); wiring presses to the history or the layer (task 12); the symbols
dropdown's and text tool's *behaviour* (task 16 - this task only has to render
their buttons, locked or not).

**Proof**
```bash
pnpm test tests/draw-bar.test.ts
```

Cover `barGroups` - it is where the tier gate becomes visible, so it is worth a
real test: with `toolsFor(false)`, the `symbol` and `text` buttons are
`locked: true` and pencil / line / rect / ellipse are not; with `toolsFor(true)`
nothing is locked; every group in the contract's list is present exactly once;
every `BarButton.id` in the returned groups is unique (they are the keys
`onPress` dispatches on).

**Manual check**

1. Mount the bar over a page. Drag it by the grip into each corner; it stops
   `BAR_MARGIN_PX` from the edge and never leaves the viewport.
2. Resize the window so the bar would be off-screen; it comes back inside.
3. Scroll the page: the bar stays put (it is screen-anchored) while the page
   moves under it.
4. Press a locked tool: the note appears, the tool does not become active.

**Depends on**: 01, 02, 03, 06
