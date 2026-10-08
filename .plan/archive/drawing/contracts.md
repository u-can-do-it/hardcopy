# DRAWING - contracts

Every shared seam, exactly. Workers code against this file and cannot ask.
If something here is wrong, **stop and report it** rather than working around
it.

§§1-16 were written before the code. **§17 is written after it**, and records
the exports that grew past the sections above while it was built - read it
before concluding that a `lib/draw/` export is undeclared.

House rules that apply to every signature below: `strict`, `noUnusedLocals`,
`noUnusedParameters`, `verbatimModuleSyntax` (so `import type` for types), and
`@/` for cross-module imports inside `tests/`. `lib/types.ts` stays free of
`chrome.*` references.

---

## 1. `lib/types.ts` - additions

Appended after `ImageFormat` / before `CaptureRect`. These live here rather
than in `lib/draw/model.ts` because they cross the message boundary; the
`Shape` union does not, and stays in `model.ts`.

```ts
/**
 * What the bar has selected. `symbol` is qualified by a `SymbolKind` - the
 * dropdown is seven marks behind one tool.
 */
export type DrawTool =
  | "pencil"
  | "highlighter"
  | "line"
  | "rect"
  | "ellipse"
  | "symbol"
  | "text";

/** The symbol palette. `pin` is the auto-incrementing numbered pin. */
export type SymbolKind =
  | "arrow"
  | "arrow-double"
  | "check"
  | "cross"
  | "bang"
  | "star"
  | "pin";

/**
 * Three steps, not a slider: a slider is a fiddly thing to hit on a bar
 * floating over someone's page, and nobody has ever needed 5px specifically.
 */
export type StrokeWidth = 2 | 4 | 8;

/**
 * The bar's position and the pen it was last holding.
 *
 * `chrome.storage.local`, deliberately not `sync`: one position for every
 * site, and a position synced from a 34-inch monitor onto a laptop is a bar
 * off the edge of the screen.
 */
export interface DrawPrefs {
  /** The bar's top-left in *viewport* coordinates. Clamped on load. */
  bar: { x: number; y: number };
  tool: DrawTool;
  symbol: SymbolKind;
  /** CSS colour, one of `DRAW_COLORS` or whatever the colour input returned. */
  color: string;
  width: StrokeWidth;
  /** Text tool, in CSS px. */
  fontSize: number;
}
```

## 2. `lib/messages.ts` - additions

The header comment currently says "Two channels, and they do not overlap".
It becomes three - the injected script now talks to the background too, which
is why `ANNOTATE_EXPORT` and `ANNOTATE_EXIT` are `BgRequest`s and not
`PageRequest`s:

```
popup/options   -> background        via chrome.runtime.sendMessage
injected script -> background        via chrome.runtime.sendMessage (sender.tab)
background      -> injected script   via chrome.tabs.sendMessage
```

Add `DrawPrefs` and `DrawTool` to the existing `import type { ... } from "./types"`.

### 2.1 New requests to the background

```ts
/** Turn annotate mode on or off in the active tab. From the popup. */
export interface AnnotateRequest {
  type: "ANNOTATE";
  action: "start" | "stop";
}

/**
 * Save from the bar, where the user's hand already is. Sent by the injected
 * annotate script, so the background takes the tab from `sender`, not from
 * `chrome.tabs.query` - the popup is not open and "active tab" is not a safe
 * answer here.
 */
export interface AnnotateExportRequest {
  type: "ANNOTATE_EXPORT";
  target: "pdf" | "png";
}

/** The bar's X, or Esc. Restores the page. Sent by the injected script. */
export interface AnnotateExitRequest {
  type: "ANNOTATE_EXIT";
}

export type BgRequest =
  | ExportRequest
  | StateRequest
  | CaptureRequest
  | AnnotateRequest
  | AnnotateExportRequest
  | AnnotateExitRequest;
```

### 2.2 New response

```ts
export interface AnnotateSuccess {
  ok: true;
  kind: "annotate";
  /** Whether annotate mode is running in the tab now. */
  active: boolean;
  /** The pre-processing pass annotate mode entered on. Absent when stopping. */
  report?: PrepReport | undefined;
  /**
   * The tools this browser may use, as `isPro()` answered at start. The bar
   * renders everything else locked and never decides entitlement itself.
   */
  tools?: readonly DrawTool[] | undefined;
}

export type BgResponse =
  | ExportSuccess
  | StateSuccess
  | CaptureSuccess
  | AnnotateSuccess
  | Failure;
```

`ErrorCode` is **unchanged**. A restricted URL is already `RESTRICTED_URL`, a
failed injection `INJECT_FAILED`, a missing debugger `CAPTURE_FAILED`, and
starting when already started is not an error (see §2.5).

### 2.3 No flag on the export requests

`ExportRequest` and `CaptureRequest` are **unchanged**. An earlier draft put a
`keepPrepared` flag on both and threaded it through all three export handlers;
that is wiring this feature does not need. `entrypoints/prepare.ts` is the
single owner of the prepared state, so it is the one place that has to know -
see §2.5, §13 and §15. Nothing in the export or capture paths changes.


### 2.4 New page requests

```ts
/**
 * Put the bar and the drawing layer up. The page is already prepared by the
 * time this arrives.
 */
export interface PageAnnotateStartRequest {
  type: "PAGE_ANNOTATE_START";
  prefs: DrawPrefs;
  /** Tools the bar may offer; the rest render locked. Decided by the background. */
  tools: readonly DrawTool[];
}

/** Take both hosts down. The background restores the page separately. */
export interface PageAnnotateStopRequest {
  type: "PAGE_ANNOTATE_STOP";
}

/**
 * Hide our own furniture around a capture.
 *
 * `false` hides the bar - it is `position: fixed`, so leaving it in would
 * repeat it on every printed sheet - and drops the layer's `pointer-events`,
 * which is what lets the region selector have the pointer. The layer stays
 * *visible*: the marks are the point.
 */
export interface PageAnnotateUiRequest {
  type: "PAGE_ANNOTATE_UI";
  visible: boolean;
}

export type PageRequest =
  | PagePrepareRequest
  | PagePingRequest
  | PageRestoreRequest
  | PageSelectAreaRequest
  | PageSelectStatusRequest
  | PageAnnotateStartRequest
  | PageAnnotateStopRequest
  | PageAnnotateUiRequest;
```

All three answer with the existing `{ ok: true; pong: true }` variant of
`PageResponse`. `PageResponse` itself does not change.

### 2.5 Two added fields, both on existing page requests

This is the whole of the cross-cutting change. `PagePrepareRequest` gains:

```ts
  /**
   * Annotate mode owns this pass and will keep it: hold it rather than undoing
   * it, and reuse it for any later `PAGE_PREPARE` until a `PAGE_RESTORE` with
   * `release` arrives.
   *
   * Drawing happens on a prepared page, and re-preparing under the marks would
   * move the content out from under every one of them - a mark below an
   * expanded section drifts by however tall that section turned out to be.
   */
  hold?: boolean | undefined;
```

`PageRestoreRequest` gains:

```ts
  /**
   * Give up a held pass and restore. Only the annotate-exit path sends this;
   * an ordinary export's `PAGE_RESTORE` is ignored while a pass is held, which
   * is what stops a popup-initiated export from tearing the drawing surface
   * out from under the user.
   */
  release?: boolean | undefined;
```

Everything else follows from those two inside `prepare.ts` (§15). No export
handler, no capture handler and no new storage need to know.


## 3. `lib/draw/model.ts`

```ts
import type { DrawTool, StrokeWidth, SymbolKind } from "../types";

export interface Vec2 { x: number; y: number }

/** One pointer sample. `pressure` is 0..1; 0.5 for a mouse. */
export interface StrokePoint extends Vec2 { pressure: number }

/** A rectangle in *document* coordinates, CSS px. Not rounded - SVG is happy with fractions. */
export interface DrawRect { x: number; y: number; width: number; height: number }

export interface ShapeBase {
  id: string;
  /** CSS colour. */
  color: string;
  width: StrokeWidth;
}

export interface StrokeShape extends ShapeBase {
  kind: "stroke";
  points: StrokePoint[];
  /** The highlighter: fat width plus `mix-blend-mode: multiply`. */
  highlight: boolean;
}
export interface LineShape extends ShapeBase { kind: "line"; from: Vec2; to: Vec2 }
export interface RectShape extends ShapeBase { kind: "rect"; rect: DrawRect }
export interface EllipseShape extends ShapeBase { kind: "ellipse"; rect: DrawRect }
export interface SymbolShape extends ShapeBase {
  kind: "symbol";
  symbol: SymbolKind;
  rect: DrawRect;
  /** 1, 2, 3... for `symbol: "pin"`; absent for every other symbol. */
  index?: number;
}
export interface TextShape extends ShapeBase {
  kind: "text";
  at: Vec2;
  text: string;
  /** CSS px. */
  fontSize: number;
}

export type Shape =
  | StrokeShape
  | LineShape
  | RectShape
  | EllipseShape
  | SymbolShape
  | TextShape;

/** Red, amber, green, blue, near-black. Five is enough; the sixth is the colour input. */
export const DRAW_COLORS: readonly string[];   // exactly 5 entries
export const DRAW_WIDTHS: readonly StrokeWidth[];  // [2, 4, 8]

/** The highlighter is the pencil at this multiple of the selected width. */
export const HIGHLIGHT_WIDTH_SCALE: number;

/** Free tier: the plain marks. See .plan/design.md §3. */
export const DRAW_FREE_TOOLS: readonly DrawTool[];
  // ["pencil", "highlighter", "line", "rect", "ellipse"]
export const DRAW_ALL_TOOLS: readonly DrawTool[];
  // free, then "symbol", "text"

/** The tool set a browser may use. The background's only entitlement call. */
export function toolsFor(pro: boolean): readonly DrawTool[];

export function isToolAllowed(tool: DrawTool, tools: readonly DrawTool[]): boolean;

/** Monotonic within one annotate session; only has to be unique in the layer. */
export function shapeId(seq: number): string;

/** 1 + however many pins are already down. */
export function nextPinIndex(shapes: readonly Shape[]): number;

/**
 * A click that made nothing: a zero-length line, a rect with no area, an empty
 * label, a stroke of one sample from a stray click. Discarded rather than
 * pushed onto the history, so undo never appears to do nothing.
 */
export function isDegenerate(shape: Shape): boolean;
```

`isDegenerate` thresholds: a `line` shorter than `MIN_SHAPE_PX`, a `rect` or
`ellipse` whose width **or** height is under `MIN_SHAPE_PX`, a `symbol` under
`MIN_SHAPE_PX` in either axis, a `text` whose `text.trim()` is empty, a
`stroke` with fewer than 2 points **that also** spans under `MIN_SHAPE_PX`
(a deliberate dot is a legitimate mark). Export `MIN_SHAPE_PX: number` (4).

## 4. `lib/draw/geometry.ts`

```ts
import type { DrawRect, Vec2 } from "./model";

/** Shift snaps a line to this many degrees. */
export const SNAP_STEP_DEG: number;   // 15
/** How close the bar may sit to a viewport edge. */
export const BAR_MARGIN_PX: number;   // 8

/** Viewport -> document, with the *current* scroll. Called per pointer event. */
export function toDocument(client: Vec2, scroll: Vec2): Vec2;

/**
 * What `left`/`top` put an appended host at document (0, 0).
 *
 * `position: absolute` resolves against the nearest positioned ancestor, and a
 * page is free to put `position: relative` plus a margin on `html`. So the
 * host is appended at 0,0, measured once, and corrected by this.
 *
 * @param hostRect - the host's own `getBoundingClientRect()` x/y
 * @param scroll   - `{ x: scrollX, y: scrollY }` at the time of measurement
 */
export function anchorCorrection(hostRect: Vec2, scroll: Vec2): Vec2;

/** Normalise a drag in any direction. No rounding. */
export function normalizeRect(a: Vec2, b: Vec2): DrawRect;

/** Shift on a rect/ellipse: the corner that makes it square, sign preserved. */
export function constrainSquare(from: Vec2, to: Vec2): Vec2;

/** Shift on a line: the end point snapped to the nearest `step` degrees, length kept. */
export function snapAngle(from: Vec2, to: Vec2, step?: number): Vec2;

/** The two barb points of an arrowhead at `to`, coming from `from`. */
export function arrowHead(from: Vec2, to: Vec2, size: number): [Vec2, Vec2];

/** Keep the bar on screen - on drag, and again on window resize. */
export function clampToViewport(
  pos: Vec2,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin?: number,
): Vec2;
```

`snapAngle` on a zero-length drag returns `to` unchanged. `clampToViewport`
with a bar wider than the viewport pins it to `margin` rather than going
negative on the right.

## 5. `lib/draw/stroke.ts`

