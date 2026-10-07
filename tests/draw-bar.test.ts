import { describe, expect, it } from "vitest";
import {
  barGroups,
  FONT_SIZES,
  parseBarId,
  popoverAfterPress,
  type BarAction,
  type BarGroup,
  type BarId,
} from "@/lib/draw/bar";
import { DRAW_ALL_TOOLS, DRAW_COLORS, DRAW_WIDTHS } from "@/lib/draw/model";
import { DEFAULT_DRAW_PREFS } from "@/lib/draw/prefs";
import type { FillMode, SymbolKind } from "@/lib/types";

/**
 * `barGroups`, `parseBarId` and `popoverAfterPress` are the pure half of the
 * bar. `barGroups` is what the bar offers, `parseBarId` is the grammar those
 * buttons' ids are written in, read back, and `popoverAfterPress` is the panel
 * policy, lifted out of `mountBar`'s closure so that it can be one. `mountBar`
 * itself is deliberately not covered: `tests/` is plain vitest on `environment:
 * "node"` with no DOM harness, which `CLAUDE.md` asks stay that way, so the DOM
 * half has `pnpm compile` and the Manual checks in `.plan/tasks/11-draw-bar.md`
 * and `.plan/tasks/25-bar-panels-survive.md` instead.
 */

/**
 * The nine ids in `contracts.md` §11, in the order task 11 lays the bar out,
 * plus the `fill` menu contracts §27.1 adds.
 *
 * It sits between the tools and the symbols because it is only ever about the
 * two shapes in the group before it - the pairing that used to put each filled
 * tool beside the outline it filled, one level up.
 */
const GROUP_IDS: readonly BarGroup["id"][] = [
  "grip",
  "tools",
  "fill",
  "symbols",
  "text",
  "width",
  "color",
  "history",
  "save",
  "exit",
];

/** Every `BarAction`. Each is one button, in the group named after its job. */
const ACTIONS: readonly BarAction[] = [
  "undo",
  "redo",
  "clear",
  "save-pdf",
  "save-png",
  "save-area",
  "exit",
];

/**
 * Every `SymbolKind`, from `contracts.md` §3's own words.
 *
 * Written out here rather than imported, for the reason `rebuild` is: the
 * palette's job is to offer *all seven*, and a list taken from the module that
 * builds the buttons could lose one on both sides at once and still pass. The
 * `SymbolKind` annotation rejects a kind that does not exist, and the length
 * assertion below is what catches one that has gone missing from here.
 */
const SYMBOLS: readonly SymbolKind[] = [
  "arrow",
  "arrow-double",
  "check",
  "cross",
  "bang",
  "star",
  "pin",
];

/**
 * Every `FillMode` and the label the menu has to give it - `contracts.md`
 * §27.1's table, written out here rather than imported for the reason `SYMBOLS`
 * is, with more riding on it: these three strings *are* the honesty of the
 * feature (`.plan/design.md` §21.3), so a test that took them from the module
 * that writes them could watch "Cover - removes text" become "Redact" and pass.
 */
const FILL_LABELS: readonly (readonly [FillMode, string])[] = [
  ["none", "Not filled"],
  ["tint", "Filled - read-through"],
  ["cover", "Cover - removes text"],
];

function group(groups: readonly BarGroup[], id: BarGroup["id"]): BarGroup {
  const found = groups.find((g) => g.id === id);
  if (!found) throw new Error(`no ${id} group`);
  return found;
}

function ids(groups: readonly BarGroup[]): string[] {
  return groups.flatMap((g) => g.buttons.map((b) => b.id));
}

/**
 * A parsed id put back together, from `contracts.md` §11's own words.
 *
 * Written out here rather than imported from lib/draw/bar.ts on purpose: it is
 * the independent half of the round-trip, so the prefixes cannot move on both
 * sides at once and still pass.
 */
