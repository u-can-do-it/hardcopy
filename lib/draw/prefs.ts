/**
 * The bar's position and the pen it was last holding.
 *
 * `chrome.storage.local`, deliberately **not** `sync`: one position for every
 * site, and a position synced from a 34-inch monitor onto a laptop is a bar off
 * the edge of the screen. (It is clamped to the viewport at mount anyway -
 * `clampToViewport` in lib/draw/geometry.ts - but syncing it would still be
 * wrong.) This is also why `DrawPrefs` is not part of `Settings`: those live in
 * `storage.sync` and follow the profile, which is right for them and wrong for
 * a bar coordinate.
 *
 * Shaped after lib/settings.ts, down to the `str`/`num` helpers:
 * `mergeDrawPrefs` is pure and validating, so anything stored by an older
 * version - or corrupted, or hand-edited - degrades to the default for that one
 * field instead of throwing and leaving the bar unopenable. `loadDrawPrefs`
 * degrades the same way when the storage area itself is unreachable.
 *
 * Covered by tests/draw-prefs.test.ts (`mergeDrawPrefs`, the pure half).
 */

import type { DrawPrefs, DrawTool, FillMode, StrokeWidth, SymbolKind } from "../types";
// `MIN_TEXT_WIDTH_PX` is the floor a frame drag is clamped against, taken from
// the module that owns it rather than written again here. The edge is safe:
// `frame.ts` imports nothing but types, from `model.ts`, and nothing in
// `lib/draw/` imports this module, so it cannot close a cycle.
import { MIN_TEXT_WIDTH_PX } from "./frame";
import { DEFAULT_TEXT_WIDTH_PX, DRAW_ALL_TOOLS, DRAW_COLORS, DRAW_WIDTHS } from "./model";

export const DRAW_PREFS_KEY = "drawPrefs";

export const DEFAULT_DRAW_PREFS: DrawPrefs = {
  bar: { x: 24, y: 24 },
  tool: "pencil",
  symbol: "arrow",
  color: DRAW_COLORS[0],
  width: 4,
  fontSize: 16,
  textWidth: DEFAULT_TEXT_WIDTH_PX,
  fill: "none",
};

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

/**
 * A text box width, in CSS px: finite and inside `MIN_TEXT_WIDTH_PX .. 2000`,
 * or the default.
 *
 * This is §23's `num(r.textWidth, d.textWidth, MIN_TEXT_WIDTH_PX, 2000)`, lifted
 * out of `mergeDrawPrefs` and **exported**, because `textWidth` is the first
 * pref whose write side is a free continuous number rather than a choice off a
 * menu. Every other field is written from a fixed set the bar offers - five font
 * sizes, three stroke widths, seven symbols - so for them the merge clamp only
 * ever had corruption and older builds to repair. A frame drag has no such set:
 * `resizeFrame`'s floor is the same `MIN_TEXT_WIDTH_PX` this uses, and nothing
 * bounds its top, so a handle pulled to 2400 CSS px - a mouse move on a wide
 * monitor, or on any monitor below 100% page zoom - is a width the writer can
 * hand us.
 *
 * So the resize writer in `entrypoints/annotate.ts` calls this before it puts a
 * width into its in-memory `pen`, and `mergeDrawPrefs` calls it on the way to
 * storage. The width the session holds and the width storage holds are then the
 * same number by construction, rather than agreeing until the next reload
 * rediscovered the ceiling. Inlined in `mergeDrawPrefs` it would have to be
 * written a second time in the entrypoint - arithmetic in a file whose header
 * promises none (`CLAUDE.md`) - and the range would have two owners free to
 * drift apart.
 *
 * `unknown` and not `number`, so the one function serves both callers: a stored
 * `"240"`, a `NaN` and a missing key take the default by the same route on
 * either side of the seam.
 */
export function clampTextWidth(v: unknown): number {
  return num(v, DEFAULT_DRAW_PREFS.textWidth, MIN_TEXT_WIDTH_PX, 2000);
}

