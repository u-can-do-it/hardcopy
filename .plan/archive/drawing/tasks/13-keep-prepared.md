# 13 - prepare.ts holds the pass

**Goal**: `entrypoints/prepare.ts` can hold a pre-processing pass on behalf of
annotate mode, so an export reuses it instead of restoring the page and running
a second one under the marks.

**Files**
- `entrypoints/prepare.ts` (modify)

**Contracts**: `contracts.md` §13, verbatim - the `held` flag, the reuse branch
in `PAGE_PREPARE`, and `PAGE_RESTORE` only restoring when it may. The two
message fields (`hold`, `release`) landed in task 01.

Why this exists (`design.md` §4.2): `prepare.ts` calls `restore()` at the top
of **every** `PAGE_PREPARE` today. Run that under a drawn page and every mark
below an expanded section drifts by however tall that section turned out to be.

**This one file is the entire cross-cutting change.** `background.ts`,
`lib/dom/prepare.ts`, the CDP paths and the popup are all untouched by this
task - and by design, an export started from the *popup* while marks are up
comes out right without either of them knowing annotate mode exists.

Three changes and no more:

1. `let held = false;` at module scope, with the doc comment from the contract.
2. `PAGE_PREPARE`: when `held && active !== null`, reply with the held report,
   call `schedulePrint()` if asked, and return - no `restore()`, no second
   pass. `active !== null` is the guard that makes a stale flag fall through to
   a normal prepare rather than exporting an unprepared page. A normal,
   non-holding `PAGE_PREPARE` clears `held`; `message.hold === true` sets it.
3. `PAGE_RESTORE`: with `release: true`, clear `held` and restore as today.
   Without it, and while `held`, reply `{ ok: true, pong: true }` and do
   nothing.

`schedulePrint()`'s `afterprint` handler and its post-`print()` path call
`restore()` only when `held` is false. **Do not weaken `Prepared.undo`'s
idempotence** to achieve this - that idempotence is what makes the existing
double-restore safe.

**Out of scope**: anything outside this file. No background handler, no
`storage.session`, no per-tab tracking, no `tabs.onRemoved` listener - an
earlier draft of the plan had all of those and they were cut (`design.md` §5,
"Kept separate on purpose").

**Proof**
```bash
pnpm compile
```

Entrypoint wiring: one flag and two branches, in a file this repo has no
harness for. `CLAUDE.md` asks that `tests/` stay plain vitest with no DOM
harness, and adding one for two branches would be the wrong trade. The
behaviour is covered by the manual check below and by the §9 matrix row.

**Manual check**

1. Export a page with annotate mode **off**: pre-processing runs, the report
   reports, the page is restored afterwards. Nothing about the existing free or
   Pro paths changes. Do this first - it is the regression that matters.
2. Export twice in a row without annotate mode: the second export prepares
   from scratch, and the header block appears once, not twice.

The `held` path itself cannot be exercised until task 14 sends `hold: true`;
its manual checks live there and in task 15.

**Depends on**: 01
