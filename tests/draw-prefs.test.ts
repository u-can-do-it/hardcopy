import { describe, expect, it } from "vitest";

import { MIN_TEXT_WIDTH_PX } from "@/lib/draw/frame";
import {
  DEFAULT_TEXT_WIDTH_PX,
  DRAW_ALL_TOOLS,
  DRAW_COLORS,
  DRAW_WIDTHS,
} from "@/lib/draw/model";
import {
  clampTextWidth,
  DEFAULT_DRAW_PREFS,
  DRAW_PREFS_KEY,
  mergeDrawPrefs,
} from "@/lib/draw/prefs";
import type { FillMode, SymbolKind } from "@/lib/types";

/**
 * Every `SymbolKind`, kept complete by the compiler rather than by hand.
 *
 * The tool half of "accepts every tool and symbol the bar can select" iterates
 * `DRAW_ALL_TOOLS`; there is no equivalent list of symbols to iterate, because
 * both of the ones that exist are module-private (`SYMBOL_KINDS` in
 * lib/draw/prefs.ts, `SYMBOL_ICONS` in lib/draw/bar.ts). So this record does
 * for the loop what those records do for their modules: an eighth `SymbolKind`
 * in lib/types.ts is a `pnpm compile` failure *here* until it is named, and an
 * excess key that is not a `SymbolKind` is one as well.
 *
 * That is the point of it. The loop below asserts only positives, so a plain
 * literal that fell behind the type would go on passing while covering one
 * symbol less, and nothing would say so - which is exactly what happened to the
 * tool half.
 */
const ALL_SYMBOLS = Object.keys({
  arrow: true,
  "arrow-double": true,
  check: true,
  cross: true,
  bang: true,
  star: true,
  pin: true,
} satisfies Record<SymbolKind, true>) as readonly SymbolKind[];

/**
 * Every `FillMode`, kept complete by the compiler for the reason `ALL_SYMBOLS`
 * is: `FILL_MODES` in lib/draw/prefs.ts is module-private, so this record is
 * what makes a fourth mode a `pnpm compile` failure *here* until the loop below
 * covers it, rather than a mode that quietly goes untested.
 */
const ALL_FILL_MODES = Object.keys({
  none: true,
  tint: true,
  cover: true,
} satisfies Record<FillMode, true>) as readonly FillMode[];

/** A complete, valid blob, so each case below shows only the field it is testing. */
function stored(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bar: { x: 100, y: 200 },
    tool: "rect",
    symbol: "star",
    color: "#123456",
    width: 8,
    fontSize: 30,
    textWidth: 320,
    // Not the default, so a whole-blob assertion shows the field came off the
    // blob rather than out of `DEFAULT_DRAW_PREFS`.
    fill: "tint",
    ...over,
  };
}

/**
 * The same blob as it was written before `textWidth` existed - contracts §12's
 * six keys and nothing else.
 *
 * Spelled out rather than built by deleting a key from `stored()`, because it is
 * a record of what is actually on disk in every profile that has drawn anything
 * so far: `mergeDrawPrefs` is the only thing standing between that blob and a
 * `DrawPrefs`, and this is the shape it has to survive.
 */
const BEFORE_TEXT_WIDTH: Record<string, unknown> = {
  bar: { x: 100, y: 200 },
  tool: "rect",
  symbol: "star",
  color: "#123456",
  width: 8,
  fontSize: 30,
};

/**
 * The same blob one pass later - contracts §23's seven keys, and no `fill`.
 *
 * The blob on disk in every profile that has drawn anything since `textWidth`
 * shipped, written down for the same reason `BEFORE_TEXT_WIDTH` is: this is the
 * shape `mergeDrawPrefs` has to survive, and the fill it comes back holding is
 * the one thing a user could be surprised by.
 */
const BEFORE_FILL: Record<string, unknown> = {
  bar: { x: 100, y: 200 },
  tool: "rect",
  symbol: "star",
  color: "#123456",
  width: 8,
  fontSize: 30,
  textWidth: 320,
};

