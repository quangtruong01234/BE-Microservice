---
name: sweep
description: Run the TryBuy backlog sweep loop for Codex: pick open backend work, implement or audit it, validate, and close handoffs. Use when the user says "$sweep", "sweep", "weekly sweep", "sweep audit", "sweep propose", or asks Codex to work through the backend backlog.
---

# $sweep - Backlog Sweep Skill

Use this skill to run the recurring audit, record, fix, and close loop without
re-explaining the workflow each time.

## How To Invoke

```text
$sweep            # fix the single highest-priority open item
$sweep 3          # fix up to 3 open items in one autonomous batch
$sweep audit      # audit-only; record new issues, do not fix
$sweep propose    # propose new roadmap features, do not implement
$sweep PERF-05    # fix a specific backlog item
```

## Work Sources

In fix mode, read both sources and merge their open work:

- `ai-docs/agent-handoff/snapshot.md`: Active Tasks, perf backlog, roadmap
  unchecked items, and Known Issues.
- `../.agent-local/backend-handoff.md`: FE-to-BE inbox at the MCR workspace root.
  Only entries under Open count; Done is history.

## Mode: Fix

1. Read the work sources.
2. If `snapshot.md` already has an `IN-PROGRESS (sweep)` marker, resume that
   item instead of picking a new one.
3. Otherwise pick the top item:
   - Critical before Important before Minor.
   - Respect any "TOP FIX (next)" note.
   - Treat backend-handoff Open entries as Critical when FE has no mitigation.
   - Treat confirm-only handoff entries as cheap and close them when encountered.
   - If the user names a specific item, pick that item.
4. Write one progress marker under Active Tasks in `snapshot.md`:
   `> IN-PROGRESS (sweep): <item id> - step: <researching|implementing|validating|self-testing|closing>`
5. Follow repo orchestration from `AGENTS.md`:
   - 1 service, clear scope: implement directly.
   - More than 1 file or TCP/RabbitMQ: researcher, then implement.
   - More than 2 services or migration: researcher, planner, implement,
     code-reviewer.
   - Bug/crash: use `$debug` directly.
6. Implement with minimal diff. New SQL migrations go in `database/` and must be
   idempotent; remember social runs `synchronize:false`.
7. Validate with the repo Definition of Done:
   - Format/lint changed TypeScript files as required by `AGENTS.md`.
   - Run `npx tsc --noEmit` after TypeScript changes.
   - Run endpoint self-tests when endpoints change.
8. Close the loop:
   - Remove the `IN-PROGRESS (sweep)` marker from `snapshot.md`.
   - Remove or annotate the finished item in `snapshot.md`.
   - Append completed-work summary to `ai-docs/agent-handoff/CHANGELOG.md`.
   - If the item came from `backend-handoff.md`, move it from Open to Done there.
   - Evaluate FE impact and write to the correct FE handoff file.
9. If batching, repeat until the requested count is done or a real blocker is hit.

Never leave a sweep item half-closed. If blocked, record the evidence, preserve
the progress marker, and report the exact next action needed.

## Mode: Audit

Use for `$sweep audit` or `$sweep audit <area>`.

1. Scope defaults to the full backend; `<area>` narrows it.
2. Hunt for new issues only. Dedupe against `snapshot.md` and
   `../.agent-local/backend-handoff.md` Open and Done.
3. Do not edit implementation code in audit mode.
4. Look for:
   - Contract mismatches between gateway DTOs, microservice handlers, entities,
     and FE handoff.
   - Missing guards, filters, timeouts, error handlers, ack/nack handling.
   - N+1 TCP/DB calls, unbounded lists, missing indexes, cache gaps.
5. Record findings in `snapshot.md` using the existing backlog convention:
   severity, location, failure scenario, and suggested fix.
6. Report the new findings and the recommended top fix.

## Mode: Propose

Use for `$sweep propose`.

1. Read `snapshot.md` and recent `ai-docs/agent-handoff/CHANGELOG.md`.
2. Propose 3 to 5 net-new features ranked by value and effort.
3. Include affected services, migration yes/no, and FE impact yes/no.
4. Do not implement. Append chosen items to the Feature Roadmap only after the
   user selects them.

## Always Apply

- Do not mark an item done with TypeScript errors, lint errors, or failed
  self-tests.
- Keep diffs minimal and scoped to the chosen item.
- Do not do drive-by refactors.
- Preserve unrelated user changes in the dirty worktree.
- Never print secrets, cookies, tokens, or plaintext credentials in final output.
