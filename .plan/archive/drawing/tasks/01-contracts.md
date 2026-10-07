# 01 - Land the contracts

**Goal**: The shared drawing types and the whole annotate message protocol
exist as real code, and `tsc` is happy with them.

**Files**
- `lib/types.ts` (modify - append the four additions)
- `lib/messages.ts` (modify - three new `BgRequest`s, `AnnotateSuccess`, three
  new `PageRequest`s, `hold` on `PagePrepareRequest`, `release` on
  `PageRestoreRequest`, and the header comment's third channel)

**Contracts**: `contracts.md` §1 and §2, verbatim - every name, every field,
every doc comment.

Three things stay **unchanged**, and a reviewer should check it: `ErrorCode`,
`PageResponse`, and `ExportRequest` / `CaptureRequest`. The two new fields go
on the *page* messages only (§2.3, §2.5) - the export handlers are deliberately
left out of this feature.

**Out of scope**: any behaviour at all. No `lib/draw/`, no background handler,
no `prepare.ts` branch, no popup button. Nothing imports these yet, and that is
fine - task 01 exists so the next sixteen tasks cannot disagree about a name.

**Proof**
```bash
pnpm compile
```

Typecheck-only by nature: this task adds no runtime surface. Every later task
that touches `lib/` ships a test.

**Manual check - the one that gates phase 2**

Do this before anyone writes another line. It needs no code, and it answers the
single unproven claim the feature rests on (`design.md` §1): that Chrome
vectorises SVG `<text>` into *searchable* text in both print paths.

1. Open any ordinary article page, open devtools, and in the console:
   ```js
   document.body.insertAdjacentHTML("afterbegin",
     '<svg width="400" height="60" style="position:relative;z-index:9999">' +
     '<text x="10" y="40" font-size="28" fill="red">zzqqxx-probe</text></svg>');
   ```
2. Ctrl+P, Save as PDF, tick Background graphics.
3. Open the PDF and Ctrl+F for `zzqqxx-probe`.

Found: phase 2 is safe, carry on. **Not found: stop and report it** - the text
tool, the numbered pins and the §9 matrix row all have to be rethought, and the
rest of the plan should not be built on top of a wrong assumption.

**Depends on**: none
