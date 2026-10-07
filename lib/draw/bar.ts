/**
 * The floating tool bar: its contents as data, and the DOM that draws them.
 *
 * Split the way `.plan/design.md` §6 asks every DOM builder in `lib/draw/` to
 * split. `barGroups()` is pure - the bar's contents as a list of groups of
 * buttons - so `tests/draw-bar.test.ts` covers it properly. `mountBar()` is the
 * half a unit test cannot reach: a closed shadow root, a pointer drag and a
 * `window` listener.
 *
 * Five things about it are decisions rather than detail:
 *
 * 1. **Its own shadow host**, separate from the layer's, so `setVisible(false)`
 *    can take the bar out of a capture without touching the drawing. The host
 *    deliberately does **not** carry `LAYER_ATTR`: `LAYER_CSS` forces
 *    `display: block !important` on anything that does, which would beat
 *    `.root[data-visible="0"]` and photograph the bar anyway.
 * 2. **The host is positioned inline, with `important`**, the way
 *    `entrypoints/select-area.ts` does it. Having given up `LAYER_CSS`, it has
 *    no forced positioning left, and a page shipping
 *    `* { position: static !important }` reaches the host - though not, thanks
 *    to the shadow boundary, `BAR_CSS`'s own `.root`.
 * 3. **`parseBarId` is exported and the id prefixes are not**, so the grammar a
 *    `BarButton.id` is written in has exactly one reader. That is an addition to
 *    `contracts.md` §11, and the reason for it is on the type.
 * 4. **Three groups are popovers, and the rest are flat.** The symbols palette,
 *    the label's font size and the shape fill hide their members behind a
 *    trigger (`POPOVER_GROUPS` below, and the last block of `BAR_CSS`); the
 *    widths, the colours and the save pair stay inline, because a menu costs a
 *    second press and only earns it when it is hiding enough buttons to be
 *    worth it. The fill is three buttons and would have fitted in a row - it is
 *    a menu because it is a *setting*, and a row of three shapes-with-interiors
 *    beside the row of shape tools reads as six tools. Which *side* of the bar
 *    a panel - or the note - hangs on is `dropSide`'s (geometry.ts), because a
 *    bar parked at the bottom of the screen has no room below it; `place()` does
 *    the measuring.
 * 5. **A panel is opened and closed by the bar, and by nothing else.** Nothing
 *    that happens in the *page* - a stroke, a `<select>`, a JS menu, a focus
 *    trap - dismisses one, so this module installs no `window` `pointerdown`
 *    listener of its own and annotate mode is one capture-phase listener lighter
 *    on every page it runs on (`.plan/design.md` §12). The whole of the policy
 *    is `popoverAfterPress` below, and it is pure, so its rules are assertions
 *    in `tests/draw-bar.test.ts` rather than branches in a closure. `Esc` is the
 *    keyboard's way out, through `closePanels()`.
 */

import { BAR_CSS, Z_INDEX } from "./css";
import { clampToViewport, dropSide } from "./geometry";
import { DRAW_COLORS, DRAW_WIDTHS } from "./model";
import { SVG_NS } from "./render";

import type { Vec2 } from "./model";
import type { DrawTool, FillMode, StrokeWidth, SymbolKind } from "../types";

/* ------------------------------------------------------------------ icons */

/*
 * Inline SVG path data lifted from **lucide** (ISC - see
 * node_modules/lucide-react/LICENSE; portions are Feather, MIT). Each icon is
 * lucide's own geometry on its 24x24 grid, so the bar looks like the popup even
 * though it shares no code with it.
 *
 * `lucide-react` is deliberately **not** imported here. This module is bundled
 * into a script injected into someone else's page, and a content script is not
 * the place for Preact, Tailwind and Radix (`.plan/design.md` §7).
 *
 * `BarButton.icon` is one `d` string, so one code path renders every button.
 * Where lucide draws an icon with several elements the subpaths are
 * concatenated - a leading relative `m` becomes `M` plus an explicit `l`, since
 * only the *first* moveto of a path is absolute regardless of case - and its
 * `rect` / `circle` / `line` primitives are written out as path commands. The
 * grip's six dots use lucide's own dot idiom, a zero-length `h.01` under
 * `stroke-linecap: round`.
 */

/** lucide `grip-vertical`, its six r=1 dots as zero-length round-capped lines. */
const ICON_GRIP = "M9 5h.01 M9 12h.01 M9 19h.01 M15 5h.01 M15 12h.01 M15 19h.01";
/** lucide `pencil`. */
const ICON_PENCIL =
  "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z M15 5l4 4";
/** lucide `highlighter`. */
const ICON_HIGHLIGHTER =
  "M9 11l-6 6v3h9l3-3 M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4";
/** lucide `slash` - a bare diagonal, which is what the line tool draws. */
const ICON_LINE = "M22 2 2 22";
/** lucide `square`, its `rx="2"` corners as arcs. */
const ICON_RECT = "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z";
/** lucide `circle`, as two half-arcs. */
const ICON_ELLIPSE = "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20";

/*
 * The fill menu: one square, three interiors.
 *
 * The interior is how a fill is said at all here. `BAR_CSS` gives `.icon`
 * `fill: none` and `stroke: currentColor` at width 2, and every button renders
 * from one `d` string through one code path, so an icon cannot ask for a fill
 * without a stylesheet change (`.plan/tasks/33-fill-menu.md` rules that out, as
 * task 27's did) or a second attribute on `BarButton.icon` (contracts §11 says
 * it is path data and nothing else). Painting the interior *with the stroke*
 * needs neither.
 *
 * All three open with `ICON_RECT`, so the menu and its trigger read as one
 * control in three states rather than three unrelated marks. The square stands
 * for both shapes it arms rather than being drawn twice, once round: what the
 * menu chooses is the interior, and an ellipse's would have to be a different
 * set of subpaths to say the same three things. The whole `d` is one `<path>`,
 * so the contours are stroked into one region and rasterised once.
 *
 * The solid block's spacing is measured, in the sense `CLAUDE.md` means:
 * rendered in Chromium at 16, 24 and 128px for task 27's filled-rectangle icon,
 * and carried here unchanged rather than redrawn. Concentric outlines a
 * stroke-width or less apart, so each one's 2px stroke covers the hole the one
 * outside it left and the set reads as a single solid 8x8 mark - about 5px of
 * the rendered 16, with clear space to the outline on every side. Nested
 * squares spaced a full 2 apart look solid at 16 and open four notches at 128,
 * because `stroke-linejoin: round` rounds the inner square's outer corners away
 * from the outer square's square ones, which is why the rings overlap by 0.5.
 */

/**
 * lucide `square` with a diagonal across it - "not filled".
 *
 * The swatch every drawing program draws for no fill, and a glyph of its own
 * rather than the bare `ICON_RECT`: the trigger shows the armed mode, and a
 * trigger showing a plain square would be the rectangle *tool*'s button drawn
 * twice on one bar.
 */
const ICON_FILL_NONE = `${ICON_RECT} M7 17 17 7`;
/**
 * lucide `square` with a hollow block inside it - the read-through tint.
 *
 * The block is `ICON_FILL_COVER`'s outermost ring on its own, which is what
 * makes the pair legible: the same block, open and then filled in.
 */
const ICON_FILL_TINT = `${ICON_RECT} M9 9h6v6H9z`;
/**
 * lucide `square` with a solid block inside it - the cover.
 *
 * The 6x6 square's stroke covers the ring 8..10 and 14..16, the 3x3 square's
 * covers 9.5..14.5 - overlapping it, so no notch survives at the corners - and
 * `M12 12h.01` is lucide's own dot idiom (see `ICON_GRIP`) filling the 1x1 hole
 * the 3x3 square's own stroke leaves at the centre. Together: a solid 8..16.
 */
const ICON_FILL_COVER = `${ICON_FILL_TINT} M10.5 10.5h3v3h-3z M12 12h.01`;
/** lucide `arrow-up-right` - the symbols group's own trigger. */
const ICON_SYMBOL = "M7 7h10v10 M7 17 17 7";
/** lucide `type`, its polyline and two lines as path commands. */
const ICON_TEXT = "M4 7V4h16v3 M9 20h6 M12 4v16";
/** lucide `undo-2`. */
const ICON_UNDO = "M9 14 4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11";
/** lucide `redo-2`. */
const ICON_REDO = "M15 14l5-5-5-5 M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13";
/** lucide `trash-2`. */
const ICON_CLEAR =
  "M3 6h18 M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6 M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2 M10 11v6 M14 11v6";
