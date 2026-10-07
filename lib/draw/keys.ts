/**
 * The text caret's keyboard: which keystrokes are somebody's shortcut, which one
 * is undo, which ones are characters at all, and what a Backspace leaves behind.
 *
 * Four decisions that lived in `entrypoints/annotate.ts` because that is the
 * only file with a keyboard - but they are pure functions of one plain object,
 * they each regress silently, and an entrypoint is not where logic goes
 * (`CLAUDE.md`). One module rather than a file per function: all four answer
 * the same question from different sides - *what does this keystroke mean to the
 * label being typed?* - and `dropLastChar` is the answer for Backspace and for
 * Ctrl+Z, which have no other reader.
 *
 * They read a `KeyboardEvent` structurally rather than by its DOM type, so this
 * module needs no `lib.dom` and `tests/draw-keys.test.ts` needs no harness: a
 * real event satisfies `KeyStroke`, and so does `{ key: "z", ctrlKey: true, ... }`.
 *
 * The whole module is an **addition** to `contracts.md`:
 * `.plan/tasks/16-phase2-tools.md` says the task "adds no new contract", which
 * was true until these four functions and `KeyStroke` came out of the
 * entrypoint - there is no section of §§1-16 they belong to, so they are
 * registered here, against §14's entrypoint whose predicates they were.
 *
 * Covered by tests/draw-keys.test.ts.
 */

/** The four fields these functions read off a `KeyboardEvent`. */
export interface KeyStroke {
  /** `KeyboardEvent.key` - a character, or a name like `Escape`. */
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/**
 * The string with its last character gone.
 *
 * By code point rather than by UTF-16 unit, so one backspace deletes one emoji
 * instead of half of one and leaving a lone surrogate in a `<text>` node. Not a
 * grapheme-cluster split: a combining accent or a ZWJ family comes apart one
 * code point at a time, which is what a plain text field does too.
 */
export function dropLastChar(text: string): string {
  const chars = Array.from(text);
  chars.pop();
  return chars.join("");
}

/**
 * Whether this keystroke is somebody's shortcut rather than a character.
 *
 * `Ctrl` **with** `Alt` is AltGr, which is how a European layout types `@` or
 * `€`, and `Alt` alone is macOS Option, which types `´` and `€` there - so
 * neither of those may be treated as a chord or those layouts cannot type into
 * a label at all. `Meta` is Cmd, and `Ctrl` without `Alt` is the Windows and
 * Linux modifier; both are chords.
 */
export function isChord(event: KeyStroke): boolean {
  return event.metaKey || (event.ctrlKey && !event.altKey);
}

/**
 * Whether this keystroke is a character to insert rather than the *name* of a
 * key.
 *
 * `KeyboardEvent.key` is either one character - `"a"`, `" "`, `"€"`, `"🚀"` -
 * or a name several characters long: `"Enter"`, `"Escape"`, `"ArrowLeft"`,
 * `"F5"`. So the length is the whole classification, and it is counted in
 * **code points**, not UTF-16 units. `event.key.length !== 1` reads any astral
 * character as a key name (an emoji is a surrogate pair, so `length` is 2) and
 * the label silently never gains it - nothing on screen, nothing to fail. It is
 * the same silent regression `dropLastChar` exists for, from the other end: one
 * of them puts the emoji in, the other takes it out whole.
 *
 * The modifiers are `isChord`'s to read and the caller asks it first: `Ctrl+S`
 * is a printable `"s"` by this test and must not reach the label.
 */
export function isPrintable(event: KeyStroke): boolean {
  return Array.from(event.key).length === 1;
}

/**
 * The undo gesture, on either platform.
 *
 * `metaKey` as well as `ctrlKey`, because Cmd+Z is the gesture on macOS.
 * `altKey` excluded for the same reason `isChord` excludes it: Ctrl+Alt+Z is
 * AltGr+Z, which is a character on some layouts and somebody else's shortcut on
 * the rest - either way it is not ours.
 *
 * Shift is deliberately *not* read here: the caller uses the same test for undo
 * and for redo and looks at Shift itself (`onKeyDown`).
 */
export function isUndoChord(event: KeyStroke): boolean {
  if (event.altKey || !(event.ctrlKey || event.metaKey)) return false;
  // Upper case under Shift, so compare case-insensitively.
  return event.key.toLowerCase() === "z";
}