describe("the defaults", () => {
  it("are the values contracts.md §12 names", () => {
    // Pinned rather than derived: these six travel to the page in
    // PAGE_ANNOTATE_START, and a drifted default is a bar that opens somewhere
    // else holding a different pen.
    expect(DEFAULT_DRAW_PREFS.bar).toEqual({ x: 24, y: 24 });
    expect(DEFAULT_DRAW_PREFS.tool).toBe("pencil");
    expect(DEFAULT_DRAW_PREFS.symbol).toBe("arrow");
    expect(DEFAULT_DRAW_PREFS.width).toBe(4);
    expect(DEFAULT_DRAW_PREFS.fontSize).toBe(16);
    // The contract says the default pen *is* DRAW_COLORS[0]; the literal it
    // resolves to is pinned in tests/draw-model.test.ts.
    expect(DEFAULT_DRAW_PREFS.color).toBe(DRAW_COLORS[0]);
    expect(DEFAULT_DRAW_PREFS.color).not.toBe("");
  });

  it("open a text box at the model's own default width (§23)", () => {
    // Not a second literal 240: `DEFAULT_TEXT_WIDTH_PX` is what `openEditor`
    // used before this pref existed, so this is the assertion that the change
    // is invisible until somebody drags a handle. The literal itself is pinned
    // in tests/draw-model.test.ts.
    expect(DEFAULT_DRAW_PREFS.textWidth).toBe(DEFAULT_TEXT_WIDTH_PX);
  });

  it("arm no fill, so a shape is an outline until somebody asks (§24.3)", () => {
    // Pinned as the literal rather than through a constant, because this is the
    // decision and not a lookup: `"cover"` removes text from the export, and the
    // mode a bar opens holding must be the one that touches nothing. Every rect
    // and ellipse drawn before this pref existed is an outline too, so this is
    // also what makes the change invisible until a menu is opened.
    expect(DEFAULT_DRAW_PREFS.fill).toBe("none");
  });

  it("store under the key the loader reads", () => {
    expect(DRAW_PREFS_KEY).toBe("drawPrefs");
  });

  it("are themselves valid, so a merge of them is a fixed point", () => {
    expect(mergeDrawPrefs(DEFAULT_DRAW_PREFS)).toEqual(DEFAULT_DRAW_PREFS);
  });
});

describe("mergeDrawPrefs", () => {
  it("returns defaults for nothing stored", () => {
    expect(mergeDrawPrefs(undefined)).toEqual(DEFAULT_DRAW_PREFS);
    expect(mergeDrawPrefs(null)).toEqual(DEFAULT_DRAW_PREFS);
    expect(mergeDrawPrefs("garbage")).toEqual(DEFAULT_DRAW_PREFS);
    expect(mergeDrawPrefs(42)).toEqual(DEFAULT_DRAW_PREFS);
    expect(mergeDrawPrefs({})).toEqual(DEFAULT_DRAW_PREFS);
  });

  it("does not hand back the shared default object", () => {
    const merged = mergeDrawPrefs(null);
    merged.bar.x = 999;
    merged.tool = "text";
    expect(DEFAULT_DRAW_PREFS.bar).toEqual({ x: 24, y: 24 });
    expect(DEFAULT_DRAW_PREFS.tool).toBe("pencil");
  });

  it("never aliases its input", () => {
    // The bar mutates the prefs it is handed on every drag, and the blob it
    // came from is storage's, not ours.
    const raw = stored();
    const merged = mergeDrawPrefs(raw);
    expect(merged).not.toBe(raw);
    expect(merged.bar).not.toBe(raw.bar);

    merged.bar.x = 999;
    expect(raw.bar).toEqual({ x: 100, y: 200 });
  });

  it("keeps a whole valid blob", () => {
    expect(mergeDrawPrefs(stored())).toEqual({
      bar: { x: 100, y: 200 },
      tool: "rect",
      symbol: "star",
      color: "#123456",
      width: 8,
      fontSize: 30,
      textWidth: 320,
      fill: "tint",
    });
  });

  it("drops fields that are not prefs", () => {
    // toEqual is exact about extra keys, so this also proves nothing arrives
    // by spreading the stored blob.
    expect(mergeDrawPrefs({ nope: true, pageMode: "single", prep: {} })).toEqual(
      DEFAULT_DRAW_PREFS,
    );
  });

  it("fills in fields a previous version never wrote", () => {
    const merged = mergeDrawPrefs({ tool: "line" });
    expect(merged.tool).toBe("line");
    expect(merged.symbol).toBe(DEFAULT_DRAW_PREFS.symbol);
    expect(merged.width).toBe(DEFAULT_DRAW_PREFS.width);
    expect(merged.bar).toEqual(DEFAULT_DRAW_PREFS.bar);
  });
});