/** lucide `file-down`. */
const ICON_SAVE_PDF =
  "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z M14 2v4a2 2 0 0 0 2 2h4 M12 18v-6 M9 15l3 3 3-3";
/** lucide `image-down`, its `circle` as arcs. */
const ICON_SAVE_PNG =
  "M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1a2 2 0 0 0-2.814.014L6 21 M14 19l3 3v-5.5 M17 22l3-3 M9 7a2 2 0 1 0 0 4a2 2 0 1 0 0-4";
/**
 * lucide `crop` - the icon on the popup's own "Select area" button, so the same
 * errand has the same picture wherever it is started from.
 */
const ICON_SAVE_AREA = "M6 2v14a2 2 0 0 0 2 2h14 M18 22V8a2 2 0 0 0-2-2H2";
/** lucide `x`. Both the cross symbol and the exit button - an X is an X. */
const ICON_X = "M18 6 6 18 M6 6l12 12";
/** lucide `arrow-down-right`, aimed the way symbols.ts draws the diagonal. */
const ICON_ARROW = "M7 7l10 10 M17 7v10H7";
/** lucide `move-diagonal-2` - the same diagonal, headed at both ends. */
const ICON_ARROW_DOUBLE = "M19 13v6h-6 M5 11V5h6 M5 5l14 14";
/** lucide `check`. */
const ICON_CHECK = "M20 6 9 17l-5-5";
/** lucide `circle-alert`, its `circle` and two `line`s as path commands. */
const ICON_BANG = "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20 M12 8v4 M12 16h.01";
/** lucide `star`. */
const ICON_STAR =
  "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z";
/** lucide `map-pin`, its `circle` as arcs. */
const ICON_PIN =
  "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0 M12 7a3 3 0 1 0 0 6a3 3 0 1 0 0-6";

/* ---------------------------------------------------------------- contents */

export type BarAction =
  | "undo"
  | "redo"
  | "clear"
  | "save-pdf"
  | "save-png"
  | "save-area"
  | "exit";

export interface BarButton {
  /** `tool:<DrawTool>`, `symbol:<SymbolKind>`, `width:<n>`, `color:<css>`, or a `BarAction`. */
  id: string;
  label: string;
  /** Inline SVG path data lifted from lucide (ISC). No lucide-react in here. */
  icon?: string;
}

export interface BarGroup {
  id:
    | "grip"
    | "tools"
    // Next to the shapes it paints, and not down with the width and the colour
    // it is otherwise a sibling of: the fill is only ever about the rectangle
    // and the ellipse, and the pairing is the ordering's whole job - the same
    // argument that used to put each filled tool beside the outline it filled.
    | "fill"
    | "symbols"
    | "text"
    | "width"
    | "color"
    | "history"
    | "save"
    | "exit";
  buttons: BarButton[];
}

/**
 * What a button id is made of.
 *
 * The prefixes are read back as well as written: the value a press carries
 * lives in the id, and `width:4` is the only place that 4 exists. They stay
 * module-private and `parseBarId` below is exported in their place, because the
 * grammar has several readers and one of them is in another file - `valueElement`
 * draws a swatch or a bar from the value in the id, `paint` decides from it what
 * the state has selected, and task 12 turns a press back into a tool, a width or
 * a colour. Every reader that splits the string itself is another place for
 * `width:4` to stop meaning 4 with nothing failing to say so, and the symptom is
 * the worst kind to go looking for: a button that quietly does nothing.
 */
const TOOL_PREFIX = "tool:";
const SYMBOL_PREFIX = "symbol:";
const WIDTH_PREFIX = "width:";
const COLOR_PREFIX = "color:";
const FONT_PREFIX = "font:";
const FILL_PREFIX = "fill:";

/**
 * The label sizes the font-size control offers, in CSS px.
 *
 * DRAWING.md's one deviation from the sketch is that the text tool places a
 * caret on the page instead of a field on the bar, and "the bar keeps a
 * font-size control where the field would have been" - this is that control's
 * vocabulary.
 *
 * It lives here and **not** beside `DRAW_WIDTHS` in lib/draw/model.ts, which is
 * the difference between the two: `mergeDrawPrefs` *quantises* a stored width
 * to the nearest member of `DRAW_WIDTHS`, so those three are the model's whole
 * idea of a pen width, whereas it merely *clamps* `fontSize` into 8..96 - any
 * size in that range is a legitimate label. So these five are an affordance the
 * bar offers, not a rule the model keeps, and a sixth preset needs no thought
 * anywhere else.
 *
 * Five steps rather than three, and geometric rather than even: a label is
 * either a note beside a paragraph or a title across a screenshot, and 12 to 48
 * covers both without a step nobody can tell from its neighbour. 16 is
 * `DEFAULT_DRAW_PREFS.fontSize`, so the control opens with something lit.
 */
export const FONT_SIZES: readonly number[] = [12, 16, 24, 32, 48];

/**
 * Label and icon for every member of `DrawTool`.
 *
 * A `Record<DrawTool, ...>` rather than a list, for the reason `SYMBOL_KINDS`
 * in lib/draw/prefs.ts is one: an eighth tool in ../types then fails to build
 * until it is named here, instead of quietly having no button.
 *
 * Every member now has a button. `highlighter` had an entry and no home for as
 * long as the `tools` group was DRAWING.md §2's phase-1 list - see
 * `TOOL_GROUP`, which is where it landed.
 *
 * Seven again: "Filled rectangle" and "Filled ellipse" were entries here for as
 * long as a fill was a tool, and the labels that replaced them - the ones that
 * are a contract rather than decoration - are on `FILL_ICONS` below, with the
 * rule they have to keep.
 */
const TOOL_ICONS: Readonly<Record<DrawTool, { label: string; icon: string }>> = {
  pencil: { label: "Pencil", icon: ICON_PENCIL },
  highlighter: { label: "Highlighter", icon: ICON_HIGHLIGHTER },
  line: { label: "Line", icon: ICON_LINE },
  rect: { label: "Rectangle", icon: ICON_RECT },
  ellipse: { label: "Ellipse", icon: ICON_ELLIPSE },
  symbol: { label: "Symbols", icon: ICON_SYMBOL },
  text: { label: "Text label", icon: ICON_TEXT },
};

/**
 * The fill menu: every `FillMode`, in the order it is drawn.
 *
 * A `Record<FillMode, ...>` for the reason `SYMBOL_ICONS` below is one - a
 * fourth mode in ../types then fails to build until it is named here, rather
 * than quietly having no button - and with the key order doing a list's second
 * job, since object key order for string keys is insertion order
 * (`FILL_ORDER`).
 *
 * **The three labels are a contract, not decoration**, and the rule they keep
 * is not quite the one the bar carried before. That rule said the labels were
 * "never 'cover', never 'redact', never 'black out'" (`.plan/design.md` §11.1),
 * and it was right about the bar it was written for: every fill that shipped
 * then was the translucent tint, the text underneath stayed in the exported PDF
 * and stayed searchable, and a button promising otherwise would have been the
 * one thing in the feature that could hurt somebody.
 *
 * **Never "redact" and never "black out" still stand.** Both promise a standard
 * this does not meet - a redaction is a claim about a document's whole history,
 * and a black bar is the picture of one - so neither is a word a button here
 * may use however opaque the mark is.
 *
 * **"Cover" is now allowed**, for the same reason the rest of the rule exists:
 * a `"cover"` genuinely removes the characters underneath from the export
 * (`lib/dom/cover.ts`, `.plan/design.md` §19), so `"Cover - removes text"`
 * describes what the mark does instead of promising what it cannot. It claims
 * that and nothing more, which is why the limit that can actually hurt somebody
 * - it cannot reach inside an embedded frame - is said in words the moment the
 * mode is armed (`FILL_NOTE`, entrypoints/annotate.ts) rather than crammed into
 * a button. `"Filled - read-through"` names its own limit the same way.
 */
const FILL_ICONS: Readonly<Record<FillMode, { label: string; icon: string }>> = {
  none: { label: "Not filled", icon: ICON_FILL_NONE },
  tint: { label: "Filled - read-through", icon: ICON_FILL_TINT },
  cover: { label: "Cover - removes text", icon: ICON_FILL_COVER },
};

