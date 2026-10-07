# 25 - Nothing dismisses a bar panel except the bar

**Goal**: the symbols palette stays up while you place marks, and no press in
the page - a stroke, a `<select>`, a JS menu - closes any bar panel.

**Files**
- `lib/draw/bar.ts` (modify)
- `tests/draw-bar.test.ts` (modify)
- `entrypoints/annotate.ts` (modify - `Esc` closes a panel first)

**Contracts**: `contracts.md` §20 - `popoverAfterPress` (new, pure, exported),
`BarHandle.closePanels` (new member), and §20.3's two **removals**.

**The bug, in one line.** `onWindowPointerDown` closes the open panel on every
press whose `composedPath()` excludes the bar's host. The press that starts a
stroke is such a press - the listener's own comment says that is why it is
`pointerdown` and not `click` - and so is a press on a page's own select or
menu. So placing five arrows is five presses of the trigger, and a bar panel
cannot survive using the page it is floating over.

**Do this:**

1. **Delete** `onWindowPointerDown`, `POPOVER_LISTENER`, and the matching
   `addEventListener` / `removeEventListener` pair in `mountBar` / `unmount`.
   Annotate mode then installs one fewer capture-phase `window` listener on
   every page it runs on.
2. **Add `popoverAfterPress`** and have `onClick` call it instead of deciding
   inline. Its five rules are §20.1, verbatim, and rule 3 - *a press inside the
   open panel keeps it open* - is the fix.
   A **locked** trigger still falls through to `press` and opens nothing; that
   behaviour is unchanged and its comment explains why.
3. **`setVisible(false)` no longer closes a panel.** The whole host goes to
   `display: none`, panel included, so nothing reaches a capture and the bar
   comes back as it was left - which is what the existing comment on
   `setVisible` asks for and could not have. Rewrite that comment; keep the
   unconditional `place()`.
4. **`setState`** closes an open panel whose group's tool is no longer selected
   - the state-driven backstop for rule 4.
5. **`BarHandle.closePanels()`**, and in `entrypoints/annotate.ts`'s
   `onKeyDown`, `Esc` calls it **first**: if a panel was open, consume the key
   and stop. With the page no longer able to dismiss a panel, Esc is the
   keyboard's way out - and it must not fall through to the mid-drag cancel or
   to leaving annotate mode, which restores the page and takes every mark with
   it.

**Out of scope**: `POPOVER_GROUPS` (unchanged - `symbols` stays
`"first-button"`, `text` stays `"own-trigger"`), `BAR_CSS`, the tier gate, the
grip drag. The **extension popup** closing when focus leaves it is Chrome's
behaviour and no extension can prevent it (`.plan/design.md` §12.1) - nothing
here touches it.

**Proof**
```bash
pnpm test tests/draw-bar.test.ts
```

Add one assertion per rule in §20.1, all against `popoverAfterPress`:
- `("symbols", "symbols", true)` -> `null` (its own trigger closes it)
- `(null, "symbols", true)` -> `"symbols"`
- `("symbols", "text", true)` -> `"text"` (another trigger opens its own)
- `("symbols", "symbols", false)` -> `"symbols"` (**a press inside keeps it**)
- `("symbols", "width", false)` -> `null` (another group's press puts it away)
- `("symbols", null, false)` -> `"symbols"` (the grip, the note: no change)
- `(null, anything, false)` -> `null`

And keep the existing suite green: `barGroups` is untouched by this task, so
every id, every group and the whole tier gate must be unchanged.

**Manual check**

1. Draw, press the symbols trigger, place five arrows in a row. The palette
   stays up for all five, and each arrow lands.
2. With the palette up, press Pencil: the palette closes.
3. With the palette up, press its trigger again: it closes.
4. With the palette up, press `Esc`: the palette closes and **annotate mode
   stays up**. Press `Esc` again: it exits.
5. Open the palette, then open a `<select>` or a JS menu **in the page** (a
   MUI menu docs page is the reported repro): the palette stays up.
6. Open the palette, then take a region screenshot: the bar goes away for the
   capture, the palette is not in the image, and the bar comes back with the
   palette still open and hanging off the right side of itself.
7. Park the bar at the bottom of the window with the palette open, then shorten
   the window: the palette flips above the bar.

**Depends on**: none