```ts
import type { StrokePoint, Vec2 } from "./model";

/** perfect-freehand tuning. Measured by eye; change together with a look at a real pen. */
export const STROKE_OPTIONS: {
  smoothing: number;
  thinning: number;
  streamline: number;
};

/** Decimals kept in a path `d`. Two is invisible and keeps the string short. */
export const PATH_PRECISION: number;   // 2

/** A closed polygon -> one `d`. Empty outline -> "". */
export function outlineToPath(outline: readonly Vec2[]): string;

/** A single tap: a filled circle, as a `d`, so one code path renders every stroke. */
export function dotPath(at: Vec2, radius: number): string;

/**
 * Pointer samples -> the `d` of a variable-width outline. One sample (or all
 * samples at one spot) returns `dotPath`.
 */
export function strokePath(points: readonly StrokePoint[], width: number): string;
```

`perfect-freehand` is imported as `import { getStroke } from "perfect-freehand"`
and its output is fed to `outlineToPath`. `outlineToPath` and `dotPath` take no
dependency, which is where most of the test surface is.

## 6. `lib/draw/render.ts`

```ts
import type { Shape } from "./model";

export const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * One SVG element, described without a DOM.
 *
 * Nothing goes through `innerHTML`: `text` becomes `textContent` on a real
 * `<text>` node, which is both the safe way to place a string the user typed
 * and the only way it comes out of Chrome as searchable text.
 */
export interface NodeSpec {
  tag: string;
  attrs: Record<string, string>;
  text?: string;
  children?: NodeSpec[];
}

/** Pure, and the whole of the rendering logic. Fully tested. */
export function shapeToSpec(shape: Shape): NodeSpec;

/** The DOM adapter: createElementNS + setAttribute + textContent. Ten lines. */
export function specToElement(spec: NodeSpec, doc?: Document): SVGElement;
```

Per-kind output of `shapeToSpec` (attribute names exactly as written):

| kind                | tag        | required attrs                                                                            |
| ------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| `stroke`            | `path`     | `d`, `fill` = colour, `stroke` = `none`; when `highlight`, also `opacity` and `style` carrying `mix-blend-mode:multiply` |
| `line`              | `path`     | `d`, `fill` = `none`, `stroke`, `stroke-width`, `stroke-linecap` = `round`                 |
| `rect`              | `rect`     | `x`, `y`, `width`, `height`, `fill` = `none`, `stroke`, `stroke-width`                      |
| `ellipse`           | `ellipse`  | `cx`, `cy`, `rx`, `ry`, `fill` = `none`, `stroke`, `stroke-width`                          |
| `symbol`            | `g`        | delegated to `symbolSpec` (§7)                                                            |
| `text`              | `text`     | `x`, `y`, `fill`, `font-size`, `font-family`, `dominant-baseline` = `text-before-edge`; `text` = the label |

A `stroke` is a **filled outline**, not a stroked line - that is what
perfect-freehand returns and why the pen has a variable width.

## 7. `lib/draw/symbols.ts`

```ts
import type { NodeSpec } from "./render";
import type { SymbolShape } from "./model";

/** Click-to-place size, before any click-drag resize. */
export const DEFAULT_SYMBOL_SIZE_PX: number;   // 32

/** A `<g>` holding the symbol's own geometry, scaled into `shape.rect`. */
export function symbolSpec(shape: SymbolShape): NodeSpec;
```

`arrow` and `arrow-double` are drawn along the rect's diagonal (so a
click-drag aims them) using `arrowHead` from `geometry.ts`. `check`, `cross`,
`bang` and `star` are unit-square path templates scaled into the rect. `pin` is
a `circle` plus a centred `<text>` carrying `String(shape.index ?? 1)` - real
text, so a pin number is findable too.

## 8. `lib/draw/history.ts`

```ts
import type { Shape } from "./model";

/** Snapshots kept. A long session cannot grow without bound. */
export const HISTORY_LIMIT: number;   // 100

export interface DrawHistory {
  shapes(): readonly Shape[];
  push(shape: Shape): void;
  /** Returns whether anything moved. */
  undo(): boolean;
  redo(): boolean;
  /** Wipes the marks and *is undoable* - see below. */
  clear(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Bumps on every change, so the layer can skip a re-render it does not need. */
  version(): number;
}

export function createHistory(initial?: readonly Shape[]): DrawHistory;
```

A **stack of snapshots**, not of operations: shape lists are small, and it is
what makes `clear()` undoable for one line of code. Clear without undo would be
worse than freehand without undo. `push` after an `undo` drops the redo tail,
as every editor does.

## 9. `lib/draw/css.ts`

```ts
/** Marks our own nodes, so nothing else has to guess which they are. */
export const LAYER_ATTR = "data-pagepdf-draw";
/** Above every `z-index` a page can name, matching select-area.ts. */
export const Z_INDEX = 2_147_483_647;

/**
 * Injected with `injectUnconditionalCss()`, never as `media="print"`: a
 * `media="print"` sheet does not match while the Pro path emulates screen
 * media (DEVIATIONS.md Deviation 11).
 *
 * Forces `print-color-adjust: exact` on our subtree regardless of the
 * `exactColors` setting, so a user who turned that off does not get
 * washed-out marks - and forces `display`/`visibility` so a site whose print
 * stylesheet says `* { display: none }` cannot erase the annotations.
 */
export const LAYER_CSS: string;

/** Inside the bar's own closed shadow root, so the page's CSS cannot reach it. */
export const BAR_CSS: string;
```

## 10. `lib/draw/layer.ts`

```ts
import type { Shape, Vec2 } from "./model";

export interface LayerSize { width: number; height: number }

/**
 * The wrapper's inline style.
 *
 * Pure so the two load-bearing properties are covered by a test and not by a
 * comment: `position: absolute` (a `fixed` layer repaints on every printed
 * sheet - see lib/dom/hide-fixed.ts) and `overflow: clip` (a stroke dragged
 * past the bottom edge must not grow `scrollHeight` and change the paper size
 * the Pro path measures - and `clip` rather than `hidden` because `hidden`
 * would make the wrapper a scroll container, which is monolithic under the
 * older fragmentation rules and so might not break across sheets at all).
 */
export function layerBoxStyle(size: LayerSize, offset: Vec2): string;

export interface DrawLayer {
  /** Re-render every committed shape. */
  render(shapes: readonly Shape[]): void;
  /** The shape being dragged right now, updated in place; `null` clears it. */
  setLive(shape: Shape | null): void;
  /** `false` drops pointer-events so the region selector can have the pointer. */
  setInteractive(on: boolean): void;
  /** Re-measure the document and resize the wrapper. For resize and re-layout. */
  resize(): void;
  /** The surface pointer handlers attach to. */
  surface(): HTMLElement;
  unmount(): void;
}

/** Appends the host to `documentElement`, measures, corrects, returns the handle. */
export function mountLayer(): DrawLayer;
```

## 11. `lib/draw/bar.ts`

```ts
import type { DrawTool, StrokeWidth, SymbolKind } from "../types";

export type BarAction =
  | "undo" | "redo" | "clear"
  | "save-pdf" | "save-png"
  | "exit";

export interface BarButton {
  /** `tool:<DrawTool>`, `symbol:<SymbolKind>`, `width:<n>`, `color:<css>`, or a `BarAction`. */
  id: string;
  label: string;
  /** Inline SVG path data lifted from lucide (ISC). No lucide-react in here. */
  icon?: string;
  /**
   * True when the tool is Pro and this browser is not.
   *
   * A locked button renders `disabled`, carries a `title` saying it is a Pro
   * feature, and on click puts the same sentence in `BarState.note` rather
   * than activating the tool. That is the whole of the gate: nothing is
   * re-checked before printing, and if someone tricks their own page into
   * drawing a pin, they get their pin. See `design.md` §3.
   */
  locked: boolean;
}

export interface BarGroup {
  id: "grip" | "tools" | "symbols" | "text" | "width" | "color" | "history" | "save" | "exit";
  buttons: BarButton[];
}

/**
 * The bar's contents for a given tool set. Pure, and the tier gate's only
 * visible consequence - `tests/draw-bar.test.ts` asserts that a free tool set
 * locks `symbol` and `text` and unlocks nothing else by accident.
 */
export function barGroups(tools: readonly DrawTool[]): BarGroup[];

export interface BarState {
  tool: DrawTool;
  symbol: SymbolKind;
  color: string;
  width: StrokeWidth;
  canUndo: boolean;
  canRedo: boolean;
  /** A line of feedback, or a locked-tool explanation. `null` clears it. */
  note: string | null;
}

export interface BarHandle {
  setState(state: BarState): void;
  /** Hidden around a capture; it is fixed, and would repeat on every sheet. */
  setVisible(on: boolean): void;
  unmount(): void;
}

export interface BarOptions {
  tools: readonly DrawTool[];
  /** Viewport coordinates, already clamped. */
  position: { x: number; y: number };
  state: BarState;
  /** A button id from `BarButton.id`. */
  onPress(id: string): void;
  /** Fired on drag end and on resize, already clamped. Persist it. */
  onMove(position: { x: number; y: number }): void;
}

export function mountBar(options: BarOptions): BarHandle;
```

## 12. `lib/draw/prefs.ts`

```ts
import type { DrawPrefs } from "../types";

export const DRAW_PREFS_KEY = "drawPrefs";

export const DEFAULT_DRAW_PREFS: DrawPrefs;
  // bar { x: 24, y: 24 }, tool "pencil", symbol "arrow",
  // color DRAW_COLORS[0], width 4, fontSize 16

/** Validating merge, in the shape of `mergeSettings`. Never throws. */
export function mergeDrawPrefs(raw: unknown): DrawPrefs;

/** `storage.local`. Falls back to defaults when storage is unreachable. */
export function loadDrawPrefs(): Promise<DrawPrefs>;

/** Read-modify-write. Returns the prefs as they now stand. */
export function saveDrawPrefs(patch: Partial<DrawPrefs>): Promise<DrawPrefs>;
```

`mergeDrawPrefs` clamps `bar.x` / `bar.y` to finite numbers >= 0, coerces an
unknown `tool` / `symbol` to the default, `width` to the nearest member of
`DRAW_WIDTHS`, `fontSize` into 8..96, and requires `color` to be a non-empty
string.

## 13. `entrypoints/prepare.ts` - where the whole seam lives

Three changes, all inside the existing message handler. Nothing else in the
codebase needs to know that annotate mode exists.

```ts
/** Annotate mode owns the prepared pass; an export must not tear it down. */
let held = false;
```

**1. `PAGE_PREPARE` reuses a held pass** - before the existing `restore()`:

```ts
if (held && active !== null) {
  sendResponse({ ok: true, report: active.report });
  if (message.print) schedulePrint();
  return true;
}
```

Note what this covers for free: an export started from the *popup* while marks
are up reuses the pass too, without the popup or the background knowing
anything. `active !== null` is the guard that stops a stale flag causing an
unprepared export - it falls through to a normal prepare.

**2. `hold` sets the flag.** A normal, non-holding `PAGE_PREPARE` clears it.

**3. `PAGE_RESTORE` only restores when it may.** With `release: true` it clears
`held` and restores as it does today. Without it, and while `held` is true, it
answers `{ ok: true, pong: true }` and does nothing - that is what stops an
ordinary export's `finally` from pulling the page out from under the drawing.

`schedulePrint()`'s `afterprint` handler and its post-`print()` path call
`restore()` only when `held` is false. Do not weaken `Prepared.undo`'s
idempotence to achieve this.

## 14. `entrypoints/annotate.ts`

An unlisted script, like `prepare.ts` and `select-area.ts`:

```ts
export default defineUnlistedScript(() => { ... });
```

- Guards double installation with `__pagepdfAnnotateInstalled` on `window`,
  matching `__pagepdfInstalled` / `__pagepdfSelectInstalled`.
- Handles exactly `PAGE_ANNOTATE_START`, `PAGE_ANNOTATE_STOP` and
  `PAGE_ANNOTATE_UI`, and returns `false` for everything else - `prepare.js`
  and `select-area.js` listen in the same document.
- Sends `ANNOTATE_EXPORT` and `ANNOTATE_EXIT` to the background and awaits the
  reply, showing it in the bar's `note`. There is no popup open to report into.
- **Hides its own bar** around a save it started, and puts it back when the
  reply lands - the bar is `position: fixed`, so leaving it in would repeat it
  on every printed sheet.
- Listens for `beforeprint` / `afterprint` on `window` and hides the bar for
  the duration. That covers `window.print()` started from anywhere, including
  the popup, with no background involvement at all.
- Owns no logic beyond the pointer state machine: everything with a decision in
  it is in `lib/draw/`.

The built file is `annotate.js`, referenced from the background as:

```ts
/** Built by WXT from entrypoints/annotate.ts. */
const ANNOTATE_SCRIPT = "annotate.js";
```

## 15. `entrypoints/background.ts` - the seams it must honour

```ts
/** Free tier reaches this; it must never touch chrome.debugger. */
async function handleAnnotate(request: AnnotateRequest): Promise<BgResponse>;

/** From the bar. The tab comes from `sender`, never from `tabs.query`. */
async function handleAnnotateExport(
  request: AnnotateExportRequest,
  tabId: number,
): Promise<BgResponse>;

async function handleAnnotateExit(tabId: number): Promise<BgResponse>;
```

The `chrome.runtime.onMessage` listener already receives `_sender`; it is
renamed to `sender` and `sender.tab?.id` is passed through for the two
page-originated requests. A page-originated request with no `sender.tab?.id`
fails with `NO_TAB`.