/** The menu in the record's own key order. See `FILL_ICONS`. */
const FILL_ORDER = Object.keys(FILL_ICONS) as readonly FillMode[];

/**
 * The symbol palette, in the order it is drawn on the bar.
 *
 * Again a `Record`, and again for the compiler rather than for lookup speed -
 * with the key order doing the second job a list would have done. Object key
 * order for string keys is insertion order, so `SYMBOL_ORDER` below is this
 * literal's order, and an eighth `SymbolKind` is a compile error rather than a
 * mark with no button.
 */
const SYMBOL_ICONS: Readonly<Record<SymbolKind, { label: string; icon: string }>> = {
  arrow: { label: "Arrow", icon: ICON_ARROW },
  "arrow-double": { label: "Double arrow", icon: ICON_ARROW_DOUBLE },
  check: { label: "Check", icon: ICON_CHECK },
  cross: { label: "Cross", icon: ICON_X },
  bang: { label: "Exclamation", icon: ICON_BANG },
  star: { label: "Star", icon: ICON_STAR },
  pin: { label: "Numbered pin", icon: ICON_PIN },
};

/** The palette in the record's own key order. See `SYMBOL_ICONS`. */
const SYMBOL_ORDER = Object.keys(SYMBOL_ICONS) as readonly SymbolKind[];

/**
 * The tools group: DRAWING.md §2's four, plus the highlighter.
 *
 * `symbol` and `text` are groups of their own further along the bar, which is
 * why they are not in here - so this list is `DRAW_ALL_TOOLS` (lib/draw/model.ts)
 * without those two, and in the same order.
 *
 * The highlighter sits second, next to the pencil, because it **is** the pencil
 * - at `HIGHLIGHT_WIDTH_SCALE` times the width with a multiply blend
 * (lib/draw/render.ts) - and the pair of them is the one place on the bar where
 * two buttons mean the same gesture. §2 left it out only because it was a later
 * addition to that document, and a tool with no button is a tool nobody has.
 *
 * Five and not seven: the two filled tools that sat beside the outlines they
 * filled are one `fill` menu now (`.plan/design.md` §18), which is why the
 * group after this one is that menu. The pairing argument that placed them did
 * not go away - it moved up a level, to where the menu sits.
 */
const TOOL_GROUP: readonly DrawTool[] = ["pencil", "highlighter", "line", "rect", "ellipse"];

/** Label and icon for every `BarAction`. A record, for the same reason as above. */
const ACTION_ICONS: Readonly<Record<BarAction, { label: string; icon: string }>> = {
  undo: { label: "Undo", icon: ICON_UNDO },
  redo: { label: "Redo", icon: ICON_REDO },
  clear: { label: "Clear all marks", icon: ICON_CLEAR },
  "save-pdf": { label: "Save as PDF", icon: ICON_SAVE_PDF },
  "save-png": { label: "Save as PNG", icon: ICON_SAVE_PNG },
  "save-area": { label: "Save selected area", icon: ICON_SAVE_AREA },
  exit: { label: "Done - leave annotate mode", icon: ICON_X },
};

/**
 * A button id taken apart, as a discriminated result.
 *
 * An **addition** to `contracts.md` §11: the contract writes the grammar down
 * in a comment on `BarButton.id` (`tool:<DrawTool>`, `symbol:<SymbolKind>`,
 * `width:<n>`, `color:<css>`, or a bare `BarAction`), and this is that comment
 * made executable so that a second reader cannot drift from it.
 *
 * `font:<n>` is the sixth member, and the second addition: §11 asks the `text`
 * group for a font-size control without saying what its buttons are called, and
 * every other value on the bar is carried in its own id rather than in a
 * parallel structure. It is a **pen setting**, spelled like `width:` and read
 * back like it.
 *
 * `fill:<FillMode>` is the seventh, and contracts §27.2 names it: the two
 * filled tools it replaced were `tool:` ids, and a fill is a pen setting now -
 * so it is spelled and read back like the other three.
 */
export type BarId =
  | { kind: "tool"; tool: DrawTool }
  | { kind: "symbol"; symbol: SymbolKind }
  | { kind: "width"; width: StrokeWidth }
  | { kind: "color"; color: string }
  | { kind: "font"; fontSize: number }
  | { kind: "fill"; fill: FillMode }
  | { kind: "action"; action: BarAction };

/**
 * Take a `BarButton.id` apart. The only thing that knows the grammar.
 *
 * Validating rather than merely splitting: `tool:`, `symbol:` and the bare
 * actions are checked against the same records that gave the buttons their
 * icons and labels, and a width against `DRAW_WIDTHS`, so an id this module
 * never produced cannot come back as a `DrawTool` that does not exist.
 * `Object.hasOwn`, never `in` - `"constructor" in TOOL_ICONS` is true, a note
 * lib/draw/prefs.ts makes about the same hazard.
 *
 * An id that does not parse is `null` rather than an `{ kind: "unknown" }`
 * member, so a caller cannot forget the case: `if (!parsed) return;` is the
 * only way in to the `switch`, and the `switch` is then exhaustive.
 *
 * A colour is whatever follows the prefix, verbatim and unvalidated - the same
 * treatment `mergeDrawPrefs` gives a stored colour, because a CSS colour is
 * whatever the colour input returned. It only ever reaches a style *property*
 * (`valueElement`), never a stylesheet or markup.
 */
export function parseBarId(id: string): BarId | null {
  if (id.startsWith(TOOL_PREFIX)) {
    const tool = id.slice(TOOL_PREFIX.length);
    return Object.hasOwn(TOOL_ICONS, tool) ? { kind: "tool", tool: tool as DrawTool } : null;
  }
  if (id.startsWith(SYMBOL_PREFIX)) {
    const symbol = id.slice(SYMBOL_PREFIX.length);
    return Object.hasOwn(SYMBOL_ICONS, symbol)
      ? { kind: "symbol", symbol: symbol as SymbolKind }
      : null;
  }
  if (id.startsWith(WIDTH_PREFIX)) {
    const rest = id.slice(WIDTH_PREFIX.length);
    // Matched as a string, so only the exact spelling `barGroups` writes
    // parses: `width:04` and `width: 4` are not ids, and `Number("")` being 0
    // never gets the chance to look like one.
    const width = DRAW_WIDTHS.find((w) => String(w) === rest);
    return width === undefined ? null : { kind: "width", width };
  }
  if (id.startsWith(FONT_PREFIX)) {
    const rest = id.slice(FONT_PREFIX.length);
    // Matched as a string against `FONT_SIZES`, exactly as a width is against
    // `DRAW_WIDTHS`: `font:17` is not a button this module ever wrote, and
    // `Number("")` being 0 must not arrive as a 0px label.
    const fontSize = FONT_SIZES.find((size) => String(size) === rest);
    return fontSize === undefined ? null : { kind: "font", fontSize };
  }
  if (id.startsWith(FILL_PREFIX)) {
    const fill = id.slice(FILL_PREFIX.length);
    // Checked against the record that gave the three buttons their labels and
    // icons, exactly as a tool and a symbol are, and matched as a whole string
    // so only the exact spelling `barGroups` writes parses: `fill:solid` is the
    // word somebody would reach for and is not one of the three, and
    // `fill:COVER` is the right word in the wrong case. `Object.hasOwn`, never
    // `in` - a `FillMode` of `"constructor"` would reach the renderer, which
    // has no case for it.
    return Object.hasOwn(FILL_ICONS, fill) ? { kind: "fill", fill: fill as FillMode } : null;
  }
  if (id.startsWith(COLOR_PREFIX)) {
    const color = id.slice(COLOR_PREFIX.length);
    // Everything after the first prefix, colons included: a CSS colour is not
    // a token we get to reject, but an empty one is not a colour.
    return color === "" ? null : { kind: "color", color };
  }
  return Object.hasOwn(ACTION_ICONS, id) ? { kind: "action", action: id as BarAction } : null;
}

function toolButton(tool: DrawTool): BarButton {
  const { label, icon } = TOOL_ICONS[tool];
  return { id: `${TOOL_PREFIX}${tool}`, label, icon };
}

function actionButton(action: BarAction): BarButton {
  const { label, icon } = ACTION_ICONS[action];
  return { id: action, label, icon };
}

