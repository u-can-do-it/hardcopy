/**
 * Annotate mode in the page: the bar, the layer, and the pointer state machine
 * that turns a drag into a mark.
 *
 * Unlisted and injected on demand, for the same reason as
 * `entrypoints/prepare.ts` and `entrypoints/select-area.ts`: a declared content
 * script needs `matches`, and `<all_urls>` would put "read and change all your
 * data on all websites" on the install prompt that §5's `host_permissions: []`
 * exists to avoid (README Deviation 3).
 *
 * **Glue only.** Every decision belongs to a `lib/draw/` module with a test
 * beside it, and this file's whole job is to call them in the right order:
 * `geometry.ts` for anything spatial, `stroke.ts` for the pen (through
 * `render.ts`), `model.ts` for what a mark is and which ones to throw away,
 * `history.ts` for undo, `symbols.ts` for the click-to-place size, `wrap.ts`
 * for where a label's lines break and how tall its box has to be, `layer.ts`
 * and `bar.ts` for the two hosts, `cursor.ts` for the pointer each tool shows,
 * `prefs.ts` for what survives a reload. One module comes from outside that
 * directory and says so in its own path: `lib/dom/cover.ts` is surgery on the
 * *user's* page rather than a fact about a mark - which characters a cover
 * hides from the export, and how to put them back afterwards
 * (`.plan/design.md` §19). Every threshold below this comment is imported
 * rather than written (`CLAUDE.md`: logic lives in `lib/`, entrypoints stay
 * thin).
 *
 * **No arithmetic and no predicates of its own**, and that is now true rather
 * than aspirational. The symbol tool's signed rect, its Shift and its
 * click-to-place size are `symbolRect` (`symbols.ts`); the text editor's three
 * keyboard classifications and its Backspace are `keys.ts`; where its lines
 * break and how tall its box has to be are `layoutText` (`wrap.ts`); which side
 * of the bar a panel opens on is `dropSide` (`geometry.ts`); which part of a
 * label's box a press landed on, and what moving or resizing does to it, are
 * `frameZoneAt` / `moveFrame` / `resizeFrame` (`frame.ts`). All of them were
 * written on this side of the seam first, and the one that mattered is why they
 * are not any more: the
 * symbol rect borrowed `isDegenerate` as its "that was a click" test, so every
 * deliberate horizontal or vertical drag committed as a small down-right arrow
 * instead - and there was nothing for a suite of 430 tests to fail on. Whatever
 * comes next belongs in a `lib/draw/` module with a test beside it.
 *
 * The one exception is named, is one line, and is declared as such:
 * `sincePress` subtracts the press point from the current one, because
 * `moveFrame` and `resizeFrame` take a `Vec2` of *movement* (contracts §21) and
 * `geometry.ts` exports no vector difference to build it with. It decides
 * nothing - it is the argument those two functions are shaped to take.
 *
 * Nothing here touches `chrome.debugger`, and nothing needs to: drawing is
 * pointer events and SVG elements, so drawing and a save through the print
 * path stay free of it (.plan/design.md §3).
 *
 * ## Two things it does differently from select-area.ts
 *
 * 1. **The wheel is not blocked.** The selector freezes scrolling for the
 *    duration of a drag because its rectangle is in viewport coordinates. A
 *    mark is in *document* coordinates, so every event is converted with the
 *    scroll as it is at that moment (`toDocument`) and a stroke can run past
 *    the fold (.plan/design.md §4.5).
 * 2. **`preventDefault()` on `pointerdown` is this file's job.** The layer host
 *    deliberately sets no `touch-action` - a whole-document `touch-action: none`
 *    would kill the touch scrolling §4.5 wants - so the layer cannot suppress
 *    the page's own default actions for us, and without this a drag also
 *    selects text and starts a native image drag.
 *
 * ## The two tools that are not a drag
 *
 * Five of the seven tools are "press, move, release". The other two are placed
 * by a *click*, and they are why `pointerdown` and `endDrag` are shaped the way
 * they are rather than carrying two more cases:
 *
 * - A **symbol** starts an ordinary drag, so it can be sized and aimed - but a
 *   click leaves `from === to`, and any rect that describes has no extent at
 *   all. `symbolRect` (lib/draw/symbols.ts) therefore asks *did the pointer
 *   move?* for itself and answers a click with a `DEFAULT_SYMBOL_SIZE_PX` box,
 *   which is why the preview and the committed mark are the same call here and
 *   why `endDrag` lets a symbol past `isDegenerate`'s per-axis discard.
 * - A **text** label has no drag preview at all, so it never starts one. The
 *   click opens an `Editor`, `onKeyDown` types into it, and Esc, Ctrl/Cmd+Enter
 *   or the next click commits it. Plain `Enter` is a newline (§13.7).
 *
 * The editor is drawn by `setLive()` - it is the `TextShape` itself, at the
 * colour, size and position it will print at, wrapped into the box the click
 * placed, plus a `CARET_GLYPH` that exists only in the preview. So there is
 * **no `contenteditable` anywhere**: nothing of the page's CSS or its key
 * handlers can reach the label being typed, the committed mark is a `<text>`
 * node like every other one, and the thing you typed into is the thing that
 * prints.
 *
 * Its box is drawn by `setFrame()`, and that is **chrome, not a mark**: it is
 * in neither the history nor the live element, and it must never reach a PDF or
 * a screenshot. Two independent mechanisms keep it out (.plan/design.md §13.5):
 * `commitEditor` / `discardEditor` clear it, and every path that captures commits
 * the editor first; and `layer.ts` gives its container `display: none` whenever
 * the layer is not interactive.
 *
 * That box is also draggable, which is the file's **third pointer state**:
 * `frameDrag`, beside `drag` and `editor`. Not a fourth `DragTool` - a frame
 * drag draws nothing and pushes nothing onto the history - so the invariant
 * that a `Drag` and an editor are never both live is untouched by it. One
 * branch in `onPointerDown` is the whole of the feature, and it goes *before*
 * the `commitEditor()` that "click away to commit" relies on: a press on the
 * frame is not a click away (.plan/design.md §13.6).
 *
 * The three `PAGE_ANNOTATE_*` types are the only messages it answers.
 * `prepare.js` and `select-area.js` listen in this same document and each
 * returns `false` for what it does not own, so the sets must stay disjoint
 * (.plan/design.md §9.6).
 *
 * Not unit tested, and cannot be: `tests/` is plain vitest with no DOM harness,
 * which `CLAUDE.md` asks stay that way. `pnpm compile` plus the Manual checks in
 * `.plan/tasks/12-annotate-entrypoint.md` and
 * `.plan/tasks/16-phase2-tools.md` cover it - and the one in task 16 is the
 * only thing that can tell you an arrow points where it was dragged.
 */

import { hideTextUnder, type CoverHandle } from "@/lib/dom/cover";
import { mountBar, parseBarId, type BarAction, type BarHandle, type BarState } from "@/lib/draw/bar";
import {
  frameZoneAt,
  moveFrame,
  resizeFrame,
  MIN_TEXT_HEIGHT_PX,
  MIN_TEXT_WIDTH_PX,
  type FrameZone,
} from "@/lib/draw/frame";
import { toolCursor } from "@/lib/draw/cursor";
import { constrainSquare, normalizeRect, snapAngle, toDocument } from "@/lib/draw/geometry";
import { createHistory, type DrawHistory } from "@/lib/draw/history";
import { dropLastChar, isChord, isPrintable, isUndoChord } from "@/lib/draw/keys";
import { mountLayer, type DrawLayer } from "@/lib/draw/layer";
import {
  coverAreas,
  isDegenerate,
  isFreehand,
  nextPinIndex,
  shapeId,
  type DrawRect,
  type Shape,
  type StrokePoint,
  type TextShape,
  type Vec2,
} from "@/lib/draw/model";
import { clampTextWidth, saveDrawPrefs } from "@/lib/draw/prefs";
import { symbolRect } from "@/lib/draw/symbols";
import { createTextMeasure, layoutText, type Measure } from "@/lib/draw/wrap";
import {
  fail,
  type AnnotateExportRequest,
  type BgRequest,
  type BgResponse,
  type PageAnnotateStartRequest,
  type PageRequest,
  type PageResponse,
} from "@/lib/messages";
import type { DrawPrefs, DrawTool, SymbolKind } from "@/lib/types";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";

/** Injection is idempotent - re-running must not stack message listeners. */
interface AnnotateWindow extends Window {
  __pagepdfAnnotateInstalled?: boolean;
}

/**
 * Capture phase on `window`, for the reason `bar.ts` gives its grip drag: a
 * page that swallows `pointermove` on its own document - a map, an editor,
 * anything with a drag of its own - must not be able to freeze a stroke of ours
 * mid-way. `removeEventListener` has to be handed the same flag, hence the
 * shared constants.
 */
const DRAG_LISTENER = { capture: true } as const;

/**
 * Also capture phase, and for a second reason on top of that one: Ctrl+Z on a
 * page with its own undo (a webmail composer, a wiki editor) must reach us and
 * stop there, or one keypress undoes a mark *and* a paragraph.
 */
const KEY_LISTENER = { capture: true } as const;

/**
 * The floor a frame drag may ask for, packed once for `resizeFrame`.
 *
 * Both numbers are `lib/draw/frame.ts`'s and are imported rather than written
 * (`CLAUDE.md`: every threshold in this file comes from `lib/`). This is only
 * the shape `resizeFrame`'s `min` parameter takes, hoisted out of the pointer
 * handler so it is not rebuilt per event.
 *
 * It is a limit on what a *drag* may ask for and not on the rendered label:
 * `layoutText` still grows the height past it whenever the text needs the room
 * (see `Editor.rect`).
 */
const FRAME_MIN = { width: MIN_TEXT_WIDTH_PX, height: MIN_TEXT_HEIGHT_PX } as const;

/**
 * How long after the last `resize` event the layer is measured once more.
 *
 * `layer.resize()` collapses the box, reads `documentElement.scrollWidth` /
 * `scrollHeight` and then `getBoundingClientRect()`, and re-applies the box -
 * two synchronous layouts of a document-sized host, and a dragged window edge
 * fires `resize` at about the frame rate. So the handler measures on the
 * *first* event of a burst, because the layer must not lag the document's
 * extent, drops the ones in between, and measures once more this long after
 * the last of them. 150ms is past the gap between two frames of a drag by a
 * wide margin, so a whole drag costs two measurements rather than a hundred,
 * and is short enough that the settling pass is not something you can watch
 * happen.
 *
 * A constant about this file's own event handling, not about drawing - nothing
 * in `lib/draw/` has an opinion on it, so it stays here (`CLAUDE.md`).
 */
const RESIZE_SETTLE_MS = 150;

/**
 * The text cursor, appended to the label being typed and to nothing else.
 *
 * The caret has no element of its own - it *is* the `TextShape` the label will
 * become, previewed through `setLive()` - so an empty editor would be an empty
 * `<text>` node, which paints nothing at all: click with the T tool and the
 * page would look like the click had missed. One glyph fixes that, and because
 * it lives in `editorShape`'s preview branch and not in `Editor.text`, it
 * cannot reach the committed mark or the exported PDF.
 *
 * It is appended **before the wrap**, so it travels with the word it is sitting
 * on: a cursor at the end of a line that is one character from full wraps onto
 * the next line with that word, rather than being painted past the right edge
 * of a box the text was fitted to without it.
 *
 * `|` rather than a block or a `▏`: it is in every one of
 * `LABEL_FONT_FAMILY`'s faces, it scales with `fontSize` for free, and at the
 * end of a run of text it reads as a cursor rather than as punctuation.
 *
 * It does not blink. A blink is a timer re-rendering an SVG node two or three
 * times a second for as long as somebody is thinking about what to type, and
 * the mark it is inside is the only thing on the layer that moves.
 */