/**
 * A bar coordinate, in viewport px: finite and `>= 0`, or the default.
 *
 * Not clamped like `fontSize`, because a negative coordinate is not a position
 * that got out of range - it is not a position at all, and clamping it to 0
 * would tuck the bar into the very corner of the page rather than putting it
 * back where the user last saw it. There is deliberately no upper bound here
 * either: this runs where no viewport is knowable (the background reads prefs
 * to send them to the page), so fitting the position to *this* screen is
 * `clampToViewport`'s job at mount, and one clamp in one place is enough.
 */
function coord(v: unknown, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return fallback;
  return v;
}

/**
 * Validated against `DRAW_ALL_TOOLS`, which is exactly the members of
 * `DrawTool`, and against nothing about entitlement. Prefs record the wish; the
 * background's `isPro()` decides entitlement once, on entry into annotate mode,
 * for the whole mode. Gating here as well would quietly rewrite a Pro user's
 * stored pen the first time their key lapsed.
 */
function tool(v: unknown): DrawTool {
  return typeof v === "string" && (DRAW_ALL_TOOLS as readonly string[]).includes(v)
    ? (v as DrawTool)
    : DEFAULT_DRAW_PREFS.tool;
}

/**
 * The symbol palette as a lookup rather than a list, so the *compiler* keeps it
 * complete: an eighth `SymbolKind` in ../types fails to build until it is named
 * here, instead of silently falling back to the arrow at runtime.
 *
 * `Object.hasOwn` below, never `in`: `"constructor" in SYMBOL_KINDS` is true.
 */
const SYMBOL_KINDS: Readonly<Record<SymbolKind, true>> = {
  arrow: true,
  "arrow-double": true,
  check: true,
  cross: true,
  bang: true,
  star: true,
  pin: true,
};

function symbolKind(v: unknown): SymbolKind {
  return typeof v === "string" && Object.hasOwn(SYMBOL_KINDS, v)
    ? (v as SymbolKind)
    : DEFAULT_DRAW_PREFS.symbol;
}

/**
 * The three fill modes, as a lookup and for the same reason `SYMBOL_KINDS` is
 * one: the *compiler* keeps it complete, so a fourth `FillMode` in ../types
 * fails to build until it is named here instead of silently falling back to the
 * outline at runtime.
 *
 * `Object.hasOwn` below, never `in`: `"constructor" in FILL_MODES` is true.
 */
const FILL_MODES: Readonly<Record<FillMode, true>> = {
  none: true,
  tint: true,
  cover: true,
};

/**
 * A plain fallback, not a nearest member like `width`: the three modes are
 * choices off a menu rather than a quantisation of one number, so a mode this
 * module never wrote has no nearer neighbour than the default.
 *
 * The direction of that fallback matters more here than anywhere else in this
 * file. `"none"` is an outline, and `"cover"` is the one mode with a
 * consequence outside the mark - it hides the text underneath so it is not in
 * the exported PDF (`.plan/design.md` §19). Falling *to* the harmless one means
 * a corrupted or hand-edited blob can only ever cost somebody an outline they
 * did not ask for; it can never arm a removal they did not ask for.
 */
function fillMode(v: unknown): FillMode {
  return typeof v === "string" && Object.hasOwn(FILL_MODES, v)
    ? (v as FillMode)
    : DEFAULT_DRAW_PREFS.fill;
}

/**
 * The nearest member of `DRAW_WIDTHS`.
 *
 * Nearest rather than a plain fallback because the three widths are a
 * *quantisation* of one number: a 6 from an older build, or from a hand-edited
 * blob, means "the fat one", and 8 is a truer answer than the default. Ties go
 * to the thinner pen - `DRAW_WIDTHS` is ascending and only a strictly smaller
 * gap wins - so a 3 is 2 and a 6 is 4, deterministically rather than by
 * whichever way `Math.round` happened to lean.
 *
 * A non-number has no nearest member, so it takes the default, exactly as
 * `num` in lib/settings.ts treats a `stickyMinHeight` of `"tall"`. Notably
 * `"4"` is the default 4 by that route and not by parsing the string: storage
 * round-trips JSON, so a numeric string only ever arrives from corruption.
 */