function rebuild(parsed: BarId): string {
  switch (parsed.kind) {
    case "tool":
      return `tool:${parsed.tool}`;
    case "symbol":
      return `symbol:${parsed.symbol}`;
    case "width":
      return `width:${parsed.width}`;
    case "color":
      return `color:${parsed.color}`;
    case "font":
      return `font:${parsed.fontSize}`;
    case "fill":
      return `fill:${parsed.fill}`;
    case "action":
      return parsed.action;
  }
}

describe("barGroups - tools and fills", () => {
  it("gives every tool exactly one button", () => {
    // Draw mode is Pro as a whole, so the bar offers every tool there is: a
    // tool in `DRAW_ALL_TOOLS` with no button is a tool nobody has, and one
    // with two is a press the bar cannot light up honestly.
    const tools = ids(barGroups()).filter((id) => id.startsWith("tool:"));
    expect([...tools].sort()).toEqual(DRAW_ALL_TOOLS.map((t) => `tool:${t}`).sort());
  });

  it("puts the five plain marks in the tools group, the highlighter included", () => {
    const buttons = group(barGroups(), "tools").buttons;

    // DRAWING.md §2's four plus the highlighter, which was a tool with no
    // button on the bar for as long as the group was §2's phase-1 list.
    //
    // Five, not seven: `tool:rect-fill` and `tool:ellipse-fill` were here for
    // one pass, and a fill is one menu serving both shapes now
    // (`.plan/design.md` §18) rather than a second button per shape.
    expect(buttons.map((b) => b.id)).toEqual([
      "tool:pencil",
      "tool:highlighter",
      "tool:line",
      "tool:rect",
      "tool:ellipse",
    ]);
  });

  it("offers exactly three fills, labelled verbatim", () => {
    // Contracts §27.1's table, in its order: the menu is one control in three
    // states, so a fourth button or a missing one is a different control.
    const buttons = group(barGroups(), "fill").buttons;
    expect(buttons).toHaveLength(3);
    expect(buttons.map((b) => [b.id, b.label])).toEqual(
      FILL_LABELS.map(([mode, label]) => [`fill:${mode}`, label]),
    );
  });

  it("labels the fills honestly - never redact, never black out", () => {
    // The labels are a contract, not decoration (`.plan/design.md` §21.3), and
    // this is the half of the old rule that did not change: "redact" and "black
    // out" promise a standard this does not meet, whatever the mark's alpha is.
    //
    // "cover" *is* now allowed, and only because it became true: a `"cover"`
    // removes the characters underneath from the export (`lib/dom/cover.ts`),
    // so `"Cover - removes text"` describes the mark rather than overselling it
    // - and the assertion that it still says "removes text" is what stops it
    // being shortened to the word alone, which would be a promise with the
    // limit filed off. `FILL_NOTE` (entrypoints/annotate.ts) says the limit in
    // words, once per session.
    const all = barGroups().flatMap((g) => g.buttons);
    const label = (id: string): string => all.find((b) => b.id === id)?.label ?? "";

    expect(label("fill:cover")).toContain("removes text");
    for (const button of all) {
      expect(button.label.toLowerCase(), button.id).not.toMatch(/redact|black out/);
    }
    // And nothing on the bar says "cover" except the one button that earns it.
    const covers = all.filter((b) => b.label.toLowerCase().includes("cover"));
    expect(covers.map((b) => b.id)).toEqual(["fill:cover"]);
  });
});