**`handleAnnotate` and `handleAnnotateExit` are the only places the two new
`PAGE_PREPARE` / `PAGE_RESTORE` fields are ever set**: `hold: true` on entry,
`release: true` on exit. `handleExport`, `handleScreenExport` and
`handleCapture` keep their current signatures and their current bodies, with
one exception:

`handleCapture` and `handleScreenExport` each send a **best-effort, stateless**
`PAGE_ANNOTATE_UI` pair - `{ visible: false }` before the capture and
`{ visible: true }` in the `finally` - each wrapped in `try/catch` like the
existing `reportInPage`. When annotate mode is not running the send simply
fails and nothing happens; there is no flag to keep and nothing to get out of
step. This is what keeps the bar out of a CDP capture started from the popup.

No `chrome.tabs.onRemoved` or `onUpdated` listeners are added. Nothing is
tracked per tab. Navigation takes the marks, the injected scripts and the
`activeTab` grant with it, which is the correct outcome and needs no code.

## 16. `entrypoints/popup/` - the Draw button

`store.ts` gains:

```ts
/** Annotate mode: mark the page up, then export with the marks in it. */
export async function startAnnotate(): Promise<void>;
```

It sends `{ type: "ANNOTATE", action: "start" }`, and on success closes the
popup the way `runCapture("region")` does - drawing means clicking on the page,
which dismisses the popup either way, so it closes deliberately rather than
being dismissed mid-sentence. On failure it sets `status` to the error.

`App.tsx` gains one `Button` in the row under Export, labelled **Draw**, with
lucide's `Pencil`, `disabled={exportDisabled.value}`.

## 17. What shipped past §§1-16 - recorded after the fact

Everything below is an **addition** found by a reviewer after the section it
belongs to was already written, and none of it changes a signature declared
above. It is recorded here, and not by editing §§3-11 in place, so that the
line between "the contract the workers coded against" and "what the code
actually exports" stays visible.

**§3 `lib/draw/model.ts`** - `isFreehand(tool: DrawTool): boolean`. The pencil
and the highlighter are the two tools that sample pointer moves, and the two
that can commit a lone `pointerdown` sample; the set is pinned by
`tests/draw-model.test.ts` so a third cannot be classified as freehand without
somebody reading why that matters.

**§4 `lib/draw/geometry.ts`** - `POPOVER_GAP_PX`, `DropSide` and
`dropSide()`, where the section fixed the module at two constants and seven
functions and named no popover at all. Which side of the bar a panel opens on
is arithmetic against the viewport, so it belongs beside `clampToViewport` -
the same fact from the other end - rather than in the entrypoint.

**§5 `lib/draw/stroke.ts`** - `coord(value: number): string`, the SVG number
rounding, now a named export rather than private to the three path builders.
It moved here to kill a `render -> symbols -> render` import cycle:
`stroke.ts` is the leaf both modules already sit above.

**§6 `lib/draw/render.ts`** - `HIGHLIGHT_OPACITY: number` (0.4). The §6 table
says a highlight stroke carries an `opacity` without fixing a value, and the
value has to live somewhere pinnable - the same treatment
`HIGHLIGHT_WIDTH_SCALE` and `PATH_PRECISION` already get.

**§7 `lib/draw/symbols.ts`** - `symbolRect(from, to, shift): DrawRect`. The
symbol tool's signed rect, its Shift constraint and its click-to-place size
were arithmetic sitting untested in the entrypoint, which is what let every
deliberate horizontal or vertical drag commit as a 32px down-right arrow with
the whole suite green.