function width(v: unknown): StrokeWidth {
  if (typeof v !== "number" || !Number.isFinite(v)) return DEFAULT_DRAW_PREFS.width;

  let best = DRAW_WIDTHS[0];
  let bestGap = Math.abs(v - best);
  for (const candidate of DRAW_WIDTHS) {
    const gap = Math.abs(v - candidate);
    if (gap < bestGap) {
      best = candidate;
      bestGap = gap;
    }
  }
  return best;
}

/** Validate and fill in an arbitrary stored blob. Never throws. */
export function mergeDrawPrefs(raw: unknown): DrawPrefs {
  const d = DEFAULT_DRAW_PREFS;
  if (typeof raw !== "object" || raw === null) return copyOf(d);

  const r = raw as Record<string, unknown>;
  const rb = (typeof r.bar === "object" && r.bar !== null ? r.bar : {}) as Record<string, unknown>;

  // Every field is rebuilt, so the result never aliases `raw` - not even
  // through `bar`, the one nested object here. A caller that mutates the prefs
  // it got back (the bar does, on every drag) must not reach into the blob
  // storage handed us, nor into DEFAULT_DRAW_PREFS.
  return {
    bar: { x: coord(rb.x, d.bar.x), y: coord(rb.y, d.bar.y) },
    tool: tool(r.tool),
    symbol: symbolKind(r.symbol),
    // A CSS colour is whatever the colour input returned, so it is only
    // checked for being a non-empty string - the same treatment, and the same
    // trim, as `filenameTemplate`.
    color: str(r.color, d.color).trim() || d.color,
    width: width(r.width),
    // Clamped, unlike `bar`: a 500 is a font size that ran out of range, and
    // 96 is the nearest thing we will draw to what was asked for.
    fontSize: num(r.fontSize, d.fontSize, 8, 96),
    // Clamped for the same reason, and against the same floor a frame drag has:
    // a stored 4 is a width that got out of range, and `MIN_TEXT_WIDTH_PX` is
    // the nearest box we will draw. 2000 is past any viewport worth typing a
    // label across. A blob written before this key existed has no `textWidth`
    // at all and comes back at the default - which is what this function is
    // for, so there is no migration.
    //
    // Through `clampTextWidth` rather than `num` directly, because the resize
    // that *writes* this field clamps with the same function: one owner for the
    // range, so what a session holds in memory cannot outrun what a reload
    // brings back. See its comment.
    textWidth: clampTextWidth(r.textWidth),
    // A blob written before this key existed has no `fill` at all and comes
    // back an outline - which is exactly what every rectangle and ellipse drawn
    // before this pass is, so there is nothing to migrate and no migration.
    fill: fillMode(r.fill),
  };
}

/** Fresh nested `bar`, so nothing can mutate the shared default. */
function copyOf(p: DrawPrefs): DrawPrefs {
  return { ...p, bar: { ...p.bar } };
}

export async function loadDrawPrefs(): Promise<DrawPrefs> {
  try {
    const got = await chrome.storage.local.get(DRAW_PREFS_KEY);
    return mergeDrawPrefs(got[DRAW_PREFS_KEY]);
  } catch {
    // The area can be unreachable (revoked permission, quota error, or an
    // injected script whose page went away mid-read). The bar opens at its
    // default position rather than not opening.
    return copyOf(DEFAULT_DRAW_PREFS);
  }
}

/**
 * Read-modify-write, in the shape of `patchSettings`. Returns the prefs as they
 * now stand.
 *
 * The write goes through `mergeDrawPrefs` for the same reason `patchSettings`
 * goes through `mergeSettings`: what lands in storage is then already
 * validated, so the next `loadDrawPrefs` has nothing to repair, and the value
 * returned is exactly the value stored. A failed `set` rejects rather than
 * being swallowed - the caller is the bar's `onMove`, and it is the one that
 * knows whether a lost position is worth a line in the note.
 */
export async function saveDrawPrefs(patch: Partial<DrawPrefs>): Promise<DrawPrefs> {
  const current = await loadDrawPrefs();
  const next = mergeDrawPrefs({
    ...current,
    ...patch,
    bar: { ...current.bar, ...(patch.bar ?? {}) },
  });
  await chrome.storage.local.set({ [DRAW_PREFS_KEY]: next });
  return next;
}
