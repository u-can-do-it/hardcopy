import { describe, expect, it } from "vitest";

import { dropLastChar, isChord, isPrintable, isUndoChord, type KeyStroke } from "@/lib/draw/keys";

/**
 * The text caret's keyboard, which is four pure functions and no DOM.
 *
 * They sat in `entrypoints/annotate.ts` where nothing could reach them, and all
 * four fail *silently*: a `dropLastChar` on UTF-16 units leaves half an emoji
 * in a `<text>` node, an `isPrintable` on UTF-16 units never lets a whole one
 * in, and a mis-classified modifier means a whole keyboard layout cannot type a
 * label. `KeyStroke` is structural, so a plain object is the whole harness
 * (`CLAUDE.md`: `tests/` stays plain vitest).
 */

/** A keystroke, with no modifier held unless the case says so. */
function key(over: Partial<KeyStroke> = {}): KeyStroke {
  return { key: "a", ctrlKey: false, metaKey: false, altKey: false, ...over };
}

describe("dropLastChar", () => {
  it("drops one plain character", () => {
    expect(dropLastChar("label")).toBe("labe");
    expect(dropLastChar("a")).toBe("");
  });

  it("drops one emoji rather than half of one", () => {
    // The whole reason it is not `slice(0, -1)`: an emoji outside the BMP is a
    // surrogate pair, and half a pair is a lone surrogate in an SVG `<text>`
    // node - a replacement glyph on the screen and in the exported PDF.
    expect("🚀".length).toBe(2);
    expect(dropLastChar("ship 🚀")).toBe("ship ");
    expect(dropLastChar("🚀")).toBe("");
    expect(dropLastChar("🚀🚀")).toBe("🚀");
  });

  it("comes apart one code point at a time, as a plain text field does", () => {
    // Deliberately *not* a grapheme-cluster split: a combining accent goes
    // first and leaves the letter, and a ZWJ family loses one member.
    expect(dropLastChar("é")).toBe("e");
    // A precomposed é is one code point and goes whole.
    expect(dropLastChar("café")).toBe("caf");
  });

  it("leaves an empty string empty rather than throwing", () => {
    // Backspace on an untouched caret. It is reachable on the first keystroke
    // after a click, so it has to be a no-op and not an exception in a page's
    // event handler.
    expect(dropLastChar("")).toBe("");
  });
});

describe("isChord", () => {
  it("takes Ctrl and Cmd as chords", () => {
    expect(isChord(key({ ctrlKey: true }))).toBe(true);
    expect(isChord(key({ metaKey: true }))).toBe(true);
    // Cmd with Alt is still Cmd: macOS chords freely with Option.
    expect(isChord(key({ metaKey: true, altKey: true }))).toBe(true);
  });

  it("does not take AltGr as a chord, or a label cannot be typed on half of Europe", () => {
    // Ctrl+Alt *is* AltGr: it is how a Polish, German or French layout types
    // `@`, `€` or `ł`. Reading it as a shortcut means those characters never
    // reach the label.
    expect(isChord(key({ key: "@", ctrlKey: true, altKey: true }))).toBe(false);
  });

  it("does not take bare Alt as a chord either, which is macOS Option", () => {
    // Option is a character modifier on macOS: `´`, `€`, `∆`.
    expect(isChord(key({ key: "´", altKey: true }))).toBe(false);
  });

  it("takes a plain keystroke for what it is", () => {
    expect(isChord(key())).toBe(false);
    expect(isChord(key({ key: "Escape" }))).toBe(false);
  });
});

describe("isPrintable", () => {
  it("takes a character, including a space", () => {
    expect(isPrintable(key({ key: "a" }))).toBe(true);
    expect(isPrintable(key({ key: "Z" }))).toBe(true);
    // A space is `event.key === " "` - one character, and the commonest one in
    // a label. Its *name* is "Space", which is `event.code`, not `key`.
    expect(isPrintable(key({ key: " " }))).toBe(true);
    // A layout's own character, which is what `isChord` lets past AltGr for.
    expect(isPrintable(key({ key: "€" }))).toBe(true);
  });

  it("takes an emoji, which `key.length !== 1` would have refused", () => {
    // The whole reason it counts code points: an astral character is a
    // surrogate pair, so `"🚀".length` is 2 and a UTF-16 test reads it as the
    // name of a key. The label would simply never gain the character - nothing
    // on screen, nothing to fail.
    expect("🚀".length).toBe(2);
    expect(isPrintable(key({ key: "🚀" }))).toBe(true);
  });

  it("refuses a key *name*", () => {
    // The first two are handled before this test is reached (`typeIntoCaret`
    // commits on them); the last two are here because a name that slipped
    // through would be inserted into the label as literal text.
    expect(isPrintable(key({ key: "Enter" }))).toBe(false);
    expect(isPrintable(key({ key: "Escape" }))).toBe(false);
    expect(isPrintable(key({ key: "ArrowLeft" }))).toBe(false);
    expect(isPrintable(key({ key: "Backspace" }))).toBe(false);
  });

  it("reads only `key`, so the caller still has to ask isChord first", () => {
    // Ctrl+S is a printable "s" by this test alone. The order in
    // `typeIntoCaret` is `isChord` and then this.
    const save = key({ key: "s", ctrlKey: true });
    expect(isPrintable(save)).toBe(true);
    expect(isChord(save)).toBe(true);
  });
});

describe("isUndoChord", () => {
  it("is Ctrl+Z and Cmd+Z", () => {
    expect(isUndoChord(key({ key: "z", ctrlKey: true }))).toBe(true);
    expect(isUndoChord(key({ key: "z", metaKey: true }))).toBe(true);
  });

  it("still matches the upper-case Z that Shift produces", () => {
    // Shift+Ctrl+Z is redo, and `event.key` is `Z` under Shift - so a
    // case-sensitive compare would drop redo entirely. Shift itself is the
    // caller's to read.
    expect(isUndoChord(key({ key: "Z", ctrlKey: true }))).toBe(true);
    expect(isUndoChord(key({ key: "Z", metaKey: true }))).toBe(true);
  });

  it("is not Ctrl+Alt+Z, which is AltGr+Z", () => {
    expect(isUndoChord(key({ key: "z", ctrlKey: true, altKey: true }))).toBe(false);
    expect(isUndoChord(key({ key: "z", metaKey: true, altKey: true }))).toBe(false);
  });

  it("is not a bare z, which is a character somebody is typing", () => {
    expect(isUndoChord(key({ key: "z" }))).toBe(false);
    expect(isUndoChord(key({ key: "z", altKey: true }))).toBe(false);
  });

  it("is not somebody else's chord", () => {
    expect(isUndoChord(key({ key: "y", ctrlKey: true }))).toBe(false);
    expect(isUndoChord(key({ key: "s", metaKey: true }))).toBe(false);
    expect(isUndoChord(key({ key: "Backspace", ctrlKey: true }))).toBe(false);
  });

  it("agrees with isChord on everything it accepts", () => {
    // The two are used one after the other in `onKeyDown`: an undo that was not
    // also a chord would be a character the caret refused to type *and* refused
    // to undo with.
    for (const event of [
      key({ key: "z", ctrlKey: true }),
      key({ key: "Z", ctrlKey: true }),
      key({ key: "z", metaKey: true }),
    ]) {
      expect(isUndoChord(event)).toBe(true);
      expect(isChord(event)).toBe(true);
    }
  });
});
