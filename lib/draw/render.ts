/**
 * A `Shape` -> the SVG that draws it.
 *
 * Split in two on purpose (`.plan/design.md` §6): `shapeToSpec` is the whole of
 * the rendering logic and is pure - no DOM, no `document`, fully unit-tested in
 * `tests/draw-render.test.ts` - and `specToElement` is the only function here
 * that touches a document at all.
 *
 * **Nothing goes through `innerHTML`**, ever. A spec becomes real nodes via
 * `createElementNS`, `setAttribute` and `textContent`, which is both the safe
 * way to place a string the user typed into their own page and the only way the
 * text comes out of Chrome as *searchable* text in the exported PDF - the one
 * check `CLAUDE.md` says matters most.
 *
 * All six kinds are here. `symbol` is delegated to `lib/draw/symbols.ts`, whose
 * geometry is more than a tag and a box; the `switch` below names every member
 * of the union, so adding a seventh kind is a compile error rather than a shape
 * that silently renders as nothing.
 *
 * The two things this module shares with `symbols.ts` - the coordinate rounding
 * (`coord`, from `lib/draw/stroke.ts`) and the label font stack
 * (`LABEL_FONT_FAMILY`, from `lib/draw/css.ts`) - are imported from the modules
 * that own them rather than re-exported from here, which is what keeps
 * `render` -> `symbols` a one-way edge. Only `stroke.ts` is still a leaf:
 * `css.ts` imports `POPOVER_GAP_PX` from `./geometry`, so the rule that holds
 * down there is the one `css.ts` itself states - nothing in `geometry.ts` may
 * import from `css.ts`.
 *
 * `TEXT_LINE_HEIGHT` comes from `lib/draw/wrap.ts` for the same reason: it is
 * the number `layoutText` grew a label's box by, and the number each `<tspan>`
 * below steps down by. One owner, or a wrapped label paints outside the box it
 * was fitted to. `render.ts` and `layer.ts` are the only two modules in
 * `lib/draw/` allowed that import (contracts §18), and `wrap.ts` imports
 * nothing back.
 */

import { LABEL_FONT_FAMILY } from "./css";
import { FILL_OPACITY, HIGHLIGHT_WIDTH_SCALE } from "./model";
import { coord, strokePath } from "./stroke";
import { symbolSpec } from "./symbols";
import { TEXT_LINE_HEIGHT } from "./wrap";

import type { DrawRect, EllipseShape, RectShape, Shape, StrokeShape } from "./model";

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

/**
 * The highlighter's alpha, on top of `mix-blend-mode: multiply`.
 *
 * Multiply alone already keeps dark text readable - multiplying anything by
 * near-black leaves near-black - so this is not about legibility of the words.
 * It is about the *dark* end of `DRAW_COLORS`: at full alpha a near-black
 * highlighter is an opaque bar over a line of text, and an opaque bar is a
 * claim. The product does now ship a mark that can make it - `FillMode`'s
 * `"cover"` (`../types`) - so this comment no longer describes a thing that
 * does not exist, and the difference between the two is worth being exact
 * about, because it is **not the alpha**.
 *
 * **A cover is opaque because something is removed under it**: the characters
 * it paints over are hidden from the print, so they are not in the exported
 * PDF's text layer at all (`lib/dom/cover.ts`, `.plan/design.md` §19).
 * **A highlighter is translucent because nothing is**: the text under a stroke
 * stays in the PDF and stays searchable, and at 0.4 the stroke is a grey wash
 * you can read through - which is what keeps a dark one from looking like a
 * removal it never performs. Neither is a certified redaction (§21.3); only one
 * of them takes the words out. So raising this number does not turn a
 * highlighter into a cover, it turns it into a bar that lies.
 *
 * At 0.4 amber over white also lands at roughly `#fbd89d`, which is what a real
 * marker looks like, and it keeps two overlapping strokes from multiplying down
 * to mud.
 *
 * By eye, like `HIGHLIGHT_WIDTH_SCALE` and `STROKE_OPTIONS`; change it with a
 * real page of text in front of you.
 */
export const HIGHLIGHT_OPACITY: number = 0.4;

/**
 * The min corner plus a positive extent.
 *
 * A drag runs in any direction and nothing in the model promises a normalised
 * rect (see `isDegenerate`, which takes `Math.abs` for the same reason). SVG
 * treats a negative `width`, `height`, `rx` or `ry` as an error and draws
 * *nothing*, so a rectangle dragged up and to the left would vanish.
 */