const CARET_GLYPH = "|";

/**
 * What a print-path save says, and it is deliberately not "saved".
 *
 * The print route is `window.print()`, and `prepare.ts` answers the background
 * *before* calling it (the `CLAUDE.md` invariant - `print()` blocks the
 * renderer while the dialog is open). So this reply arrives while the dialog is
 * still on its way and no file exists yet: whether one gets written is between
 * the user and Chrome's own dialog, and claiming otherwise here would be a lie
 * the extension cannot back up.
 */
const PRINT_NOTE = "Opening the print dialog...";

/**
 * What a cover does, and the one place it cannot reach. Said once per session -
 * on the press that arms `"cover"`, or at the start of a session whose pen came
 * back holding it.
 *
 * Contracts §27.3, verbatim, and it is a different sentence from the one task
 * 27 shipped because it is about a different mark. That one said a filled shape
 * *looks* like it hides text and does not, which was the honest thing to say
 * about a translucent tint over a password - the text underneath stayed in the
 * exported PDF and stayed searchable. `"cover"` does remove it
 * (`lib/dom/cover.ts`, `.plan/design.md` §19), so the warning is no longer
 * about what the mark fails to do; it is about the **limit** of what it does.
 *
 * The second sentence is `.plan/design.md` §21.1 - the one limit on the list
 * that can actually hurt somebody, since a cover drawn over an embedded frame
 * paints a solid block and leaves the frame's own text where it was. It is said
 * in the channel the bar already has, next to the control that arms the mode,
 * rather than left to a README nobody opens mid-annotation.
 *
 * **The press alone is not enough**, which is why `start()` says it too.
 * `DrawPrefs.fill` is persisted (lib/draw/prefs.ts), so the bar comes back
 * armed on whatever it was last left armed on: somebody who leaves it on Cover
 * would hear the sentence once, on the day they first pressed the button, and
 * never again on any of the later visits where they actually draw the covers.
 * That is precisely the path this exists to cover, so the trigger is "this
 * session is armed on `"cover"`", however it got there.
 *
 * Once, because the note line is also where a save reports: a line that came
 * back on every press would be a warning people stop reading. Once per *session* rather than once ever,
 * because there is nothing to store it in that would not outlive the point of
 * saying it - and a session is one visit to one page, which is the same scope
 * as the marks.
 *
 * It cannot reach a PDF or a screenshot from either trigger, and that is the
 * bar's doing rather than the note's: all three capture paths hide the whole
 * bar - `save()` through `saving`, `window.print()` through `beforeprint`, and
 * a CDP capture through `PAGE_ANNOTATE_UI` - and `setVisible(false)` puts the
 * bar's host at `display: none` (lib/draw/css.ts, `.root[data-visible="0"]`),
 * note line included. The first press in the page clears it anyway
 * (`onPointerDown`), so it is gone before the first cover exists.
 */
const FILL_NOTE =
  "Cover hides the text under it from the export. It cannot reach inside an embedded frame.";

/** The house one-liner for putting an unknown throw into a sentence. */
function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Annotate mode while it is running: the two hosts, the undo stack, and the pen
 * the bar is holding.
 *
 * One object rather than six nullable variables, so "is annotate mode up?" is
 * one question with one answer - and so `stop()` cannot leave half of it
 * mounted.
 */
interface Session {
  layer: DrawLayer;
  bar: BarHandle;
  history: DrawHistory;
  /**
   * The pen, as the bar has it. Mutated in place on every press and mirrored
   * into `storage.local` by `persist`, so a reload comes back holding the same
   * pen at the same place.
   */
  pen: DrawPrefs;
  /** The bar's one line of feedback. */
  note: string | null;
  /**
   * The page's hidden text while a capture is in flight, or `null`.
   *
   * `hideTextUnder`'s handle (lib/dom/cover.ts), held for exactly as long as
   * the covers are on - which is the length of one export and no longer
   * (`.plan/design.md` §20). Doubles as the answer to "are the covers on?",
   * which is what makes `applyCovers` and `releaseCovers` idempotent.
   *
   * **On the session rather than in a module variable**, and that is the whole
   * of why `stop()` cannot leave somebody's page with holes in its text: the
   * handle is reachable from the one object that says annotate mode is up, so
   * the teardown that takes the layer and the bar down takes the covers off in
   * the same breath. A module variable would outlive the session, and the page
   * it belonged to would keep the split text nodes and the hidden `<span>`s
   * until a navigation.
   */
  covers: CoverHandle | null;
  /**
   * Whether `FILL_NOTE` has been said yet in this session.
   *
   * Here rather than at module scope, so it is scoped to the session the way
   * the sentence is: the script installs once per document and outlives an
   * annotate session, so a module flag would silence the note for every later
   * session on that page - including the one where somebody else, or the same
   * person an hour later, reaches for the tool for the first time.
   *
   * Starts `true` for a session that opens armed on `"cover"`, because that
   * session has already said it (`start`).
   */
  fillNoted: boolean;
  /**
   * How wide a run of text is, for `layoutText`.
   *
   * Made once per session in `start()` and held here, because
   * `createTextMeasure` caches a canvas context and the font string it last
   * parsed (lib/draw/wrap.ts) - and the caller is a keystroke handler, so a
   * fresh one per character would throw both caches away on every key and
   * allocate a canvas per keystroke. Not at module scope either: the cache
   * belongs to the session that uses it, and it goes when the session does.
   */
  measure: Measure;
}

/**
 * Every tool that draws by dragging - which is every tool but `text`.
 *
 * A type rather than a runtime list, and it is what lets `dragShape` return a
 * `Shape` instead of `Shape | null`. `null` used to mean two things at once,
 * "no preview" and "not implemented", and the conflation could not express
 * either click-to-place tool (`.plan/tasks/16-phase2-tools.md`). Now the
 * exhaustive `switch` below is the classification: an eighth `DrawTool` either
 * gets a case there or is excluded here, and there is no third answer that
 * compiles.
 */
type DragTool = Exclude<DrawTool, "text">;

/** A drag in flight, in document coordinates. */
interface Drag {
  /** The pointer that started it; a second finger must not steer it. */
  pointerId: number;
  /** Read once at `pointerdown`, so switching tools mid-drag cannot change it. */
  tool: DragTool;
  /** Read once for the same reason, and only used when `tool` is `symbol`. */
  symbol: SymbolKind;
  id: string;
  from: Vec2;
  /** The latest sample, kept so Shift can re-derive the preview on its own. */
  to: Vec2;
  shift: boolean;
  /** Pen samples. Empty for the tools that need only `from` and `to`. */
  points: StrokePoint[];
  /**
   * The number a `pin` would carry, from `nextPinIndex` at `pointerdown`.
   *
   * Taken once rather than per render, so the number under the pointer is the
   * number that commits: the alternative is re-counting on every `pointermove`,
   * which would let a Ctrl+Z mid-drag renumber the pin being placed while the
   * user watches. Unused by the other six symbols.
   */
  pinIndex: number;
}

/**
 * A label being typed, in document coordinates.
 *
 * The text tool's whole state, and the only mutable string in the file. It is
 * *not* a DOM node: the preview comes from `editorShape` through the layer's
 * `setLive`, so the page cannot style it, cannot focus it and cannot read it -
 * see the header. `id` is taken at the click so the committed mark keeps the
 * identity its preview had.
 */
interface Editor {
  id: string;
  /**
   * The box the label is being typed into - **what the user asked for**, and
   * the floor the rendered box is grown from.
   *
   * `layoutText` (lib/draw/wrap.ts) takes this, wraps the text to its `width`
   * and returns a rect whose height is `max(this one's, what the lines need)`.
   * The grown height is never written back here, which is the whole of "a box
   * dragged tall stays tall, and a box dragged short grows back to fit"
   * (.plan/design.md §13.6). Placed by the click that opened the editor, and
   * moved and resized after that by `applyFrameDrag` - which writes *this*
   * rect and nothing else, for the same reason.
   */
  rect: DrawRect;
  /**
   * The box as `layoutText` last returned it - **what is actually on screen**,
   * and the rect a press is hit-tested against.
   *
   * Not the same rect as `rect` above, and the difference is the whole of why
   * this field exists. A label that wraps onto a second line is taller than the
   * box that was asked for, so the dashed frame the user can see - and the
   * eight handles drawn on it - are on this one. Hit-testing `rect` instead
   * would put the south handles of a two-line label outside the box being
   * tested: the press that grabbed a handle would fall through to
   * `commitEditor()` and the label would commit instead of resizing, which is
   * exactly what contracts §22.2 exports `frameHandles` to prevent ("the handle
   * you can see and the handle you can grab are the same rect, from one
   * function").
   *
   * A cache with one producer (`showLive`, which writes it in the same breath
   * as it hands the same rect to `setFrame`) and one consumer (`onPointerDown`).
   * On the `Editor` rather than beside it so it cannot outlive the editor it
   * describes, or disagree with it about whether there is one.
   */
  laidOut: DrawRect;
  text: string;
}

/**
 * A move or a resize of the open editor's box, in document coordinates.
 *
 * The third pointer state, beside `drag` and `editor`, and deliberately **not a
 * fourth `DragTool`**: a frame drag draws nothing, previews nothing and pushes
 * nothing onto the history, so `DragTool` stays `Exclude<DrawTool, "text">` and
 * the invariant that a `Drag` and an editor are never both live holds unchanged
 * - a frame drag is neither of those. It is a drag *of* an editor, which is why
 * it cannot outlive one (`commitEditor`, `stop`).
 */
interface FrameDrag {
  /** The pointer that started it; a second finger must not steer it. */
  pointerId: number;
  /** Read once at the press, so the gesture cannot change what it is mid-way. */
  zone: FrameZone;
  /** Where the press landed, in document coordinates. */
  from: Vec2;
  /**
   * `Editor.rect` as it was at the press - **the box the user asked for**, not
   * the laid-out one the hit test used.
   *
   * Baselining here rather than on `Editor.laidOut` is what keeps
   * `.plan/design.md` §13.6's "a box dragged tall stays tall, and a box dragged
   * short grows back to fit" true through a drag. Baselined on the grown rect,
   * merely pressing a handle and releasing would silently adopt the grown
   * height as the user's request - and the box would then stay tall after a
   * line was deleted, though nobody had ever dragged it tall.
   *
   * The price is dead travel on the y handles once a label has outgrown its
   * box: a two-line label at the default 16px pen (`DEFAULT_DRAW_PREFS`,
   * lib/draw/prefs.ts) still has an `Editor.rect` one line tall - 22.4px, `16 *
   * TEXT_LINE_HEIGHT` (lib/draw/wrap.ts) - against a laid-out 44.8px, so the
   * first 22.4px of a south drag grow *this* rect from 22.4 and `layoutText`
   * clamps every one of them straight back to 44.8, with nothing moving on
   * screen; it is 44.8px at three lines, `laidOut.height - rect.height` in
   * general, and a north drag spends the same span sliding the box up instead
   * of growing it, because the bottom edge it pins is one the text is still
   * holding down. Worth it, because the only way to have none of it is to use
   * one rect for both jobs: the grown one loses "a box dragged tall stays tall"
   * above, and the asked-for one puts the bottom handles the user can see
   * outside the rect `frameZoneAt` is asked about (`Editor.laidOut`).
   *
   * Held rather than accumulated, so every event is measured from the press:
   * a resize cannot drift over a long drag, and a mid-drag scroll moves the box
   * exactly once.
   */
  rect: DrawRect;
}

