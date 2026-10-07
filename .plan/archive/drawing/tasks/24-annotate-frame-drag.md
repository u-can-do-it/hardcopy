# 24 - Drag the box, and drag its handles

**Goal**: the open editor's box can be moved and resized with the pointer.

**Files**
- `entrypoints/annotate.ts` (modify)

**Contracts**: `contracts.md` §21 (`frameZoneAt`, `moveFrame`, `resizeFrame`,
`MIN_TEXT_WIDTH_PX`, `MIN_TEXT_HEIGHT_PX`), §22 (`setFrame`).

**A third pointer state, not a fourth tool.** `frameDrag` sits beside `drag`
and `editor`:

```
interface FrameDrag {
  pointerId: number;
  zone: FrameZone;
  from: Vec2;      // document coords of the press
  rect: DrawRect;  // the editor's rect as it was at the press
}
```

`DragTool` stays `Exclude<DrawTool, "text">` and the invariant that a `Drag`
and an editor are never both open holds unchanged - a frame drag is neither.

**One branch in `onPointerDown`, and it goes before the commit:**

```
event.preventDefault();
if (editor !== null) {
  const zone = frameZoneAt(editorRect, at);
  if (zone !== null) { start a frameDrag; return; }   // no commit
}
commitEditor();                                        // as today
... the tool's own business
```

That ordering *is* the feature: a press on the frame is not a click away, so it
must not reach the "click away to commit" rule that `isDegenerate`'s `text`
case is written for.

Move applies `moveFrame(from-rect, delta)`; every other zone applies
`resizeFrame(from-rect, zone, delta, { width: MIN_TEXT_WIDTH_PX, height:
MIN_TEXT_HEIGHT_PX })`. Both write `editor.rect`, then `showLive()` - which
re-wraps and re-grows for free, because `layoutText` runs there.

Deltas are computed from `from` in **document** coordinates read per event
(`toDocument` + `scroll()`), like every other drag in this file, so the box can
be dragged across the fold. The `pointermove` / `pointerup` / `pointercancel`
listeners use the same `DRAG_LISTENER` capture flag and the same `buttons === 0`
recovery as `onPointerMove` - a page that swallows `pointermove` must not be
able to freeze a resize half-way.

`stop()` must end a frame drag in flight, the way it already calls
`endDrag(false)` and `discardEditor()`, or a session torn down mid-resize leaves
listeners on the page's `window`. A `pointercancel` **keeps** the box where it
got to rather than discarding: unlike a stroke, there is nothing here to throw
away and the alternative is a box that jumps back.

**No arithmetic and no predicates in this file** - all four calls above are
`lib/draw/frame.ts`'s, and task 19 tested them.

**Out of scope**: moving a **committed** mark (still phase 3 - `BACKLOG.md`,
`.plan/design.md` §11.2). Drag-to-create a box. Anything in `lib/`.

**Proof**
```bash
pnpm compile
```

Typecheck-only for the reason task 23 gives: this is pointer plumbing in an
injected entrypoint, and every decision it makes is one `frame.ts` call that
`tests/draw-frame.test.ts` already covers.

**Manual check**

1. Open a text box, type two words, then drag its **middle**: the box and the
   text move together, and it does not commit.
2. Drag the **east** handle left: the text re-wraps as the box narrows, and the
   box grows taller as lines are added.
3. Drag the **south** handle down, then delete a line: the box stays tall.
4. Drag the **west** handle far east: it stops at the minimum with the east
   edge where it was - the box is never mirrored.
5. Drag a **corner**: both axes resize at once.
6. Drag the box below the fold with the wheel mid-drag: it follows the pointer,
   not the viewport.
7. Press `Esc`: committed at the box's final size and wrap. Export and Ctrl+F a
   word - found.
8. Press outside the box: committed, and the press did not resize anything.

**Depends on**: 19, 22, 23

---

## Found by task 23's review, and this task must handle it

**Hit-test the *laid-out* rect, not `editor.rect`.** §13.6 above writes the
branch as `frameZoneAt(editor.rect, at)`, and that is wrong the moment a label
reaches a second line: `Editor.rect` is what the user asked for and
`layoutText` grows the height *from* it, so the frame the user sees is taller
than `editor.rect` by design. The bottom handles would then be drawn outside
the rect `frameZoneAt` is asked about, the press would fall through to
`commitEditor()`, and the box would commit instead of resizing - which negates
the reason `contracts.md` §22.2 gives for exporting `frameHandles` at all
("the handle you can see and the handle you can grab are the same rect, from
one function").

So the press must be tested against the same rect `setFrame` was given. Hold
the laid-out rect beside `editor` (`showLive` already computes it - it is
`shape.rect` on the `TextShape` `editorShape` returns), or re-derive it with
`layoutText`. Do **not** hit-test `editor.rect`.

Then, when a resize starts, the drag's `rect` baseline is still `editor.rect` -
the user's own height - so that a box dragged tall stays tall. Only the hit
test uses the grown one. Say which is which in the code.
