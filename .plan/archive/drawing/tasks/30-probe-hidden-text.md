# 30 - Probe: does `visibility: hidden` text stay out of the PDF?

**Goal**: find out, before anything is built on it, whether Chrome omits
`visibility: hidden` text from the exported PDF's text layer.

**Files**: none. This task writes no code.

**Contracts**: none. It decides whether §26 is buildable as written.

**Why this exists.** The entire third pass rests on one unverified claim
(`.plan/design.md` §17.2): that hiding a text run with `visibility: hidden`
takes it out of the text layer Chrome builds for the printed PDF, while
preserving layout so nothing reflows. `CLAUDE.md` is explicit that this class
of claim cannot be checked from here - *"headless renders, unit tests and
inspecting injected CSS have all reported single-page mode working while the
real dialog disagreed"* - and the one check it says matters most is exactly
this one: open the PDF, Ctrl+F, search a word.

If the claim is false, the cover tool cannot work this way and **tasks 31-37
must not be built**. Report it instead.

**The probe**

Do this before anyone writes another line. It needs no build.

1. Open any ordinary article page. In the devtools console:
   ```js
   document.body.insertAdjacentHTML("afterbegin",
     '<p style="font:20px system-ui">' +
     'aaprobe-visible ' +
     '<span style="visibility:hidden">zzprobe-hidden</span> ' +
     'aaprobe-after</p>');
   ```
2. Note where `aaprobe-after` sits on screen - there should be a gap where the
   hidden word is, and `aaprobe-after` should be pushed right by exactly that
   much. That is the layout half of the claim.
3. Ctrl+P, **Save as PDF**, tick Background graphics.
4. Open the PDF. Ctrl+F for each of:
   - `aaprobe-visible` - **must be found** (proves the search works at all)
   - `aaprobe-after` - **must be found**
   - `zzprobe-hidden` - **must NOT be found**
5. Also select the line with the mouse and copy it. Paste it somewhere. The
   hidden word must not be in what you pasted - `Ctrl+F` and the copy buffer
   read the same text layer, but checking both costs five seconds and they have
   been known to disagree.

**Then do it once more over real text**, because step 1 builds the node itself
and the real tool wraps a run inside a paragraph the page already had:

6. On the same page, in the console, pick a paragraph and hide four words in
   the middle of it:
   ```js
   const p = [...document.querySelectorAll("p")].find(el => el.textContent.trim().split(/\s+/).length > 12);
   const t = [...p.childNodes].find(n => n.nodeType === 3 && n.data.trim().length > 40);
   const words = t.data.split(" ");
   console.log("hidden words will be:", words.slice(4, 8).join(" "));
   const mid = t.splitText(words.slice(0, 4).join(" ").length);
   mid.splitText(words.slice(4, 8).join(" ").length + 1);
   const span = document.createElement("span");
   span.style.visibility = "hidden";
   mid.replaceWith(span);
   span.append(mid);
   ```
7. Confirm on screen that the paragraph did **not** reflow - the words after
   the gap are exactly where they were, and only the four words vanished.
8. Ctrl+P, Save as PDF, and Ctrl+F for the four words the console logged.
   **Must not be found.** Ctrl+F a word from later in the same paragraph:
   **must be found.**

**Proof**

```bash
pnpm compile
```

Nothing to compile and nothing to test - this task adds no code. The command is
here only so the task has a green gate like every other; **the real proof is
the eight steps above, and they need a human.** Paste what you actually saw for
each of the four searches.

**Report one of three outcomes**

- **Hidden text not found, no reflow** - the claim holds. Build tasks 31-37.
- **Hidden text not found, but the paragraph reflowed** - something is wrong
  with the probe, not with Chrome; `visibility: hidden` does not reflow. Redo
  step 6 before concluding anything.
- **Hidden text IS found** - stop. `.plan/design.md` §17.2 lists the three
  fallbacks (same-size spacers, `display: none` and accepting reflow,
  `clip-path`) and says why none of them should be chosen on a guess. This needs
  a design decision, not a workaround.

**Depends on**: none. Everything from 31 on depends on this.

---

## Result: PASSED

Run by the user at a real Chrome print dialog, on a live article page
(sportowefakty.wp.pl), saved to PDF and searched in the PDF viewer.

- `zzprobe-hidden` - **not found.** Searching `hidd` in the exported PDF
  returns **0/0**.
- `aaprobe-visible` and `aaprobe-after` - **both found and both rendered.**
- **Layout preserved**: the two visible probes sit either side of a gap exactly
  the width of the hidden word, which is the whole reason for
  `visibility: hidden` over `display: none`.

So both halves of the claim hold: hidden text is absent from the exported PDF's
text layer, and hiding it moves nothing. Tasks 31-37 are cleared to build on it.

**One caveat, recorded rather than glossed:** steps 1-5 were run - the
synthetic case, where the probe builds the `<span>` itself. Steps 6-8, which
wrap a run *inside a paragraph the page already had*, were not, and that is the
shape the real tool takes. There is no reason to expect them to differ - the
mechanism is the same computed style on the same kind of inline box - but the
first two steps of `.plan/tasks/35-cover-dom.md`'s Manual check exercise
exactly that case against real text, and they are where it would show up.
