# 39 - A cover reaches into the page's open shadow roots

**Goal**: text inside a page's open shadow root is hidden by a cover painted
over it, instead of being left in the PDF.

**Files**
- `lib/dom/cover.ts`

**Contracts**: `contracts.md` §31.2, verbatim.

**This is a leak, and it is the direction the feature exists to prevent.**
`createTreeWalker` does not cross a shadow boundary, so a cover drawn directly
over a component's text painted an opaque block and left every word of it in
the exported text layer. Confirmed against the shipped code: the shadow `<p>`'s
markup came back untouched.

`hideTextUnder` descends into open shadow roots - for every element walked, if
`el.shadowRoot` is non-null, walk that root the same way. The field pass needs
the same treatment: `querySelectorAll` does not cross either.

**A closed shadow root stays unreachable**, and that one is a genuine limit for
§21's list, the same shape as a cross-origin iframe: `attachShadow({mode:
"closed"})` hands the page a root nothing else can get at. Task 41 documents it.

**This is also what keeps the walk off our own marks**, so do not "fix" that:
the layer and the bar are closed roots hanging off `documentElement`. Verify
that still holds after your change - a walk that reached the layer would split
the text of our own labels.

**Out of scope**: the ink inset (task 38), the SVG wrapper (task 40). Do not
change the pure half.

**Proof**
```bash
pnpm compile
```

Typecheck-only for the reason task 35 gives: `tests/` is plain vitest on
`environment: "node"` with no DOM harness, which `CLAUDE.md` asks stay that way,
and this task adds no rule - only reach. If you find yourself writing a
predicate, it belongs in the pure half.

**Manual check**

1. On a page with a web component (or build one in the console with
   `attachShadow({mode:"open"})` holding a paragraph), cover its text, export,
   and Ctrl+F a word from it: **not found**.
2. Do the same with `{mode:"closed"}`: the word **is** found. Expected, and
   task 41 documents it.
3. Cover a paragraph on an ordinary page and confirm nothing regressed.
4. Draw a **text label** of our own over a covered area and export: the label's
   own text is still in the PDF and still findable. If it is not, the walk has
   reached inside our layer.

**Depends on**: 38