/**
 * The bar's contents. Pure, and fresh on every call, so a caller cannot reach
 * the next bar through the arrays it was handed.
 *
 * `grip` carries no buttons: it is a drag handle, and `onPress` dispatches on
 * button ids. `mountBar` draws it from `ICON_GRIP`.
 *
 * This function is **flat** whatever the bar does with it: a group is a list of
 * buttons, and which of them `mountBar` puts behind a trigger is a layout
 * decision (`POPOVER_GROUPS`). The consequence worth having: a test can
 * enumerate every mark in the palette without knowing a menu exists.
 *
 * The order inside a popover group is therefore load-bearing: `mountBar` puts
 * the **first** button in the bar's row and the rest in the panel, so
 * `tool:symbol` leads the symbols group and `tool:text` leads the text group.
 * The exception is a popover group that leads with no *tool* - the `fill` menu,
 * whose three buttons all belong in the panel because none of them is a mark
 * you press once. What stays in the row is the tool; see `mountBar`.
 */
export function barGroups(): BarGroup[] {
  return [
    { id: "grip", buttons: [] },
    { id: "tools", buttons: TOOL_GROUP.map(toolButton) },
    {
      id: "fill",
      // Every button goes in the panel, unlike the other two popover groups:
      // this group leads with no tool, so there is nothing that has to stay in
      // the bar's row. `mountBar` draws the trigger, and the trigger shows the
      // armed mode - see `POPOVER_GROUPS`.
      buttons: FILL_ORDER.map((fill) => ({
        id: `${FILL_PREFIX}${fill}`,
        label: FILL_ICONS[fill].label,
        icon: FILL_ICONS[fill].icon,
      })),
    },
    {
      id: "symbols",
      buttons: [
        toolButton("symbol"),
        ...SYMBOL_ORDER.map((kind) => ({
          id: `${SYMBOL_PREFIX}${kind}`,
          label: SYMBOL_ICONS[kind].label,
          icon: SYMBOL_ICONS[kind].icon,
        })),
      ],
    },
    {
      id: "text",
      buttons: [
        toolButton("text"),
        // No icon: `BAR_CSS`'s `.size` shows each size as its own number, the
        // way `.stroke` shows each width at its own thickness.
        ...FONT_SIZES.map((size) => ({
          id: `${FONT_PREFIX}${size}`,
          label: `${size} px label`,
        })),
      ],
    },
    {
      id: "width",
      // No icon: BAR_CSS's `.stroke` shows each width at its own thickness,
      // which is more use on a bar than the number 4.
      buttons: DRAW_WIDTHS.map((width) => ({
        id: `${WIDTH_PREFIX}${width}`,
        label: `${width} px pen`,
      })),
    },
    {
      id: "color",
      // The value *is* the label: DRAW_COLORS is a list of CSS colours with no
      // names attached, and inventing a second list of names here would be one
      // more thing to keep in step with lib/draw/model.ts.
      buttons: DRAW_COLORS.map((color) => ({
        id: `${COLOR_PREFIX}${color}`,
        label: `Colour ${color}`,
      })),
    },
    { id: "history", buttons: [actionButton("undo"), actionButton("redo"), actionButton("clear")] },
    {
      id: "save",
      buttons: [actionButton("save-pdf"), actionButton("save-png"), actionButton("save-area")],
    },
    { id: "exit", buttons: [actionButton("exit")] },
  ];
}

/* ------------------------------------------------------------------- mount */

export interface BarState {
  tool: DrawTool;
  symbol: SymbolKind;
  color: string;
  width: StrokeWidth;
  /**
   * The label size, in CSS px. An **addition** to `contracts.md` §11, and the
   * other half of the font-size control that §11 asks the `text` group for: a
   * control with no state behind it is five buttons that never light up, and
   * the trigger's whole job is to show the size the next label will be. It is
   * `DrawPrefs.fontSize`, so the shape of the state is unchanged - `tool`,
   * `symbol`, `color` and `width` are the same four fields of the same object.
   *
   * A size outside `FONT_SIZES` lights nothing, which is the honest picture -
   * exactly as a colour from the system input leaves all five swatches unlit.
   */
  fontSize: number;
  /**
   * The fill the next rectangle or ellipse gets (contracts §27.2). It is
   * `DrawPrefs.fill`, and it is here for the same reason `fontSize` is: the
   * menu's three buttons need one of them lit, and the trigger's whole job is
   * to show which mode is armed - "why is my rectangle solid?" answered by
   * looking at the bar rather than by drawing another one.
   *
   * Unlike `fontSize` there is no honest blank state to fall into: a stored
   * fill is quantised to one of the three by `mergeDrawPrefs`, so exactly one
   * button is always lit.
   */
  fill: FillMode;
  canUndo: boolean;
  canRedo: boolean;
  /** A line of feedback - a save's result, or a warning. `null` clears it. */
  note: string | null;
}

export interface BarHandle {
  setState(state: BarState): void;
  /**
   * Hidden around a capture; it is fixed, and would repeat on every sheet.
   *
   * An open panel is left open and hidden with it - see the implementation.
   */
  setVisible(on: boolean): void;
  /**
   * Close an open panel. Returns whether one was open.
   *
   * The entrypoint's `Esc` handler is the caller: with the page no longer able
   * to dismiss a panel, Esc is the keyboard's way out, and it must be consumed
   * by the panel *before* it reaches the mid-drag cancel or the exit - leaving
   * annotate mode because somebody wanted a menu shut is the expensive
   * misreading. The boolean is how the caller knows to stop.
   */
  closePanels(): boolean;
  unmount(): void;
}

export interface BarOptions {
  /** Viewport coordinates, already clamped. */
  position: { x: number; y: number };
  state: BarState;
  /** A button id from `BarButton.id`. */
  onPress(id: string): void;
  /** Fired on drag end and on resize, already clamped. Persist it. */
  onMove(position: { x: number; y: number }): void;
}

/** One `<svg class="icon">` around one `<path d>`. BAR_CSS sizes and strokes it. */
function iconElement(d: string): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  // `className` on an SVG element is a read-only SVGAnimatedString.
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  // The label is on the button, so the icon is decoration to a screen reader.
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}

/**
 * A colour swatch, a bar at the width it stands for, or a size as its own
 * number. None of the three has an icon - the value *is* the icon.
 */
function valueElement(id: string): HTMLElement | null {
  const parsed = parseBarId(id);
  if (parsed?.kind === "font") {
    const size = document.createElement("div");
    size.className = "size";
    // A number out of `FONT_SIZES`, so there is nothing here a page could have
    // written - and it is `textContent` regardless, never markup.
    size.textContent = String(parsed.fontSize);
    return size;
  }
  if (parsed?.kind === "color") {
    const swatch = document.createElement("div");
    swatch.className = "swatch";
    // Whatever the colour input returned, straight into a style property -
    // never into a stylesheet or markup, so a hostile value has nowhere to go.
    swatch.style.background = parsed.color;
    return swatch;
  }
  if (parsed?.kind === "width") {
    const stroke = document.createElement("div");
    stroke.className = "stroke";
    stroke.style.height = `${parsed.width}px`;
    return stroke;
  }
  return null;
}

/**
 * Whether `id` is what `state` currently has selected.
 *
 * Read out of the id rather than built into one: `paint` used to assemble
 * `tool:`+`state.tool` itself, which made it a second writer of the grammar
 * `parseBarId` reads. A colour matches only when the stored colour is one of
 * `DRAW_COLORS` - a colour from the input leaves all five swatches unlit, which
 * is the honest picture. An action is never "selected"; pressing undo does not
 * put the bar into an undoing mode.
 */
function isSelected(parsed: BarId, state: BarState): boolean {
  switch (parsed.kind) {
    case "tool":
      return parsed.tool === state.tool;
    case "symbol":
      return parsed.symbol === state.symbol;
    case "width":
      return parsed.width === state.width;
    case "color":
      return parsed.color === state.color;
    case "font":
      return parsed.fontSize === state.fontSize;
    case "fill":
      // The armed mode and nothing else: one of the three is always lit, and
      // whichever it is, the other two are not - a fill is one choice, not a
      // set of flags, which is what the two filled tools it replaced could not
      // say without also changing the tool.
      return parsed.fill === state.fill;
    case "action":
      return false;
  }
}