describe("the tool and the symbol", () => {
  it("falls back on an unknown tool and keeps the rest of the blob", () => {
    const merged = mergeDrawPrefs(stored({ tool: "airbrush" }));
    expect(merged.tool).toBe("pencil");
    expect(merged.symbol).toBe("star");
    expect(merged.color).toBe("#123456");
    expect(merged.width).toBe(8);
    expect(merged.fontSize).toBe(30);
    expect(merged.bar).toEqual({ x: 100, y: 200 });
  });

  it("falls back on an unknown symbol and keeps the rest of the blob", () => {
    const merged = mergeDrawPrefs(stored({ symbol: "smiley" }));
    expect(merged.symbol).toBe("arrow");
    expect(merged.tool).toBe("rect");
    expect(merged.color).toBe("#123456");
    expect(merged.width).toBe(8);
  });

  it("accepts every tool and symbol the bar can select", () => {
    // Both loops iterate a list that maintains itself, and that is the whole
    // assertion rather than a tidy-up. These are positive assertions only, so a
    // hand-written literal that falls behind goes on passing while quietly
    // covering one tool less - and this one did: it was still the seven-tool
    // phase-1 list long after `rect-fill` and `ellipse-fill` joined `DrawTool`
    // (`.plan/contracts.md` §19.4), green the whole time. `DRAW_ALL_TOOLS` is
    // the list `tool()` validates against, so an eighth tool is covered the day
    // it exists; that the list itself holds the right members is pinned
    // literally in tests/draw-model.test.ts, which is where that belongs.
    //
    // The length guards are the one failure this shape has left: a loop over an
    // empty list passes without asserting anything.
    expect(DRAW_ALL_TOOLS.length).toBeGreaterThan(0);
    expect(ALL_SYMBOLS.length).toBeGreaterThan(0);
    for (const t of DRAW_ALL_TOOLS) {
      expect(mergeDrawPrefs({ tool: t }).tool).toBe(t);
    }
    for (const s of ALL_SYMBOLS) {
      expect(mergeDrawPrefs({ symbol: s }).symbol).toBe(s);
    }
  });

  it("answers a filled tool with the pencil, both of them being gone", () => {
    // `rect-fill` and `ellipse-fill` were `DrawTool` members for one pass
    // (`.plan/design.md` §18 takes them back out), and every profile that
    // pressed one has one of these two words in `storage.local` right now. So
    // this is a migration case rather than a rejection: `tool()` validates
    // against `DRAW_ALL_TOOLS`, a name no longer in it is not a tool, and the
    // pen comes back as the default rather than as something the layer has no
    // case for. The fill those users chose is not lost with it - it was never
    // in this field; `fill` is, and it defaults to `"none"` below.
    //
    // What this test used to assert - that the pair round-trips, because
    // `FILL_NOTE`'s session-start branch depends on the pen persisting - moved
    // with the note itself: "round-trips every mode the menu can arm" is that
    // assertion now, `"cover"` included.
    expect(mergeDrawPrefs({ tool: "rect-fill" }).tool).toBe("pencil");
    expect(mergeDrawPrefs({ tool: "ellipse-fill" }).tool).toBe("pencil");
  });

  it("is not fooled by a prototype property", () => {
    // `"constructor" in obj` is true; hasOwn is why this is not "constructor".
    expect(mergeDrawPrefs({ tool: "toString" }).tool).toBe("pencil");
    expect(mergeDrawPrefs({ symbol: "constructor" }).symbol).toBe("arrow");
    expect(mergeDrawPrefs({ symbol: "hasOwnProperty" }).symbol).toBe("arrow");
  });

  it("replaces a wrongly typed tool or symbol instead of throwing", () => {
    const merged = mergeDrawPrefs({ tool: 3, symbol: { kind: "arrow" } });
    expect(merged.tool).toBe("pencil");
    expect(merged.symbol).toBe("arrow");
  });
});

