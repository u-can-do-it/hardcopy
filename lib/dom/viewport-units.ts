/**
 * Pin viewport-relative lengths to the pixels they occupy on screen, before a
 * single continuous page is measured and printed.
 *
 * This is why "single long page" kept coming back as two sheets with a band of
 * blank space after the content. In paged media, `vh` - and its `svh` / `lvh` /
 * `dvh` / `vmin` / `vmax` relatives - resolves against the *page box*, not the
 * browser window. So the paper we size to the measured height then becomes the
 * reference for every `100vh` on the page: a hero or a `min-height: 100vh`
 * wrapper that was 813px on screen is re-laid-out at the full paper height,
 * everything below it is pushed past the bottom edge, and Chromium adds a
 * second sheet. Measured on Chrome 152 (headless, `Page.printToPDF`, paper
 * sized to the measured document as `handleScreenExport` does):
 *
 *   | document                                    | sheets | with freeze |
 *   | ------------------------------------------- | ------ | ----------- |
 *   | 3,200px of plain content                    | 1      | 1           |
 *   | `min-height: 100vh` wrapper + 200px footer   | 2      | 1           |
 *   | `height: 100vh` hero + 3,200px content       | 2      | 1           |
 *   | `padding-bottom: 20vh`                       | 2      | 1           |
 *   | `min-height: calc(100vh - 60px)`             | 2      | 1           |
 *   | `html,body{height:100%}` + `min-height:100%` | 2      | 1           |
 *
 * Sizing the paper cannot fix this: raising the paper raises `100vh` with it,
 * so no height fits. The reference has to stop moving instead, which is what
 * pinning the used value does. Percentage heights are the same trap by another
 * spelling - `height: 100%` on `html` resolves against the initial containing
 * block, which is the page box too - so the two root elements are pinned as
 * well, whatever their declarations look like.
 *
 * Every pin is the value the element *already* computes to, so this is a no-op
 * on screen by construction, and reversible through the returned undo.
 */

import { overrideStyle, undoAll, type Undo } from "./style";

/**
 * A length written against the viewport's height.
 *
 * `vw` is deliberately absent: the paper is as wide as the content, so
 * horizontal units already resolve to what they did on screen, and pinning
 * them would only freeze layout that is not broken.
 */
export const VIEWPORT_HEIGHT_UNIT = /\d(?:\.\d+)?(?:s|l|d)?(?:vh|vmin|vmax|vb)\b/i;

/** Pure predicate - covered by tests/viewport-units.test.ts. */
export function usesViewportHeight(value: string): boolean {
  return VIEWPORT_HEIGHT_UNIT.test(value);
}

/** The part of `CSSStyleDeclaration` used here, so the tests need no DOM. */
export interface DeclarationLike {
  readonly length: number;
  item(index: number): string;
  getPropertyValue(property: string): string;
}

/** Which declarations in `style` are written in a viewport-height unit. */
export function viewportHeightProps(style: DeclarationLike): string[] {
  const props: string[] = [];
  for (let i = 0; i < style.length; i++) {
    const prop = style.item(i);
    if (prop && usesViewportHeight(style.getPropertyValue(prop))) props.push(prop);
  }
  return props;
}

/**
 * `html` and `body` anchor every percentage height on the page, and their own
 * containing block is the page box while printing. Cheaper to pin all three
 * properties unconditionally than to trace which descendant needs them.
 */
export const ROOT_PINNED_PROPS = ["height", "min-height", "max-height"];

/** Nothing to gain from pinning these: they do not follow the page box. */
const UNPINNABLE = new Set(["", "auto", "none", "normal"]);

export interface FreezeResult {
  /** Elements pinned. Zero is the common, healthy case. */
  count: number;
  undo: Undo;
}

type Targets = Map<HTMLElement, Set<string>>;

function want(targets: Targets, el: HTMLElement, props: Iterable<string>): void {
  let set = targets.get(el);
  if (!set) targets.set(el, (set = new Set()));
  for (const prop of props) set.add(prop);
}

/**
 * Collect selectors that declare a viewport-height length, through grouping
 * rules (`@media`, `@supports`, `@layer`, `@container`) and CSS nesting alike.
 *
 * `@media print` blocks are walked like any other, and that is safe: what gets
 * pinned is the element's *computed* value - whatever it renders as right now -
 * so a rule that does not currently apply contributes its selector and nothing
 * else.
 */
function collectRules(rules: CSSRuleList, into: Map<string, Set<string>>): void {
  for (const rule of Array.from(rules)) {
    const nested = (rule as CSSGroupingRule).cssRules;
    if (nested) collectRules(nested, into);

    const styleRule = rule as CSSStyleRule;
    if (!styleRule.selectorText || !styleRule.style) continue;

    const props = viewportHeightProps(styleRule.style);
    if (props.length === 0) continue;

    let set = into.get(styleRule.selectorText);
    if (!set) into.set(styleRule.selectorText, (set = new Set()));
    for (const prop of props) set.add(prop);
  }
}

/** Pin every viewport-relative length on the page to its current pixel value. */
export function freezeViewportUnits(): FreezeResult {
  const selectors = new Map<string, Set<string>>();
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      collectRules(sheet.cssRules, selectors);
    } catch {
      // A cross-origin stylesheet served without CORS headers denies CSSOM
      // access. Its `100vh` rules stay invisible to us; the root pinning and
      // the inline pass below are what is left. Not worth telling the user
      // about - most such sheets are fonts and resets.
    }
  }

  const targets: Targets = new Map();

  for (const [selector, props] of selectors) {
    let matched: NodeListOf<HTMLElement>;
    try {
      matched = document.querySelectorAll<HTMLElement>(selector);
    } catch {
      continue; // A nested rule may serialise as `& .foo`, which is not standalone.
    }
    for (const el of Array.from(matched)) want(targets, el, props);
  }

  // Inline `style="height: 100vh"` never appears in a stylesheet.
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[style]"))) {
    const props = viewportHeightProps(el.style);
    if (props.length > 0) want(targets, el, props);
  }

  for (const root of [document.documentElement, document.body]) {
    if (root) want(targets, root, ROOT_PINNED_PROPS);
  }

  const undos: Undo[] = [];
  for (const [el, props] of targets) {
    const computed = getComputedStyle(el);
    const decls: Array<[string, string]> = [];
    for (const prop of props) {
      const value = computed.getPropertyValue(prop);
      if (!UNPINNABLE.has(value)) decls.push([prop, value]);
    }
    if (decls.length > 0) undos.push(overrideStyle(el, decls));
  }

  return { count: undos.length, undo: () => undoAll(undos) };
}