/**
 * The groups that keep their members behind a trigger, and where the trigger
 * comes from. Everything not named here renders as a flat row.
 *
 * `mountBar` puts each popover group's **first** button in the bar's row and
 * every button after it in the panel; the two values are only about what opens
 * the panel:
 *
 * - `"first-button"` - that first button *is* the trigger. The symbols palette:
 *   one press both selects the tool that places a mark and shows you the marks,
 *   which is what makes `➤ ▾` one control rather than two.
 * - `"own-trigger"` - `mountBar` draws a trigger of its own after the buttons.
 *   The text group needs this because `tool:text` must stay a plain tool
 *   button: pressing **T** picks the text tool, and hijacking it to open a size
 *   menu would leave the tool unreachable. The drawn trigger shows the current
 *   size, which is the whole of DRAWING.md's "font-size control".
 *
 *   The fill menu needs it for the same reason one level along (contracts
 *   §27.1): its own group holds no tool at all, and the tools it paints - the
 *   rectangle and the ellipse - are in the group before it, where they must
 *   stay **one press away**. A menu that hijacked one of those buttons would
 *   buy a control by making a shape cost two presses. Its trigger shows the
 *   armed mode the way the size trigger shows the size, so all three of them -
 *   the shape, the fill and what the fill is - are readable off the bar at
 *   once. Both differ from `"first-button"` in the same way: a press on the
 *   trigger changes nothing, it only opens the menu.
 *
 * A `Partial<Record<...>>` over `BarGroup["id"]`, so a renamed group id fails
 * to build rather than silently going flat.
 */
const POPOVER_GROUPS: Partial<Record<BarGroup["id"], "first-button" | "own-trigger">> = {
  fill: "own-trigger",
  symbols: "first-button",
  text: "own-trigger",
};

/** Marks the element that opens a panel, for `BAR_CSS`'s caret and for `onClick`. */
const TRIGGER_ATTR = "data-popover-trigger";

/**
 * The font-size control's name, wherever it is said.
 *
 * It is not a `BarButton`, so it has no `label` of its own to take one from -
 * and it is a control whose name has to explain what it is a size *of*: "16"
 * alone reads as a width, a count or a page number.
 */
const FONT_CONTROL_LABEL = "Label font size";

/**
 * The fill menu's name, on the same terms: no `BarButton`, so no label, and an
 * icon on its own says nothing at all to a screen reader. The mode's own label
 * is appended by `paint()`, verbatim, so the trigger says the sentence the
 * button in the menu says rather than a shortened version of it.
 */
const FILL_CONTROL_LABEL = "Shape fill";

/**
 * The two `"own-trigger"` controls' names, by the group each belongs to - which
 * is what a panel of theirs is called, since neither is named after its first
 * button the way the symbols palette is.
 */
const OWN_TRIGGER_LABELS: Partial<Record<BarGroup["id"], string>> = {
  text: FONT_CONTROL_LABEL,
  fill: FILL_CONTROL_LABEL,
};

/**
 * Which panel is open after a press on the bar. The whole of the panel policy.
 *
 * Pure and exported so that `.plan/design.md` §12's five rules are five
 * assertions in tests/draw-bar.test.ts rather than five branches inside a
 * closure a unit test cannot reach. `mountBar` calls it and does the DOM.
 *
 * @param open         the group id currently open, or `null`
 * @param pressedGroup the group id the press landed in, or `null` for the bar's
 *                     own chrome (the grip, the note) and for a press that hit
 *                     no group at all
 * @param isTrigger    whether the press landed on that group's popover trigger
 *
 * The rules, in order:
 *
 * 1. the open group's own trigger closes it - the only way out of a palette
 *    without picking a mark;
 * 2. any other trigger opens its own panel;
 * 3. a press **inside the open panel** keeps it open. This is the whole of the
 *    symbols fix: picking a mark is not the end of the errand, it is the errand,
 *    and closing the palette makes placing five arrows five extra presses;
 * 4. a press on another group closes what was open - that panel is now in the
 *    way of the bar;
 * 5. a press on no group changes nothing.
 *
 * What is **not** here, and is the point: a press in the *page*. Nothing that
 * happens in the page - a stroke, a `<select>`, a JS menu, a focus trap -
 * dismisses a panel.
 */
export function popoverAfterPress(
  open: string | null,
  pressedGroup: string | null,
  isTrigger: boolean,
): string | null {
  // Rule 5, and it is the only rule that answers with the panel untouched
  // whatever else is true: the grip and the note are the bar's own chrome, and a
  // press on them is not a press on a *control*.
  if (pressedGroup === null) return open;
  // Rules 1 and 2 in one line: a trigger toggles its own panel, which means it
  // also closes anybody else's.
  if (isTrigger) return pressedGroup === open ? null : pressedGroup;
  // Rules 3 and 4: inside the open group the panel stays up, and in any other
  // group it is in the way of the bar. The open group is judged by its id and
  // not by the panel's own box, which is what makes the rule say *group* rather
  // than *panel*: the text group's T button sits in the bar's row beside the
  // size trigger, and pressing it while the sizes are showing is a press on the
  // control that panel belongs to, not a press somewhere else.
  return pressedGroup === open ? open : null;
}

/**
 * One button.
 *
 * `data-active` and `aria-pressed` are deliberately not set here. `paint()`
 * owns both, and it runs before the bar is ever shown.
 */
function buttonElement(button: BarButton): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "btn";
  el.dataset.id = button.id;
  el.dataset.active = "0";
  el.title = button.label;
  el.setAttribute("aria-label", button.label);

  const content = button.icon ? iconElement(button.icon) : valueElement(button.id);
  if (content) el.append(content);
  return el;
}

/**
 * Put the bar up and hand back the three things the caller needs.
 *
 * Not unit tested, and cannot be: `tests/` is plain vitest on `environment:
 * "node"` with no DOM harness, which `CLAUDE.md` asks stay that way. `pnpm
 * compile` plus the Manual check in `.plan/tasks/11-draw-bar.md` cover it.
 */