describe("barGroups - shape", () => {
  it("returns the contract's ten groups, each exactly once, in order", () => {
    expect(barGroups().map((g) => g.id)).toEqual(GROUP_IDS);
  });

  it("gives every button a unique id - they are what onPress dispatches on", () => {
    const all = ids(barGroups());
    expect(new Set(all).size).toBe(all.length);
  });

  it("ids follow the contract's scheme", () => {
    // `tool:<DrawTool>`, `symbol:<SymbolKind>`, `width:<n>`, `color:<css>`,
    // `font:<n>`, `fill:<FillMode>`, or a bare `BarAction`.
    const scheme = new RegExp(
      `^(tool:[a-z-]+|symbol:[a-z-]+|width:\\d+|color:.+|font:\\d+|fill:[a-z]+|${ACTIONS.join("|")})$`,
    );
    for (const id of ids(barGroups())) expect(id).toMatch(scheme);
  });

  it("gives every SymbolKind a button in the symbols group", () => {
    // The pins are what make a review screenshot readable, so a `SymbolKind`
    // with no button is a mark nobody can place. `SYMBOL_ICONS` in lib/draw/bar.ts
    // is a `Record<SymbolKind, ...>` so the compiler keeps it complete; this is
    // the check that `barGroups` actually renders all of it.
    expect(SYMBOLS).toHaveLength(7);
    const buttons = group(barGroups(), "symbols").buttons;
    expect(buttons.map((b) => b.id)).toEqual([
      "tool:symbol",
      ...SYMBOLS.map((kind) => `symbol:${kind}`),
    ]);
  });

  it("puts the font-size control in the text group, behind the T button", () => {
    // DRAWING.md's one deviation from the sketch: the text tool places a caret
    // on the page instead of a field on the bar, and "the bar keeps a font-size
    // control where the field would have been". The T button comes first
    // because `mountBar` puts a popover group's first button in the bar's row
    // and the rest in the panel.
    const buttons = group(barGroups(), "text").buttons;
    expect(buttons.map((b) => b.id)).toEqual([
      "tool:text",
      ...FONT_SIZES.map((size) => `font:${size}`),
    ]);
    expect(FONT_SIZES.length).toBeGreaterThan(1);
  });

  it("keeps every preset two digits wide, so the trigger's box does not move", () => {
    // Coupled to `rememberSize` in lib/draw/bar.ts, which caches the bar's box
    // and says the cache is *exact* because the bar's contents never change
    // size - and the font-size trigger is the one element that shows a value.
    // `.size` sets tabular figures, so two digits are two digits; an 8 or a 100
    // would make the trigger narrower or wider than the box that was cached and
    // clamped against. `mergeDrawPrefs` clamps a stored size into 8..96, so
    // both ends of that are reachable by hand.
    for (const size of FONT_SIZES) expect(String(size), String(size)).toHaveLength(2);
  });

  it("offers the default label size, so the control opens with something lit", () => {
    // Across two modules on purpose. `DEFAULT_DRAW_PREFS.fontSize` is what a
    // fresh profile arrives holding, and a default that is not one of the
    // presets would light no button at all - the same honest-but-blank picture
    // a colour from the system input gives the five swatches, except that this
    // one is the *out of the box* state.
    expect(FONT_SIZES).toContain(DEFAULT_DRAW_PREFS.fontSize);
  });

  it("gives an armed fill exactly one button to light, whichever it is", () => {
    // `isSelected` is private to `mountBar`'s half of the module and compares
    // `parsed.fill` with `BarState.fill`, so what a unit test can hold to
    // account is the half that decides how many buttons *can* match: one id per
    // mode, each parsing back to the mode it was written for. Two buttons
    // carrying `fill:cover` would light together and the menu would stop being
    // one control in three states; none would leave the menu open with nothing
    // lit and the trigger showing a mode that appears nowhere in it.
    const buttons = group(barGroups(), "fill").buttons;
    for (const [mode] of FILL_LABELS) {
      const matching = buttons.filter((b) => {
        const parsed = parseBarId(b.id);
        return parsed?.kind === "fill" && parsed.fill === mode;
      });
      expect(matching.map((b) => b.id), mode).toEqual([`fill:${mode}`]);
    }
  });

  it("carries no button in the grip - it is a drag handle", () => {
    expect(group(barGroups(), "grip").buttons).toEqual([]);
  });

  it("derives the widths and colours from lib/draw/model.ts", () => {
    const groups = barGroups();
    expect(group(groups, "width").buttons.map((b) => b.id)).toEqual(
      DRAW_WIDTHS.map((w) => `width:${w}`),
    );
    expect(group(groups, "color").buttons.map((b) => b.id)).toEqual(
      DRAW_COLORS.map((c) => `color:${c}`),
    );
  });

  it("has one button for each BarAction", () => {
    const groups = barGroups();
    const all = ids(groups);
    for (const action of ACTIONS) {
      expect(all.filter((id) => id === action)).toEqual([action]);
    }
    expect(group(groups, "history").buttons.map((b) => b.id)).toEqual(["undo", "redo", "clear"]);
    expect(group(groups, "save").buttons.map((b) => b.id)).toEqual([
      "save-pdf",
      "save-png",
      "save-area",
    ]);
    expect(group(groups, "exit").buttons.map((b) => b.id)).toEqual(["exit"]);
  });

  it("labels every button, because the label is the title and the aria-label", () => {
    for (const g of barGroups()) {
      for (const b of g.buttons) expect(b.label.trim()).not.toBe("");
    }
  });

  it("gives every button either an icon or a value to draw", () => {
    // The width and colour buttons have no icon on purpose: BAR_CSS draws a
    // `.stroke` at the width itself and a `.swatch` in the colour itself, both
    // read back out of the id. Everything else is a lucide path.
    for (const g of barGroups()) {
      for (const b of g.buttons) {
        // `font:` joins them: `.size` draws the size as its own number.
        const drawsItsValue =
          b.id.startsWith("width:") || b.id.startsWith("color:") || b.id.startsWith("font:");
        if (drawsItsValue) expect(b.icon).toBeUndefined();
        else expect(b.icon).toMatch(/^[Mm]/);
      }
    }
  });

  it("draws the three fills as one square with three interiors", () => {
    // `BAR_CSS` gives `.icon` `fill: none` and strokes it, so an icon here
    // cannot say "filled" with a fill - it says it with extra subpaths inside
    // the outline. Two buttons sharing a `d` would be two buttons nobody can
    // tell apart, which is half of what this catches; the other half is the
    // three drifting into three unrelated glyphs, when the menu is one control
    // in three states and its trigger shows whichever is armed.
    const icons = new Map(barGroups().flatMap((g) => g.buttons.map((b) => [b.id, b.icon])));
    const icon = (id: string): string => icons.get(id) ?? "";
    const square = icon("tool:rect");

    expect(square).not.toBe("");
    for (const [mode] of FILL_LABELS) {
      expect(icon(`fill:${mode}`).startsWith(square), mode).toBe(true);
      // ...and none of them *is* the square: the trigger shows the armed mode,
      // and a bare square there would be the rectangle tool's button drawn a
      // second time on the same bar.
      expect(icon(`fill:${mode}`), mode).not.toBe(square);
    }
    // The cover is the tint with the block filled in, which is what makes the
    // pair legible at 16px - see the icon comments in lib/draw/bar.ts.
    expect(icon("fill:cover").startsWith(icon("fill:tint"))).toBe(true);
    expect(new Set(FILL_LABELS.map(([mode]) => icon(`fill:${mode}`))).size).toBe(3);
  });

  it("parses every id it writes - the two halves of the grammar agree", () => {
    // The drift guard. `barGroups` writes the ids and `parseBarId` reads them
    // back; a prefix changed on one side and not the other now fails here
    // instead of becoming a button that quietly does nothing.
    for (const id of ids(barGroups())) {
      const parsed = parseBarId(id);
      expect(parsed, id).not.toBeNull();
      // Rebuilt from `contracts.md` §11's own words, spelled out here rather
      // than imported, so bar.ts cannot move the grammar and its test with it.
      expect(rebuild(parsed as BarId)).toBe(id);
    }
  });

  it("parses each group's ids to the kind that group is for", () => {
    const groups = barGroups();
    const kinds = (id: BarGroup["id"]): string[] =>
      group(groups, id).buttons.map((b) => parseBarId(b.id)?.kind ?? "null");

    expect(kinds("tools")).toEqual(["tool", "tool", "tool", "tool", "tool"]);
    // The fill menu is the one group with no tool in it at all, which is why
    // `mountBar` draws it a trigger of its own and puts every button in the
    // panel: there is nothing here that has to stay one press away.
    expect(kinds("fill")).toEqual(["fill", "fill", "fill"]);
    // The text group is mixed too: the tool, then the font sizes behind the
    // control that replaced DRAWING.md's text field.
    expect(kinds("text")).toEqual(["tool", ...FONT_SIZES.map(() => "font")]);
    // The symbols group is the one mixed group: its trigger is a tool and the
    // seven marks behind it are symbols.
    expect(kinds("symbols")).toEqual([
      "tool",
      "symbol",
      "symbol",
      "symbol",
      "symbol",
      "symbol",
      "symbol",
      "symbol",
    ]);
    expect(kinds("width")).toEqual(DRAW_WIDTHS.map(() => "width"));
    expect(kinds("color")).toEqual(DRAW_COLORS.map(() => "color"));
    expect(kinds("history")).toEqual(["action", "action", "action"]);
    expect(kinds("save")).toEqual(["action", "action", "action"]);
    expect(kinds("exit")).toEqual(["action"]);
  });

  it("returns fresh objects, so a caller cannot mutate the next bar", () => {
    // `BarGroup.buttons` is a mutable array in the contract, and mountBar walks
    // it - a shared literal would let one bar's edit reach the next one.
    const first = barGroups();
    first[0].buttons.push({ id: "tool:pencil", label: "x" });
    first[1].buttons[0].label = "x";

    const second = barGroups();
    expect(second[0].buttons).toEqual([]);
    expect(second[1].buttons[0].label).toBe("Pencil");
  });
});