describe("the stroke width", () => {
  it("snaps to the nearest of the three, ties to the thinner", () => {
    expect(DRAW_WIDTHS).toEqual([2, 4, 8]);
    expect(mergeDrawPrefs({ width: 3 }).width).toBe(2); // tie: 2 and 4 are both 1 away
    expect(mergeDrawPrefs({ width: 6 }).width).toBe(4); // tie: 4 and 8 are both 2 away
    expect(mergeDrawPrefs({ width: 5 }).width).toBe(4);
    expect(mergeDrawPrefs({ width: 7 }).width).toBe(8);
    expect(mergeDrawPrefs({ width: 2.4 }).width).toBe(2);
  });

  it("keeps the three exact widths", () => {
    for (const w of DRAW_WIDTHS) expect(mergeDrawPrefs({ width: w }).width).toBe(w);
  });

  it("snaps a width off either end onto the end", () => {
    expect(mergeDrawPrefs({ width: 0 }).width).toBe(2);
    expect(mergeDrawPrefs({ width: -12 }).width).toBe(2);
    expect(mergeDrawPrefs({ width: 999 }).width).toBe(8);
  });

  it("takes the default for anything that is not a finite number", () => {
    // "4" is 4 by this route, not by parsing: "8" is 4 as well. Storage
    // round-trips JSON, so a numeric string only arrives from corruption.
    expect(mergeDrawPrefs({ width: "4" }).width).toBe(4);
    expect(mergeDrawPrefs({ width: "8" }).width).toBe(4);
    expect(mergeDrawPrefs({ width: Number.NaN }).width).toBe(4);
    expect(mergeDrawPrefs({ width: Infinity }).width).toBe(4);
    expect(mergeDrawPrefs({ width: null }).width).toBe(4);
  });

  it("always lands on a member of DRAW_WIDTHS", () => {
    for (const raw of [1, 3, 6, 3.5, -1, 1e9, "wide", undefined]) {
      expect(DRAW_WIDTHS).toContain(mergeDrawPrefs({ width: raw }).width);
    }
  });
});

describe("the font size", () => {
  it("clamps into 8..96", () => {
    expect(mergeDrawPrefs({ fontSize: 2 }).fontSize).toBe(8);
    expect(mergeDrawPrefs({ fontSize: 500 }).fontSize).toBe(96);
    expect(mergeDrawPrefs({ fontSize: 8 }).fontSize).toBe(8);
    expect(mergeDrawPrefs({ fontSize: 96 }).fontSize).toBe(96);
    expect(mergeDrawPrefs({ fontSize: 24 }).fontSize).toBe(24);
  });

  it("takes the default for anything that is not a finite number", () => {
    expect(mergeDrawPrefs({ fontSize: "16" }).fontSize).toBe(16);
    expect(mergeDrawPrefs({ fontSize: Number.NaN }).fontSize).toBe(16);
    expect(mergeDrawPrefs({ fontSize: -Infinity }).fontSize).toBe(16);
  });
});

