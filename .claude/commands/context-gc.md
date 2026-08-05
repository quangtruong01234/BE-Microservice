# /context-gc — Context Garbage Collection

Use this command periodically (or when snapshot.md feels bloated) to compact
the auto-loaded context back to a lean live picture. Auto-loaded tokens are
paid on EVERY session — finished work in snapshot.md is pure recurring cost.

## How to invoke

```
/context-gc          # compact snapshot.md + verify the context set is consistent
/context-gc report   # measure only — report sizes and what WOULD move, change nothing
```

## Where content belongs (the routing table)

| Content | Belongs in |
|---|---|
| Live picture: active/open work, open questions, prod-owed items | `ai-docs/agent-handoff/snapshot.md` (auto-loaded — keep LEAN) |
| Finished milestones, completed tasks, rationale of past changes | `ai-docs/agent-handoff/CHANGELOG.md` (not auto-loaded) |
| Ops facts: deploy, pm2, nginx, env, EC2, applied-migration ledger, GHN ops, seed | `ai-docs/agent-context/ops-runtime.md` (on-demand) |
| Residual behaviours of SHIPPED fixes (not open bugs) | `ai-docs/agent-context/known-behaviors.md` (on-demand) |
| Rules/conventions | `ai-docs/agent-context/*.md` — never duplicated in snapshot |

## Procedure

1. **Measure first**: `wc -w` / `wc -l` on `ai-docs/agent-handoff/snapshot.md`
   (and any other auto-loaded file that looks bloated). Record the numbers.
2. **Sweep Active Tasks**: every `[x] DONE` item, shipped-feature narrative, or
   verification log → move its full text to `CHANGELOG.md` (append, keep
   chronological), leaving at most a one-line pointer in snapshot if the item
   still gates something.
3. **Sweep Known Issues**: entries describing residual/deliberate behaviour of
   a shipped fix → move the detail to `known-behaviors.md`, keep a one-line
   summary in snapshot pointing there. Entries that are genuinely OPEN bugs
   stay in snapshot.
4. **Sweep Ops/Runtime**: ops facts and applied-migration notes → move to
   `ops-runtime.md`, keep only the section pointer in snapshot.
5. **Dedupe**: anything in snapshot that repeats a rule already in
   `ai-docs/agent-context/` → delete from snapshot (keep the context file
   version).
6. **Verify the context set** while you're here:
   - Both keyword tables (in `.claude/CLAUDE.md` AND `AGENTS.md`) list every
     on-demand context file — including any file this GC created — and no
     deleted file.
   - No content was LOST: everything removed from snapshot exists verbatim (or
     summarized with a pointer) in its destination file.
7. **Measure after**: `wc -w` / `wc -l` again.

## Report format

- Before → after word/line counts per touched file.
- What moved where (per section, one line each).
- Anything deliberately kept in snapshot despite being old (and why).
- Keyword-table fixes made, if any.

## Rules

- Docs-only: never touch `.ts` files in this command.
- Never delete content outright — GC moves it; only true duplicates of
  context-file rules are dropped.
- Do not commit — leave the changes for the user to review unless asked.
