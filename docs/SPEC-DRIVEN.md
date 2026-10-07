# How a feature gets built here

Every feature in this repo since the drawing tool has gone through the same
loop, and the loop is the reason `README.md`'s Deviations list reads like a set
of decisions rather than a set of apologies. This file writes the loop down so
the next feature does not have to rediscover it.

```
  docs/features/<FEATURE>.md      the brief - what and why, in prose
            │  /spec docs/features/<FEATURE>.md
            ▼
  .plan/design.md                 how, at the level of modules and message flow
  .plan/contracts.md              every shared seam, exactly
  .plan/tasks/NN-<slug>.md        one reviewable diff each
            │  /build
            ▼
  one commit per task             implementer + reviewer agent per task
            │
            ▼
  a docs task, last               README / BACKLOG / project.md / CLAUDE.md
            │
            ▼
  .plan/archive/<feature>/        so the next /spec starts on a clean .plan
```

## 1. The brief

A brief lives in `docs/features/` and is written for a person, not for a
compiler. `docs/features/DRAWING.md` is the worked example. What makes one
good:

- **The shape of it first** - what the user does, and what comes out.
- **The one fact the feature rests on**, named as such. Drawing's was "SVG
  `<text>` prints as real text". If that fact is wrong, the feature is wrong,
  and it is cheaper to find out on page one.
- **Permissions impact**, always, even when the answer is "none". This project
  defends `host_permissions: []` harder than it defends any piece of code.
- **Deliberately not doing** - the list that stops a spec pass from being
  generous with someone else's afternoon.
- **The decisions that are not the spec pass's to make**, at the end, so they
  get answered before `.plan/` is written rather than after.

## 2. `/spec <brief>`

Writes `.plan/design.md`, `.plan/contracts.md` and `.plan/tasks/NN-*.md`, then
stops for review. It writes **no implementation code**. The rules it follows are
in `.claude/commands/spec.md`; the ones worth knowing before you read a plan:

- Task 01 is always "land the contracts" - the types, message names and
  signatures as real code, `pnpm compile` green. Everything depends on it.
- Every task touching `lib/` ships or extends a test in `tests/`.
- One task = one reviewable diff, ~5 files at most.
- A task that cannot be unit tested says so and carries a **Manual check**.

**Probe tasks.** When a plan rests on a claim about Chrome that nothing in the
repo can answer, the claim becomes its own task, first, and it writes no code:
task 01 of the drawing pass probed whether SVG `<text>` survives into the PDF's
text layer, and task 30 probed whether `visibility: hidden` text stays out of
it. Both took minutes. Building on top of an unverified claim and finding out in
task 20 does not.

**Review the task list before `/build`.** That is the point of the stop.

## 3. `/build`

Runs each task with a fresh implementer agent and then a separate reviewer
agent, in dependency order, parallel only where the Files lists are disjoint.
Rules in `.claude/commands/build.md`. What it guarantees, and what it does not:

- It guarantees the Proof command was seen to pass, the contracts were followed
  verbatim, and `CLAUDE.md`'s invariants were checked by someone who did not
  write the diff.
- It does **not** guarantee the feature works. Half of this product's failures
  have been things a green suite reported as fine - see `CLAUDE.md`, "What a
  unit test cannot tell you". The print dialog is its own code path.

Commits are one per task, `task NN: <what it did>`.

## 4. Amending a plan mid-flight

Contracts are append-only once `/build` has started. When reality disagrees with
§14, you do not edit §14 - you append **§X.N, an amendment to §14**, in its own
`spec:` commit, and point the affected task files at it. When something is
abandoned, it is appended as **retracted**, with the measurement that killed it.
The two examples worth reading before writing one:

- `.plan/contracts.md` §31.4 - "the inset is per line, not per node", an
  amendment written after a real bug report.
- `.plan/contracts.md` §33.4 - "the lettering does not survive 16px", a
  retraction after the thing was built, rendered at four sizes and measured.
  The task file (`43-save-icon-labels.md`) keeps its title and gains a
  **NOT DONE, decided against** header, so nobody re-opens it by accident.

This is why the history reads as decisions: a plan that is quietly rewritten to
match what happened teaches the next person nothing.

## 5. The docs task, which is not optional

Every pass ends with a task that updates `README.md` (the Deviations list),
`BACKLOG.md`, `project.md` (the §9 matrix) and `CLAUDE.md` (invariants only).
Tasks 17, 29, 37 and 41 were those tasks.

The pass that shipped the preparation curtain **did not have one**, and the
curtain then existed in the code and in one BACKLOG line for a week while
`README.md` and `project.md` said nothing about it. That is the failure mode
this section exists to prevent: if a pass has no docs task, it is not finished,
it is only merged.

`project.md` is the brief and is kept in step with the code; `README.md` is
where the code is allowed to disagree with the brief, in writing, with a reason.

## 6. Between features

`/spec` writes into `.plan/`, so a finished plan is moved to
`.plan/archive/<feature>/` before the next one starts. The archive is worth
keeping in the tree rather than in git history alone - contracts get cited by
number from code comments, README deviations and task files, and a citation that
only resolves with `git show` does not get read.

## 7. The check that outranks all of the above

Open the exported PDF. Ctrl+F. Search a word from the page.

Nothing found means the build is broken, whatever the suite says.