describe("the text box width", () => {
  it("fills itself in for a blob written before it existed", () => {
    // The migration case, and the reason there is no migration: every profile
    // that has drawn anything so far has a blob with no `textWidth` in it, and
    // filling in a missing field is what this function is for. A box opens at
    // the default until the day a handle is dragged, and the rest of the pen
    // that profile stored comes through untouched.
    const merged = mergeDrawPrefs(BEFORE_TEXT_WIDTH);
    expect("textWidth" in BEFORE_TEXT_WIDTH).toBe(false);
    expect(merged.textWidth).toBe(DEFAULT_TEXT_WIDTH_PX);
    expect(merged).toEqual({
      bar: { x: 100, y: 200 },
      tool: "rect",
      symbol: "star",
      color: "#123456",
      width: 8,
      fontSize: 30,
      textWidth: DEFAULT_TEXT_WIDTH_PX,
      // A key added after this one, so the blob has no more of it than it has
      // `textWidth`. Through the default rather than as a second literal
      // `"none"`: the literal is pinned once, up in "the defaults".
      fill: DEFAULT_DRAW_PREFS.fill,
    });
  });

  it("round-trips a width a drag actually reached", () => {
    expect(mergeDrawPrefs({ textWidth: 320 }).textWidth).toBe(320);
    expect(mergeDrawPrefs({ textWidth: 41.5 }).textWidth).toBe(41.5);
    expect(mergeDrawPrefs(stored()).textWidth).toBe(320);
  });

  it("clamps into MIN_TEXT_WIDTH_PX..2000, like fontSize and unlike bar", () => {
    // Clamped rather than defaulted, and that is the decision: a stored 4 is a
    // width that got out of range, and 40 is the nearest box we will draw -
    // where a negative *bar* coordinate is not a position at all and takes the
    // default instead.
    expect(MIN_TEXT_WIDTH_PX).toBe(40);
    expect(mergeDrawPrefs({ textWidth: 4 }).textWidth).toBe(MIN_TEXT_WIDTH_PX);
    expect(mergeDrawPrefs({ textWidth: 0 }).textWidth).toBe(MIN_TEXT_WIDTH_PX);
    expect(mergeDrawPrefs({ textWidth: -1 }).textWidth).toBe(MIN_TEXT_WIDTH_PX);
    expect(mergeDrawPrefs({ textWidth: 9999 }).textWidth).toBe(2000);
    expect(mergeDrawPrefs({ textWidth: MIN_TEXT_WIDTH_PX }).textWidth).toBe(MIN_TEXT_WIDTH_PX);
    expect(mergeDrawPrefs({ textWidth: 2000 }).textWidth).toBe(2000);
  });

  it("takes the default for anything that is not a finite number", () => {
    // `"240"` is 240 by falling back, not by parsing - the same route
    // `width: "4"` takes, and `"9999"` proves it: a parse would have clamped
    // that one to 2000 instead.
    expect(mergeDrawPrefs({ textWidth: "240" }).textWidth).toBe(DEFAULT_TEXT_WIDTH_PX);
    expect(mergeDrawPrefs({ textWidth: "9999" }).textWidth).toBe(DEFAULT_TEXT_WIDTH_PX);
    expect(mergeDrawPrefs({ textWidth: Number.NaN }).textWidth).toBe(DEFAULT_TEXT_WIDTH_PX);
    expect(mergeDrawPrefs({ textWidth: Infinity }).textWidth).toBe(DEFAULT_TEXT_WIDTH_PX);
    expect(mergeDrawPrefs({ textWidth: -Infinity }).textWidth).toBe(DEFAULT_TEXT_WIDTH_PX);
    expect(mergeDrawPrefs({ textWidth: null }).textWidth).toBe(DEFAULT_TEXT_WIDTH_PX);
    expect(mergeDrawPrefs({ textWidth: undefined }).textWidth).toBe(DEFAULT_TEXT_WIDTH_PX);
    expect(mergeDrawPrefs({ textWidth: { width: 320 } }).textWidth).toBe(DEFAULT_TEXT_WIDTH_PX);
  });

  it("never comes back as anything a box cannot be drawn at", () => {
    // The sweep the two cases above make one claim each about: whatever was
    // stored, what comes out is a finite number inside the range - so
    // `openEditor` can hand it to `layoutText` without checking anything.
    for (const raw of [4, "240", Number.NaN, Infinity, null, -1, 9999, [320], true]) {
      const w = mergeDrawPrefs({ textWidth: raw }).textWidth;
      expect(typeof w).toBe("number");
      expect(Number.isFinite(w)).toBe(true);
      expect(w).toBeGreaterThanOrEqual(MIN_TEXT_WIDTH_PX);
      expect(w).toBeLessThanOrEqual(2000);
      expect(w).not.toBe(raw);
    }
  });
});

