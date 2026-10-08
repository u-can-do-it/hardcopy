# How a feature gets built

```
  docs/features/<FEATURE>.md      the brief - what and why, in prose
            │  /spec docs/features/<FEATURE>.md
            ▼
  .plan/design.md                 how: modules and message flow
  .plan/contracts.md              every shared seam, exactly
  .plan/tasks/NN-<slug>.md        one reviewable diff each
            │  /build
            ▼
  one commit per task             implementer + reviewer agent per task
            │
            ▼
  a docs task, last               ARCHITECTURE / BACKLOG / project.md / CLAUDE.md
            │
            ▼
  .plan/archive/<feature>/        so the next /spec starts on a clean .plan
```

## 1. The brief

Lives in `docs/features/`, written for a person. It covers:

- what the user does, and what comes out;
- the one fact the feature rests on (e.g. "SVG `<text>` prints as real text");
- permissions impact, even when it is "none" - `host_permissions` stays `[]`;
- what is deliberately not being done;
- the open decisions, so they are answered before `.plan/` is written.

`.plan/archive/drawing/DRAWING.md` is an example.

## 2. `/spec <brief>`

Writes `.plan/design.md`, `.plan/contracts.md` and `.plan/tasks/NN-*.md`, then
stops for review. No implementation code. Rules in `.claude/commands/spec.md`:

- Task 01 lands the contracts as real code (types, messages, signatures) with
  `pnpm compile` green.
- Every task touching `lib/` ships or extends a test in `tests/`.
- One task = one reviewable diff, ~5 files at most.
- A task that cannot be unit tested carries a **Manual check**.
- A claim about Chrome that nothing in the repo can answer becomes a probe task,
  first, and writes no code.

Review the task list before `/build`.

## 3. `/build`

Runs each task with a fresh implementer agent and a separate reviewer, in
dependency order, parallel only where the Files lists are disjoint. One commit
per task, `task NN: <what it did>`. Rules in `.claude/commands/build.md`.

A green build proves the Proof commands passed and the contracts and invariants
were checked - not that the feature works. The print dialog needs a human.

## 4. Amending a plan mid-flight

Contracts are append-only once `/build` has started. A change is appended as
**§X.N, an amendment to §M** in its own `spec:` commit; an abandoned idea is
appended as **retracted**, with the reason. Never rewrite a section in place.

## 5. The docs task

Every pass ends with one: `docs/ARCHITECTURE.md` (how things work, and
any non-obvious decision with its reason), `BACKLOG.md`,
`project.md` (the §9 matrix) and `CLAUDE.md` (invariants only). A pass without
it is not finished.

## 6. Between features

Move the finished plan to `.plan/archive/<feature>/` before the next `/spec`.
Code comments cite contracts by number, so the archive stays in the tree - see
`.plan/README.md`.

## The check that outranks all of the above

Open the exported PDF, Ctrl+F, search a word from the page. Nothing found means
the build is broken, whatever the suite says.