export default defineUnlistedScript(() => {
  const w = window as AnnotateWindow;
  if (w.__pagepdfAnnotateInstalled) return;
  w.__pagepdfAnnotateInstalled = true;

  let session: Session | null = null;
  let drag: Drag | null = null;
  /**
   * The label being typed, or `null`.
   *
   * Never non-null at the same time as `drag`: the text tool does not start a
   * drag, and every press that would start one commits the editor first.
   */
  let editor: Editor | null = null;
  /**
   * The frame drag in flight, or `null`.
   *
   * Non-null only while `editor` is: it is started by a press on that editor's
   * frame and ended by `commitEditor` / `stop` if the editor goes first.
   */
  let frameDrag: FrameDrag | null = null;
  /** Ids only have to be unique within the layer (`shapeId`). */
  let seq = 0;

  /**
   * The three independent reasons the bar goes away, kept apart.
   *
   * A capture asks with `PAGE_ANNOTATE_UI`, the print dialog announces itself
   * with `beforeprint`, and a save started from the bar hides it for the whole
   * round trip - and they overlap in every combination. A print-path export is
   * a `window.print()` the background knows nothing about, a one-click export
   * is a CDP capture with no print event, and a save from the bar is one of
   * those two happening *inside* the third.
   *
   * Tracking them as one boolean means whichever finishes second either strands
   * the bar hidden or brings it back mid-capture. A one-click save from the bar
   * is the concrete case, though not for the reason it looks like. Traced
   * through `entrypoints/background.ts`: `handleScreenExport` awaits its
   * `downloadPdf` *inside* the `try`, builds the success object, and only then
   * runs the `finally` that sends `{ visible: true }`. So by the time that
   * message goes out the capture is long over and the file is already queued;
   * what stands between it and the reply this file is waiting on is a
   * `PAGE_RESTORE` round trip and the response's own hop, not a download. The
   * PNG path has the same shape - `downloadBytes` ahead of the same `finally`.
   *
   * Which makes the cost of one shared boolean a *stale-note flash*, not a bar
   * in the output: the bar would come back for that gap still holding the
   * previous save's line, because this save's note is not written until the
   * reply lands. Cosmetic, but it is the bar's only feedback channel, so it
   * reads as the wrong answer to the press.
   */
  let uiVisible = true;
  let printing = false;
  /**
   * A save this bar started, from the press until the reply lands.
   *
   * Doubles as the re-entry guard, the way `exiting` does for the X: without it
   * a second press mid-save starts a second export of the same page, racing two
   * downloads, and the first one's `finally` clears the flag out from under the
   * second.
   *
   * One way past that guard is known and left open: `stop()`, `start()`, then a
   * second save, all while save #1 is still in flight. `start()` resets `saving`
   * to `false`, so the guard lets save #2 through, and save #1's `finally` then
   * clears the *new* session's flag. Mechanisms 2 and 3 still keep the bar out
   * of the output - `beforeprint`/`afterprint` for the print route, the
   * background's own `PAGE_ANNOTATE_UI` for a CDP capture - so the worst of it
   * is cosmetic: the bar back in view during save #2, carrying save #1's note.
   * Reaching it means restarting annotate mode inside a save that has not
   * answered yet, which is not worth a per-session save token to close.
   */
  let saving = false;
  /** One exit at a time: the X is one press away from the grip. */
  let exiting = false;

  const send = (request: BgRequest): Promise<BgResponse> =>
    chrome.runtime.sendMessage(request) as Promise<BgResponse>;

  /**
   * The tail of the write chain in `persist`. Never rejects, so it always runs
   * the next link.
   */
  let persisting: Promise<void> = Promise.resolve();

  /**
   * Mirror a pen change or a bar move into `storage.local`.
   *
   * **Chained, not fired off in parallel.** `saveDrawPrefs` is a
   * read-modify-write - it awaits a `loadDrawPrefs` before its `set` - so two
   * overlapping calls both read the same base and the second one's write puts
   * the first one's field back to what it was. Two presses a keystroke apart
   * (width, then colour) can drop the width that way, and the bar's `onResize`
   * fires `onMove` once per resize event whose clamp moved, so a dragged window
   * edge can settle the *stored* position on a mid-drag value rather than the
   * final one. Serialising them makes the last write the last press, which is
   * the whole point of persisting. In-memory `pen` is right either way, so this
   * was only ever the value that comes back after a reload.
   *
   * `saveDrawPrefs` rejects rather than swallowing a failed write, and its doc
   * comment leaves the decision here: a lost pen colour or bar position is a
   * cosmetic loss the user will not act on, and the note is the bar's only
   * feedback channel - spending it on a storage hiccup would cost the line a
   * save reply needs. So it is caught and dropped, deliberately, and
   * never left as an unhandled rejection - and caught *inside* the link, so one
   * failed write cannot poison the chain for every press after it.
   */
  const persist = (patch: Partial<DrawPrefs>): void => {
    persisting = persisting.then(() =>
      saveDrawPrefs(patch).then(
        () => undefined,
        () => {
          /* A pen that comes back at its default is not worth interrupting for. */
        },
      ),
    );
  };

  // --- the bar ---------------------------------------------------------------

  const barState = (pen: DrawPrefs, history: DrawHistory, note: string | null): BarState => ({
    tool: pen.tool,
    symbol: pen.symbol,
    color: pen.color,
    width: pen.width,
    fontSize: pen.fontSize,
    fill: pen.fill,
    canUndo: history.canUndo(),
    canRedo: history.canRedo(),
    note,
  });

  /**
   * The bar and the cursor, both from the pen, in the one place every press
   * ends up - so the pointer over the page and the lit tool button cannot
   * disagree. `setCursor` ignores a value it already has, so the presses that
   * change only a colour or a width cost nothing here.
   */
  const paint = (): void => {
    if (!session) return;
    session.bar.setState(barState(session.pen, session.history, session.note));
    session.layer.setCursor(toolCursor(session.pen.tool));
  };

  const setNote = (text: string | null): void => {
    if (!session) return;
    session.note = text;
    paint();
  };

  /**
   * The bar is hidden while any of the three reasons says so; the layer stays
   * *visible* throughout and only gives up the pointer, which is what lets the
   * region selector have it (.plan/design.md §4.3 - the marks are the point).
   *
   * `setInteractive` is tied to `uiVisible` alone, and only that one: the
   * pointer is handed over because something else in the page wants it (the
   * region selector), which is a thing only `PAGE_ANNOTATE_UI` knows about. A
   * print dialog blocks the renderer anyway, and a save from the bar reaches
   * the same message a moment later if its path captures at all.
   */
  const applyVisibility = (): void => {
    if (!session) return;
    session.bar.setVisible(uiVisible && !printing && !saving);
    session.layer.setInteractive(uiVisible);
  };

  // --- the covers ------------------------------------------------------------

  /**
   * Hide the page's text under every covering mark, for the length of one
   * capture. **This is the line that makes a cover a cover.**
   *
   * Without it `"cover"` paints an opaque block and Ctrl+F in the exported PDF
   * still finds every word underneath, because Chrome builds the PDF's text
   * layer from the DOM and painting over a paragraph does not remove the
   * paragraph from it (`.plan/design.md` §17.1). Removing the text from the
   * DOM's own layer is the only thing that does, and `hideTextUnder` is what
   * does it.
   *
   * Two calls and **no decision of its own**, which is this file's header
   * promise: `coverAreas` (lib/draw/model.ts) decides which marks cover and how
   * far each one's paint actually reaches, and `hideTextUnder` (lib/dom/cover.ts)
   * decides which characters that catches and what happens to them. Both are
   * tested one seam down; neither is this file's to second-guess.
   *
   * Read off `history.shapes()` per call rather than accumulated, so the covers
   * are always the ones on the page: undo a cover and the words under it come
   * back in the next export, with nothing here to keep in step (§20's first
   * reason for bracketing a capture instead of hiding at commit time).
   *
   * **Idempotent**, and that is structural rather than defensive. The four
   * brackets overlap in every combination - a save from the bar is a
   * `window.print()` or a CDP capture happening *inside* a third thing, which
   * is the same reason the three visibility booleans are three and not one. A
   * second apply over a live handle would measure a document whose text nodes
   * this pass has already split and wrapped, and would drop the first handle on
   * the floor: half the page would stay hidden after the restore. So the first
   * bracket to fire owns the covers and every later one is a no-op.
   *
   * **What it costs, measured rather than assumed**, because `onBeforePrint` is
   * synchronous and this is the one thing on the critical path of opening the
   * print dialog that does per-character geometry (§20). In a real Chromium at
   * 1280x900, on en.wikipedia.org's "World War II" - a 59,000px document, about
   * 179k characters across 16.8k elements, which is the long article it was
   * asked to be timed on - three 752x400px covers hiding 195 runs cost
   * **21-26ms**, with the restore at 3-5ms and the layout the split dirties at
   * another ~4ms. The first call of a series measured 128ms and every later one
   * 21-26: that one is paying for a layout the page had not been asked for yet,
   * which a print is about to force regardless.
   *
   * **On what, and sampled how**, because `CLAUDE.md` asks the next person to
   * re-measure and neither is guessable from the numbers. The machine is an
   * Apple M4 Pro - 12 cores, 48GB, macOS 26.6, arm64 - which is the machine
   * this repo is on and a quick one, so read all of these as a floor rather
   * than as typical. The sample is five apply / force-layout / restore /
   * force-layout cycles in a row in the page, and the **21-26ms is the min and
   * max of the four after the first**, the first being the 128ms one above. The
   * one-cover and tiled figures below are the same harness with different
   * covers, rounded; their spread was not written down.
   *
   * The *shape* of the cost is the part worth knowing, and its two ends are
   * paid to two different things.
   *
   * **The floor is the element pre-filter.** `hideTextUnder` reads one
   * `getBoundingClientRect()` per text-holding element before it measures a
   * single character, and across 16.8k elements that is very nearly all of what
   * **one** cover over a single line of the same page costs: ~14ms. It is why
   * three large covers are barely dearer than one small one - 195 runs add only
   * 7-12ms on top of that 14, about 0.04-0.06ms a run.
   *
   * **The slow end is the per-character walk**, and it is not the same bill.
   * Three covers tiled over the *whole* 59,000px document hide 9,584 runs at
   * ~330ms. Take the floor off and that is 316ms for 49x the runs, ~0.033ms
   * each - the 195-run case's own per-run cost, a shade under it if anything.
   * So ~96% of the 330ms is `Range` measurement on elements that reached the
   * per-character walk *because they genuinely intersect a cover*, which is
   * exactly what no pre-filter may reject: rejecting them is the leak this
   * whole feature exists to prevent.
   *
   * Which sharpens §20. It names a cheaper pre-filter as the answer if a page
   * is ever visibly slow, and on these numbers that buys some of the 14ms floor
   * and none of the 316ms - the floor is what is already fast. The only lever
   * on the tail is measuring fewer characters per covered node. §20's other
   * half stands untouched: whatever the answer is, it is not a move to an async
   * seam, because `beforeprint` does not have one.
   *
   * A page tiled with covers is one nobody draws, and still a third of a
   * second.
   *
   * Measured on this exact `lib/dom/cover.ts` code bundled into that page,
   * rather than through the built extension, so it is the algorithm's number
   * and not the round trip's. Re-measure if the pre-filter changes (`CLAUDE.md`).
   */
  const applyCovers = (): void => {
    const s = session;
    if (!s || s.covers !== null) return;
    s.covers = hideTextUnder(coverAreas(s.history.shapes()), document);
  };

  /**
   * Put the page's text back.
   *
   * Not an error path: it runs on **every** use, because the covers exist only
   * for the duration of a capture (§20). A page left with hidden `<span>`s and
   * split text nodes in it is a page this extension broke.
   *
   * Idempotent twice over - the handle is dropped here and `restore()` flags
   * itself before it does any work (lib/dom/cover.ts) - because the brackets
   * that call it overlap exactly as the ones that call `applyCovers` do.
   *
   * The field is cleared *before* the restore rather than after, and the
   * ordering only shows up if `restore()` throws: keeping the handle back for a
   * retry would buy nothing, since a second `restore()` is a no-op by
   * construction, and it would leave `applyCovers` refusing to cover the next
   * capture for the rest of the session.
   *
   * **The `try` is for the statements that come *after* the call, not for the
   * handle.** The handle is already safe, by the line above. What a throw would
   * take out is the rest of whichever caller is running, and in both callers
   * that is worse than the failed restore itself. `onAfterPrint` would skip
   * `applyVisibility()` with `printing` already `false` - nothing else calls it
   * again, so the bar stays hidden and **the user cannot reach the X**.
   * `stop()` would skip `session = null` and both `unmount()`s, which is the
   * half-torn-down session that function exists to prevent. And a throw is not
   * hypothetical enough to argue about: `restore()` guards `undoAll` and its
   * unwrap loop one span at a time, then runs `for (const parent of parents)
   * parent.normalize()` unguarded.
   *
   * Swallowing is the right answer here rather than a shrug. A `restore()` that
   * threw has already left the page with some of its text hidden; letting it
   * propagate does not put a character back, it just adds a stranded bar on top
   * of a page with holes in its text. So "the release always happens" becomes
   * true by construction, at the same price `lib/dom/cover.ts` already pays per
   * span and per undo.
   */
  const releaseCovers = (): void => {
    const s = session;
    if (!s) return;
    const handle = s.covers;
    s.covers = null;
    try {
      handle?.restore();
    } catch {
      // Nothing to retry - a second `restore()` is a no-op - and nowhere to
      // report it: every caller is an `afterprint` handler, a message handler
      // or `stop()`. Their remaining statements are what this buys.
    }
  };

  const onBeforePrint = (): void => {
    // The layer stays visible for a print - the marks are the point (§4.3) -
    // and both the live preview and the frame are in it, so an open editor
    // would be printed with its `CARET_GLYPH` still on the end and a dashed
    // rectangle around it (§13.5). Committed, not discarded: the label is what
    // the user typed, and this covers a `window.print()` from anywhere, Ctrl+P
    // included, where no press of ours committed it first.
    commitEditor();
    // **After the commit**, which contracts §28 asks for in as many words. The
    // rule is that `applyCovers` reads the history, so it goes after everything
    // on this path that pushes onto it - and on this path that is exactly the
    // line above, which turns the label somebody was still typing when Ctrl+P
    // landed into a `Shape`. It costs nothing to obey and it is the ordering
    // that stays correct: today no commit can add a *cover*, because only a
    // rect or an ellipse carries `fill` at all (lib/draw/model.ts's
    // `coverAreas`), so the two lines are independent in the present tense and
    // this one is about not having to re-derive that if a third box tool ever
    // arrives.
    applyCovers();
    printing = true;
    applyVisibility();
  };

  const onAfterPrint = (): void => {
    printing = false;
    // The other half of the print route's bracket, and the only one there is:
    // `window.print()` blocks the renderer while the dialog is open, so nothing
    // of ours runs between these two handlers and this is the first moment the
    // text can safely go back. Paired with `beforeprint` rather than with the
    // save that started it, because Ctrl+P is a print this extension was never
    // told about.
    releaseCovers();
    applyVisibility();
  };

  /** Pending trailing measurement; `undefined` means no burst is in progress. */
  let resizeTimer: number | undefined;

  /**
   * A re-layout changes the document's extent, and the layer is sized to it.
   *
   * Leading edge plus a trailing settle, for the reason written on
   * `RESIZE_SETTLE_MS`: the first event of a burst measures straight away, so a
   * one-off re-layout is never left waiting on a timer; the rest of the burst is
   * dropped in favour of one measurement after the window stops moving.
   */
  const onWindowResize = (): void => {
    if (resizeTimer === undefined) session?.layer.resize();
    else clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      resizeTimer = undefined;
      session?.layer.resize();
    }, RESIZE_SETTLE_MS);
  };

  // --- shapes ----------------------------------------------------------------

  /**
   * What a drag currently describes.
   *
   * Total over `DragTool`, so `pointerdown`, `pointermove` and `pointerup`
   * cannot disagree about what a tool draws - and so there is no `null` doing
   * double duty as "this tool does not draw", which is what stopped it
   * expressing the two click-to-place tools (see `DragTool` and the header).
   *
   * It describes what commits, too: a symbol drag that turned out to be a click
   * is re-read by `symbolRect` itself, so nothing changes shape between the last
   * `pointermove` and the `pointerup`.
   *
   * Every branch is a call into `lib/draw/`; the snap and the square constraint
   * are `geometry.ts`'s, and the width, colour and blend mode are `render.ts`'s
   * business once the shape exists.
   */
  const dragShape = (pen: DrawPrefs, d: Drag): Shape => {
    const base = { id: d.id, color: pen.color, width: pen.width };
    switch (d.tool) {
      case "pencil":
        // A filled outline, not a stroked line - `strokePath` puts the varying
        // width into the `d` itself.
        return { ...base, kind: "stroke", points: d.points, highlight: false };

      case "highlighter":
        // The pencil with one flag flipped, and nothing else: `render.ts` is
        // what turns it into `HIGHLIGHT_WIDTH_SCALE` times the width plus
        // `mix-blend-mode: multiply`, so the fat pen and the blend cannot drift
        // apart from the box the layer measures for it.
        return { ...base, kind: "stroke", points: d.points, highlight: true };

      case "line":
        return { ...base, kind: "line", from: d.from, to: d.shift ? snapAngle(d.from, d.to) : d.to };

      case "rect":
        // `normalizeRect` because a rect wants normalising: a drag up and to
        // the left is the same rectangle. Note that the *symbol* case below
        // does not - read the note on `normalizeRect` before copying this line
        // any further.
        return {
          ...base,
          kind: "rect",
          rect: normalizeRect(d.from, d.shift ? constrainSquare(d.from, d.to) : d.to),
          // Straight off the pen, like the colour and the width above it, and
          // that is the whole of what replaced the two filled tools: one menu
          // arms a mode and both box tools read it (`.plan/design.md` §18).
          // What a mode *means* is `render.ts`'s business - `"tint"` is the
          // shape's own colour at `FILL_OPACITY`, `"cover"` is opaque - and
          // what `"cover"` does to the text underneath is `coverAreas`'
          // (lib/draw/model.ts), so neither can drift from here.
          fill: pen.fill,
        };

      case "ellipse":
        // The same three lines as the rect, fill included: the drag's box, which
        // `render.ts` turns into a centre and two radii. Shift makes it a
        // circle.
        return {
          ...base,
          kind: "ellipse",
          rect: normalizeRect(d.from, d.shift ? constrainSquare(d.from, d.to) : d.to),
          fill: pen.fill,
        };

      case "symbol":
        // **Not `normalizeRect`**, and not this file's arithmetic either:
        // `symbolRect` (lib/draw/symbols.ts) owns the signed rect, the Shift
        // constraint and the click-to-place size together, because they are one
        // decision and splitting it is what put a 32x32 down-right arrow at the
        // end of every horizontal drag. Its doc comment is the reason it cannot
        // be `normalizeRect`: the sign *is* the aiming, and nothing downstream
        // can recover it.
        return {
          ...base,
          kind: "symbol",
          symbol: d.symbol,
          rect: symbolRect(d.from, d.to, d.shift),
          // Only a pin is numbered. Every other symbol leaves the field absent
          // rather than carrying a meaningless 1 (lib/draw/model.ts).
          ...(d.symbol === "pin" ? { index: d.pinIndex } : {}),
        };
    }
  };

  /**
   * The label as it stands, as the shape it will become.
   *
   * `preview` is the only difference between what is on the screen and what
   * gets committed: it appends `CARET_GLYPH`, so the cursor is visible while
   * typing and is not part of the mark. It is appended *before* the wrap, so
   * the cursor sits at the end of the text as it is actually laid out rather
   * than beyond the edge of the box. Colour, width and size come from `pen` at
   * render time rather than being frozen at the click, which is what lets the
   * colour and font-size buttons restyle a label while it is being typed - and
   * the box follows the size for the same reason.
   *
   * `Editor.rect` is the box the click placed; `layoutText` (lib/draw/wrap.ts)
   * is what fills it in, and it is the only producer of `TextShape.lines` there
   * is meant to be (contracts §19.1). It also owns the one decision here that
   * is not a placement: `rect.height` comes back grown to hold however many
   * lines the text wrapped onto, so a label that outgrows its box is a taller
   * box rather than text painted past the bottom of one. The grown rect stays
   * on the shape and never goes back onto the `Editor` - see `Editor.rect`.
   *
   * `TextShape` rather than `Shape`, so `showLive` can hand the same rect
   * straight to `setFrame`. That is not a convenience: laying the text out
   * twice - once for the mark, once for the frame - is two chances for the
   * frame to sit somewhere the text is not.
   */
  const editorShape = (
    pen: DrawPrefs,
    measure: Measure,
    e: Editor,
    preview: boolean,
  ): TextShape => {
    const text = preview ? e.text + CARET_GLYPH : e.text;
    const layout = layoutText(text, e.rect, pen.fontSize, measure);
    return {
      id: e.id,
      color: pen.color,
      width: pen.width,
      kind: "text",
      rect: layout.rect,
      text,
      lines: layout.lines,
      fontSize: pen.fontSize,
    };
  };

  /**
   * Show whatever is under the hand - the drag, or the editor, or nothing.
   *
   * `setLive` touches one element, so a pointer move never re-renders the
   * committed list - which is the difference between a pen that follows the
   * hand and one that stutters once there are forty marks on the page. The
   * editor shares that element rather than getting one of its own, which is
   * also why it can never be up at the same time as a drag.
   *
   * The frame is the third element (`setFrame`, contracts §22.1) and is set
   * from the *laid out* rect, so it tracks the height on every keystroke: type
   * past the bottom of the box and the box gets taller under the text. It is
   * the preview's rect, `CARET_GLYPH` included, because the cursor is inside
   * the box the user can see and a frame that cropped it would be describing a
   * different box from the one being typed into.
   *
   * **One layout, three readers**, which is why the same `shape.rect` goes to
   * `setFrame` and onto `Editor.laidOut` here rather than being derived twice:
   * the mark, the frame drawn around it and the rect `onPointerDown`
   * hit-tests are then the same numbers by construction, and a handle cannot
   * be drawn anywhere but where it can be grabbed.
   *
   * A drag returns early without touching the frame, and needs no `setFrame`
   * of its own: a press that starts one commits the editor first, which is
   * what cleared it.
   */
  const showLive = (): void => {
    const s = session;
    if (!s) return;
    if (drag !== null) {
      s.layer.setLive(dragShape(s.pen, drag));
      return;
    }
    const e = editor;
    if (e === null) {
      s.layer.setLive(null);
      s.layer.setFrame(null);
      return;
    }
    const shape = editorShape(s.pen, s.measure, e, true);
    e.laidOut = shape.rect;
    s.layer.setLive(shape);
    s.layer.setFrame(shape.rect);
  };

  /**
   * Run a history operation, and re-render only if it moved.
   *
   * `version()` is on `DrawHistory` for exactly this: `clear()` on an empty
   * page and `undo()` at the baseline both do nothing, and re-rendering
   * anyway would be a pointless pass over every mark.
   */
  const change = (mutate: (history: DrawHistory) => void): void => {
    const s = session;
    if (!s) return;
    const before = s.history.version();
    mutate(s.history);
    if (s.history.version() === before) return;
    s.layer.render(s.history.shapes());
    // `render()` clears the live element (lib/draw/layer.ts), so an undo with
    // the pointer still down - Ctrl+Z mid-stroke - would wipe the preview until
    // the next `pointermove`. Put it straight back rather than leaving the pen
    // looking like it died.
    showLive();
    paint();
  };

  // --- the text editor -------------------------------------------------------

  /**
   * Put an editor where the click landed. The keyboard takes it from here.
   *
   * The box is a click's worth of state and nothing more - `pen.textWidth`
   * wide and one line tall - because a label is *placed* by a click and sized
   * by its handles (`.plan/design.md` §13.6). Drag-to-create is deliberately
   * not a thing: it would be a `DragTool` restructure for very little, and it
   * is in `BACKLOG.md` instead.
   *
   * `pen.textWidth` rather than a constant, and that is the whole of "a text box
   * remembers how wide you made it": the width a frame drag reached is written
   * back by `endFrameDrag`, so the second label on a page opens at the size the
   * first one was dragged to, and so does the first one after a reload
   * (`contracts.md` §23). It starts life as `DEFAULT_TEXT_WIDTH_PX`, which is
   * where the default now lives - `DEFAULT_DRAW_PREFS` in lib/draw/prefs.ts -
   * rather than being read from `model.ts` here.
   *
   * One line tall is **asked for rather than computed**, which is why there is
   * no `fontSize * TEXT_LINE_HEIGHT` in this file: `layoutText` on the empty
   * string is `wrapLines("", …)`, which is `[""]` - one line, never none - so a
   * box handed `height: 0` comes back at `max(0, one line at the pen's size)`.
   * The floor is produced by the same function that later grows it, and that is
   * the only way the two can be guaranteed to agree about how tall a line is
   * (`tests/draw-wrap.test.ts`, "is one line tall for an empty label").
   *
   * Read at the click and not again - which is `Editor.rect`'s "what the user
   * asked for": pick a bigger font mid-label and the box grows to fit it, pick
   * a smaller one and the box you already had stays.
   */
  const openEditor = (at: Vec2): void => {
    const s = session;
    if (!s) return;
    const placed = layoutText(
      "",
      { x: at.x, y: at.y, width: s.pen.textWidth, height: 0 },
      s.pen.fontSize,
      s.measure,
    ).rect;
    editor = {
      id: shapeId(seq),
      rect: placed,
      // Seeded with the box that was just placed, and overwritten by the
      // `showLive` below before anything can read it: an empty label is exactly
      // one line tall, so the two agree at the click and diverge only once the
      // text outgrows the box (`Editor.laidOut`). Seeded rather than left
      // optional so there is never an editor whose frame nothing can hit-test.
      laidOut: placed,
      text: "",
    };
    seq += 1;
    showLive();
  };

  /**
   * Commit the label, if there is one and it says anything.
   *
   * Reached from every direction a label can end: Esc and Ctrl/Cmd+Enter, the
   * next click anywhere on the page, a tool or action pressed on the bar, and
   * the start of a save or a print (a capture would otherwise photograph the
   * caret glyph *and* the frame - the layer stays visible through one, §4.3).
   *
   * An untouched editor is discarded by `isDegenerate`, whose `text` case is
   * written for exactly this - "committed by clicking away or pressing Esc" -
   * so clicking with the T tool and changing your mind costs nothing and leaves
   * no undo step that appears to do nothing.
   *
   * Idempotent, and clearing `editor` *before* `change` matters: `change` calls
   * `showLive`, which would otherwise put the preview straight back.
   */
  const commitEditor = (): void => {
    const s = session;
    const e = editor;
    // A frame drag is a drag *of* an editor, so it cannot outlive one: the
    // label can be committed out from under a resize by `beforeprint`, by
    // `PAGE_ANNOTATE_UI { visible: false }` or by a press on the bar with a
    // second pointer, and the listeners left behind would be capture-phase
    // `pointermove`s calling `preventDefault()` over whatever wanted the
    // pointer next - the same trap `PAGE_ANNOTATE_UI` ends a `Drag` for.
    // Idempotent, so the far commoner case - the `commitEditor()` on every
    // ordinary press - costs three `removeEventListener` calls and nothing else.
    //
    // *Above* `editor = null`, and that is the whole of "an interrupted resize
    // still remembers its width": `endFrameDrag` reads `editor.rect` to persist
    // it. It is free, because that function neither writes `editor` nor renders
    // - the ordering that matters here is `editor = null` before the `change`
    // below, whose `showLive` would otherwise put the preview straight back.
    endFrameDrag();
    editor = null;
    if (!s || e === null) return;

    // Half of what keeps a dashed rectangle out of every PDF and every
    // screenshot (`.plan/design.md` §13.5). Unconditional, and not left to the
    // `showLive` inside `change`: a degenerate label never reaches that call,
    // and `change` itself does nothing when the history did not move.
    s.layer.setFrame(null);
    const shape = editorShape(s.pen, s.measure, e, false);
    if (!isDegenerate(shape)) {
      change((history) => history.push(shape));
      return;
    }
    // `change` would have cleared the preview on its way past; nothing was
    // committed, so clear it here instead.
    s.layer.setLive(null);
  };

  /** Throw the label away. For a session being torn down, and nothing else. */
  const discardEditor = (): void => {
    const s = session;
    editor = null;
    s?.layer.setLive(null);
    s?.layer.setFrame(null);
  };

  // --- the pointer state machine ---------------------------------------------

  /**
   * The scroll as it is *right now*, read per event.
   *
   * This one line is what lets a stroke cross the fold: the page is free to
   * scroll mid-drag (§4.5), and every sample still lands on the content the
   * pointer was over.
   */
  const scroll = (): Vec2 => ({ x: window.scrollX, y: window.scrollY });

  /** Fold one event into the drag. */
  const track = (d: Drag, event: PointerEvent): void => {
    const at = toDocument({ x: event.clientX, y: event.clientY }, scroll());
    d.to = at;
    d.shift = event.shiftKey;
    // Only the freehand tools sample; a line and a rect need the start and the
    // current point and nothing in between.
    if (isFreehand(d.tool)) d.points.push({ ...at, pressure: event.pressure });
  };

  /**
   * End the drag, keeping what it drew or throwing it away.
   *
   * Idempotent, and `stop()` calls it too, so a session torn down mid-stroke
   * leaves nothing of ours on the page's `window`.
   */
  const endDrag = (keep: boolean): void => {
    const s = session;
    const d = drag;
    drag = null;
    window.removeEventListener("pointermove", onPointerMove, DRAG_LISTENER);
    window.removeEventListener("pointerup", onPointerUp, DRAG_LISTENER);
    window.removeEventListener("pointercancel", onPointerCancel, DRAG_LISTENER);
    if (!s) return;

    const shape = keep && d !== null ? dragShape(s.pen, d) : null;
    // `isDegenerate` is what keeps undo honest: a stray click with the line
    // tool, or a rect drag that never left the pixel it started on, is thrown
    // away here rather than becoming a mark nobody can see and an undo step
    // that appears to do nothing.
    //
    // A symbol is the exception, and `symbolRect` has already made the whole
    // decision for it: a click is a placement at `DEFAULT_SYMBOL_SIZE_PX`, and
    // anything past that threshold is a drag somebody aimed. What must not
    // reach it is `isDegenerate`'s *per-axis* rect test, which is right for a
    // rect - a 400x1 box is a drag that never left the line it started on - and
    // wrong for an arrow, where 400x1 is a horizontal arrow. So with that tool
    // every press that is not cancelled leaves a mark, which is what the tool
    // is for.
    if (shape !== null && (shape.kind === "symbol" || !isDegenerate(shape))) {
      change((history) => history.push(shape));
      return;
    }
    // `change` would have cleared the preview on its way past; nothing was
    // committed, so clear it here instead.
    s.layer.setLive(null);
  };

  // --- the frame's own drag --------------------------------------------------

  /**
   * How far the pointer has come since the press, in document coordinates.
   *
   * The one piece of arithmetic in this file, declared as such in the header.
   * It is here because there is nowhere else for it to be: `moveFrame` and
   * `resizeFrame` (contracts §21) both take a `Vec2` of *movement*, and
   * `geometry.ts` exports no vector difference to build one with - adding one
   * is `lib/`'s to do, not this file's. It decides nothing; the two functions
   * it feeds decide everything.
   *
   * Read per event through `toDocument` and `scroll()`, exactly as `track`
   * does, and that is what lets a box be dragged across the fold: the page is
   * free to scroll mid-drag (§4.5) and the box follows the pointer over the
   * content rather than the viewport.
   */
  const sincePress = (from: Vec2, event: PointerEvent): Vec2 => {
    const at = toDocument({ x: event.clientX, y: event.clientY }, scroll());
    return { x: at.x - from.x, y: at.y - from.y };
  };

  /**
   * Fold one event into the frame drag: the box moves or resizes, and the label
   * re-wraps with it.
   *
   * Both spatial decisions are `lib/draw/frame.ts`'s, and task 19 tested them.
   * `"move"` translates; every other zone moves the edges it names and clamps
   * them by pinning the opposite edge, so dragging the west handle far east
   * stops at `FRAME_MIN` with the east edge where it was rather than mirroring
   * the box. The branch is what makes a move a move - `resizeFrame` is a
   * documented no-op for `"move"`, so without it a drag of the box's interior
   * would sit there doing nothing.
   *
   * Written to `Editor.rect`, never to `Editor.laidOut`: this is the height the
   * user asked for, and `showLive` does the rest for free. It re-runs
   * `layoutText`, so a box dragged narrower re-wraps and grows back down under
   * its own text, and the frame follows because it is drawn from the rect that
   * came back.
   *
   * `editor === null` is not a state this should be reachable in - the drag is
   * ended when the editor goes - so it declines rather than resurrecting one.
   */
  const applyFrameDrag = (f: FrameDrag, event: PointerEvent): void => {
    const e = editor;
    if (e === null) return;
    const delta = sincePress(f.from, event);
    e.rect =
      f.zone === "move" ? moveFrame(f.rect, delta) : resizeFrame(f.rect, f.zone, delta, FRAME_MIN);
    showLive();
  };

  /**
   * End the frame drag, **keeping the box where it got to**.
   *
   * There is no `keep` flag here, and that asymmetry with `endDrag` is the
   * point: a stroke's samples exist only to become a mark, so a cancelled one
   * has something to throw away, while a frame drag has been writing
   * `Editor.rect` all along. So a `pointercancel` - Chrome deciding a finger
   * was a pan - leaves the box at the size the drag reached, and the
   * alternative is a box that visibly jumps back to where the press started.
   *
   * Idempotent, and called by `commitEditor` and `stop` as well as by the end
   * of a gesture, so a session torn down or a label committed mid-resize leaves
   * nothing of ours on the page's `window`.
   *
   * **And it is where the width is written back** (`contracts.md` §23). Here
   * rather than in `onFramePointerUp` because this is where every ending
   * arrives, and at all but one of them the box keeps the size it reached: a
   * `pointercancel`, and the `buttons === 0` recovery, leave a box the user can
   * see at a width they chose, so the next box should open at it too. Once per
   * gesture and never per `pointermove`: `persist` is a read-modify-write of
   * `storage.local`, and a dragged handle fires at about the frame rate.
   *
   * The exception is `stop()`, which calls this and then `discardEditor()`: a
   * session torn down mid-resize persists a width from a label that never
   * became a mark. Deliberate, and the smaller of the two wrongs - the user did
   * drag the handle to that width, and the alternative is the `keep` flag this
   * function pointedly does not have, threaded through for a preference.
   *
   * A **resize** only. `zone === "move"` is the same question `applyFrameDrag`
   * asks a line apart, and for the same reason: a move is a statement about
   * where a label goes, not about how wide labels should be, and persisting on
   * one would rewrite the pref with a number nobody chose.
   *
   * `editor === null` writes nothing, and that is now only about the calls with
   * nothing to read - the `commitEditor()` on every ordinary press, where there
   * is neither an editor nor a drag. A label committed out from under a resize
   * (`beforeprint`, `PAGE_ANNOTATE_UI`, a press on the bar with a second
   * pointer) *keeps* its width, because `commitEditor` calls this one line
   * before it clears `editor`. That ordering costs nothing: this function
   * neither writes `editor` nor renders, so the constraint the commit path
   * really has - `editor` cleared before `change` calls `showLive` - is
   * untouched by it.
   */
  const endFrameDrag = (): void => {
    const f = frameDrag;
    frameDrag = null;
    window.removeEventListener("pointermove", onFramePointerMove, DRAG_LISTENER);
    window.removeEventListener("pointerup", onFramePointerUp, DRAG_LISTENER);
    window.removeEventListener("pointercancel", onFramePointerCancel, DRAG_LISTENER);
    if (f !== null && f.zone !== "move" && editor !== null) {
      // `editor.rect` and not `laidOut`: the width is the one axis the two
      // always agree on - `layoutText` grows the height, never the width - and
      // `rect` is the one the user asked for (`Editor.rect`).
      //
      // Through `clampTextWidth`, which owns the 40..2000 range (prefs.ts), and
      // not because a drag is untrusted: `resizeFrame`'s floor is `FRAME_MIN`'s
      // same 40, but nothing bounds a drag's *top*, and a handle pulled to 2400
      // CSS px is one mouse move on a wide monitor. `saveDrawPrefs` clamps on
      // the way to disk regardless, so without this the pref this session holds
      // and the pref a reload brings back would be different numbers. The box
      // on screen keeps the width that was dragged; it is only the *next* one
      // that opens at the end of the range.
      const width = clampTextWidth(editor.rect.width);
      // In memory *and* in storage, the way every press on the bar does it
      // (`onBarAction`). `openEditor` reads `pen.textWidth`, so without the
      // first of these the *next* box in this session would still open at the
      // old width and only a reload would agree with the drag that just ended.
      if (session !== null) session.pen.textWidth = width;
      persist({ textWidth: width });
    }
  };

  /**
   * Take the press, and listen for the rest of the gesture.
   *
   * The three listeners are on `window` in the capture phase for the reason
   * `DRAG_LISTENER` gives - a page that swallows `pointermove` on its own
   * document must not be able to freeze a resize half-way - and they are the
   * same three, with the same flag, that a stroke uses.
   */
  const startFrameDrag = (
    event: PointerEvent,
    zone: FrameZone,
    at: Vec2,
    rect: DrawRect,
  ): void => {
    frameDrag = { pointerId: event.pointerId, zone, from: at, rect };
    window.addEventListener("pointermove", onFramePointerMove, DRAG_LISTENER);
    window.addEventListener("pointerup", onFramePointerUp, DRAG_LISTENER);
    window.addEventListener("pointercancel", onFramePointerCancel, DRAG_LISTENER);
    try {
      // The same bonus as a stroke's, and not a dependency for the same reason:
      // it keeps the resize alive while the pointer is outside the window, and
      // the `window` listeners above work with or without it.
      session?.layer.surface().setPointerCapture(event.pointerId);
    } catch {
      /* Carry on without capture. */
    }
  };

  function onFramePointerMove(event: PointerEvent): void {
    const f = frameDrag;
    if (f === null || event.pointerId !== f.pointerId) return;
    // A button released outside the window, with capture refused, arrives as
    // nothing at all - the recovery `onPointerMove` explains. End it on the
    // same terms, and without folding this event in: the box keeps the size the
    // last real move gave it, which is what the user last saw.
    if (event.buttons === 0) {
      endFrameDrag();
      return;
    }
    event.preventDefault();
    applyFrameDrag(f, event);
  }

  function onFramePointerUp(event: PointerEvent): void {
    const f = frameDrag;
    if (f === null || event.pointerId !== f.pointerId) return;
    event.preventDefault();
    applyFrameDrag(f, event);
    endFrameDrag();
  }

  /** The browser took the gesture over. The box stays put - see `endFrameDrag`. */
  function onFramePointerCancel(event: PointerEvent): void {
    if (frameDrag === null || event.pointerId !== frameDrag.pointerId) return;
    endFrameDrag();
  }

  const onPointerDown = (event: PointerEvent): void => {
    const s = session;
    // `frameDrag` alongside `drag` for the same reason: one gesture at a time,
    // so a second finger on the page cannot restart the resize the first one is
    // in the middle of, or commit the label out from under it.
    if (!s || drag !== null || frameDrag !== null || event.button !== 0) return;

    const at = toDocument({ x: event.clientX, y: event.clientY }, scroll());

    // This file's own `preventDefault` - see the header. The layer sets no
    // `touch-action` on purpose, so without this a drag also selects the text
    // underneath and a drag from an image starts a native image drag. Before
    // anything else, because the press landed on our surface whatever the tool
    // turns out to do with it - including opening an editor, where a stray text
    // selection under the label is exactly what nobody wants.
    event.preventDefault();

    // **A press on the frame is not a click away**, so this branch goes ahead
    // of the commit below - the ordering *is* the feature (.plan/design.md
    // §13.6). Reaching `commitEditor()` with a handle under the pointer would
    // commit the label and then start whatever the tool does, which is the
    // opposite of grabbing its south edge.
    //
    // Hit-tested against `laidOut` and **not** `editor.rect`: those are two
    // different boxes the moment a label wraps onto a second line, and the
    // handles the user can see are on the laid-out one (`Editor.laidOut` says
    // what goes wrong otherwise). What the drag is *baselined* on is the other
    // rect - `editor.rect`, the height the user asked for - so a box dragged
    // tall stays tall (`FrameDrag.rect`).
    if (editor !== null) {
      const zone = frameZoneAt(editor.laidOut, at);
      if (zone !== null) {
        startFrameDrag(event, zone, at, editor.rect);
        return;
      }
    }

    // "Click away to commit" (lib/draw/model.ts's `isDegenerate`), and this is
    // the click. Before the tool is read, so it applies whether the next thing
    // is another label or the first stroke of something else.
    commitEditor();

    // Copied out so the compiler can narrow it: `text` is the one tool that
    // does not drag, and `DragTool` is what is left.
    //
    // Read straight off the pen, with **no entitlement check**, and that is on
    // purpose rather than an oversight. Draw mode is Pro as a whole and
    // `isPro()` is called once, on entry (`handleAnnotate`,
    // entrypoints/background.ts); nothing is re-checked afterwards, so a key
    // that lapses mid-session leaves that session open. The marks are in the
    // DOM before anything exports, and the only way to gate later would be to
    // strip a user's marks out of their own PDF (README Deviation 15).
    const tool = s.pen.tool;
    if (tool === "text") {
      // No drag, and no preview to drag out - the pointer's whole job here was
      // to say where. `onKeyDown` fills it in from now on.
      openEditor(at);
      return;
    }

    const started: Drag = {
      pointerId: event.pointerId,
      tool,
      symbol: s.pen.symbol,
      id: shapeId(seq),
      from: at,
      to: at,
      shift: event.shiftKey,
      // `pressure` is the device's: 0.5 for a mouse with the button down, real
      // for a pen (lib/draw/model.ts).
      points: [{ ...at, pressure: event.pressure }],
      // Counted from the marks as they stand at the press, so pins read 1, 2,
      // 3 and an undo hands the number back (`nextPinIndex`).
      pinIndex: nextPinIndex(s.history.shapes()),
    };

    seq += 1;
    drag = started;
    if (s.note !== null) setNote(null);

    window.addEventListener("pointermove", onPointerMove, DRAG_LISTENER);
    window.addEventListener("pointerup", onPointerUp, DRAG_LISTENER);
    window.addEventListener("pointercancel", onPointerCancel, DRAG_LISTENER);
    try {
      // A bonus, not a dependency: it keeps the stroke alive while the pointer
      // is outside the window, where no listener of ours can reach. The window
      // listeners above work with or without it, so a pointer that cannot be
      // captured (a synthetic one, a pen that left the digitiser) costs
      // nothing - the same treatment as entrypoints/select-area.ts.
      s.layer.surface().setPointerCapture(event.pointerId);
    } catch {
      /* Carry on without capture. */
    }
    showLive();
  };

  function onPointerMove(event: PointerEvent): void {
    const d = drag;
    if (d === null || event.pointerId !== d.pointerId) return;
    // A button released outside the window, with capture refused, arrives as
    // nothing at all: the first we hear of it is a move back over the page with
    // `buttons` already 0. Treat it as the `pointerup` we never got, exactly as
    // the bar's grip drag does, or the stroke never ends.
    if (event.buttons === 0) {
      endDrag(true);
      return;
    }
    event.preventDefault();
    track(d, event);
    showLive();
  }

  function onPointerUp(event: PointerEvent): void {
    const d = drag;
    if (d === null || event.pointerId !== d.pointerId) return;
    event.preventDefault();
    track(d, event);
    endDrag(true);
  }

  /**
   * The browser took the gesture over, so the mark is thrown away.
   *
   * This is the touch path, and it is why it discards rather than commits: the
   * layer sets no `touch-action` (§4.5 wants the page to keep scrolling under a
   * finger), so a finger drag that Chrome decides is a pan arrives here after a
   * sample or two. Committing that would leave a stray flick of ink every time
   * someone scrolled a page they were annotating - and `isDegenerate` would not
   * catch it, because a two-sample flick is a legitimate short stroke.
   */
  function onPointerCancel(event: PointerEvent): void {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    endDrag(false);
  }

  // --- the keyboard ----------------------------------------------------------

  /**
   * The keystroke goes into the label, if there is one open that wants it.
   *
   * Returns whether it was taken, so the caller knows whether to swallow the
   * key. What it deliberately does *not* take is a chord (`isChord`) or a named
   * key it has no use for (`isPrintable`) - Tab, the arrows, F5 - so the page
   * keeps everything the label is not using.
   *
   * **`Enter` inserts a newline.** It used to commit, and the reason it did was
   * that an SVG `<text>` node does not wrap - a second line needed `<tspan>`s
   * and a line height, which was a change to `render.ts` and to the box
   * `layer.ts` measures. That change has landed (`.plan/design.md` §13.7), so a
   * label is a box with as many lines as you type into it and `\n` is a break
   * the user asked for: `wrapLines` splits on it first, so it survives the wrap
   * and a blank line stays a blank line.
   *
   * `Esc` is still the primary commit, and still what the §9 matrix tells a
   * tester to press. **`Ctrl/Cmd+Enter` is the fast one**, added because Enter
   * was the fast one and somebody's hand will go looking for it - and it is
   * `isChord` that tells the two apart rather than a modifier test written
   * here, so AltGr+Enter on a layout that needs AltGr is a newline and not a
   * commit (lib/draw/keys.ts).
   *
   * The `Enter` branch is ahead of `isPrintable` because it has to be:
   * `isPrintable` classifies by name length and `"Enter"` is five code points,
   * so a key handled after it would simply be dropped.
   */
  const typeIntoEditor = (event: KeyboardEvent): boolean => {
    const e = editor;
    if (e === null) return false;

    if (event.key === "Escape") {
      commitEditor();
      return true;
    }
    if (event.key === "Enter") {
      if (isChord(event)) {
        commitEditor();
        return true;
      }
      e.text += "\n";
      showLive();
      return true;
    }
    if (event.key === "Backspace") {
      // `dropLastChar` deletes a `\n` like any other single code unit, so a
      // Backspace at the start of a line joins it to the one above.
      e.text = dropLastChar(e.text);
      showLive();
      return true;
    }
    if (isChord(event)) return false;
    if (!isPrintable(event)) return false;
    e.text += event.key;
    showLive();
    return true;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    // `!uiVisible` is a capture in flight, and the keyboard is not ours while
    // it runs - the region selector's above all. Its own Esc listener is on
    // `window` in the capture phase too, and installed *after* this one, so
    // this one hears the key first and `stopPropagation()` here does not stop
    // a listener on the same target: without this line, Esc meant to cancel
    // a selection fell through to `exit()` below and left annotate mode,
    // taking every mark on the page with it. A Ctrl+Z mid-capture is no better
    // - it would change the marks out from under the picture being taken.
    if (session === null || !uiVisible) return;

    // The editor owns the keyboard while it is open, and that is the narrowing
    // `.plan/tasks/16-phase2-tools.md` asks for in both directions.
    if (editor !== null) {
      // Ctrl+Z with an editor open must not reach the mark history - the user
      // is typing, and undoing somebody's *last mark* because they wanted their
      // last *character* back is the worst possible reading of the keystroke.
      // It deletes the character instead: with no `contenteditable` anywhere
      // (the header says why) there is no browser undo to defer to, so the
      // editor provides its own. This is what the old `pen.tool === "text"`
      // gate was reaching for and could not express, having no editor to read.
      if (isUndoChord(event)) {
        event.preventDefault();
        event.stopPropagation();
        editor.text = dropLastChar(editor.text);
        showLive();
        return;
      }
      if (typeIntoEditor(event)) {
        // Swallowed, or the page acts on it too: Space scrolls, `/` opens a
        // site's search box, and a single letter is a shortcut on half the
        // web.
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      // A bar panel first, and it consumes the key. Nothing in the page can
      // dismiss a panel any more - a stroke, a `<select>` or a JS menu leaves
      // the symbols palette up, which is the whole of `.plan/design.md` §12 -
      // so Esc is the keyboard's way out of one, and the trigger is the only
      // other. It has to be *first*: falling through would cancel a stroke
      // nobody was drawing, or leave annotate mode and take every mark on the
      // page with it, because somebody wanted a menu shut.
      if (session.bar.closePanels()) return;
      // Mid-drag, Esc cancels the stroke rather than the mode: it is the
      // universal "forget this gesture", and leaving annotate mode - which
      // restores the page and takes every mark with it - because somebody
      // mis-started one line is a spectacularly expensive misreading. Discarded
      // rather than committed, like a `pointercancel`.
      if (drag !== null) {
        endDrag(false);
        return;
      }
      void exit();
      return;
    }

    // `metaKey` as well as `ctrlKey`: Cmd+Z is the undo gesture on macOS, and a
    // Mac user pressing it while the page's own handler is listening is exactly
    // the case the capture-phase listener exists for. `altKey` is excluded
    // because Ctrl+Alt+Z is somebody else's shortcut, not ours.
    if (!isUndoChord(event)) return;
    // Deliberately *not* gated on the selected tool. Undo belongs to the marks
    // on the page, and they are there to be undone whatever the bar happens to
    // be holding. The gate that used to stand here read `pen.tool === "text"`,
    // which gated on the wrong thing twice over: prefs record the wish and not
    // the entitlement (lib/draw/prefs.ts), and `DEV_UNLOCK_PRO` is `true`, so
    // picking Text and reloading came back with a session in which nothing drew
    // *and* Ctrl+Z silently did nothing. The condition it wanted is the one
    // above: the editor has the keystrokes.
    event.preventDefault();
    event.stopPropagation();
    change((history) => (event.shiftKey ? history.redo() : history.undo()));
  };

  // --- the bar's buttons -----------------------------------------------------

  const runAction = (action: BarAction): void => {
    switch (action) {
      case "undo":
        change((history) => history.undo());
        return;
      case "redo":
        change((history) => history.redo());
        return;
      case "clear":
        // Undoable, because `DrawHistory` is a stack of snapshots - which is
        // most of why it is one.
        change((history) => history.clear());
        return;
      case "save-pdf":
        void save("pdf");
        return;
      case "save-png":
        void save("png");
        return;
      case "save-area":
        void save("region");
        return;
      case "exit":
        void exit();
        return;
    }
  };

  const onPress = (id: string): void => {
    const s = session;
    if (!s) return;
    // `parseBarId` is the only reader of the `tool:` / `symbol:` / `width:` /
    // `color:` grammar there is meant to be - splitting the string here again
    // would be a third place for `width:4` to stop meaning 4, with nothing
    // failing to say so (its own doc comment).
    const parsed = parseBarId(id);
    if (parsed === null) return;

    // Where a press stands on the open editor, and it is one rule: a press that
    // changes **what the pointer does** commits the label, and a press that
    // changes **how it looks** restyles it in place. So the tools, the symbol
    // palette and every action commit; the colour, the width, the font size and
    // the fill are visible on the label you are still typing, which is the whole
    // reason the editor is on the page rather than in a field on the bar.
    switch (parsed.kind) {
      case "tool":
        commitEditor();
        s.pen.tool = parsed.tool;
        persist({ tool: parsed.tool });
        // Picking a tool is a new errand, so whatever the note line was saying -
        // a save's result, or `FILL_NOTE` - is done with. No tool writes a note:
        // the sentence a press can put up is `FILL_NOTE`, and the press that
        // does it is on the fill menu below rather than on a tool.
        s.note = null;
        break;

      case "symbol":
        commitEditor();
        // Picking a mark picks the tool that places it. The palette lives
        // behind the symbol tool's own button, so the press that opened it
        // already selected the tool; a press *inside* it that left the pencil
        // active would be the bar lighting up a star and then drawing
        // freehand. `parseBarId` is what makes this reachable at all.
        s.pen.tool = "symbol";
        s.pen.symbol = parsed.symbol;
        persist({ tool: "symbol", symbol: parsed.symbol });
        s.note = null;
        break;

      case "width":
        s.pen.width = parsed.width;
        persist({ width: parsed.width });
        // Restyles an open editor. There is never a drag in flight here - the
        // pointer is on the bar - so this only ever redraws a label.
        showLive();
        break;

      case "color":
        s.pen.color = parsed.color;
        persist({ color: parsed.color });
        showLive();
        break;

      case "font":
        // DRAWING.md's font-size control, and the reason it is a control
        // rather than a field: the label being typed is redrawn at the new
        // size straight away, so the size is chosen by looking at it.
        s.pen.fontSize = parsed.fontSize;
        persist({ fontSize: parsed.fontSize });
        showLive();
        break;

      case "fill":
        // A pen setting, so it behaves like the width and the colour above it:
        // it restyles a live drag and an open editor rather than committing
        // anything, and it commits no editor on the way (`.plan/design.md` §18
        // - the fill stopped being a tool precisely so that arming it is not a
        // change of what the pointer does).
        s.pen.fill = parsed.fill;
        persist({ fill: parsed.fill });
        // Every mode press puts the menu away, and this is not `popoverAfterPress`
        // rule 3 (lib/draw/bar.ts, contracts §20.1) being contradicted: that rule
        // is right, and this is one caller deciding its own errand is finished.
        // Arming a fill is a one-shot errand - you pick a mode and then go and
        // draw with it - whereas the symbols palette is the case rule 3 exists
        // for, where picking a mark *is* the errand and you place five in a row.
        // So the rule keeps a panel open by default and this branch is the one
        // that says otherwise, through `closePanels` (§20.2).
        //
        // It is also what lets the sentence below be read at all. `.note` is
        // `absolute; left: 0; top: calc(100% + gap)` off `.root`; a `.popover`
        // hangs at the same offset off its own group and carries `z-index: 1`
        // expressly to paint above the note (lib/draw/css.ts). The `fill` group
        // is third in the bar, so its open panel lands inside the note's first
        // 420px - and `FILL_NOTE` is the one sentence a cover's honesty rests
        // on. Task 27 never met this: the note fired from `tool:rect-fill`, a
        // press in the flat `tools` group, which rule 4 closed the panel for.
        s.bar.closePanels();
        // The one press on this bar that writes a note instead of clearing one:
        // `FILL_NOTE` says what a cover does and the one place it cannot reach,
        // in the channel the bar already has, and the flag keeps it to once (see
        // `Session.fillNoted` and `FILL_NOTE`). A press in the page clears it
        // like any other note (`onPointerDown`), so it is gone by the time the
        // first cover is drawn.
        //
        // Not the only trigger: a session that opens *already* armed on
        // `"cover"` says it in `start()` and sets the same flag, so this branch
        // is the mid-session case and the two cannot both fire.
        //
        // The `else` clears, unlike the other pen settings, because this note is
        // *about the armed mode*: leaving the cover sentence up over a bar that
        // has just been disarmed to "Not filled" would be the bar contradicting
        // itself, which is the one thing the labels here exist to avoid.
        if (parsed.fill === "cover" && !s.fillNoted) {
          s.fillNoted = true;
          s.note = FILL_NOTE;
        } else {
          s.note = null;
        }
        showLive();
        break;

      case "action":
        // Committed first, so a label typed and then saved is *in* the save,
        // and so Clear cannot leave an editor hanging over a page it just wiped.
        commitEditor();
        // Paints for itself, and `undo` must not be followed by the repaint
        // below writing a stale `canUndo` back over it.
        runAction(parsed.action);
        return;
    }
    paint();
  };

  const onMove = (position: { x: number; y: number }): void => {
    // `mountBar` fires this once during its own construction (the load-time
    // clamp against the real box), before `session` exists - so the pen is
    // patched only when there is one, and the write happens either way.
    if (session) session.pen.bar = { ...position };
    persist({ bar: { ...position } });
  };

  // --- saving from the bar ---------------------------------------------------

  /** `Saved page.pdf`, plus whatever the reply had to qualify it with. */
  const savedNote = (filename: string, note: string | undefined): string =>
    note ? `Saved ${filename} - ${note}` : `Saved ${filename}`;

  /**
   * The one line the bar gets to say how a save went.
   *
   * The background hands back the underlying `ExportSuccess` /
   * `CaptureSuccess` / `Failure` unchanged, because there is no popup open to
   * report into - so all four outcomes arrive here and this is where they
   * become a sentence. A `Failure.error` already is one and is shown verbatim
   * (`lib/messages.ts`: "write it like a sentence"); a success is reduced to
   * the filename, which is the part the user wants and the part the download
   * bubble is about to agree with.
   */
  const saveNote = (reply: BgResponse): string => {
    if (!reply.ok) return reply.error;
    // `printRequested` is the field only an export reply carries - the popup
    // narrows on the same one, because a full-page screenshot brings a `report`
    // back too.
    if ("printRequested" in reply) {
      return reply.printRequested ? PRINT_NOTE : savedNote(reply.filename ?? "the PDF", reply.note);
    }
    if ("kind" in reply && reply.kind === "capture") return savedNote(reply.filename, reply.note);
    // Unreachable: `ANNOTATE_EXPORT` answers with one of those two or a
    // `Failure`. Said anyway, because a save that leaves the note blank reads
    // as a dead button.
    return "That save sent back an unexpected reply.";
  };

  /**
   * Save the marked-up page, with the bar out of the picture.
   *
   * Mechanism 1 of the three that keep the bar out of the output
   * (.plan/design.md §4.3): the bar is `position: fixed`, so left in it would
   * repeat on every printed sheet. Hidden before the send and put back in the
   * `finally`, so a failed export never strands it hidden.
   *
   * It is not the only mechanism covering this press, and deliberately so. A
   * print-path PDF save is a `window.print()`, so `beforeprint` hides the bar
   * as well; a one-click save is a CDP capture, so the background sends
   * `PAGE_ANNOTATE_UI { visible: false }` around it. Two of the three firing
   * for one press is harmless because each owns its own boolean and
   * `applyVisibility` reads all three - what they must not do is share one.
   *
   * Nothing is sent to say "keep the page prepared": `prepare.ts` is holding
   * the pass these marks were drawn on and reuses it for the `PAGE_PREPARE`
   * this export sends, so the content does not move out from under them.
   *
   * `"region"` is the one save that waits on the user: the reply does not come
   * until the area selector has had its drag, its Esc or its too-small click,
   * and the bar stays hidden for all of it. A cancelled selection comes back
   * as a `CANCELLED` failure and is said like one - the bar was pressed, so
   * it answers.
   */
  async function save(target: AnnotateExportRequest["target"]): Promise<void> {
    if (saving) return;
    saving = true;
    applyVisibility();
    try {
      // Written before the `finally` shows the bar again, so it never comes
      // back holding the *previous* save's line for a frame.
      setNote(saveNote(await send({ type: "ANNOTATE_EXPORT", target })));
    } catch (error) {
      // MV3 rejects a `sendMessage` with no receiver, and a worker that was
      // asleep and failed to wake is exactly when the user is left guessing.
      setNote(`Saving failed: ${detail(error)}`);
    } finally {
      saving = false;
      applyVisibility();
    }
  }

  // --- start, stop, exit -----------------------------------------------------

  const start = (message: PageAnnotateStartRequest): void => {
    // A second START replaces rather than stacks. `mountLayer` already does
    // this for itself; the bar does not, and two bars is two sets of `window`
    // listeners.
    stop();

    // Copied, not aliased: the pen is mutated on every press and the message's
    // own object is not ours to write to.
    const pen: DrawPrefs = { ...message.prefs, bar: { ...message.prefs.bar } };

    /**
     * The line the bar opens on, which is `FILL_NOTE` when this session starts
     * out armed on `"cover"` and `null` otherwise.
     *
     * The mechanism task 27's review added, kept for the mode that now needs it
     * (contracts §27.3). A press-only trigger says the sentence once ever - on
     * the visit where the button was first pressed - because `DrawPrefs.fill`
     * persists (lib/draw/prefs.ts): leave the menu armed on Cover and every
     * later visit opens armed on it, which is exactly where the covers actually
     * get drawn. Said here as well, and `fillNoted` set with it, so the sentence
     * is still exactly once and the press that arms `"cover"` does not repeat
     * it.
     *
     * Read off `pen` rather than off the bar's own state because the pen is
     * what the bar is about to render: it is the same value `barState` sends as
     * `fill`, so the note and the lit menu button agree by construction.
     */
    const opening = pen.fill === "cover" ? FILL_NOTE : null;

    const history = createHistory();
    const layer = mountLayer();
    let bar: BarHandle;
    try {
      bar = mountBar({
        // `DrawPrefs.bar` promises "clamped on load", and `mountBar` is where
        // that happens - the bar's width is not knowable until it exists.
        position: pen.bar,
        // Handed to `mountBar` *and* stored on the session below, so the two
        // cannot disagree: `paint()` rebuilds the whole `BarState` from
        // `session.note`, so a note that lived only in this initial state would
        // be wiped by the next press of a colour or a width - neither of which
        // is a press that clears a note.
        state: barState(pen, history, opening),
        onPress: (id) => onPress(id),
        onMove: (position) => onMove(position),
      });
    } catch (error) {
      // The mount has to undo itself here, because `session` is still `null`
      // until the line below and `stop()` reads exactly that: the caller's
      // `catch` would call it, find nothing, and unmount nothing. What it would
      // leave behind is the worst possible half of a session - a document-sized
      // layer host on `documentElement` at the top of the stacking order with
      // `pointer-events: auto` and `LAYER_CSS` injected, invisible and
      // swallowing every click on the page until a navigation, while the reply
      // says annotate mode never started. No input of `mountBar`'s is known to
      // make it throw now that it takes no tool set from the message; the guard
      // is for whatever does, because that page is the price of missing one.
      // Re-thrown so the caller still tells the background, which restores the
      // page.
      layer.unmount();
      throw error;
    }

    // One per session, and this is the only call: it caches a canvas context
    // and the last font string it parsed, and the thing that calls it is a
    // keystroke handler (see `Session.measure`). Safe here whatever the page
    // is - the canvas itself is made lazily, on the first measurement.
    session = {
      layer,
      bar,
      history,
      pen,
      note: opening,
      // A fresh session has not said `FILL_NOTE` yet, whatever the last one
      // said - unless it has just said it on the line above, which is the whole
      // of `opening`.
      fillNoted: opening !== null,
      // No capture is in flight in a session that has just started, and the
      // one that may have been is not this session's to release: `stop()` on
      // the line at the top of this function has already restored whatever the
      // last one was holding.
      covers: null,
      measure: createTextMeasure(),
    };
    // A fresh session starts visible whatever the last one was left mid-way
    // through: a capture that hid the bar and never came back must not leak
    // into this one.
    uiVisible = true;
    printing = false;
    saving = false;
    exiting = false;
    applyVisibility();
    // `paint()`'s second half: the bar was handed its first state by
    // `mountBar` above, and the layer has to be told the tool the same way.
    layer.setCursor(toolCursor(pen.tool));

    layer.surface().addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, KEY_LISTENER);
    // The bar is `position: fixed`, so left in place it would repeat on every
    // printed sheet. These two cover `window.print()` from anywhere - the print
    // export path, the popup, Ctrl+P - with no background involvement at all.
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    window.addEventListener("resize", onWindowResize);
  };

  function stop(): void {
    // Before the hosts go, so a session torn down mid-stroke takes its
    // `window` listeners with it.
    endDrag(false);
    // And the same for one torn down mid-resize. Explicit rather than left to
    // `discardEditor` below, which does not end it: the two states are ended
    // for different reasons and neither should be a side effect of the other.
    endFrameDrag();
    // Discarded, not committed: the history and the layer are about to go with
    // the session, so committing would be a push onto a stack nobody will read
    // - and a mid-word label is not something to save on the way out.
    discardEditor();
    // And the covers come off, beside those two and for a stronger version of
    // the same reason. A session torn down mid-capture - the X pressed while a
    // save is in flight, a second START, a `PAGE_ANNOTATE_STOP` - would
    // otherwise leave the page it was covering with its text still hidden and
    // nothing left holding the handle that puts it back. The layer and the bar
    // going is a UI that vanished; this would be the user's own page broken
    // until they reload it.
    //
    // Above the `session = null` below, because the handle is on the session.
    releaseCovers();
    window.removeEventListener("keydown", onKeyDown, KEY_LISTENER);
    window.removeEventListener("beforeprint", onBeforePrint);
    window.removeEventListener("afterprint", onAfterPrint);
    window.removeEventListener("resize", onWindowResize);
    // A trailing measurement left pending would find no session and do nothing,
    // but clearing it is also what resets the leading edge - `start()` calls
    // `stop()` first, so the next session's first resize measures at once
    // instead of waiting out the previous one's burst.
    if (resizeTimer !== undefined) {
      clearTimeout(resizeTimer);
      resizeTimer = undefined;
    }

    const s = session;
    session = null;
    // The pointerdown listener goes with the host it is on.
    s?.bar.unmount();
    s?.layer.unmount();
  }

  /**
   * Leave annotate mode - the bar's X, and Esc.
   *
   * Asks and waits rather than unmounting itself, because the page is prepared
   * and **the background is what restores it**: it answers this by sending
   * `PAGE_ANNOTATE_STOP` (which is what takes the hosts down, above) and a
   * `PAGE_RESTORE { release: true }` (.plan/design.md §5). So a success
   * normally arrives with the bar already gone, and the only interesting case
   * is a failure - the page was not restored, we are still up, and the note is
   * the only place left to say so.
   */
  async function exit(): Promise<void> {
    if (exiting) return;
    exiting = true;
    try {
      const reply = await send({ type: "ANNOTATE_EXIT" });
      if (!reply.ok) setNote(reply.error);
    } catch (error) {
      // MV3 rejects a `sendMessage` with no receiver, and a worker that was
      // asleep and failed to wake is exactly when the user is stuck.
      setNote(`Leaving annotate mode failed: ${detail(error)}`);
    } finally {
      exiting = false;
    }
  }

  chrome.runtime.onMessage.addListener(
    (message: PageRequest, _sender, sendResponse: (r: PageResponse) => void) => {
      // Exactly three types, and `false` for everything else: prepare.js and
      // select-area.js listen in this same document (.plan/design.md §9.6).
      if (message?.type === "PAGE_ANNOTATE_START") {
        try {
          start(message);
          sendResponse({ ok: true, pong: true });
        } catch (error) {
          // Half a session up is worse than none: the background is about to
          // hear that annotate mode did not start, and it restores the page.
          // This covers a throw once `session` exists, which is all `stop()` can
          // see; a throw *before* that assignment undoes itself inside `start`,
          // for the reason written there.
          stop();
          sendResponse(fail("UNKNOWN", `Starting annotate mode failed: ${detail(error)}`));
        }
        return false;
      }

      if (message?.type === "PAGE_ANNOTATE_STOP") {
        stop();
        sendResponse({ ok: true, pong: true });
        return false;
      }

      if (message?.type === "PAGE_ANNOTATE_UI") {
        uiVisible = message.visible;
        // Dropping the layer's `pointer-events` is §4.3's answer to trap 2 - the
        // region selector and the drawing surface both want the pointer - but it
        // only redirects events that have not been claimed yet. A drag already in
        // flight holds its own capture-phase `pointermove`/`pointerup` on
        // `window` and calls `preventDefault()` on them, so it would carry on
        // drawing over the selector out of the very same events the selector is
        // reading. Ended and discarded rather than committed: half a mark made
        // while the user was aiming a capture rectangle is not a mark they asked
        // for, and it would be in the capture.
        if (!message.visible) {
          endDrag(false);
          // The editor goes the other way - committed rather than discarded -
          // and the asymmetry is deliberate. Half a stroke made while the user
          // was aiming a capture rectangle is not a mark they asked for; a
          // label they had finished typing is, and the alternative is a
          // `CARET_GLYPH` and a frame in the capture (the layer stays visible
          // through one). The frame has a second, independent guard on this
          // path - `setInteractive(false)` gives its container `display: none`
          // (§13.5) - and they must not share a boolean, so both stand.
          commitEditor();
          // The second bracket (§20), and the one that covers everything the
          // print dialog does not: a one-click PDF, a full-page screenshot, and
          // the region selector - which needs the covers as much as either,
          // because the region is cut out of the same painted page. After
          // `commitEditor()` for the reason `onBeforePrint` gives.
          applyCovers();
        } else {
          // And its release. The background sends this from a `finally`, so it
          // arrives whether the capture succeeded or threw (`setAnnotateUi`,
          // entrypoints/background.ts) - which is what makes it a safe place to
          // put somebody's text back.
          releaseCovers();
        }
        applyVisibility();
        sendResponse({ ok: true, pong: true });
        return false;
      }

      return false;
    },
  );
});