describe("clampTextWidth", () => {
  /**
   * Everything either side of the seam can hand it: widths a drag reaches, the
   * two ends of the range, one past the top, and the junk only a corrupted or
   * hand-edited blob produces.
   */
  const EVERY_WIDTH: readonly unknown[] = [
    4,
    0,
    -1,
    MIN_TEXT_WIDTH_PX,
    41.5,
    DEFAULT_TEXT_WIDTH_PX,
    320,
    2000,
    2400,
    9999,
    "240",
    Number.NaN,
    Infinity,
    -Infinity,
    null,
    undefined,
    [320],
    true,
    { width: 320 },
  ];

  it("agrees with mergeDrawPrefs on every value, which is why it is exported", () => {
    // The assertion the export exists for. `entrypoints/annotate.ts` calls this
    // on the width a resize reached before putting it in its in-memory pen, and
    // `mergeDrawPrefs` calls it on the way to storage - so this is the pin that
    // the two cannot answer the same width differently. Written as an
    // equivalence rather than as a second list of expected numbers on purpose:
    // a range that moved would have to move in both, and a range that moved in
    // only one of them fails here.
    expect(EVERY_WIDTH.length).toBeGreaterThan(0);
    for (const raw of EVERY_WIDTH) {
      expect(clampTextWidth(raw)).toBe(mergeDrawPrefs({ textWidth: raw }).textWidth);
    }
  });

  it("bounds the top, which is the whole of the fix", () => {
    // `resizeFrame` clamps a drag to `FRAME_MIN` and nothing bounds it above,
    // so 2400 CSS px is reachable by dragging a handle on a wide monitor - or
    // on any monitor below 100% page zoom. Storage would have clamped it to
    // 2000 on the next reload whatever happened here; this is what stops the
    // session and the disk disagreeing until then.
    expect(clampTextWidth(2400)).toBe(2000);
    expect(clampTextWidth(1e9)).toBe(2000);
    expect(clampTextWidth(2000)).toBe(2000);
  });

  it("floors at the same MIN_TEXT_WIDTH_PX a drag is clamped to", () => {
    expect(clampTextWidth(MIN_TEXT_WIDTH_PX)).toBe(MIN_TEXT_WIDTH_PX);
    expect(clampTextWidth(4)).toBe(MIN_TEXT_WIDTH_PX);
    expect(clampTextWidth(0)).toBe(MIN_TEXT_WIDTH_PX);
    expect(clampTextWidth(-1)).toBe(MIN_TEXT_WIDTH_PX);
  });

  it("passes a width a drag can actually reach straight through", () => {
    // The ordinary case: almost every resize lands here, and the clamp is a
    // guard rather than a transformation.
    expect(clampTextWidth(DEFAULT_TEXT_WIDTH_PX)).toBe(DEFAULT_TEXT_WIDTH_PX);
    expect(clampTextWidth(320)).toBe(320);
    expect(clampTextWidth(41.5)).toBe(41.5);
  });

  it("takes the default for anything that is not a finite number", () => {
    expect(clampTextWidth(Number.NaN)).toBe(DEFAULT_TEXT_WIDTH_PX);
    expect(clampTextWidth(Infinity)).toBe(DEFAULT_TEXT_WIDTH_PX);
    expect(clampTextWidth("240")).toBe(DEFAULT_TEXT_WIDTH_PX);
    expect(clampTextWidth(undefined)).toBe(DEFAULT_TEXT_WIDTH_PX);
  });

  it("always returns a width a box can be drawn at", () => {
    for (const raw of EVERY_WIDTH) {
      const w = clampTextWidth(raw);
      expect(typeof w).toBe("number");
      expect(Number.isFinite(w)).toBe(true);
      expect(w).toBeGreaterThanOrEqual(MIN_TEXT_WIDTH_PX);
      expect(w).toBeLessThanOrEqual(2000);
    }
  });

  it("is a fixed point on its own output, so persisting twice cannot drift", () => {
    for (const raw of EVERY_WIDTH) {
      const once = clampTextWidth(raw);
      expect(clampTextWidth(once)).toBe(once);
    }
  });
});