/**
 * `parseBarId` is an addition to `contracts.md` §11, and it exists so that the
 * id grammar has one reader rather than three: `valueElement` draws a swatch
 * from it, `paint` decides what is selected from it, and task 12 turns a press
 * back into a tool, a width or a colour. That makes its rejections as
 * load-bearing as its successes - a press it mis-parses is a button that
 * quietly does nothing.
 */
describe("parseBarId", () => {
  it("takes a tool, a symbol, a width, a colour, a size, a fill and an action apart", () => {
    expect(parseBarId("tool:pencil")).toEqual({ kind: "tool", tool: "pencil" });
    expect(parseBarId("symbol:arrow-double")).toEqual({
      kind: "symbol",
      symbol: "arrow-double",
    });
    expect(parseBarId("width:8")).toEqual({ kind: "width", width: 8 });
    expect(parseBarId("color:#ef4444")).toEqual({ kind: "color", color: "#ef4444" });
    expect(parseBarId("font:16")).toEqual({ kind: "font", fontSize: 16 });
    expect(parseBarId("fill:cover")).toEqual({ kind: "fill", fill: "cover" });
    for (const action of ACTIONS) {
      expect(parseBarId(action)).toEqual({ kind: "action", action });
    }
  });

  it("gives back a fill mode, and only one the menu has a button for", () => {
    // The same treatment as a width and a size: matched as a whole string
    // against the three, so only the exact spelling `barGroups` writes parses.
    // `fill:solid` is the word somebody would reach for, `fill:COVER` is the
    // right word in the wrong case, and `fill:` is what an empty value looks
    // like - none of them is a mode, and the direction of the failure is the
    // point. An id that mis-parsed to `"cover"` would arm a text removal
    // nobody asked for; one that parsed to nothing at all is a dead button.
    for (const [mode] of FILL_LABELS) {
      expect(parseBarId(`fill:${mode}`)).toEqual({ kind: "fill", fill: mode });
    }
    for (const id of ["fill:solid", "fill:", "fill:COVER", "fill:Cover", "fill:none ", "fill"]) {
      expect(parseBarId(id), id).toBeNull();
    }
  });

  it("gives back a number for a font size, and only one it has a button for", () => {
    // The same treatment as a width, and for the same reason: `font:16` is the
    // only place that 16 lives, and a size this module never wrote must not
    // come back as a label nobody can see - `mergeDrawPrefs` clamps a stored
    // `fontSize` into 8..96, so an unchecked `font:0` would round-trip.
    for (const size of FONT_SIZES) {
      expect(parseBarId(`font:${size}`)).toEqual({ kind: "font", fontSize: size });
    }
    for (const id of ["font:17", "font:016", "font: 16", "font:", "font:16px", "font:NaN"]) {
      expect(parseBarId(id), id).toBeNull();
    }
  });

  it("gives back a number for a width, not the string in the id", () => {
    // The whole reason the parser exists: `width:4` is the only place that 4
    // lives, and a caller that got "4" would be back to parsing it itself.
    for (const width of DRAW_WIDTHS) {
      expect(parseBarId(`width:${width}`)).toEqual({ kind: "width", width });
      expect(typeof (parseBarId(`width:${width}`) as { width: number }).width).toBe("number");
    }
  });

  it("rejects a width that is not one of the three", () => {
    // Only the exact spelling `barGroups` writes: a 3 is not a pen we have, and
    // `Number("")` being 0 must never look like one either.
    for (const id of ["width:3", "width:04", "width: 4", "width:", "width:4px", "width:NaN"]) {
      expect(parseBarId(id), id).toBeNull();
    }
  });

  it("rejects a tool or a symbol it has no button for", () => {
    expect(parseBarId("tool:marker")).toBeNull();
    expect(parseBarId("symbol:heart")).toBeNull();
    expect(parseBarId("tool:")).toBeNull();
    expect(parseBarId("symbol:")).toBeNull();
    // The parser follows the type rather than the layout, which is why nothing
    // here had to change when the highlighter got its button in the tools
    // group - it parsed before it was reachable.
    expect(parseBarId("tool:highlighter")).toEqual({ kind: "tool", tool: "highlighter" });
  });

  it("has no button and no parse left for either filled tool", () => {
    // They were `DrawTool` members for one pass and are gone (`.plan/design.md`
    // §18), so a bar built before this change - or a press replayed from one -
    // must come back as nothing rather than as a tool the layer has no case
    // for. `Object.hasOwn(TOOL_ICONS, ...)` is a membership test and not a
    // prefix match, which is what makes both of these `null` the moment the
    // entries left the record.
    expect(parseBarId("tool:rect-fill")).toBeNull();
    expect(parseBarId("tool:ellipse-fill")).toBeNull();
    expect(parseBarId("tool:rect-filled")).toBeNull();
    expect(parseBarId("tool:fill")).toBeNull();
    // And no button writes them any more.
    expect(ids(barGroups())).not.toContain("tool:rect-fill");
    expect(ids(barGroups())).not.toContain("tool:ellipse-fill");
    // `arrow-double` and `save-pdf` are what is left of the hyphenated ids, and
    // they still take apart prefix and all - `onPress` reads every press
    // through this, so one that did not parse would be a button that quietly
    // does nothing.
    expect(parseBarId("symbol:arrow-double")).toEqual({ kind: "symbol", symbol: "arrow-double" });
    expect(parseBarId("save-pdf")).toEqual({ kind: "action", action: "save-pdf" });
  });

  it("is not fooled by a prototype key", () => {
    // `Object.hasOwn`, never `in` - `"constructor" in TOOL_ICONS` is true, and
    // a `DrawTool` of "constructor" would reach the layer as a tool.
    for (const id of [
      "tool:constructor",
      "tool:toString",
      "symbol:constructor",
      "symbol:hasOwnProperty",
      // The fill menu joins them: `"constructor" in FILL_ICONS` is true, and a
      // `FillMode` of "constructor" would reach the renderer, which has no case
      // for it - and, worse, would not be the `"none"` a bad value must fall to.
      "fill:constructor",
      "fill:hasOwnProperty",
      "constructor",
      "toString",
      "__proto__",
    ]) {
      expect(parseBarId(id), id).toBeNull();
    }
  });

  it("takes a colour verbatim, colons and all, but not an empty one", () => {
    // A CSS colour is whatever the colour input returned (`mergeDrawPrefs`
    // treats a stored one the same way), so there is nothing here to validate -
    // and `valueElement` only ever puts it in a style property. What it must
    // not do is truncate: `color:` splits on the *first* prefix, not on every
    // colon in the value.
    expect(parseBarId("color:rgb(1, 2, 3)")).toEqual({ kind: "color", color: "rgb(1, 2, 3)" });
    expect(parseBarId("color:var(--x)")).toEqual({ kind: "color", color: "var(--x)" });
    expect(parseBarId("color:color-mix(in srgb, red 50%, blue)")).toEqual({
      kind: "color",
      color: "color-mix(in srgb, red 50%, blue)",
    });
    expect(parseBarId("color:color:red")).toEqual({ kind: "color", color: "color:red" });
    expect(parseBarId("color:")).toBeNull();
  });

  it("returns null - not a member - for anything else", () => {
    // Unparseable is `null` rather than an `{ kind: "unknown" }` variant, so a
    // caller cannot forget the case and the switch on `kind` stays exhaustive.
    for (const id of ["", "pencil", "undo!", "tool", "save", "Undo", " undo", "tool:pencil "]) {
      expect(parseBarId(id), JSON.stringify(id)).toBeNull();
    }
  });
});