**§9 `lib/draw/css.ts`** - `LABEL_FONT_FAMILY: string`, where the section fixed
the file at two strings. Both `render.ts` (the `text` kind) and `symbols.ts` (a
pin's digits) sit above `css.ts`, so the stack lives next to the identical one
`BAR_CSS` already carried instead of being duplicated in a renderer.
Also a correction to this module's dependency direction: `css.ts` is **no
longer a leaf** - it imports `POPOVER_GAP_PX` from `geometry.ts` so the offsets
and the arithmetic that chooses between them cannot drift. The rule that
matters now runs the other way: **nothing in `geometry.ts` may import from
`css.ts`.** No cycle exists today only because that edge is one-way.

**§10 `lib/draw/layer.ts`** - `markSpec(shape: Shape): NodeSpec`. It is the
pure half of the per-mark `<svg>` restructure (one small `<svg>` per mark, never
one document-tall one - DEVIATIONS.md Deviation 16), and it is where the box maths is
tested: `tests/draw-layer.test.ts` re-derives each kind's painted extent from
what `shapeToSpec` produced and asserts the box contains it.

**§11 `lib/draw/bar.ts`** - `BarId` and `parseBarId()`, so
`entrypoints/annotate.ts` does not re-declare the button-id grammar as a third
hand-written reader; the grammar gains a sixth member, `font:<n>`, because §11
asks the `text` group for a font-size control without saying what its buttons
are called, and every other value on the bar is carried in its own id. Also
`FONT_SIZES: readonly number[]` (`[12, 16, 24, 32, 48]`) - an affordance the
bar offers rather than a rule the model keeps, which is why it is not beside
`DRAW_WIDTHS`: `mergeDrawPrefs` quantises a width to `DRAW_WIDTHS` but merely
clamps `fontSize` into 8..96.

**New module: `lib/draw/keys.ts`** - `KeyStroke`, `dropLastChar()`,
`isChord()`, `isPrintable()` and `isUndoChord()`. `.plan/tasks/16-phase2-tools.md`
said it added no new contract, and that was true until these four came out of
the entrypoint: they were §14's caret predicates, and they are pure rules that
regress silently. There is no section of §§1-16 they belong to, so this is it.
They read a `KeyboardEvent` structurally, so the module needs no `lib.dom` and
`tests/draw-keys.test.ts` needs no harness.

### The same, for the second pass (§§18-23)

Written after tasks 18-28 shipped, on the same terms as everything above: an
addition or a correction a reviewer found once the section it belongs to was
already written, recorded here rather than by editing §§18-23 in place - the one
exception being §20.4's `setState` bullet, whose *shipped* behaviour and written
behaviour had diverged far enough to mislead, so the bullet itself was corrected
and this is the note saying it was.

**§18 `lib/draw/wrap.ts`** - `TEXT_LINE_HEIGHT` is **1.4**, where §18 declared
the constant and fixed no value. It has a floor and a ceiling and 1.4 sits
between them: the floor is the *loosest* face in `LABEL_FONT_FAMILY` rather than
the average one - ascent plus descent is about 1.2 em across the stack, but Segoe
UI asks for about 1.33 em once its line gap is counted - and the ceiling is that
this is a two- or three-line annotation, so past about 1.5 the lines stop reading
as one label. `tests/draw-wrap.test.ts` pins it as that *range* (`>= 1.33`,
`<= 1.5`) and not as an equality, so what the assertion protects is the argument
in the doc comment rather than the digit. A second assertion compares
`16 * TEXT_LINE_HEIGHT` (22.4px, a one-line box at the default pen) against
`MIN_TEXT_HEIGHT_PX` with both constants imported, since the point of it is that
a freshly placed box must not begin by snapping taller than it was drawn.

**§20.4 `setState`** - it closes an open panel on a **transition**, not on the
bare test "the open group's tool is no longer selected", and the bullet in §20.4
has been reworded to say so. The bare test is §20.1 rule 3 undone by the very
press it protects: `setState` is what the entrypoint's `paint()` calls on every
pref, note and history change, and the `text` group's own trigger dispatches no
tool, so the font-size panel opens with (say) the pencil active and the first
`setState` after it opened - including the one caused by picking a size out of
it - would close it. Rule 3 outranks the phrasing, and §20.4's own rationale was
transition language already.

**§21 `lib/draw/frame.ts`** - `resizeFrame`'s postcondition does **not** cover
`"move"`, and §21 is self-inconsistent about that: it exempts `"move"` as a no-op
in one sentence and then states the minimums for every input in the next. The
no-op wins - a zone that changes nothing cannot also normalise and grow the box
it was handed - and `tests/draw-frame.test.ts` pins that reading, including for a
rect with negative extents. A private `floorOf` came with it: a `min` of 0, a
negative one or a `NaN` one cannot be honoured as given without producing the
ungrabbable box `MIN_TEXT_WIDTH_PX` exists to prevent, so the module's own
minimum stands in.

**§22 `lib/draw/layer.ts`** - `FRAME_STROKE: string` (`#c026d3`), where §22
declared `setFrame` and `frameSpec` and named no colour. The frame's ink needs a
pinnable home for the one reason no manual check can help here: **the frame never
prints**, so a collision between it and the pen can only be caught by an
assertion. `tests/draw-layer.test.ts` imports `DRAW_COLORS` and compares against
the whole palette rather than one member of it. The colour is a magenta because
the obvious alternative is the trap - the chrome blue anyone reaches for,
`#2563eb`, *is* `DRAW_COLORS[3]` to the byte, so a selection blue would give a
user drawing with the blue pen a frame in their own ink.

**§23 `lib/draw/prefs.ts`** - `clampTextWidth(v: unknown): number`, exported,
where §23 said only that `mergeDrawPrefs` validates `textWidth` with the existing
`num` helper. `textWidth` is the first pref whose write side is a free continuous
number rather than a choice off a menu - the other fields are written from five
font sizes, three widths, seven symbols - and a frame drag has no such set:
`resizeFrame`'s floor is `MIN_TEXT_WIDTH_PX` and nothing bounds its top, so a
handle pulled to 2400 CSS px is one mouse move on a wide monitor. The resize
writer in the entrypoint and the merge therefore call the same function, the
range (40..2000) has one owner, and the width this session holds and the width a
reload brings back are the same number by construction. Inlined, it would also
have put arithmetic in a file whose header promises none.

**`entrypoints/annotate.ts` - three things no section names.** Not exports, so
there is no §§18-23 entry they belong to, and each is a decision a review moved:

- **`Editor.laidOut`**, the box as `layoutText` last returned it, held beside
  `Editor.rect` and hit-tested instead of it. `.plan/design.md` §13.6 writes the
  branch as `frameZoneAt(editor.rect, at)`, which is wrong the moment a label
  reaches a second line: the frame the user sees is grown *from* `rect`, so the
  south handles would sit outside the rect being tested, the press would fall
  through to `commitEditor()` and the label would commit instead of resizing -
  negating the reason §22.2 exports `frameHandles` at all. `Editor.rect` is still
  what a drag is baselined on, which is what keeps "a box dragged tall stays
  tall" true; the two rects have separate jobs and neither can do both.
- **`FILL_NOTE` is said at session start as well as on the first press.**
  `.plan/design.md` §11.1's third term is written as "the first press of either
  tool in a session", and `DrawPrefs.tool` persists: a bar left on Filled
  rectangle starts every later visit holding it, so a press-only trigger says the
  sentence once *ever* - on the visit where the button was first pressed - and
  stays silent on every visit where the filled blocks actually get drawn. The
  session flag is set by whichever trigger fires first, so it is still exactly
  once per session.
- **`isFilledTool` and `sincePress`**, a predicate and a piece of arithmetic in a
  file whose header disclaims both. Each landed there because `lib/` was out of
  scope for the task that needed it, each is declared in the header as the named
  exception it is, and both are recorded in `BACKLOG.md` rather than left in a
  doc comment: `isFilledTool` wants a `DRAW_TOOL_FILLED` table beside
  `isFreehand` in `model.ts`, and `sincePress` wants a `deltaOf(from, to)` in
  `geometry.ts` - which would de-duplicate three call sites, since
  `constrainSquare` and `snapAngle` compute the same `dx`/`dy` in that module
  already.

### The same, for the third pass (§§24-30)

Written after tasks 30-36 shipped, on the terms above: an addition or a
correction a reviewer found once the section it belongs to was already written,
recorded here rather than by editing §§24-30 in place. Two of these are
corrections to a *sentence* in §26 whose shipped behaviour is deliberately
different, and they are the ones to read before trusting §26 verbatim.

**§26.2 the element pre-filter - "skip elements whose bounding box misses every
cover" is wrong as stated, and shipping it that way leaked.** §20 and §26.2 both
describe the cheap first pass that way. The shipped rule skips only on a box
that **exists and misses**: an empty rect means *unknown*, not *nowhere*, and
`intersects` short-circuits on an empty box, so the bare rule answers "misses
every cover" for an element with no box at all and drops its text unmeasured.
`display: contents` is the shape of it - the element generates no box while its
direct text children are laid out and painted like anyone else's - so a cover
over `<div style="display:contents">secret</div>` painted an opaque block and
left every word in the exported text layer. Falling through is safe because the
second filter is exact and reads the *text's* client rects rather than the
parent's box, and it costs one range call per text node in a boxless subtree.
`display: none` now falls through here too, harmlessly: its ranges have no
client rects either.

**§26.1 a zero-area character box is *skipped*, not "left alone".** §26.1 says
such a box "intersects nothing and is left alone", which reads as: close the run
before it and open a new one after. The shipped rule neither opens nor closes a
run there, and the difference is not cosmetic. A soft hyphen in the middle of a
covered word would otherwise put an element boundary **inside the word**, and an
inline boundary is where Chrome restarts shaping - kerning and ligatures do not
cross it - so §17.1's promise that this mechanism reflows nothing would be
broken for a boundary that buys nothing, since the characters either side of it
are covered anyway. It would also inflate `CoverHandle.runs`.

**§26 `lib/dom/cover.ts` - `SKIP_TAGS`, which the section does not name.** The
walker rejects eight subtrees for two different reasons, and only the first is a
saving. `SCRIPT`, `STYLE`, `NOSCRIPT` and `TEMPLATE` hold text that is never laid
out. `TEXTAREA`, `SELECT` and `DATALIST` hold text that is **not ours to split**:
a `<span>` inserted into a `<textarea>`'s content model is a change to the
field's value, and an `<option>`'s text is laid out by the browser's own widget
so no `Range` over it has a box. Both are caught by the field pass instead, which
is also what keeps each blanked exactly once. `IFRAME`'s children are unrendered
fallback content and its real content is another document - §21.1, the leak.

**§26.2 the mutation is all-or-nothing.** The section says `restore()` puts the
page back; it does not say what happens to a `hideTextUnder` that throws
half-way. It **undoes its own work and rethrows**, rather than returning a handle
over the partial split. The tempting alternative hands back a cover that hid
*some* of what it paints over and says nothing about it, and the capture then
goes out with part of a covered paragraph still in the text layer - the leak
§19.1 exists to prevent, in its worst form because it is silent. The measuring
half mutates nothing, so only the second half needs the guard.

**§26.2 the wrapper's `visibility` is forced with `!important`,** where the
section fixes only the property. A page's own `span { visibility: visible }` at
that weight would otherwise put the covered text back into the text layer, and
this is the one declaration that must win. Only `visibility` is forced, so
"adds no box of its own" remains a claim about the default UA style for a
`<span>` rather than a guarantee - a page-wide `span { display: block }` matches
this wrapper as it matches the page's own. Widening the reset would trade a rare
page for a certain one (`display: inline !important` is wrong inside a flex or
grid container), so the claim is qualified instead.

**`lib/dom/cover.ts` imports `./style`** (`overrideStyle`, `undoAll`, `Undo`),
which no section declares. The field pass needs the exact `style`-attribute undo
that `hide-fixed.ts` already uses; the import touches no DOM at load, so the
module still imports cleanly under vitest's `environment: "node"`, which is what
`tests/cover.test.ts` needs of it.

**`CoverHandle.runs` and `.fields` have no reader.** §26.2 says they are "for the
note line and for the §9 matrix", and both are populated correctly, but nothing
in `entrypoints/annotate.ts` shows either number - the note line says the
cross-origin limit and nothing about counts. Not dead weight (both are two lines
and the §9 rows do want them from a console), but the contract's stated consumer
does not exist, and a reader should not go looking for it.

**§27.3 the note is *cleared* when the fill is disarmed, and the fill press
closes the panel first.** Neither is in §27.3. The `else` branch clears
`session.note` because this note is about the *armed mode*: leaving the cover
sentence up over a bar just disarmed to "Not filled" would be the bar
contradicting itself. And `case "fill"` calls `closePanels()` before it writes
the note, because a `.popover` carries `z-index: 1` expressly to paint above
`.note` and the `fill` group's open panel lands inside the note's first 420px -
so the one sentence a cover's honesty rests on would be behind the menu that
armed it. Task 27 never met this: its note fired from `tool:rect-fill`, a press
in the flat `tools` group, which the panel policy closed anyway.

**§28 `applyCovers` is idempotent on `s.covers !== null`,** which is the shape
the section asks for and worth spelling out because the reason is structural
rather than defensive: a second apply over a live handle would measure a document
this pass has already split and wrapped, and drop the first handle on the floor -
half the page would stay hidden after the restore. The first bracket to fire owns
the covers; every later one is a no-op.

### The same, for the fourth pass (§31)

Written after tasks 38-40 shipped, on the terms above: an addition or a
correction found once §31 was already written, recorded here rather than by
editing §31 in place. §31.4 is itself the largest of these and is in §31 because
it changed a signature; everything below is what shipped past it.

**§31.1 `inkBox` answers four questions, and three of them are not arithmetic.**
The function is private - `coveredRuns` is the contract surface - but the rule it
holds is the whole of the inset. No inset, or a zero one, returns the box itself
and not a copy: the pre-§31.1 behaviour exactly. An inset with a **non-finite**
component returns the box itself too, and that direction is deliberate - a band
of `NaN` makes `intersects` answer `false` to every comparison, so a walker that
merely failed to measure would have turned the whole cover off and left every
covered word in the PDF. The old box over-hides, which is the direction to fail
in. A **negative** component is clamped to zero, as §31.4 requires, and the zero
test comes after the clamp so `{top: 0, bottom: -2}` gives back the same box
rather than a copy. An inset **taller than the box** keeps a 1px band at the ink
centre, clamped into the box, rather than collapsing to no height, because a
zero-height box is invisible to `intersects` and that is the under-hiding
direction.

**§31.1 the walker measures in a font it composes, not in `cs.font`.**
`canvasFont` builds the shorthand from four longhands, because
`getComputedStyle().font` may serialise to the empty string when a longhand is
not representable in it, and an unparseable value assigned to `ctx.font` is
**ignored** - it leaves the previous font in place and measures the wrong face
with nothing thrown to notice. `font-style` is narrowed to the three keywords for
the same reason (`oblique 14deg` is valid CSS and need not survive a canvas font
parser, and an angle moves no vertical metric); `font-variant` and `font-stretch`
are left out because they move widths rather than the ascent and descent this
measures. The empty string means "no font to measure" and the caller insets
nothing. It is the **element's** computed font throughout, never
`LABEL_FONT_FAMILY`.

**§31.4 the per-line grouping, and what a failed line costs.** Characters are
grouped by their box's `y` - which is what a line *is* here - with empty boxes
left out of their group rather than joined to whichever line sits at `y: 0`. One
`measureText` per group, over that group's own substring. A line whose metrics
are not finite keeps a shared `NO_INSET` and **the rest of the node is still
measured**; the insets array is always as long as `charBoxes`, because
`coveredRuns` reads it positionally. One canvas for the whole pass, made lazily
(a page with no cover allocates none), and `ctx.font` is only assigned when the
string changes, which for a paragraph is once.

**§31.2 the walk root's *own* shadow root is entered, and the section does not
say so.** §31.2 writes the rule as "for every element it walks", and the walk
root is the one node a `TreeWalker` never returns - its filter is not applied to
it and `nextNode()` starts past it. Doing only half of it was the same leak over
again, for a whole document: `hideTextUnder` walks `doc.body`, `body` is in the
spec's `attachShadow` allow-list, so a page rendered into
`document.body.attachShadow({mode: "open"})` came back `runs: 0`, `fields: 0`,
its markup byte-identical under a cover. Found by a reviewer running the module
in a browser rather than reading it. `walkRoot` therefore calls `measure` and
`enterShadow` on the root by hand before it walks.

**§31.2 `measure` takes a holder and a host, because a shadow root holds text and
is not an element.** A component may parent text straight to its root
(`shadow.textContent = "..."`), and that text is laid out, painted and printed
like anyone else's - but a `ShadowRoot` has no box to pre-filter on and no
computed style to measure a font from. The host answers both questions exactly
rather than approximately: it is the element that text is laid out in and
inherits from. `holdsText` accepts either.

**§31.2 the field pass sweeps the roots the text pass entered**, collected in
`scopes` as `enterShadow` finds them rather than at either call site, so the two
passes cannot drift. `querySelectorAll` does not cross a boundary either, and the
field pass is the *only* pass that can see what the browser paints for a control,
so a missed root there is a missed control entirely. Nothing is swept twice: a
shadow tree is not in its document's `querySelectorAll`, nor a nested root in its
parent root's.

**§31.2 there is deliberately no test for whether a root is worth entering.** A
host far from every cover costs the walk and no more, because each element inside
it meets the same two pre-filters every other element meets. A gate would be a
second rule to keep in step with the first.

**§31.3 `<foreignObject>` is subtracted from the namespace test**, which §31.3
does not mention, and it is §31.3's own bug mirrored: it sits in the SVG
namespace like every other SVG element but is the one whose children lay out as
HTML, so a bare text child of it answered "SVG" and got a `<tspan>` built in an
HTML layout context - the same node's rect went from `[10, 470, 203.11, 20.5]`
with a `<span>` to `[0, 0, 0, 0]` with a `<tspan>`. Only a **text** child needs
the clause; an element child carries its own namespace. Matched on `localName`,
not `tagName`: `localName` is the prefix-free name the namespace defines
(`foreignObject`, case-sensitive), while `tagName` is the qualified name and may
be `svg:foreignObject` on an XHTML-served page.

**§31.3 `SVG_NS` is declared in `cover.ts` rather than imported from
`render.ts`.** The two constants share a value and mean different things - one is
the namespace our marks are drawn in, the other a namespace recognised in a
stranger's page - and a W3C namespace URI cannot drift. Importing it would pull
`css`, `geometry`, `model`, `stroke`, `symbols` and `wrap` in behind it and point
`lib/dom/` at `lib/draw/`, which this module's header opens by disclaiming.

**Two things §31 does not list as limits, and both are now in the README.** A
shadow root whose **host sits inside a `SKIP_TAGS` subtree** is not entered
either - the walker rejects the subtree before it ever returns the host - which
is consistent with how the same subtree's light DOM is treated. And covering
**MathML** grows the element and `restore()` does not put it back (11.16 to 18.5
on an `<mi>`); that one predates this pass, is a §17.1 "reflows nothing"
violation rather than a limit on what a cover removes, and is filed as a bug in
`BACKLOG.md`.

---

# DRAWING, second pass - contracts

Sections 18-23 are the seams added by the second pass (`.plan/design.md`
§§11-16). Sections 1-17 above are **unchanged** and still binding - in
particular there are **no new messages and no changed payloads**, so §§2, 13,
14, 15 and 16 stand exactly as written.

Workers code against these verbatim. Do not edit this file; if a contract is
wrong, stop and report it.

## 18. `lib/draw/wrap.ts` - new

Pure, and a leaf: it imports **types only**, from `./model`. Nothing in
`lib/draw/` may import from `wrap.ts` except `render.ts` and `layer.ts`, and
`wrap.ts` may import from nothing but `./model` (types) and `./css`
(`LABEL_FONT_FAMILY`, in `createTextMeasure` only).

```ts
/**
 * How much taller than its font size a line of a label sits, as a multiple.
 *
 * Owned here rather than in model.ts because it is a *layout* number: it is
 * what `layoutText` multiplies by to decide whether a box has grown, and what
 * `render.ts` puts in each `<tspan>`'s `dy`. Those two must agree exactly or a
 * wrapped label paints outside the box it was fitted to.
 */
export const TEXT_LINE_HEIGHT: number;

/**
 * The width of a run of text at a font size, in CSS px.
 *
 * A parameter rather than a call, which is what keeps every line of wrapping
 * logic in this file pure and unit-tested: the tests pass a fake (half an em
 * per code unit), and `createTextMeasure()` is the real one.
 */
export type Measure = (text: string, fontSize: number) => number;

export interface TextLayout {
  /** One entry per rendered line. Never empty: an empty label is one empty line. */
  lines: readonly string[];
  /**
   * The box the label was laid out in. `width` is the box's, untouched;
   * `height` is `max(the box's, the lines' own height)`.
   */
  rect: DrawRect;
}

/**
 * Break `text` into rendered lines at `maxWidth`.
 *
 * `\n` is split on first, always, so a break the user typed is honoured and a
 * blank line survives as an empty entry. Each segment is then greedy-wrapped:
 * words are kept whole where they fit, and a single word wider than `maxWidth`
 * is broken between characters so a long URL cannot run off the side.
 *
 * A trailing space at a soft break is dropped from the line and kept in `text`.
 *
 * `maxWidth <= 0` or non-finite means **no soft wrapping** - one line per hard
 * segment. A degenerate box must not loop.
 *
 * Never returns an empty array: `wrapLines("", …)` is `[""]`.
 */
export function wrapLines(
  text: string,
  maxWidth: number,
  fontSize: number,
  measure: Measure,
): string[];

/**
 * `wrapLines`, plus the box grown to hold the result.
 *
 * `rect.width` is passed to `wrapLines` as `maxWidth` and comes back unchanged.
 * `rect.height` comes back as
 * `Math.max(rect.height, lines.length * fontSize * TEXT_LINE_HEIGHT)` - the
 * whole of "if the text exceeds height, automatically make the text area
 * higher", and the reason a box dragged tall stays tall.
 *
 * `x` and `y` are passed through untouched.
 */
export function layoutText(
  text: string,
  rect: DrawRect,
  fontSize: number,
  measure: Measure,
): TextLayout;

/**
 * The real `Measure`: a cached 2D canvas context with
 * `font = \`${fontSize}px ${LABEL_FONT_FAMILY}\``.
 *
 * The only function in this file that touches a document - the same split as
 * `shapeToSpec` / `specToElement` in render.ts. Called once per session and
 * then per keystroke, so the context and the last font string are both cached.
 *
 * Returns a `Measure` that answers `0` if a context cannot be had, which turns
 * wrapping off rather than throwing inside a keystroke handler.
 */
export function createTextMeasure(): Measure;
```

## 19. `lib/draw/model.ts` - changes

### 19.1 `TextShape` - `at` becomes `rect`, and gains `lines`

```ts
export interface TextShape extends ShapeBase {
  kind: "text";
  /**
   * The label's box, in document coordinates. `x`/`y` is its top-left, which
   * is what `at` already meant - the renderer sets
   * `dominant-baseline: text-before-edge` so the text starts at the top of the
   * box rather than one line-height above it.
   *
   * `width` is what the text was wrapped to. `height` is
   * `max(what the user dragged, what the lines need)` - see `layoutText`.
   */
  rect: DrawRect;
  /** The label as typed. `\n` for a hard break. The source of truth. */
  text: string;
  /**
   * The label as laid out, one entry per rendered line.
   *
   * A **layout cache**, and `layoutText` (lib/draw/wrap.ts) is its only
   * producer. Duplicating `text` is unavoidable: wrapping needs advance widths,
   * advance widths need a font, and `render.ts` is pure and runs without a
   * document. So the measuring happens once on the side of the seam that has a
   * document, and the answer travels here.
   */
  lines: readonly string[];
  /** CSS px. */
  fontSize: number;
}
```

`at: Vec2` is **removed**. Every construction site moves to `rect`.

`isDegenerate`'s `text` case is unchanged and still reads `shape.text.trim()`:
`lines` is derived, so an empty label is empty whatever it was laid out into.

### 19.2 `RectShape` and `EllipseShape` gain `fill`

```ts
export interface RectShape extends ShapeBase {
  kind: "rect";
  rect: DrawRect;
  /**
   * A translucent interior as well as an outline.
   *
   * The flag, not the colour: `render.ts` turns it into `fill: color` plus
   * `fill-opacity: FILL_OPACITY`, exactly as `StrokeShape.highlight` becomes a
   * fat width plus a blend mode. Read `.plan/design.md` §11.1 before changing
   * the opacity - a fully opaque fill is the redaction hazard this product
   * deliberately does not ship, and 0.35 is what makes it visibly not one.
   */
  fill: boolean;
}
export interface EllipseShape extends ShapeBase {
  kind: "ellipse";
  rect: DrawRect;
  /** As `RectShape.fill`. */
  fill: boolean;
}
```

Required, not optional: an unset `fill` on a shape the renderer branches on is
a mark whose appearance depends on which code path built it.

### 19.3 New constants

```ts
/**
 * The alpha of a filled shape's interior. The outline stays solid.
 *
 * Sibling of `HIGHLIGHT_OPACITY` (render.ts) and for the same reason: at full
 * alpha a dark fill over a line of text is an opaque bar that looks exactly
 * like a redaction, and the text underneath stays perfectly selectable in the
 * PDF. At 0.35 you can read through it, which is what makes it obvious that it
 * removed nothing. `.plan/design.md` §11.1 is the whole decision.
 *
 * Applied as SVG `fill-opacity`, never `opacity`, so the stroke is unaffected.
 */
export const FILL_OPACITY: number; // 0.35

/** The width a text box is created at, in CSS px. `DEFAULT_DRAW_PREFS.textWidth`. */
export const DEFAULT_TEXT_WIDTH_PX: number; // 240
```

### 19.4 `DrawTool` grows by two, and the tables that must follow

`lib/types.ts`:

```ts
export type DrawTool =
  | "pencil"
  | "highlighter"
  | "line"
  | "rect"
  | "rect-fill"
  | "ellipse"
  | "ellipse-fill"
  | "symbol"
  | "text";
```

The compiler then requires, and a reviewer must check, all four:

- `DRAW_FREE_TOOLS` (model.ts) gains `"rect-fill"` and `"ellipse-fill"`. **Both
  are free.** A filled box is not a Pro capability; the tier split is exactly
  symbols and text labels (§3, `PRO_NOTE`).
- `DRAW_TOOL_FREEHAND` (model.ts) gains both as `false`.
- `TOOL_ICONS` (bar.ts) gains both, labelled **`"Filled rectangle"`** and
  **`"Filled ellipse"`**. Never "cover", never "redact".
- `TOOL_GROUP` (bar.ts) becomes
  `["pencil", "highlighter", "line", "rect", "rect-fill", "ellipse", "ellipse-fill"]`
  - each filled tool next to the outline it fills, the way the highlighter sits
  next to the pencil.

`prefs.ts`'s `tool()` validates against `DRAW_ALL_TOOLS` and needs no change.

## 20. `lib/draw/bar.ts` - additions and one removal

### 20.1 `popoverAfterPress` - new, pure, exported

```ts
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
 * dismisses a panel. See §20.3.
 */
export function popoverAfterPress(
  open: string | null,
  pressedGroup: string | null,
  isTrigger: boolean,
): string | null;
```

### 20.2 `BarHandle.closePanels` - new member

```ts
export interface BarHandle {
  setState(state: BarState): void;
  setVisible(on: boolean): void;
  /**
   * Close an open panel. Returns whether one was open.
   *
   * The entrypoint's `Esc` handler is the caller: with the page no longer able
   * to dismiss a panel (§20.3), Esc is the keyboard's way out, and it must be
   * consumed by the panel *before* it reaches the mid-drag cancel or the exit -
   * leaving annotate mode because somebody wanted a menu shut is the
   * expensive misreading. The boolean is how the caller knows to stop.
   */
  closePanels(): boolean;
  unmount(): void;
}
```

### 20.3 Removed

- `onWindowPointerDown` and the `window` `pointerdown` listener it is on.
- `POPOVER_LISTENER`.

Both go with the rule they implemented. `mountBar` and `unmount` lose the
matching `addEventListener` / `removeEventListener` pair, and annotate mode
stops installing a capture-phase `window` listener on every page it runs on.

### 20.4 Changed

- `setVisible(false)` **no longer closes an open panel.** The whole host goes
  to `display: none`, panel included, so nothing of it reaches a capture, and
  the bar comes back as it was left. The existing `place()` call on the way
  back in still re-decides which side it hangs on. Its doc comment must be
  rewritten to say this rather than the opposite.
- `setState` closes an open panel on a **transition**: it fires only when the
  tool that *was* selected was the open group's and the next one is not. The
  state-driven backstop for rule 4, so that a tool changed from anywhere but a
  press on the bar cannot leave a stale palette up.
  It is deliberately **not** the bare test "the open group's tool is no longer
  selected", because that test breaks §20.1 rule 3. `setState` is what the
  entrypoint's `paint()` calls on every pref, note and history change, and the
  `text` group's own trigger dispatches no tool at all - so the font-size panel
  opens with, say, the pencil active. Under the bare test the first `setState`
  after it opened, *including the one caused by picking a size out of it*, would
  close the panel: a press inside a panel dismissing that panel, which is the
  bug §20 exists to fix. Rule 3 outranks this bullet's phrasing, and this
  bullet's own rationale was transition language already ("a tool *changed* from
  anywhere but a press"). Do not "fix" the shipped code back to the bare test;
  §17 records this.
- `POPOVER_GROUPS` is unchanged. `symbols` is still `"first-button"` and `text`
  is still `"own-trigger"`.

## 21. `lib/draw/frame.ts` - new

Pure. Imports types only, from `./model`. Takes any `DrawRect`, so phase 3's
select/move can reuse it rather than doing this work twice.

```ts
/** Which part of the frame a press landed on. */
export type FrameZone =
  | "move"
  | "n" | "s" | "e" | "w"
  | "ne" | "nw" | "se" | "sw";

/** The side of a square handle, in CSS px. */
export const FRAME_HANDLE_PX: number; // 10

/** The smallest a text box may be dragged, in CSS px. */
export const MIN_TEXT_WIDTH_PX: number; // 40
export const MIN_TEXT_HEIGHT_PX: number; // 20

/** The eight resize zones, in a stable order. `"move"` is not one of them. */
export const FRAME_RESIZE_ZONES: readonly FrameZone[];

/**
 * The eight handle rects, centred on the corners and edge midpoints of `rect`.
 *
 * Exported because it has **two readers** - `frameZoneAt` for the hit test and
 * `frameSpec` (lib/draw/layer.ts) for the DOM - and they must agree: the handle
 * you can see is the handle you can grab. One function, one answer.
 *
 * `rect` is normalised first, so a negative extent cannot put a handle on the
 * wrong side.
 */
export function frameHandles(
  rect: DrawRect,
): readonly { zone: FrameZone; rect: DrawRect }[];

/**
 * Which zone `at` is in, or `null` for outside the frame entirely.
 *
 * Corners beat edges, so the 10px square where a corner and an edge handle
 * overlap resizes both axes - which is what a corner is for. Anything inside
 * the box and on no handle is `"move"`, including the box's interior: a press
 * on the label you are typing moves it, it does not commit it.
 */
export function frameZoneAt(rect: DrawRect, at: Vec2): FrameZone | null;

/** `rect` translated by `delta`. No clamping - the layer clips. */
export function moveFrame(rect: DrawRect, delta: Vec2): DrawRect;

/**
 * `rect` with the edges `zone` names moved by `delta`.
 *
 * Clamped by **pinning the opposite edge**: dragging the west handle east past
 * `min.width` stops with the east edge where it was, rather than flipping the
 * box inside out and leaving the handles mirrored. `"move"` is a no-op here -
 * `moveFrame` is its function - so a caller that forgets to branch moves
 * nothing instead of resizing by a whole diagonal.
 *
 * The returned rect always has `width >= min.width` and `height >= min.height`,
 * both positive.
 */
export function resizeFrame(
  rect: DrawRect,
  zone: FrameZone,
  delta: Vec2,
  min: { width: number; height: number },
): DrawRect;
```

## 22. `lib/draw/layer.ts` - additions and one simplification

### 22.1 `DrawLayer.setFrame` - new member

```ts
export interface DrawLayer {
  render(shapes: readonly Shape[]): void;
  setLive(shape: Shape | null): void;
  /**
   * The open editor's frame, or `null` for none.
   *
   * A third container in the shadow root, after `committed` and `live`. Not in
   * `live`: that takes a `Shape`, and the frame is chrome - it is not in the
   * history, it is not a mark, and it must never reach a PDF or a screenshot.
   *
   * Two independent mechanisms keep it out of the output (`.plan/design.md`
   * §13.5), and they must not share a boolean: the editor commits before every
   * capture, which clears this; and the container is `display: none` whenever
   * the layer is not `interactive`, which covers the region selector and the
   * Pro capture on their own. A `media="print"` rule is not an option - the Pro
   * path emulates screen media (DEVIATIONS.md Deviation 11).
   */
  setFrame(rect: DrawRect | null): void;
  setInteractive(on: boolean): void;
  resize(): void;
  surface(): HTMLElement;
  unmount(): void;
}
```

### 22.2 `frameSpec` - new, pure, exported

```ts
/**
 * The frame as SVG: an `<svg>` box, a dashed `<rect>`, and one `<rect>` per
 * `frameHandles()` entry carrying `data-zone` and its own `cursor`.
 *
 * Pure and exported for the reason `markSpec` is: it is the half of the frame
 * an assertion can reach, and `tests/draw-layer.test.ts` can then check that
 * every handle in the spec is at the rect `frame.ts` puts it at.
 *
 * The box is `outwardBox(positiveBox(rect), FRAME_HANDLE_PX)` - the handles are
 * centred on the edges, so half of each hangs outside the rect.
 *
 * The handles' `data-zone` and `cursor` exist for the pointer cursor only.
 * `frameZoneAt` remains the authority on what a press hit; the elements are
 * never hit-tested.
 */
export function frameSpec(rect: DrawRect): NodeSpec;
```

### 22.3 `markBox`'s `text` case, and two constants retired

```ts
case "text":
  return outwardBox(positiveBox(shape.rect), MARK_PAD_PX);
```

`TEXT_EM_ADVANCE`, `TEXT_EM_LINE` and the doc comment explaining them are
**deleted**. They were upper bounds standing in for a measurement nothing in
this module could take; the shape now carries the box the text was actually
fitted to. `overflow: visible` on the mark's own `<svg>` still covers the
pathological glyph that spills, exactly as it did before - which is why this is
a bound retired and not a bound loosened.

## 23. `lib/draw/prefs.ts` - one new key

```ts
export const DEFAULT_DRAW_PREFS: DrawPrefs = {
  bar: { x: 24, y: 24 },
  tool: "pencil",
  symbol: "arrow",
  color: DRAW_COLORS[0],
  width: 4,
  fontSize: 16,
  textWidth: DEFAULT_TEXT_WIDTH_PX,
};
```

`lib/types.ts`:

```ts
export interface DrawPrefs {
  bar: { x: number; y: number };
  tool: DrawTool;
  symbol: SymbolKind;
  color: string;
  width: StrokeWidth;
  fontSize: number;
  /**
   * The width a new text box opens at, in CSS px - the last width the frame
   * was resized to.
   *
   * Width only, and not the height: the height is derived on every keystroke
   * (`layoutText` grows it to fit), so a stored one would be a number that
   * describes how much text was in some previous label. You size a box once for
   * a page and then keep typing into boxes that size, which is the width.
   */
  textWidth: number;
}
```

`mergeDrawPrefs` validates it with the existing `num` helper:
`num(r.textWidth, d.textWidth, MIN_TEXT_WIDTH_PX, 2000)`. **Clamped, like
`fontSize` and unlike `bar`** - a stored 4 is a width that got out of range, and
40 is the nearest thing we will draw; 2000 is past any viewport worth typing a
label across.

`saveDrawPrefs` needs no change: it spreads `patch` over `current` and only
`bar` is nested.

---

# DRAWING, third pass - contracts

Sections 24-28 are the seams added by the third pass (`.plan/design.md`
§§17-22). Everything above stands except where named here. **No new messages,
no changed payloads, no manifest change, no permission change** - §§1-2 and
§§13-16 are untouched, and nothing in this pass goes near `chrome.debugger`.

## 24. `lib/types.ts` - changes

### 24.1 `FillMode` - new

```ts
/**
 * How a rectangle or an ellipse is filled. A pen setting, not a tool.
 *
 * - `"none"` - an outline. The default, and what every rect and ellipse drawn
 *   before this existed is.
 * - `"tint"` - a translucent interior at `FILL_OPACITY`, outline still solid.
 *   A read-through block: the right mark for pointing at a region of a chart,
 *   and it does not touch the text underneath, which stays in the PDF and
 *   stays searchable.
 * - `"cover"` - a **solid** interior, no alpha, and the covered text is hidden
 *   so that it is not in the exported PDF's text layer at all
 *   (`lib/dom/cover.ts`, `.plan/design.md` §19).
 *
 * `"cover"` is the one member with a consequence outside the mark itself.
 * Read `.plan/design.md` §17 and §21 before changing anything about it - §21 is
 * the list of places it does *not* remove text, and a cross-origin iframe is a
 * genuine leak.
 */
export type FillMode = "none" | "tint" | "cover";
```

### 24.2 `DrawTool` - the two filled tools are removed again

Back to the seven members it had before task 27:

```ts
export type DrawTool =
  | "pencil"
  | "highlighter"
  | "line"
  | "rect"
  | "ellipse"
  | "symbol"
  | "text";
```

`"rect-fill"` and `"ellipse-fill"` are **gone**. The fill is `DrawPrefs.fill`
now (§24.3), which is what the user asked for: one menu common to both shapes.

The compiler then requires, and a reviewer must check:

- `DRAW_FREE_TOOLS` loses both, back to the five it had.
- `DRAW_TOOL_FREEHAND` loses both.
- `TOOL_ICONS` and `TOOL_GROUP` (bar.ts) lose both, and `ICON_RECT_FILL` /
  `ICON_ELLIPSE_FILL` go with them.
- `isFilledTool` in `entrypoints/annotate.ts` is **deleted**, not moved. There
  is no filled tool any more, so the predicate the task 27 review flagged for
  living in an entrypoint stops existing - which also retires
  `BACKLOG.md`'s `DRAW_TOOL_FILLED` item.

### 24.3 `DrawPrefs.fill` - new

```ts
export interface DrawPrefs {
  bar: { x: number; y: number };
  tool: DrawTool;
  symbol: SymbolKind;
  color: string;
  width: StrokeWidth;
  fontSize: number;
  textWidth: number;
  /**
   * The fill the next rectangle or ellipse gets. A pen setting, like the width
   * and the colour, so one menu serves both shapes.
   *
   * Persisted, so it survives a reload like the rest of the pen - which is
   * exactly why `FILL_NOTE`'s session-start branch exists (§27.3): somebody who
   * left the bar armed on `"cover"` must be told again what it does.
   */
  fill: FillMode;
}
```

## 25. `lib/draw/model.ts` - changes

### 25.1 `RectShape.fill` and `EllipseShape.fill` become `FillMode`

```ts
export interface RectShape extends ShapeBase {
  kind: "rect";
  rect: DrawRect;
  /**
   * `"none"`, `"tint"` or `"cover"` - see `FillMode` in ../types.
   *
   * Was a `boolean` in tasks 26/27; the third member is what the user asked
   * for, and a boolean cannot hold it. `"cover"` is the mode whose meaning
   * reaches outside the renderer: `entrypoints/annotate.ts` collects the rects
   * of every `"cover"` shape and hands them to `hideTextUnder` for the duration
   * of an export (`.plan/design.md` §20).
   */
  fill: FillMode;
}
export interface EllipseShape extends ShapeBase {
  kind: "ellipse";
  rect: DrawRect;
  /** As `RectShape.fill`. */
  fill: FillMode;
}
```

`FILL_OPACITY` is unchanged, at 0.35, and now applies to `"tint"` only. Its doc
comment must be updated: it currently argues that a translucent fill is what
keeps this from being a redaction that is not one, and `"cover"` is now
deliberately the opaque one *with* the text removal that makes it honest. Say
that, or the next reader will read the comment as forbidding the mode beside it.

### 25.2 `coverRects` - new

```ts
/**
 * The rects of every mark that covers, in document coordinates.
 *
 * Here rather than in the entrypoint because it is a fact about a `Shape[]`,
 * and because it is the one place that decides which kinds can cover -
 * `"cover"` on a stroke would be a mask rather than a box, and `coveredRuns`
 * takes rects (`.plan/design.md` §22).
 *
 * Normalised on the way out (`positiveBox`), so a rect dragged up and to the
 * left covers the area it visibly covers rather than nothing.
 */
export function coverRects(shapes: readonly Shape[]): DrawRect[];
```

## 26. `lib/dom/cover.ts` - new

`lib/dom/`, not `lib/draw/`: this is surgery on the user's page, in the family
of `hide-fixed.ts` and `expand.ts`. Split as every module there splits - a pure
decision a unit test can reach, and a DOM walker it cannot. `shouldHideFixed` /
`hideFixedElements` is the precedent to follow exactly.

### 26.1 The pure half

```ts
/** A box in the same coordinate space as the covers. `DOMRect`-shaped. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A half-open run of character indices, `[start, end)`. */
export type Run = readonly [start: number, end: number];

/**
 * Which characters of one text node fall under a cover.
 *
 * `charBoxes[i]` is the box of character `i`; `covers` are the cover rects. In
 * whatever one coordinate space the caller chose - the DOM half uses client
 * coordinates, because that is what `Range.getClientRects()` returns and
 * converting both sides would be two conversions to get the same answer.
 *
 * **A character is covered if its box intersects a cover at all** - not if it
 * is contained, and not by its centre. Greedy on purpose, and the asymmetry is
 * the whole argument: an extra character hidden is *invisible*, because it is
 * under an opaque block, while a character missed is a *leak* - half a glyph of
 * a password showing at the edge of the box, noticed after the file was sent.
 * For a tool whose job is removal, the safe direction is the only defensible
 * default (`.plan/design.md` §19.1).
 *
 * Adjacent and overlapping runs are merged, and runs come back in ascending
 * order, so a cover straddling two words is one run and one wrapping element.
 *
 * A zero-area character box (a collapsed space, a soft hyphen) intersects
 * nothing and is left alone; a zero-area *cover* covers nothing. Neither is an
 * error and neither throws.
 */
export function coveredRuns(
  charBoxes: readonly Box[],
  covers: readonly Box[],
): Run[];

/** Do two boxes share any area? Exported because it is the whole of the rule above. */
export function intersects(a: Box, b: Box): boolean;
```

### 26.2 The DOM half

```ts
/**
 * What one `hideTextUnder` call did, and how to put it back.
 *
 * `restore()` is not an error path - it runs on **every** use, because the
 * covers are applied around a capture and taken off after
 * (`.plan/design.md` §20), and because annotate mode restores the page on exit.
 * It must `normalize()` every parent it split, so a second pass measures the
 * same geometry as the first.
 *
 * Idempotent: a second `restore()` does nothing.
 */
export interface CoverHandle {
  restore(): void;
  /** Text runs wrapped. For the note line and for the §9 matrix. */
  runs: number;
  /** Form controls hidden whole. See `hideTextUnder`. */
  fields: number;
}

/**
 * Hide every character under `covers` so it is not in the printed text layer.
 *
 * `visibility: hidden`, never `display: none`: it preserves layout exactly, so
 * nothing reflows and every mark below the cover stays where it was drawn -
 * and hidden content is not painted, so Chrome has nothing to put in the text
 * layer for it. That last clause is the assumption the whole pass rests on and
 * the one a unit test cannot reach; `.plan/tasks/30-probe-hidden-text.md` is
 * the human check that it holds.
 *
 * `covers` are in **document** coordinates, as marks are; this converts once
 * with the current scroll and then works in client coordinates throughout,
 * because that is what `Range.getClientRects()` speaks.
 *
 * Form controls are handled separately and coarsely: an `<input>` or
 * `<textarea>` whose box intersects a cover gets `visibility: hidden` on the
 * *element*, because its value is not a text node and Chrome prints it. The
 * whole field goes - which is the right answer for a field, since a
 * half-hidden password box is not something anyone wants.
 *
 * Reaches nothing inside a cross-origin iframe, which is `.plan/design.md`
 * §21.1 and a genuine leak. Say it in the README, not only here.
 */
export function hideTextUnder(
  covers: readonly Box[],
  doc?: Document,
): CoverHandle;
```

## 27. `lib/draw/bar.ts` - the fill menu

### 27.1 A new group

`barGroups` gains a `fill` group, and `BarGroup["id"]` gains `"fill"`. Three
buttons, in this order, with these labels **verbatim** - the labels are the
honesty (`.plan/design.md` §21.3):

| id             | label                      |
| -------------- | -------------------------- |
| `fill:none`    | `"Not filled"`             |
| `fill:tint`    | `"Filled - read-through"`  |
| `fill:cover`   | `"Cover - removes text"`   |

Never "redact", never "black out". `"Cover - removes text"` says what it does
and claims nothing more.

`POPOVER_GROUPS.fill` is `"own-trigger"`, as the `text` group's size control
is: the shape tools must stay one press away, so the fill menu cannot hijack
one of their buttons. The trigger shows the armed mode, the way the font-size
trigger shows the size.

Both `"tint"` and `"cover"` are **free**. `locked` is `false` on all three; the
tier split stays exactly symbols and text labels.

### 27.2 `BarId` and `BarState`

```ts
export type BarId =
  | { kind: "tool"; tool: DrawTool }
  | { kind: "symbol"; symbol: SymbolKind }
  | { kind: "width"; width: StrokeWidth }
  | { kind: "color"; color: string }
  | { kind: "font"; fontSize: number }
  | { kind: "fill"; fill: FillMode }
  | { kind: "action"; action: BarAction };
```

`parseBarId` validates `fill:` against the three members the way it validates
`width:` against `DRAW_WIDTHS` - matched as a string, so only the exact
spelling `barGroups` writes parses.

`BarState` gains `fill: FillMode`, and `isSelected` gains its case.

### 27.3 `FILL_NOTE` becomes the cover's note, and only the cover's

`"tint"` needs no warning - it changes nothing about the text. `"cover"` needs
one, and it is a different sentence from the one task 27 shipped:

> `"Cover hides the text under it from the export. It cannot reach inside an embedded frame."`

Shown when `"cover"` is armed - on the press that arms it, and at session start
if the pen came back holding it (the branch task 27's review added, for the
same reason: the pen persists, and somebody who left it armed must be told
again). Once per session. `entrypoints/annotate.ts` owns it, as it does today.

The second sentence is §21.1, the one limit that can hurt somebody, in the
channel the bar already has.

## 28. `entrypoints/annotate.ts` - the capture brackets

No new messages. `dragShape` reads `pen.fill` for the `rect` and `ellipse`
cases; `isFilledTool` is deleted (§24.2); `case "fill"` joins `onPress`,
sets `s.pen.fill`, persists it, and calls `showLive()` so an open editor and a
live drag restyle - it is a pen setting, so it behaves like the width and the
colour.

The covers go on and off around a capture, in the three brackets that already
exist (`.plan/design.md` §20):

```
onBeforePrint            -> applyCovers()
onAfterPrint             -> releaseCovers()
PAGE_ANNOTATE_UI{false}  -> applyCovers()
PAGE_ANNOTATE_UI{true}   -> releaseCovers()
```

`applyCovers` is `hideTextUnder(coverRects(history.shapes()), document)` with
the handle held on the `Session`; `releaseCovers` calls `restore()` and drops
it. Both idempotent - the brackets overlap in every combination, exactly as the
three visibility booleans do, and for the same reason: a save from the bar is a
`window.print()` or a CDP capture happening *inside* a third thing.

`applyCovers` must run **after** `commitEditor()` in `onBeforePrint`, so a
label finished but not yet committed is a shape by the time `coverRects` reads
the history.

Held on `Session` rather than in a module variable, so `stop()` cannot leave a
page with holes in its text: `stop()` calls `releaseCovers()` before it
unmounts, beside `endFrameDrag()` and `discardEditor()`.

---

## 29. Amendment to §25.2 and §26.1 - a cover knows its shape

Raised by task 34's review, decided here rather than in a task, because it
changes a contract.

**The problem.** §26.1 gave `coveredRuns` a list of `Box`, so a covering
*ellipse* could only contribute its bounding box - about 27% larger than the
ellipse inside it. `render.ts` paints the ellipse, not the box, so every
character in the four corner lobes was hidden with **nothing painted over it**:
in the exported PDF those words are simply gone. That is not what §19.1 bought.
§19.1 pays for over-hiding with one sentence - the extra character is *under an
opaque block* - and in the corners it is not.

**The fix, and why it is not a compromise.** Test the character box against the
cover's real geometry. For an ellipse: translate to its centre, divide both
boxes by `rx` and `ry` - an axis-aligned scale, so the character box stays
axis-aligned and the ellipse becomes the unit circle - clamp the origin to the
scaled character box, and test `d² <= 1`. Eight lines, exact, and it removes the
unpainted hole **and** the over-hide at once, so it is strictly better than the
bounding box on both axes rather than a trade between them.

`<=`, not `<`: the greedy rule of §19.1 is unchanged and its reasoning stands
untouched. What changes is only *which region* is greedy about what.

### 29.1 `lib/dom/cover.ts` - `Box` gains a shape

```ts
/** A box in the same coordinate space as the covers. `DOMRect`-shaped. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Which of the two box tools drew a cover. Nothing else can cover (§22). */
export type CoverKind = "rect" | "ellipse";

/**
 * One covering mark: the box it was drawn in, and which shape fills it.
 *
 * `box` is the **painted** extent, stroke included - `coverAreas` widens it by
 * half the stroke width, because the outline paints outside the path and the
 * set of characters hidden must match the set of pixels covered.
 */
export interface Cover {
  box: Box;
  kind: CoverKind;
}

/** Do two boxes share any area? `<=`, so a shared edge counts. */
export function intersects(a: Box, b: Box): boolean;

/**
 * Does `cover` paint over any part of `box`?
 *
 * `"rect"` is `intersects`. `"ellipse"` is the same question against the
 * ellipse inscribed in `cover.box` - see §29's derivation. Exact, not a
 * bounding-box approximation, because the approximation hides text nobody
 * covered.
 *
 * Greedy in the same direction and for the same reason as §26.1's rule: a
 * character touching the region at all is covered.
 */
export function coversBox(cover: Cover, box: Box): boolean;

/**
 * Which characters of one text node fall under a cover.
 *
 * As §26.1, with `covers` now `readonly Cover[]` and the per-character test
 * `coversBox` rather than `intersects`. Everything §26.1 says about the greedy
 * rule, run merging, ordering and zero-area boxes still holds verbatim.
 */
export function coveredRuns(
  charBoxes: readonly Box[],
  covers: readonly Cover[],
): Run[];
```

### 29.2 `lib/draw/model.ts` - `coverRects` becomes `coverAreas`

```ts
/**
 * The covering marks, as painted areas, in document coordinates.
 *
 * Replaces §25.2's `coverRects`. Same job and same reasons for living here -
 * it is a fact about a `Shape[]`, and it is the one place that decides which
 * kinds can cover - but it now says *which shape* each cover is, so the hit
 * test can be exact about an ellipse (§29).
 *
 * Each box is normalised (`positiveBox`) and then widened by half the shape's
 * stroke width, because the outline paints outside the path: the characters
 * hidden must be the characters the mark actually covers, and a rect's own
 * stroke covers a sliver beyond its rect.
 */
export function coverAreas(shapes: readonly Shape[]): Cover[];
```

`lib/draw/model.ts` therefore imports `Cover` and `CoverKind` **as types** from
`../dom/cover`. That is a new edge and it is type-only, so it adds nothing to
any bundle; `cover.ts`'s pure half imports nothing, so no cycle is possible.

### 29.3 §26.2 and §28 follow

`hideTextUnder(covers: readonly Cover[], doc?: Document)`, and
`applyCovers` in the entrypoint is `hideTextUnder(coverAreas(...), document)`.
Nothing else in §26.2 or §28 changes.

---

## 30. Amendment to §26.2 - `<select>` is a field too

Raised by task 35's implementer, who found it and correctly declined to fix it
against a contract that said otherwise.

§26.2 enumerates the form controls a cover blanks as "an `<input>` or
`<textarea>`". That list is short by one. A `<select>`'s selected option label
is painted by the browser's own widget: no `Range` reaches it, so the
character walker cannot see it and the field pass does not try - **a cover over
a dropdown publishes its selected option into the PDF.**

That is a leak, not a limit. The distinction §21 draws is between places a
cover *cannot* reach - inside a cross-origin iframe, which is somebody else's
document - and places it simply was not pointed at. This is the second kind,
and it costs one word.

`FIELD_SELECTOR` is therefore **`"input, textarea, select"`**, and §26.2's
sentence reads "an `<input>`, `<textarea>` or `<select>` whose box the cover
paints over". Everything else about the field pass is unchanged: whole element,
`visibility: hidden`, counted in `CoverHandle.fields`.

The same reasoning applies to anything else that paints text no `Range` can
reach. Nothing else in HTML does today; if something turns up, it belongs here
rather than on §21's list.

---

## 31. Amendment - a character is its ink, not its font box

Three defects, found by diagnosing a user report against the shipped code on the
page that produced it. The first is the report; the other two were found on the
way and are worse in kind.

### 31.1 The reported bug: a cover edge in the leading takes the whole next line

Measured on the reported article (18px Roboto, `line-height: 26px`, 724px
column, one 224-character text node, three lines):

- a per-character `Range` box is the **font box** - ascent 17 + descent 4 = 21px
  tall - while the lines are 26px apart. So there is a **5px gap of empty
  leading** between consecutive character boxes.
- ink is smaller still: `actualBoundingBoxAscent` 13.5, descent 3.84 for glyphs
  that have one and **0.18** for those that do not.
- the drawn cover `{y: 1386, h: 52}` at the default 4px pen became
  `{y: 1384, h: 56}` through `coverAreas`' half-stroke widening. Painted top
  1384 is **3.8px below line 1's last ink** and exactly level with the bottom
  of its font box, so `intersects`' `<=` called all 83 characters of line 1
  covered, `coveredRuns` merged them with the lines below into one run, and the
  paragraph became a single hidden `<span>` - every word gone, including the
  line that sat above the block and was never painted over.

How big the trap is, swept at 0.25px: the unsafe share of the 5px gap is 1.25px
at the 2px pen, 2.25px at 4px, and **4.25px at 8px** - where there is
effectively nowhere between two lines to put an edge. The x axis is correct and
partial; this is a y-axis defect only.

**This is §29's defect again, one axis over.** §29 refused to let an ellipse's
bounding box hide text in corners it does not paint over; the font box's descent
and half-leading hide text in a band the cover does not paint over either.

**The fix: test a character's ink, not its box, and keep the rule greedy.**
Insetting to the ink and keeping `<=` is strictly better on both axes for the
same reason §29 was - it removes the over-hide without giving up any
leak-prevention, because the leading contains no ink to leak.

The *rule* stays pure and tested; the *measurement* is the walker's, like
everything else there.

```ts
/**
 * How much of a character box is empty space rather than ink, in CSS px.
 *
 * A `Range`'s box for a character is the font box - ascent plus descent for the
 * whole face, plus any half-leading the line box adds - so its top and bottom
 * edges sit in space no glyph paints in. A cover edge landing in that space
 * covers nothing and must hide nothing.
 *
 * Measured per distinct font by the walker (canvas `measureText`:
 * `fontBoundingBox*` minus `actualBoundingBox*`), not per character - so it is
 * one measurement per text node, not one per glyph.
 *
 * Zero is the honest default for a caller that cannot measure: it restores the
 * old behaviour rather than inventing a band.
 */
export interface InkInset {
  top: number;
  bottom: number;
}

/**
 * Which characters of one text node fall under a cover.
 *
 * As §26.1 and §29.1, with one added parameter. Each character box is shrunk
 * vertically by `inset` before it is tested - `y + inset.top` to
 * `y + height - inset.bottom` - so a cover edge in the leading between two
 * lines no longer grazes the neighbouring line's font box and take all of it.
 *
 * The x axis is untouched and stays greedy: a character clipped at its left or
 * right edge is covered, which §19.1's argument is exactly right about.
 *
 * A box left with no height after the inset keeps a **1px** band at its ink
 * centre rather than collapsing to nothing - an inset larger than the box means
 * the measurement is wrong, and a zero-height box is invisible to `intersects`,
 * which is the under-hiding direction. Erring towards hiding is the safe error.
 */
export function coveredRuns(
  charBoxes: readonly Box[],
  covers: readonly Cover[],
  inset?: InkInset,
): Run[];
```

### 31.2 A leak: the page's own shadow roots are never walked

`createTreeWalker` does not cross a shadow boundary, so a cover painted over
text inside a page's **open** shadow root hides nothing - the block paints and
the words stay in the PDF. Confirmed: the shadow `<p>`'s markup came back
untouched under a cover drawn directly over it.

That is the under-hiding direction - the leak the feature exists to prevent -
and §21 does not list it.

`hideTextUnder` therefore descends into open shadow roots: for every element it
walks, if `el.shadowRoot` is non-null, walk that root the same way. The field
pass does the same (`querySelectorAll` does not cross either).

A **closed** shadow root stays unreachable, and that one is a genuine limit for
§21's list - `attachShadow({mode: "closed"})` hands the page a root nothing else
can get at, the same shape of limit as a cross-origin iframe. Our own layer and
bar are closed roots hanging off `documentElement`, which is what keeps this
walk from ever reaching the marks themselves.

### 31.3 A reflow: an HTML `<span>` inserted into SVG

`doc.createElement("span")` is namespace-blind, so a cover over `<svg><text>`
wraps the glyphs in an HTML `<span>` inside the SVG namespace. Such an element
renders nothing, so the `<text>`'s rect collapses from `[40,206,214,24]` to
`[40,200,0,0]`: the glyphs **leave layout** instead of staying hidden in place,
and the rest of the label shifts. That breaks §17.1's "reflows nothing", and
whatever hid the text, it was not `visibility: hidden`.

The wrapper must be created in the parent's namespace: a `<tspan>` for SVG
content, a `<span>` otherwise. `restore()` already undoes either cleanly.

A mark's own `<text>` is never reachable - the layer is a closed shadow root -
so this is only ever the page's own SVG.

### 31.4 Amendment to §31.1 - the inset is per line, not per node

Task 38's review found that a node-wide inset barely fixes the reported case.

The inset is `fontBoundingBox* - actualBoundingBox*`, measured over the node's
whole text. So **one descender anywhere in a paragraph collapses the bottom
inset for every line in it**: `bottom` becomes about 0.16px, and a line with no
descenders - whose true ink ends 3.82px above its font box - is treated as inked
to within 0.16px of that box.

On §31.1's own geometry at the default 4px pen that leaves a ~2px window in
which a cover dragged below a line's last ink still hides the whole line:
a drawn top of 22.75 paints from 20.75, which is 3.57px below line 1's last
ink at 17.18, and line 1 goes. **That is §29's defect surviving, not the greedy
rule working** - the greedy reading only ever explained the 8px pen's sliver,
where the pen genuinely paints 4px above where it was dragged.

The reported cover clears the boundary by 0.16px - one sweep step - and on a
face whose descent metric equals its deepest glyph the bottom inset is 0 and the
report reproduces exactly.

**So measure per line.** The walker already has every character's box, and every
character on one line shares a `y`; group the characters by that `y` and measure
`actualBoundingBox*` for **that line's own substring**. One canvas measurement
per line - a handful per node, not one per glyph - and a line without descenders
then gets its full 3.82px back, so the reported cover clears by 3.8px instead of
0.16px.

`coveredRuns` therefore takes an inset **per character** rather than one for all
of them:

```ts
/**
 * The ink inset for each character, parallel to `charBoxes`.
 *
 * Per character in the signature and per *line* in practice: every character on
 * a line shares its box's `y`, so the walker measures one inset per line and
 * repeats it across that line's characters. A single inset for the whole node
 * is what §31.4 rejects - one descender collapses it for every line, including
 * the lines that have none.
 *
 * A shorter array than `charBoxes`, or `undefined`, leaves the unmatched
 * characters uninset - today's behaviour, and the honest default for a caller
 * that could not measure.
 */
export function coveredRuns(
  charBoxes: readonly Box[],
  covers: readonly Cover[],
  insets?: readonly InkInset[],
): Run[];
```

Two smaller corrections from the same review:

- **`inkBox` must clamp a negative inset component to 0.** `{top: -2}` passes the
  finite check and *grows* the box upward, hiding text the cover paints nothing
  over. Unreachable from the walker, which clamps, but `coveredRuns` is the
  exported contract surface and the pure suite is what speaks to it.
- **The claim that reproducing `[1.25, 2.25, 4.25]` validates the fixture as the
  reported page's geometry is false** and must come out of the test comment.
  Those three numbers are a function of `DRAW_WIDTHS`, the 0.25px sweep step and
  the sweep being anchored at the font-box bottom - any two-line fixture with a
  gap of 4px or more reproduces them. The fixture's constants *are* correctly
  copied from §31.1; it is only the argument for them that was wrong, and the
  sweep is still a good regression guard on "`insets` omitted behaves as before".

---

## 32. `lib/draw/backdrop.ts` - new: the preparation curtain

Entering annotate mode runs the lazy-image sweep, which scrolls the page to the
bottom and back. That ordering is load-bearing and is not changing
(`.plan/design.md` §4.2, `docs/features/DRAWING.md` §3): a mark stores a
document coordinate, so if an image above it loads *after* it is drawn, the
content slides down and the mark does not. What the sweep needs is not to be
moved - it needs to stop reading as a glitch.

So a curtain: a semi-transparent backdrop over the viewport, with a line saying
what is happening, up for the duration of the preparation and gone before the
bar appears.

It also, deliberately, **eats the pointer** while it is up. A click landing
mid-sweep would hit whatever the scroll happened to put under the cursor.

```ts
/**
 * The stylesheet, inside the curtain's own closed shadow root.
 *
 * Exported so `tests/draw-css.test.ts` can hold the one invariant that matters
 * here, which is the *opposite* of the layer's: this must be
 * `position: fixed`. It is a viewport overlay, not a document one - it covers
 * what the user is looking at while the page scrolls underneath it.
 *
 * That is safe only because it is **gone before anything is captured**: it is
 * removed when preparation finishes, which is before a single mark can be
 * drawn and long before any export. The host must therefore **not** carry
 * `LAYER_ATTR` - `LAYER_CSS` forces `display: block !important` on anything
 * that does, which would make it impossible to take down (the same trap
 * `lib/draw/bar.ts` documents for the bar).
 */
export const BACKDROP_CSS: string;

/**
 * How long preparation must run before the curtain appears, in ms.
 *
 * A page with no lazy images prepares in a few ms and never scrolls, and a
 * curtain that flashes up and away is worse than the thing it was hiding. So
 * it is shown on a timer rather than immediately, and a fast preparation
 * finishes first and shows nothing at all.
 *
 * Chosen, not measured: long enough that no instant preparation reaches it,
 * short enough that a sweep does not get going unannounced first.
 */
export const BACKDROP_DELAY_MS: number; // 180

/** What the curtain says. */
export const BACKDROP_TITLE: string; // "Preparing the page..."

/**
 * The second line, and it is the point of the whole feature.
 *
 * The scroll is not noise to be hidden - it is the page being made ready, and
 * saying so turns a glitch into an explanation. It also tells the user why it
 * is worth waiting for, which is the thing they cannot see.
 */
export const BACKDROP_NOTE: string; // "Loading images so your marks stay where you put them."

export interface BackdropHandle {
  /** Take it down. Idempotent, and safe before the delay has elapsed. */
  remove(): void;
}

/**
 * Put the curtain up after `BACKDROP_DELAY_MS`, and hand back its handle.
 *
 * Its own closed shadow root on `documentElement`, positioned inline with
 * `important` the way `entrypoints/select-area.ts` does it - a page shipping
 * `* { position: static !important }` reaches the host, though not the
 * stylesheet behind the boundary.
 *
 * `remove()` must be called from a `finally`: a preparation that throws must
 * not leave the page behind a curtain it cannot dismiss.
 */
export function showBackdrop(doc?: Document): BackdropHandle;
```

### 32.1 `entrypoints/prepare.ts` - where it goes up

The curtain belongs to **annotate mode's** preparation and not to an export's.
A popup export scrolls too, but the popup has closed by then and the user is
already watching something happen on purpose; annotate mode is the one where
the page appears to lurch for no stated reason.

`hold` is the field that distinguishes them - it is set only by annotate mode
(§2.5, task 13). **Verify that is still true rather than assuming it**, and if
some other caller has started setting `hold`, stop and report instead of
showing a curtain over an export.

Up before the prepare pass begins, down in a `finally`. No message change, no
new field, no contract beyond this section.

---

## 33. A bar icon may carry a label

The two save buttons are a document-with-an-arrow and an image-with-an-arrow,
and at 16px they read as "two save buttons" before they read as which is which.
So the icon gains lettering: `PDF` and `PNG`, inside the glyph.

### 33.1 `lib/draw/bar.ts`

```ts
export interface BarButton {
  id: string;
  label: string;
  icon?: string;
  /**
   * Two or three characters drawn *inside* the icon, at its foot.
   *
   * Not a replacement for `label` - that is the accessible name and the
   * tooltip, and it stays the sentence it is. This is the thing you can read
   * on the button without hovering it.
   *
   * It is drawn as a real `<text>` node, filled, because `BAR_CSS` strokes
   * `.icon path` at 2px and letterforms traced as stroked paths at this size
   * are a smudge - the same wall `ICON_RECT_FILL` hit in task 27 and solved a
   * different way.
   */
  iconLabel?: string;
  locked: boolean;
}
```

`iconElement(d, label?)` appends one `<text>` when a label is given, and is
otherwise byte-for-byte what it was.

**The outer glyphs stay different**, and this is the part not to get clever
about: `PDF` and `PNG` differ only in their last two letters, and at the size
this renders, `D`/`N` and `F`/`G` are nearly the same shape. The lettering
**confirms** which button this is; the `file-down` / `image-down` silhouette is
what still **distinguishes** them. Unifying the two glyphs behind a shared
rectangle because "the letters say which is which" would trade the working
differentiator for one that does not survive the render.

### 33.2 `lib/draw/css.ts`

`BAR_CSS` gains one rule for `.icon text`: filled with `currentColor`, stroke
explicitly `none` (or it inherits `.icon path`'s 2px stroke and blooms),
centred with `text-anchor: middle`, and small enough to sit inside the glyph.

`tests/draw-css.test.ts`'s two load-bearing guards are **unchanged and must keep
passing**: `LAYER_CSS` still never says `position: fixed`, and still forces
`print-color-adjust: exact`.

### 33.3 The thing a contract cannot settle

Whether three letters are legible at 16px is a question for a rendering engine,
not for this document. Task 43 draws it in a real Chromium at 16, 24, 64 and
128px and **reports what it sees** - `CLAUDE.md`'s rule, and the same method
that caught task 27's corner notches at 128px.

If it is a smudge at 16px, the honest outcome is to say so rather than ship one.
The fallback is the wider labelled button (`.btn.trigger`'s `width: auto`
pattern, as the font-size control uses), which costs bar width and was the
option not taken - reopen it rather than shipping something unreadable.

### 32.2 Amendment to §32.1 - the curtain covers every sweep, not only annotate's

§32.1 scoped the curtain to annotate mode, reasoning that a popup export's
scroll is less surprising because the popup has closed and the user is already
watching something happen on purpose.

That reasoning does not survive contact: the sweep is the same sweep, it moves
the page the same way, and a user who pressed Export and watched their article
lurch to the bottom has exactly the complaint that produced §32. The popup
closing makes it *worse*, not better - there is no longer any UI on screen
saying something is in progress.

So the curtain goes up for **any** preparation that runs the lazy-image sweep,
whichever path asked for it. `hold` stops being the trigger; the trigger is
simply that preparation is about to run with `loadLazyImages` on.

Two consequences to get right:

- **It must be down before `window.print()` is called.** The free export path is
  prepare-then-print in the same injected script, and `entrypoints/prepare.ts`
  answers the background *before* calling `print()` (the `CLAUDE.md` invariant).
  The curtain's `remove()` is in the `finally` around the preparation, which is
  ahead of both - verify that ordering rather than assuming it, because a
  curtain caught in the print dialog would be `position: fixed` chrome on every
  sheet.
- **It must be down before a CDP capture**, for the same reason. That path does
  not print, so the `finally` is the only thing standing between the curtain and
  the screenshot.

`BACKDROP_TITLE` and `BACKDROP_NOTE` stay as they are: "Preparing the page..."
and the sentence about images, both of which are as true of an export as of
annotate mode.

### 32.3 Amendments: one curtain at a time, opaque, and a line that is true everywhere

Three corrections, two from task 42's review and one from the user.

**A module-level handle, not a per-call local.** `curtain` being local to each
prepare call means nothing takes down a curtain an earlier *in-flight* pass put
up. The sweep budget is 8s and `entrypoints/background.ts` serialises nothing
per tab, so the window is seconds wide: press Draw on a long article, reopen the
popup, Export. Pass B removes B's curtain and replies, and `window.print()` -
or the Pro capture - fires with **A's curtain still in the document**, which is
`position: fixed` chrome on every printed sheet. Reproduced in Chrome.

So `showBackdrop` keeps one module-level handle and takes down whatever is
already up before putting a new one there. That is the same shape as
`mountLayer`'s `current?.unmount()` and `entrypoints/select-area.ts`'s
`cancelActive?.("restarted")`, and for the same reason: one live overlay and a
stale handle is a much better failure than two overlays, one of which nothing
can reach.

This does not fix the underlying hole - two `PAGE_PREPARE`s in flight still
double-run the pass and scramble `active`/`held`, which `BACKLOG.md` already
records. It stops that hole from putting fixed chrome into a PDF.

**Opaque.** `BACKDROP_CSS`'s background was `rgba(15, 23, 42, 0.55)`, which dims
the moving page rather than hiding it - so the thing the curtain exists to cover
is still visible through it. The user asked for opaque, and it costs nothing:
an opaque fixed overlay was measured to hide the sweep completely and change
nothing about what loads, because `IntersectionObserver` ignores occlusion. Use
a solid colour, and let the test assert the page cannot be read behind it.

**`BACKDROP_NOTE` must be true on every path it appears on.** §32.2 made the
curtain cover exports as well, and "Loading images so your marks stay where you
put them." names marks to a user who pressed Export PDF and has none.
`tests/draw-css.test.ts` already asserts that neither string may name a mode the
user might not be in; this is that rule, one word over. It becomes:

> `"Loading images so the whole page is in the export."`

True of an export and of annotate mode alike, and it still says the thing the
user cannot see - why the wait is worth it. `BACKDROP_TITLE` is unchanged.

### 33.4 Retracted - the lettering does not survive 16px

**§33 is not implemented, and should not be.** Task 43 built it exactly as
specified, rendered it, and it failed. Recorded here rather than deleted, so the
next person with the same good idea finds the measurement instead of repeating
it.

Rendered in a real Chromium through the actual `mountBar` and the actual
`BAR_CSS`, at 16 / 24 / 64 / 128px, and again rasterised at true size and
magnified without smoothing so the device-pixel grid was visible:

- **128px** - `PDF` reads, and `file-down`'s arrow runs straight through the
  `D`. Letters and strokes are the same colour with no knockout, so they
  **merge** rather than occlude.
- **64px** - `PDF` degrades to about `D?F`.
- **24px** - you can tell there is lettering; you cannot read it.
- **16px** - a grey smear across the bottom third of both glyphs. `D`/`N` and
  `F`/`G` are not similar, they are the same blob.

The control settles it. Rendered *alone* in the 24-unit box with nothing to
collide with, **font-size 12 is the first size at which three letters resolve** -
and at 12 the word is half the glyph's height and ~90% of its width; at 14+ it
overflows and clips. There is no size that is both legible and small enough to
sit inside a box that already has a down-arrow through its lower half.

**And it makes things worse, which is what decides it.** Side by side at true
16px, the bare `file-down` and `image-down` have clean, distinct silhouettes.
Lettered, the bottom half of both becomes mush and the down-arrow - the
differentiator §33.1 itself says is doing the real work - is swallowed. The
change does not merely fail to add the format; it degrades what already
distinguishes the two buttons.

The one mechanism that would rescue the collision is a background-coloured halo
under the fill (`paint-order`), which §33.2 forbids - rightly, since the
button's background changes on hover and on `data-active`, so a halo would be
the right colour only some of the time.

**Decision: the buttons stay as they are.** The bare glyphs are distinct at
16px and the tooltips carry the full sentence. §33.3's fallback - the wider
labelled button on `.btn.trigger`'s `width: auto` - remains available and
remains a ~40px cost to the bar's width; it was declined, twice, knowingly.

One error in §33.1 noted in passing, in case any of this is ever revived: it
names `ICON_RECT_FILL`, which does not exist. Task 27's filled square is
`ICON_FILL_COVER`.

### 32.4 Amendment to §32.3 - translucent after all, at 50%

§32.3 made the curtain opaque, on the user's call, because 55% dimmed the moving
page rather than hiding it. The user has since asked for translucent at **50%**,
and that is their call to make twice: it is a look, not a mechanism.

`BACKDROP_CSS`'s `.root` background is `rgba(15, 23, 42, 0.5)`.

Nothing else about the curtain changes, and nothing depends on the alpha:
occlusion is invisible to `IntersectionObserver`, so what the sweep loads is the
same either way - that was measured when the question first came up.

The test §32.3 added, which asserts the background is **not** translucent, is
wrong now and must invert: assert the alpha is present and below 1, so the page
is deliberately visible behind the curtain. Keep it an assertion about intent
rather than a change-detector on the exact value - the point is that the choice
between dimming and hiding was made deliberately and twice, not that it is
`0.5` to two decimal places.

`BACKDROP_TITLE` and `BACKDROP_NOTE` are unchanged, and so is everything in
§32.3's other two amendments (the module-level handle, and the second line being
true on an export).