describe("the bar position", () => {
  it("keeps a finite coordinate at or above zero", () => {
    expect(mergeDrawPrefs({ bar: { x: 0, y: 0 } }).bar).toEqual({ x: 0, y: 0 });
    expect(mergeDrawPrefs({ bar: { x: 640.5, y: 12 } }).bar).toEqual({ x: 640.5, y: 12 });
  });

  it("falls back on a negative or non-numeric coordinate", () => {
    expect(mergeDrawPrefs({ bar: { x: -40, y: 200 } }).bar).toEqual({ x: 24, y: 200 });
    expect(mergeDrawPrefs({ bar: { x: Number.NaN, y: 200 } }).bar).toEqual({ x: 24, y: 200 });
    expect(mergeDrawPrefs({ bar: { x: Infinity, y: 200 } }).bar).toEqual({ x: 24, y: 200 });
    expect(mergeDrawPrefs({ bar: { x: "10", y: 200 } }).bar).toEqual({ x: 24, y: 200 });
    expect(mergeDrawPrefs({ bar: { x: 100 } }).bar).toEqual({ x: 100, y: 24 });
  });

  it("falls back when bar is not an object at all", () => {
    expect(mergeDrawPrefs({ bar: "24,24" }).bar).toEqual({ x: 24, y: 24 });
    expect(mergeDrawPrefs({ bar: null }).bar).toEqual({ x: 24, y: 24 });
    expect(mergeDrawPrefs({ bar: [100, 200] }).bar).toEqual({ x: 24, y: 24 });
  });

  it("keeps a position off this screen, for clampToViewport to deal with", () => {
    // No upper bound here on purpose: nothing at this layer knows the
    // viewport, and the clamp at mount is the one place that does.
    expect(mergeDrawPrefs({ bar: { x: 4000, y: 3000 } }).bar).toEqual({ x: 4000, y: 3000 });
  });
});

describe("the colour", () => {
  it("takes any non-empty string, trimmed", () => {
    expect(mergeDrawPrefs({ color: "#0f172a" }).color).toBe("#0f172a");
    expect(mergeDrawPrefs({ color: "rgb(0 128 255)" }).color).toBe("rgb(0 128 255)");
    expect(mergeDrawPrefs({ color: "  #abc  " }).color).toBe("#abc");
  });

  it("falls back on an empty or wrongly typed colour", () => {
    expect(mergeDrawPrefs({ color: "" }).color).toBe(DRAW_COLORS[0]);
    expect(mergeDrawPrefs({ color: "   " }).color).toBe(DRAW_COLORS[0]);
    expect(mergeDrawPrefs({ color: 0xff0000 }).color).toBe(DRAW_COLORS[0]);
    expect(mergeDrawPrefs({ color: null }).color).toBe(DRAW_COLORS[0]);
  });

  it("keeps every colour on the palette", () => {
    for (const c of DRAW_COLORS) expect(mergeDrawPrefs({ color: c }).color).toBe(c);
  });
});

