# .plan/

`/spec` writes the **current** plan here: `design.md`, `contracts.md` and
`tasks/NN-*.md`. `/build` reads `tasks/` and nothing else in this directory.

A finished plan moves to `archive/<feature>/` so the next `/spec` starts clean.

## Resolving a citation

Code comments, README deviations and task files cite contracts by number -
"`.plan/contracts.md` §32.4", "`.plan/design.md` §4.2". There are 147 such
citations in the tree and they were written before the archive existed, so:

| Written as              | Now lives in                          |
| ----------------------- | ------------------------------------- |
| `.plan/contracts.md §N` | `.plan/archive/drawing/contracts.md`  |
| `.plan/design.md §N`    | `.plan/archive/drawing/design.md`     |
| `.plan/tasks/NN-*.md`   | `.plan/archive/drawing/tasks/`        |

Every §1-§33 citation in the tree today belongs to the drawing feature and its
three follow-up passes (the cover, the ink inset, the curtain). Section numbers
are unique across that whole plan, so a number is enough to find the entry - and
they are append-only: an entry that changed was amended or retracted further
down, never rewritten in place. See [../docs/SPEC-DRIVEN.md](../docs/SPEC-DRIVEN.md).

The next feature's plan starts a fresh numbering in a fresh `contracts.md`, so
cite it with the feature in front - "<FEATURE> contracts §3".
