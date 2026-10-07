# 40 - The wrapper is created in the parent's namespace

**Goal**: covering SVG text hides it in place instead of dropping it out of
layout.

**Files**
- `lib/dom/cover.ts`

**Contracts**: `contracts.md` §31.3, verbatim.

`doc.createElement("span")` is namespace-blind, so a cover over `<svg><text>`
wraps the glyphs in an HTML `<span>` **inside the SVG namespace**. Such an
element renders nothing, so the `<text>`'s rect collapsed from
`[40,206,214,24]` to `[40,200,0,0]` - the glyphs left layout instead of staying
hidden in place, and the rest of the label shifted. That breaks §17.1's
"reflows nothing", and whatever hid the text, it was not `visibility: hidden`.

Create the wrapper in the parent's namespace: a `<tspan>` (via
`createElementNS`) for SVG content, a `<span>` otherwise. `restore()` already
undoes either cleanly - confirm that rather than assuming it.

`visibility: hidden` still has to be the mechanism, and it has to be forced, for
the reason the existing comment gives.

A mark's own `<text>` is never reachable, because the layer is a closed shadow
root - so this only ever touches the page's own SVG. Task 39 must not have
changed that; if it did, say so rather than working around it.

**Out of scope**: the ink inset (38), shadow roots (39), the pure half.

**Proof**
```bash
pnpm compile
```

Typecheck-only, for task 35's reason. No rule is added here - only the element's
namespace.

**Manual check**

1. On a page with an inline SVG chart carrying axis labels, cover one label,
   export, and Ctrl+F it: **not found**.
2. The **other** labels have not moved - that is the half this task is about.
   Before the fix the covered label's box collapsed and the rest shifted.
3. `restore()` after: the SVG reads exactly as before, and
   `svg.querySelectorAll("tspan").length` is back to what it was.

**Depends on**: 39
