# 04 - Undo, redo, clear

**Goal**: `lib/draw/history.ts` is a bounded snapshot stack over the shape
list, with a `clear()` that Ctrl+Z can take back.

**Files**
- `lib/draw/history.ts` (create)
- `tests/draw-history.test.ts` (create)

**Contracts**: `contracts.md` §8, verbatim - `HISTORY_LIMIT`, `DrawHistory`,
`createHistory`. A stack of **snapshots**, not of operations.

**Out of scope**: keyboard handling (that is the entrypoint), the bar's
enabled/disabled rendering, persistence.

**Proof**
```bash
pnpm test tests/draw-history.test.ts
```

Cover at least: `push` then `undo` then `redo` round-trips; `push` after an
`undo` drops the redo tail; `undo` on a fresh history returns `false` and
changes nothing; `clear()` empties `shapes()` **and** `undo()` brings them all
back; `canUndo` / `canRedo` track the stack; `version()` bumps on every change
and not on a no-op `undo`; more than `HISTORY_LIMIT` pushes keeps the newest
snapshots and never grows past the limit.

**Depends on**: 02
