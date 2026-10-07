---
description: Spec pass — turn a feature .md into design, contracts and task files
---

Read the file `$ARGUMENTS` — that is the feature I want built.

Do NOT write implementation code. This is the spec pass only.

## First, ground yourself in this repo

- `CLAUDE.md` has the architecture rules, invariants and pinned versions —
  treat them as constraints on the plan, not suggestions.
- Read `project.md` (product brief), `README.md` (state of the code and its
  **Deviations** list) and `BACKLOG.md` (what was deferred and why).
  If the feature contradicts any of them, say so before planning.

## Then produce a `.plan/` directory

1. `.plan/design.md` — architecture: which entrypoints/lib modules change,
   message flow between background ↔ content ↔ offscreen ↔ UI, key decisions
   and why, permissions impact, and what you deliberately are NOT doing.

2. `.plan/contracts.md` — every shared seam, exactly: types added to
   `lib/types.ts`, message names and payloads in `lib/messages.ts`, new
   settings keys and their defaults in `lib/settings.ts` / `stores/`, exported
   function signatures. Workers code against this and cannot ask you.

3. `.plan/tasks/01-<slug>.md`, `02-…`, … — one file per task, each with:
   - **Goal**: one sentence
   - **Files**: exact paths to create/modify (max ~5)
   - **Contracts**: which entries from contracts.md it must honor verbatim
   - **Out of scope**: what not to touch
   - **Proof**: an exact shell command, one of
     - `pnpm test tests/<name>.test.ts` (preferred — name the test file)
     - `pnpm compile` (typecheck only, for pure-types tasks)
     - `pnpm build` (only when the change is build/manifest-level)
   - **Depends on**: task numbers, or "none"

## Rules

- Task 01 is always "land the contracts": the types, message names and
  signatures from contracts.md as real code with stub bodies, `pnpm compile`
  green. Everything else depends on it.
- Every task touching `lib/` must ship or extend a test in `tests/`. A task
  whose only proof is `pnpm compile` needs a reason.
- One task = one reviewable diff. If it needs >5 files, or you can't state
  done-ness in one sentence, split it.
- UI-only tasks that cannot be unit tested must say so explicitly and give
  manual repro steps under a **Manual check** heading, in addition to
  `pnpm compile`.
- Prefer many small independent tasks over few big ones.

Then stop and show me the task list for review.