/**
 * `popoverAfterPress` is the whole of the bar's panel policy, and it is pure so
 * that `.plan/design.md` §12's rules are assertions here rather than branches
 * inside a closure a unit test cannot reach - one `it` per rule below.
 *
 * The rule that fixed the reported bug is the one with no case of its own: a
 * press in the **page** is not an argument to this function. A stroke, a
 * `<select>`, a JS menu and a focus trap have no way to reach the decision, so
 * there is nothing here to assert about them beyond the shape of the signature -
 * which is exactly the point, since the press that starts a stroke was what used
 * to close the symbols palette on every mark.
 */
describe("popoverAfterPress", () => {
  it("closes the open panel when its own trigger is pressed again", () => {
    // Rule 1, and the only way back out of the symbols palette without picking
    // a mark.
    expect(popoverAfterPress("symbols", "symbols", true)).toBeNull();
  });

  it("opens a panel when nothing is open", () => {
    expect(popoverAfterPress(null, "symbols", true)).toBe("symbols");
  });

  it("lets another group's trigger open its own panel", () => {
    // Rule 2: the open palette does not have to be put away first, and two
    // panels are never up at once - `mountBar` keeps one `openId`.
    expect(popoverAfterPress("symbols", "text", true)).toBe("text");
  });

  it("keeps the panel open for a press inside it - this is the symbols fix", () => {
    // Rule 3, and the reported bug: placing five arrows in a row is five presses
    // of `symbol:arrow` and none of the trigger, so picking a mark cannot be
    // treated as the end of the errand.
    expect(popoverAfterPress("symbols", "symbols", false)).toBe("symbols");
  });

  it("closes it for a press in another group", () => {
    // Rule 4: the pencil, a width, a colour - whatever was open is in the way of
    // the bar now.
    expect(popoverAfterPress("symbols", "width", false)).toBeNull();
  });

  it("changes nothing for a press on the bar's own chrome", () => {
    // Rule 5. The grip and the note come through as `null`, so dragging the bar
    // to a corner with the palette up keeps the palette.
    expect(popoverAfterPress("symbols", null, false)).toBe("symbols");
    expect(popoverAfterPress(null, null, false)).toBeNull();
  });

  it("opens nothing from a press that is not on a trigger", () => {
    // With nothing open there is nothing to keep or to close, whatever was
    // pressed: a panel is only ever *opened* by its trigger.
    for (const pressed of ["symbols", "text", "tools", "width", "grip", null]) {
      expect(popoverAfterPress(null, pressed, false), String(pressed)).toBeNull();
    }
  });
});