function normalized(rect: DrawRect): DrawRect {
  return {
    x: Math.min(rect.x, rect.x + rect.width),
    y: Math.min(rect.y, rect.y + rect.height),
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

/**
 * The interior of a box-shaped mark, in one of the three `FillMode`s
 * (`../types`):
 *
 * - `"none"` - `fill: "none"` and no `fill-opacity` at all. Exactly the
 *   attribute this function replaced, so an outline mark renders today what it
 *   rendered before the field existed.
 * - `"tint"` - the pen colour at `FILL_OPACITY`. A read-through block.
 * - `"cover"` - the pen colour and **no alpha attribute of any kind**. A cover
 *   that quietly arrived with `fill-opacity: 0.35` would look almost right and
 *   would hide nothing, which is the one failure this mode exists to prevent.
 *
 * One helper for both kinds so a rect and an ellipse cannot drift into two
 * different-looking fills, the way `inkWidth` is one answer for the pencil and
 * the highlighter. Exhaustive on the union rather than a chain of `if`s, so a
 * fourth mode fails `pnpm compile` here instead of rendering as no interior.
 *
 * **`fill-opacity`, never `opacity`.** `opacity` fades the whole element, so a
 * tinted shape would arrive with a washed-out outline as well as a washed-out
 * interior - which is both worse to look at and, per the `rect` case below, the
 * wrong half of the mark to make faint. `fill-opacity` is the alpha of the
 * paint inside the path only, and the presentation attribute beats nothing the
 * page can say (the marks live in a closed shadow root anyway).
 */
function fillAttrs(shape: RectShape | EllipseShape): Record<string, string> {
  switch (shape.fill) {
    case "none":
      return { fill: "none" };
    case "tint":
      return { fill: shape.color, "fill-opacity": String(FILL_OPACITY) };
    case "cover":
      // The tint's attributes minus the alpha, and that subtraction is the
      // whole difference between the two modes at this level.
      return { fill: shape.color };
  }
}

/**
 * The width a stroke actually paints with: the highlighter is much fatter.
 *
 * The same expression as the private `inkWidth` in `lib/draw/model.ts`, which
 * is what `isDegenerate` measures a one-sample highlighter tap against - if
 * these two ever disagree, a tap is either kept and drawn at the wrong size or
 * discarded while it would have painted.
 */
function inkWidth(shape: StrokeShape): number {
  return shape.highlight ? shape.width * HIGHLIGHT_WIDTH_SCALE : shape.width;
}

/**
 * A stroke is a **filled outline**, not a stroked line: `fill` is the colour
 * and `stroke` is `none`. That is what `perfect-freehand` returns, and it is
 * why the pen has a variable width instead of looking like a pipe.
 *
 * An empty `d` is left in place rather than special-cased. It only happens for
 * a stroke with no samples at all, `isDegenerate` drops those before they reach
 * the layer, and an empty `d` paints nothing - which is the right answer anyway.
 */
function strokeSpec(shape: StrokeShape): NodeSpec {
  const attrs: Record<string, string> = {
    id: shape.id,
    d: strokePath(shape.points, inkWidth(shape)),
    fill: shape.color,
    stroke: "none",
  };
  if (shape.highlight) {
    attrs.opacity = String(HIGHLIGHT_OPACITY);
    // The highlighter *is* the pencil plus this line: multiply is what lets a
    // band of colour sit over a page of text instead of covering it up.
    // Presentation attributes cannot express a blend mode, so it goes in the
    // inline style - which is also what beats a page stylesheet, and what
    // LAYER_CSS deliberately leaves alone (it forces opacity on the host and
    // the <svg>, never on the marks).
    attrs.style = "mix-blend-mode:multiply";
  }
  return { tag: "path", attrs };
}

/** Pure, and the whole of the rendering logic. Fully tested. */
export function shapeToSpec(shape: Shape): NodeSpec {
  switch (shape.kind) {
    case "stroke":
      return strokeSpec(shape);

    case "line":
      return {
        tag: "path",
        attrs: {
          id: shape.id,
          // A two-point path rather than <line>: it is one tag fewer for the
          // renderer to branch on, and an open subpath so `stroke-linecap`
          // rounds both ends (a closed one would join them instead).
          d: `M ${coord(shape.from.x)} ${coord(shape.from.y)} L ${coord(shape.to.x)} ${coord(shape.to.y)}`,
          fill: "none",
          stroke: shape.color,
          "stroke-width": coord(shape.width),
          "stroke-linecap": "round",
        },
      };

    case "rect": {
      const rect = normalized(shape.rect);
      return {
        tag: "rect",
        attrs: {
          id: shape.id,
          x: coord(rect.x),
          y: coord(rect.y),
          width: coord(rect.width),
          height: coord(rect.height),
          // A colour block in one of three modes (`FillMode`, `../types`;
          // `.plan/design.md` §17-§18, which supersede the §11.1 lines that
          // used to stand here, which superseded §8):
          //
          // - `"none"` is an outline and nothing else.
          // - `"tint"` is `FILL_OPACITY` (0.35) on the *interior only*, via
          //   `fill-opacity` rather than `opacity`, so the outline stays solid.
          //   You can read through it, which is what makes it obvious to the
          //   person drawing it that nothing was removed. The precedent is
          //   `HIGHLIGHT_OPACITY` above, for exactly this reason.
          // - `"cover"` is **solid**: the pen colour, no alpha anywhere. What
          //   makes an opaque block over a password honest is not this
          //   attribute - it is that the characters under it are hidden from
          //   the print, so they are not in the exported PDF's text layer at
          //   all (`lib/dom/cover.ts`, `.plan/design.md` §19-§20). Read §21
          //   before changing anything about the mode: it lists the places a
          //   cover does *not* remove text, and a cross-origin iframe is a
          //   genuine leak.
          //
          // So the two filled modes are different marks rather than two values
          // of one alpha: a tint is not a redaction to be reached by raising
          // `FILL_OPACITY`, and a cover is not a tint to be softened by giving
          // it one. `fillAttrs` above is where each is spelled out.
          ...fillAttrs(shape),
          stroke: shape.color,
          "stroke-width": coord(shape.width),
        },
      };
    }

    case "ellipse": {
      const rect = normalized(shape.rect);
      return {
        tag: "ellipse",
        attrs: {
          id: shape.id,
          // The drag's bounding box, as a centre and two radii.
          cx: coord(rect.x + rect.width / 2),
          cy: coord(rect.y + rect.height / 2),
          rx: coord(rect.width / 2),
          ry: coord(rect.height / 2),
          // The rect's interior, on the rect's terms - read that case.
          ...fillAttrs(shape),
          stroke: shape.color,
          "stroke-width": coord(shape.width),
        },
      };
    }

    case "symbol":
      // A `<g>` of geometry, and the only kind with children. Delegated whole:
      // seven marks' worth of arrowheads and unit-square templates is a module,
      // not a case (contracts §7, .plan/design.md §6).
      return symbolSpec(shape);

    case "text": {
      // Reset on *every* tspan, including the first. An SVG tspan with no `x`
      // starts where the previous one's advance ended, so line two would begin
      // at the end of line one and the label would walk off to the right.
      const x = coord(shape.rect.x);
      // The same step `layoutText` grew the box by (`lib/draw/wrap.ts`), which
      // is why `TEXT_LINE_HEIGHT` has one owner: the lines have to land inside
      // the box the text was fitted to.
      const step = coord(shape.fontSize * TEXT_LINE_HEIGHT);
      // `lines` is a layout cache of `text` and `layoutText` is its only
      // producer, which never returns an empty array (contracts §18, §19.1).
      // A shape that reached here with one anyway would otherwise paint - and
      // export - nothing at all, so the label itself stands in as the single
      // line. Not a second rendering path: it joins the same one below.
      const lines = shape.lines.length > 0 ? shape.lines : [shape.text];
      return {
        tag: "text",
        attrs: {
          id: shape.id,
          x,
          y: coord(shape.rect.y),
          // Filled, not stroked: a label is glyphs, and `stroke-width` on text
          // is an outline around each character.
          fill: shape.color,
          "font-size": coord(shape.fontSize),
          "font-family": LABEL_FONT_FAMILY,
          // The click placed the label's top-left corner, so `y` is the top of
          // the text and not its baseline - which is what makes a label appear
          // where the caret was rather than one line-height above it.
          "dominant-baseline": "text-before-edge",
        },
        // One tspan per rendered line, and the `<text>` carries no `text` of
        // its own: all of the label lives in the children (`.plan/design.md`
        // §13.3). A one-line label is one tspan - no special case, or the
        // common label and the wrapped one would be two code paths.
        //
        // Each line goes on `NodeSpec.text` and nowhere else: `specToElement`
        // puts it on `textContent` of a real `<tspan>` node, which is text
        // content like `<text>`'s own. Never an attribute, never `innerHTML` -
        // it is a string the user typed into their own page, and it is also the
        // only route by which it comes out of Chrome searchable.
        //
        // An empty line is kept as a tspan with `""`, never dropped: it is a
        // blank line the user typed between two paragraphs, and dropping it
        // would close the gap up.
        children: lines.map((line, index) => ({
          tag: "tspan",
          // `dy` is a *relative* step, so the first line takes none - it sits
          // at the `<text>`'s own `y`, which is the top of the box.
          attrs: { x, dy: index === 0 ? "0" : step },
          text: line,
        })),
      };
    }

    default:
      return unsupported(shape);
  }
}

/**
 * Unreachable while the `switch` above names every member of `Shape`, which is
 * the point: add a kind to the union and this stops compiling.
 */
function unsupported(shape: never): never {
  const kind = (shape as { kind?: unknown }).kind;
  throw new Error(`shapeToSpec: unsupported shape kind ${String(kind)}`);
}

/**
 * The DOM adapter: `createElementNS` + `setAttribute` + `textContent`. Ten lines.
 *
 * `doc` is a parameter, and defaulted at call time rather than read at module
 * scope, so importing this module costs nothing in a worker or a test.
 *
 * `text` is applied *before* the children are appended, because `textContent`
 * replaces everything under the node - a spec carrying both keeps both.
 */
export function specToElement(spec: NodeSpec, doc: Document = document): SVGElement {
  const el = doc.createElementNS(SVG_NS, spec.tag);
  for (const [name, value] of Object.entries(spec.attrs)) el.setAttribute(name, value);
  if (spec.text !== undefined) el.textContent = spec.text;
  for (const child of spec.children ?? []) el.append(specToElement(child, doc));
  return el;
}
