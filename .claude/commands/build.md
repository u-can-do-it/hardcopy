---
description: Implement every task in .plan/tasks/ with a worker + reviewer pair each
---

Work through `.plan/tasks/` in dependency order. $ARGUMENTS

Do not implement anything in this session — you are the orchestrator.
For each task, spawn a fresh Agent:

**Implementer**
> Read `CLAUDE.md`, `.plan/design.md`, `.plan/contracts.md` and
> `.plan/tasks/<file>`. Implement exactly that task, nothing else.
> Follow `CLAUDE.md` — its invariants are not negotiable.
> Then run the task's Proof command and paste its real output. If it fails,
> fix and rerun until green. Do not edit `.plan/contracts.md` — if a contract
> is wrong, stop and report it instead of working around it.

**Reviewer** (separate agent, after the implementer returns)
> Review the working-tree diff against `.plan/tasks/<file>` and
> `.plan/contracts.md`. Check: contracts honored verbatim, nothing outside the
> task's Files list touched, every invariant in `CLAUDE.md` upheld
> (especially: no `debugger` reachable from a free-tier path, logic kept
> out of entrypoints), and the Proof command
> genuinely passes when you run it yourself.
> Reply with a findings list, or the single word PASS.

If not PASS, hand the findings to a NEW implementer agent and repeat — max 2
rounds, then stop and tell me.

## Orchestration rules

- Run tasks in parallel only when their Files lists are disjoint; serialize
  anything else. `lib/types.ts` and `lib/messages.ts` are shared — treat any
  two tasks touching them as serial.
- After each PASS, run `pnpm compile` before committing; commit with the task
  id in the message.
- Print a one-line status per task as you go.
- Never mark a task done on a proof command you did not see pass.
- When all tasks are done, run `pnpm test && pnpm compile` once over the whole
  repo and report the result.