export function mountBar(options: BarOptions): BarHandle {
  const groups = barGroups();
  const elements = new Map<string, HTMLElement>();

  const host = document.createElement("div");
  // The select-area treatment: the host takes no part in the page's layout, and
  // says so at a specificity a page's own `* { position: static !important }`
  // cannot beat. `BAR_CSS`'s `.root` is safe behind the shadow boundary; the
  // host is not, and it is not carrying LAYER_ATTR to be forced for it.
  host.style.setProperty("all", "initial", "important");
  host.style.setProperty("position", "fixed", "important");
  host.style.setProperty("z-index", String(Z_INDEX), "important");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = BAR_CSS;
  shadow.append(style);

  const root = document.createElement("div");
  root.className = "root";
  root.dataset.visible = "1";
  root.dataset.dragging = "0";
  // A named toolbar, so it arrives in the accessibility tree as one labelled
  // thing dropped over someone's page rather than two dozen loose buttons of
  // unexplained provenance, with `aria-pressed` from `paint()` saying which of
  // them is chosen.
  //
  // Deliberately *without* the roving-tabindex arrow-key navigation ARIA's
  // toolbar practice suggests: every button stays in the tab order, which is
  // what a keyboard user gets from the page's own controls. Half of that
  // pattern - one tab stop, and no arrow keys to move within it - would leave
  // most of the bar unreachable, which is worse than none of it.
  root.setAttribute("role", "toolbar");
  root.setAttribute("aria-label", "Hardcopy drawing tools");

  const grip = document.createElement("div");
  grip.className = "grip";
  grip.setAttribute("aria-hidden", "true");
  grip.append(iconElement(ICON_GRIP));

  const note = document.createElement("div");
  note.className = "note";
  note.dataset.visible = "0";
  // Feedback and errors both land here, so it is announced without being
  // focused - the hand is on the page, not on the bar. It sits inside `.root`,
  // toolbar role and all, because `BAR_CSS` positions it against the bar and
  // `.root` is the only positioned ancestor there is. `paint()` shows it before
  // it writes to it; a live region mutated while `display: none` is commonly
  // not announced.
  note.setAttribute("role", "status");

  /**
   * The panels, by group id, and the trigger that opens each.
   *
   * `openId` is the *one* panel that may be open: two menus hanging off one bar
   * is a way to hide the second one behind the first.
   *
   * `tool` is the group's own tool - the one its first button selects - or
   * `null` for a group that leads with something else. `setState` is the reader:
   * a panel whose tool has just been deselected is a stale panel.
   */
  const popovers = new Map<
    string,
    { group: HTMLElement; trigger: HTMLElement; panel: HTMLElement; tool: DrawTool | null }
  >();
  let openId: string | null = null;

  /** The font-size trigger's number, repainted by `paint()`. `null` until built. */
  let sizeLabel: HTMLElement | null = null;

  /**
   * The fill trigger's icon - the `<path>` itself, not the `<svg>` around it,
   * because `paint()` swaps one `d` attribute rather than the element.
   *
   * The trigger's box is therefore the same for all three modes, which is what
   * `rememberSize`'s cached box needs and what tabular figures buy the size
   * trigger. `null` until built.
   */
  let fillIcon: Element | null = null;

  for (const group of groups) {
    const groupEl = document.createElement("div");
    groupEl.className = "group";
    groupEl.dataset.group = group.id;
    if (group.id === "grip") groupEl.append(grip);

    // A popover group's first button stays in the row and the rest go in the
    // panel - see `POPOVER_GROUPS`. `barGroups` is flat, so this is the only
    // place the bar's three menus exist.
    const plan = POPOVER_GROUPS[group.id];
    let panel: HTMLElement | null = null;
    if (plan !== undefined) {
      groupEl.dataset.popover = "";
      groupEl.dataset.open = "0";
      panel = document.createElement("div");
      panel.className = "popover";
      // A named group rather than a `menu`: ARIA's menu roles come with
      // keyboard expectations (arrow keys, one tab stop) that this bar
      // deliberately does not implement - see `root`'s own note about the
      // roving tabindex. These are ordinary buttons that happen to be behind a
      // disclosure.
      panel.setAttribute("role", "group");
      // Named after what the panel holds, which is not the same thing in the
      // three groups: the symbols panel is the palette behind its own tool
      // button, and the other two are settings behind a control of their own -
      // the sizes behind something the T button has nothing to do with, and the
      // fill menu behind a trigger with no tool anywhere near it.
      panel.setAttribute(
        "aria-label",
        plan === "own-trigger"
          ? (OWN_TRIGGER_LABELS[group.id] ?? group.id)
          : (group.buttons[0]?.label ?? group.id),
      );
    }

    const first = group.buttons[0];
    // The group's own tool - the one its first button selects - or `null` for a
    // group that leads with something else. Read out of the id rather than
    // hardcoded per group, for the reason `paint` reads the selection out of
    // one: the grammar has a single reader. It has two readers of its own here.
    //
    // Two of the three popover groups lead with a tool (`tool:symbol`,
    // `tool:text`), which `barGroups` already calls load-bearing. The `fill`
    // menu is the group that leads with something else, and it gets `null`: no
    // backstop in `setState`, which is right - arming a fill selects no tool, so
    // there is no deselection that could make its panel stale.
    const parsedFirst = first === undefined ? null : parseBarId(first.id);
    const leadTool = parsedFirst?.kind === "tool" ? parsedFirst.tool : null;
    /**
     * Whether the group's first button stays in the bar's row rather than going
     * into the panel with the rest.
     *
     * What stays in the row is **the tool**: pressing it has to be one press
     * (`tool:text` is the reason `"own-trigger"` exists at all), and under
     * `"first-button"` it is the trigger itself, so it could not go anywhere
     * else. A group with no tool in it has nothing that must stay out - and the
     * `fill` menu is that group, three settings whose only press is a choice
     * among them.
     */
    const leadInRow = plan === "first-button" || leadTool !== null;

    group.buttons.forEach((button, index) => {
      const el = buttonElement(button);
      elements.set(button.id, el);
      (panel !== null && (index > 0 || !leadInRow) ? panel : groupEl).append(el);
    });

    if (panel !== null) {
      const existing = first === undefined ? undefined : elements.get(first.id);
      let trigger: HTMLElement | undefined = plan === "first-button" ? existing : undefined;

      if (plan === "own-trigger") {
        // Drawn here rather than returned by `barGroups`, the way the grip is:
        // it dispatches nothing (it has no `data-id`, so `pressedId` never sees
        // it) and it carries no value of its own - it shows the state's.
        //
        // Two of them, showing their state the two ways this bar has: the label
        // size as its own number, the armed fill as the icon of the mode the
        // menu has lit. `paint()` writes both, and it runs before the bar is
        // ever shown - so the `"none"` icon below is a placeholder that no
        // frame is painted with.
        //
        // The `if`/`else` below reads "fill, or else the size", and that is only
        // true while `POPOVER_GROUPS` holds exactly these two `"own-trigger"`
        // groups. `OWN_TRIGGER_LABELS` above is a `Partial<Record<BarGroup["id"],
        // …>>` so that a renamed group fails to build; this branch has no such
        // guard, so a **third** own-trigger would fall into the `else`, get a
        // `.size` div it has no number for, and overwrite `sizeLabel` - the
        // font-size trigger would then stop updating with nothing failing to say
        // so. Add its arm here before adding it there.
        const own = document.createElement("button");
        own.type = "button";
        own.className = "btn trigger";
        if (group.id === "fill") {
          const icon = iconElement(FILL_ICONS.none.icon);
          fillIcon = icon.firstElementChild;
          own.append(icon);
        } else {
          sizeLabel = document.createElement("div");
          sizeLabel.className = "size";
          own.append(sizeLabel);
        }
        groupEl.append(own);
        trigger = own;
      }

      if (trigger !== undefined) {
        trigger.setAttribute(TRIGGER_ATTR, "");
        trigger.setAttribute("aria-haspopup", "true");
        trigger.setAttribute("aria-expanded", "false");
        // The panel is kept as well as the group: `place()` measures it and
        // writes `data-place` on it, so the flip is on the thing that moves.
        popovers.set(group.id, { group: groupEl, trigger, panel, tool: leadTool });
      }
      groupEl.append(panel);
    }

    root.append(groupEl);
  }
  root.append(note);
  shadow.append(root);
  document.documentElement.append(host);

  let state: BarState = options.state;
  let position: Vec2 = { x: options.position.x, y: options.position.y };

  const viewport = (): { width: number; height: number } => ({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  /**
   * The last box the bar was seen to have. See `rememberSize`.
   *
   * `null` until it has been laid out once, which `mountBar`'s closing
   * `onResize()` does before anyone else can ask.
   */
  let lastSize: { width: number; height: number } | null = null;

  /**
   * Cache the bar's size whenever it is real, and answer with the cache when it
   * is not.
   *
   * `.root[data-visible="0"]` is `display: none`, so while the bar is hidden -
   * and `.plan/design.md` §4.3 hides it around **every** capture -
   * `getBoundingClientRect()` is 0x0. Clamping against 0x0 is not a looser
   * clamp, it is a wrong one: `clampToViewport({ x: 900 }, { width: 0 },
   * { width: 400 })` is 392, where a 300px-wide bar belongs at 92. A window
   * resized during a capture would have persisted 392 into `DrawPrefs.bar` and
   * the bar would have come back with 8px of itself on screen.
   *
   * Cached rather than guarded on visibility because the caching answer is
   * *correct* in that window instead of merely harmless: the resize is clamped
   * and persisted properly while the bar is away, with nothing deferred to a
   * `setVisible(true)` that an aborted capture might never send. The bar's
   * contents never change after mount, so the cached box is exact and not an
   * approximation - and a 0x0 box with no cache behind it means "not laid out
   * yet", which callers treat as unmeasurable rather than as zero.
   */
  const rememberSize = (box: DOMRect): { width: number; height: number } | null => {
    if (box.width > 0 && box.height > 0) lastSize = { width: box.width, height: box.height };
    return lastSize;
  };

  /** The bar's own box. A forced reflow, so it is read once per drag, not per move. */
  const measure = (): { width: number; height: number } | null =>
    rememberSize(root.getBoundingClientRect());

  const applyPosition = (): void => {
    root.style.left = `${position.x}px`;
    root.style.top = `${position.y}px`;
  };

  /**
   * The note text `place()` last measured, so it does not reflow on every press.
   */
  let placedNote: string | null = null;

  /**
   * Re-decide which side of the bar the note and any open panel hang on.
   *
   * The decision itself is `dropSide` (geometry.ts) - this is the measuring, and
   * the two heights have to be measured rather than assumed: a panel is
   * `display: none` until its group is open, and the note wraps to
   * `min(420px, 60vw)`, so neither height is knowable from here.
   *
   * Called on the five things that can change the answer - a panel opening, the
   * note's text changing, the end of a grip drag, a window resize, and the bar
   * coming back from a capture - and never on a `pointermove` or a plain
   * repaint. Each of those is one user action, so
   * the forced reflow costs a layout per press rather than per frame; the
   * `placedNote` guard is what keeps `paint()` off this path while a note is
   * merely being repainted, which `change()` does once per committed mark.
   *
   * Returns early when nothing is hanging (the common case, so a resize with the
   * bar idle measures nothing) and when the bar is `display: none` for a capture,
   * where every box is 0x0 - see `rememberSize`. A panel *and* the note may both
   * be up while the bar is away, since `setVisible(false)` closes neither, and
   * both are placed on the way back in - which is why `setVisible(true)` calls
   * this.
   */
  const place = (): void => {
    const open = openId === null ? undefined : popovers.get(openId);
    const showing = note.dataset.visible === "1";
    if (open === undefined && !showing) return;

    const box = root.getBoundingClientRect();
    if (box.height <= 0) return;
    const height = viewport().height;
    const drop = (el: HTMLElement): void => {
      // `offsetHeight` rather than a rect: it is the border box, rounded, which
      // is all `dropSide` compares - and it is 0 for anything still hidden,
      // which is not a height to place against.
      const own = el.offsetHeight;
      if (own > 0) el.dataset.place = dropSide(box, own, height);
    };
    if (showing) drop(note);
    if (open !== undefined) drop(open.panel);
  };

  const paint = (): void => {
    for (const [id, el] of elements) {
      const parsed = parseBarId(id);
      const on = parsed !== null && isSelected(parsed, state);
      el.dataset.active = on ? "1" : "0";
      // `data-active` is for BAR_CSS and nobody else; which tool, colour and
      // width is chosen has to be in the accessibility tree too, or the bar
      // reads as two dozen identical buttons with no state. Only the selecting
      // kinds get it: `aria-pressed` on undo or exit would claim they toggle.
      if (parsed !== null && parsed.kind !== "action") {
        el.setAttribute("aria-pressed", on ? "true" : "false");
      }
    }

    // The only buttons that are ever disabled. `disabled` on a real <button> is
    // exactly right here: there is nothing to explain, so swallowing the click
    // is the whole of the desired behaviour.
    elements.get("undo")?.toggleAttribute("disabled", !state.canUndo);
    elements.get("redo")?.toggleAttribute("disabled", !state.canRedo);

    // The font-size trigger is the one element on the bar that shows a value
    // rather than standing for one, which is the point of it: DRAWING.md's text
    // field is gone, so this is where you read what size the next label will
    // be. Every size in `FONT_SIZES` is two digits and `.size` sets tabular
    // figures, so the trigger's box does not change with the number in it -
    // which is what keeps `rememberSize`'s cached box exact.
    if (sizeLabel !== null) {
      sizeLabel.textContent = String(state.fontSize);
      // On the trigger and not on `.size`: the name belongs to the control, and
      // the number alone would read as a width or a count.
      const name = `${FONT_CONTROL_LABEL} - ${state.fontSize} px`;
      const trigger = popovers.get("text")?.trigger;
      trigger?.setAttribute("title", name);
      trigger?.setAttribute("aria-label", name);
    }

    // The fill trigger, the other control that shows a value rather than
    // standing for one: it is where you read what the next rectangle or ellipse
    // will be painted like, so "why is my rectangle solid?" is answered by
    // looking at the bar (`.plan/design.md` §18). One `d` attribute, so the
    // trigger's box is the same for all three modes - see `fillIcon`.
    if (fillIcon !== null) {
      const armed = FILL_ICONS[state.fill];
      fillIcon.setAttribute("d", armed.icon);
      // The mode's own label, verbatim: the trigger says the whole sentence the
      // button in the menu says - "Cover - removes text", never "Cover" - which
      // is the point of the labels being a contract (see `FILL_ICONS`).
      const name = `${FILL_CONTROL_LABEL} - ${armed.label}`;
      const trigger = popovers.get("fill")?.trigger;
      trigger?.setAttribute("title", name);
      trigger?.setAttribute("aria-label", name);
    }

    // Shown first, *then* filled. A `role="status"` region that is
    // `display: none` at the moment its text changes is commonly not announced
    // at all - it is not in the accessibility tree to have changed - and this
    // one line is the bar's only feedback channel: a save's result or failure,
    // and `FILL_NOTE` (entrypoints/annotate.ts) when Cover is armed.
    note.dataset.visible = state.note ? "1" : "0";
    note.textContent = state.note ?? "";
    // Placed on the way in, and only when the line actually changed: a note is
    // as unreachable as a panel below a bar parked at the bottom of the screen,
    // and a note two lines long does not hang off the same side as a one-line
    // one. Measured *after* the text and the visibility are set, or it would be
    // placed against the height of the previous line.
    if (state.note !== placedNote) {
      placedNote = state.note;
      if (state.note) place();
    }
  };

  /** The bar is ten groups of buttons; one delegated listener beats forty. */
  const pressedId = (target: EventTarget | null): string | null => {
    if (!(target instanceof Element)) return null;
    const el = target.closest("[data-id]");
    return el instanceof HTMLElement ? (el.dataset.id ?? null) : null;
  };

  /**
   * The two facts `popoverAfterPress` decides from: which group the press landed
   * in, and whether it landed on that group's trigger.
   *
   * Resolved from the nearest **control** - a `[data-id]` button or a trigger -
   * and not from the nearest `[data-group]`, which is the whole of the
   * contract's "`null` for the bar's own chrome". The grip lives *inside*
   * `[data-group="grip"]`, so asking the group would report a press on a drag
   * handle as a press in a group and put an open panel away: the one press on
   * the bar that is explicitly meant to change nothing. The note is outside
   * every group already, and so is a press that landed on nothing but padding.
   */
  const pressTarget = (
    target: EventTarget | null,
  ): { group: string | null; isTrigger: boolean } => {
    const none = { group: null, isTrigger: false };
    if (!(target instanceof Element)) return none;
    const control = target.closest(`[data-id], [${TRIGGER_ATTR}]`);
    if (control === null) return none;
    const groupEl = control.closest("[data-group]");
    return {
      group: groupEl instanceof HTMLElement ? (groupEl.dataset.group ?? null) : null,
      isTrigger: control.hasAttribute(TRIGGER_ATTR),
    };
  };

  /**
   * Open one panel, or `null` for none. One at a time, and the whole set is
   * rewritten each time so no group can be left holding a stale `data-open`.
   */
  const setOpen = (id: string | null): void => {
    openId = id;
    for (const [groupId, popover] of popovers) {
      const on = groupId === id;
      popover.group.dataset.open = on ? "1" : "0";
      popover.trigger.setAttribute("aria-expanded", on ? "true" : "false");
    }
    // After `data-open`, because a panel that is still `display: none` has no
    // height to place against.
    place();
  };

  const onClick = (event: MouseEvent): void => {
    // Our clicks are the bar's business. `click` is composed, so without this
    // it would leave the shadow root and reach the page's own handlers.
    event.stopPropagation();
    const id = pressedId(event.target);
    const { group, isTrigger } = pressTarget(event.target);

    // The decision is `popoverAfterPress`'s, not this closure's, and a press in
    // the *page* never gets here at all - which together are the fix.
    setOpen(popoverAfterPress(openId, group, isTrigger));

    if (id !== null && elements.has(id)) options.onPress(id);
  };

  const onPointerDown = (event: PointerEvent): void => {
    event.stopPropagation();
  };

  let grab: Vec2 | null = null;
  let dragSize: { width: number; height: number } | null = null;
  let dragPointer: number | null = null;

  /**
   * Capture phase on `window`, so a page that swallows `pointermove` on its own
   * document - a map, an editor, anything with a drag of its own - cannot
   * freeze a drag of ours in progress. `removeEventListener` has to be handed
   * the same flag, hence the shared constant.
   */
  const DRAG_LISTENER = { capture: true } as const;

  const onGripMove = (event: PointerEvent): void => {
    if (!grab || !dragSize || event.pointerId !== dragPointer) return;
    // A button released outside the window, with capture refused, arrives as
    // nothing at all: the first we hear of it is a move back over the page with
    // `buttons` already 0. Treat that as the `pointerup` we never got, or the
    // drag stays open for exactly the reason the window listeners were meant to
    // rule out.
    if (event.buttons === 0) {
      endDrag();
      options.onMove({ ...position });
      return;
    }
    event.preventDefault();
    // Clamped on every move, not just at the end: a bar that follows the
    // pointer off the edge and snaps back on release looks broken.
    position = clampToViewport(
      { x: event.clientX - grab.x, y: event.clientY - grab.y },
      dragSize,
      viewport(),
    );
    applyPosition();
  };

  const onGripUp = (event: PointerEvent): void => {
    if (!grab || event.pointerId !== dragPointer) return;
    event.preventDefault();
    endDrag();
    options.onMove({ ...position });
  };

  /**
   * Drop the drag's state and its listeners. Idempotent, and `unmount` calls it
   * too, so a bar torn down mid-drag leaves nothing on `window`.
   */
  const endDrag = (): void => {
    const wasDragging = grab !== null;
    grab = null;
    dragSize = null;
    dragPointer = null;
    root.dataset.dragging = "0";
    window.removeEventListener("pointermove", onGripMove, DRAG_LISTENER);
    window.removeEventListener("pointerup", onGripUp, DRAG_LISTENER);
    window.removeEventListener("pointercancel", onGripUp, DRAG_LISTENER);
    // The bar has moved, so a panel or a note hanging off it may belong on the
    // other side now. Once, on release, rather than per `pointermove`: that
    // handler is deliberately reflow-free (it clamps against `dragSize`), and a
    // menu changing sides under a moving bar is not something to watch. Guarded
    // so `unmount()`'s call - which is there for the listeners - measures
    // nothing on its way out.
    if (wasDragging) place();
  };

  /**
   * Start a drag, and listen for the rest of it on `window`.
   *
   * `setPointerCapture` is attempted and allowed to fail, as in
   * entrypoints/select-area.ts - but the reason failure is harmless *there*
   * does not hold here, and the moves must not be bound to the grip.
   * select-area captures on a `.root` that is `inset: 0`: its pointermove and
   * pointerup listeners cover the whole viewport with or without capture. The
   * grip is a 22x28px handle. Listeners on *it* stop firing a few pixels into
   * an uncaptured drag and the release lands on some other element entirely -
   * which left `grab` set, `data-dragging="1"`, the position never persisted,
   * and from then on a bar that moved on a mere hover, because `onGripMove`
   * only tests `grab`. On `window` the drag is capture-independent, and capture
   * is what it should always have been: a bonus that keeps the drag alive while
   * the pointer is outside the *window*, where no listener of ours can reach.
   *
   * Attached per drag rather than for the bar's lifetime, so an idle bar costs
   * the page nothing on `pointermove`. `dragPointer` pins the drag to the
   * pointer that started it: with `touch-action: none` on `.root`, a second
   * finger must not steer the bar or end the drag.
   */
  const onGripDown = (event: PointerEvent): void => {
    if (event.button !== 0 || grab) return;
    const box = root.getBoundingClientRect();
    const size = rememberSize(box);
    // Unmeasurable means not laid out yet; there is nothing to clamp a drag
    // against, and starting one would be worse than ignoring the press.
    if (!size) return;
    event.preventDefault();
    dragSize = size;
    grab = { x: event.clientX - box.left, y: event.clientY - box.top };
    dragPointer = event.pointerId;
    root.dataset.dragging = "1";
    window.addEventListener("pointermove", onGripMove, DRAG_LISTENER);
    window.addEventListener("pointerup", onGripUp, DRAG_LISTENER);
    window.addEventListener("pointercancel", onGripUp, DRAG_LISTENER);
    try {
      grip.setPointerCapture(event.pointerId);
    } catch {
      // Carry on without capture - the listeners above do not depend on it.
    }
  };

  /**
   * A window that got smaller can leave the bar outside it.
   *
   * `onMove` only fires when the clamp actually moved something: a resize is a
   * stream of events, and the caller's job is to persist the position.
   */
  const onResize = (): void => {
    const size = measure();
    // Nothing measurable yet. A clamp against 0x0 would move the bar somewhere
    // it does not belong and then persist it - see `rememberSize`.
    if (!size) return;
    const next = clampToViewport(position, size, viewport());
    if (next.x === position.x && next.y === position.y) {
      // The clamp did not have to move the bar, and the room below it still
      // changed: a window shortened from 1000px to 500px leaves a bar at y=400
      // exactly where it was and no longer has room under it for a panel. So
      // this is *before* the early return, not after it.
      place();
      return;
    }
    position = next;
    applyPosition();
    place();
    options.onMove({ ...position });
  };

  root.addEventListener("click", onClick);
  root.addEventListener("pointerdown", onPointerDown);
  // Only the press is bound to the grip. The moves and the release belong to
  // `window` - see `onGripDown`.
  grip.addEventListener("pointerdown", onGripDown);
  window.addEventListener("resize", onResize);
  // One `window` listener for the bar's lifetime, and it is that resize:
  // nothing here watches the page for presses any more. The capture-phase
  // close-on-outside-press listener that used to sit on this line is what made
  // the symbols palette unusable - the press that starts a stroke is a press
  // outside the bar - and the rule it implemented is gone rather than moved
  // (`.plan/design.md` §12). The drag's three listeners are still `window`'s,
  // but only while a drag is in flight (`onGripDown`).

  applyPosition();
  paint();
  // `BarOptions.position` arrives clamped as far as the caller could manage,
  // which is not far: the bar's width is not knowable until it exists. So it is
  // clamped once here against the real box - this is the "clamped on load" that
  // `DrawPrefs.bar` promises - and the caller is told only if it moved.
  onResize();

  return {
    setState(next: BarState): void {
      // The state-driven backstop for `popoverAfterPress`'s rule 4: a tool
      // changed from anywhere but a press on the bar must not leave a palette up
      // for a tool that is no longer selected, since nothing else can dismiss
      // one now.
      //
      // A *transition* and not a bare "is this group's tool selected", which
      // would undo rule 3 for the text group: the size panel is opened by a
      // trigger that selects no tool, so with the pencil active the first size
      // picked out of it would close the panel it was picked from - a press
      // inside a panel dismissing that panel, which is the bug this task is
      // about. So it fires only when the tool that *was* selected was this
      // group's and the next one is not.
      const openTool = openId === null ? null : (popovers.get(openId)?.tool ?? null);
      if (openTool !== null && state.tool === openTool && next.tool !== openTool) setOpen(null);
      state = next;
      paint();
    },
    closePanels(): boolean {
      const wasOpen = openId !== null;
      if (wasOpen) setOpen(null);
      return wasOpen;
    },
    setVisible(on: boolean): void {
      // An open panel is **left** open, deliberately, and this is the one place
      // that is worth spelling out: the whole host goes to `display: none`,
      // panel and all, so nothing of it reaches a capture, and the bar that
      // comes back is the bar as it was left - which is what this comment used
      // to ask for and could not have while a `window` listener was closing
      // panels behind it. A palette open across a save is a palette you were
      // working out of, not stale state.
      root.dataset.visible = on ? "1" : "0";
      // Nothing hanging off the bar is closed on the way out, and `place()`
      // measures 0x0 while the bar is hidden and returns - so every resize
      // during a capture re-clamped the bar's position (deliberately, off
      // `rememberSize`'s cache) without re-deciding which side those hang on. A
      // window shortened while the bar was away for an area capture therefore
      // brought it back parked at the bottom with the note still
      // `data-place="below"`, i.e. off screen: the exact failure `dropSide`
      // exists for, in the one path the flip left uncovered. A panel is now in
      // the same position as the note was, which is the second reason this call
      // is here. Unconditional, because the hide direction is the 0x0 early
      // return `place()` already documents.
      place();
    },
    unmount(): void {
      // `endDrag` before the host goes: a bar unmounted mid-drag (the exit
      // button is one press away from the grip) would otherwise leave its
      // pointermove and pointerup listeners on the page's `window` for good.
      endDrag();
      window.removeEventListener("resize", onResize);
      host.remove();
    },
  };
}