describe("the fill", () => {
  it("fills itself in for a blob written before it existed", () => {
    // The migration case, and the reason there is no migration - the same
    // argument `textWidth` makes above, with a sharper edge: the field being
    // filled in decides whether a shape removes text from the export, so
    // "absent" has to mean the outline and not whatever a later default becomes.
    const merged = mergeDrawPrefs(BEFORE_FILL);
    expect("fill" in BEFORE_FILL).toBe(false);
    expect(merged.fill).toBe("none");
    expect(merged).toEqual({
      bar: { x: 100, y: 200 },
      tool: "rect",
      symbol: "star",
      color: "#123456",
      width: 8,
      fontSize: 30,
      textWidth: 320,
      fill: "none",
    });
  });

  it("round-trips every mode the menu can arm", () => {
    // The loop maintains itself (`ALL_FILL_MODES`), and the length guard is the
    // one failure that shape has left. `"cover"` surviving a reload is the
    // premise of `FILL_NOTE`'s session-start branch (contracts §27.3): the pen
    // persists, so somebody who left the bar armed on it opens every later
    // session holding it and has to be told again what it does.
    expect(ALL_FILL_MODES.length).toBe(3);
    for (const f of ALL_FILL_MODES) {
      expect(mergeDrawPrefs({ fill: f }).fill).toBe(f);
    }
    expect(mergeDrawPrefs(stored()).fill).toBe("tint");
  });

  it("falls back to the outline on a mode this module never wrote", () => {
    // A plain fallback, not a nearest member like `width`: three menu choices
    // have no metric, so there is no neighbour to snap to. `"solid"` is the
    // spelling somebody would reach for, `"COVER"` is the same word in the wrong
    // case, and both are `"none"` - the direction of the fallback is the point.
    // A corrupted or hand-edited blob can cost an outline nobody asked for; it
    // must never arm a text removal nobody asked for.
    expect(mergeDrawPrefs({ fill: "solid" }).fill).toBe("none");
    expect(mergeDrawPrefs({ fill: "" }).fill).toBe("none");
    expect(mergeDrawPrefs({ fill: "COVER" }).fill).toBe("none");
    expect(mergeDrawPrefs({ fill: "Cover" }).fill).toBe("none");
    expect(mergeDrawPrefs({ fill: true }).fill).toBe("none");
    expect(mergeDrawPrefs({ fill: null }).fill).toBe("none");
    expect(mergeDrawPrefs({ fill: 0 }).fill).toBe("none");
    expect(mergeDrawPrefs({ fill: {} }).fill).toBe("none");
    expect(mergeDrawPrefs({ fill: ["cover"] }).fill).toBe("none");
  });

  it("is not fooled by a prototype property", () => {
    // The hazard `Object.hasOwn` exists for, and the one this file already
    // documents for `SYMBOL_KINDS`: `"constructor" in FILL_MODES` is true, so an
    // `in` check here would answer "yes, that is a fill mode" and hand back a
    // `FillMode` of `"constructor"` - a fill the renderer has no case for.
    expect(mergeDrawPrefs({ fill: "constructor" }).fill).toBe("none");
    expect(mergeDrawPrefs({ fill: "toString" }).fill).toBe("none");
    expect(mergeDrawPrefs({ fill: "hasOwnProperty" }).fill).toBe("none");
    expect(mergeDrawPrefs({ fill: "__proto__" }).fill).toBe("none");
  });

  it("always comes back as one of the three, whatever was stored", () => {
    for (const raw of ["solid", "", "COVER", null, 0, {}, ["cover"], "constructor", undefined]) {
      expect(ALL_FILL_MODES).toContain(mergeDrawPrefs({ fill: raw }).fill);
    }
  });

  it("comes off the blob without aliasing it, as every other field does", () => {
    // The claim "never aliases its input" makes for the whole object, said again
    // for the field this task adds: a merge that had grown into a spread of the
    // stored blob would pass every assertion above and fail here.
    const raw = stored({ fill: "cover" });
    const merged = mergeDrawPrefs(raw);
    expect(merged).not.toBe(raw);
    expect(merged.fill).toBe("cover");

    merged.fill = "none";
    expect(raw.fill).toBe("cover");
    expect(mergeDrawPrefs(raw).fill).toBe("cover");
  });
});
