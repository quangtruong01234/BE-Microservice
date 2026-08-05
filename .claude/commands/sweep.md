# /sweep — Weekly Backlog Sweep Command

Use this command to run the recurring audit → record → fix loop in one shot,
without re-explaining the workflow each time.

## How to invoke

```
/sweep            # fix the single highest-priority open item (snapshot.md + backend-handoff.md)
/sweep 3          # fix up to 3 open items in one autonomous batch
/sweep audit      # audit-only: find new bugs/gaps/perf issues, record to snapshot, DO NOT fix
/sweep propose    # propose new features, append to the Feature Roadmap in snapshot, DO NOT implement
```

## Work sources (both are checked in fix mode)

1. `ai-docs/agent-handoff/snapshot.md` — Active Tasks (perf backlog, roadmap
   `[ ]` items) + Known Issues.
2. `../.agent-local/backend-handoff.md` — the FE→BE inbox at the `MCR/`
   workspace root (outside the repo, NEVER commit or copy it in). Only its
   **Open** section counts; **Done** is history.

---

## Mode: fix (default, `/sweep` or `/sweep N`)

1. Read BOTH work sources and merge their open items:
   - `ai-docs/agent-handoff/snapshot.md` — **Active Tasks** (perf backlog,
     roadmap `[ ]` items) and **Known Issues**.
   - `../.agent-local/backend-handoff.md` — every entry under **Open**
     (missing data / wrong response / wrong request contract reported by FE).
2. Pick the top item across the merged list (🔴 > 🟡 > 🟢; respect any
   "TOP FIX (next)" note). Rank backend-handoff Open entries as 🔴 when FE has
   no mitigation (broken UX / console errors on every load) and 🟡 when the
   entry says FE shipped a workable mitigation or only needs a confirmation.
   If the user passed a specific item id (e.g. `/sweep PERF-05`) or names a
   handoff entry, pick that one. Confirm-only handoff entries (FE just needs a
   yes/no on an existing contract) are cheap — verify and close them even when
   a bigger item is picked.
   **Resume check:** if `snapshot.md` already contains an
   `⏳ IN-PROGRESS (sweep)` marker (left by an interrupted session), do NOT
   pick a new item — resume that item at the recorded step. Verify the working
   tree first (`git status` + `tsc --noEmit`) to see how far the interrupted
   session actually got before continuing.
3. **Write the progress marker.** Immediately after picking the item, append
   one line under **Active Tasks** in `snapshot.md`:
   `> ⏳ IN-PROGRESS (sweep): <item id> — step: <researching|implementing|validating|self-testing|closing>`
   Update the step label as you advance through the phases. Never keep more
   than one marker at a time. This line is what a fresh session resumes from.
4. Follow the standard orchestration from CLAUDE.md:
   - 1 service, clear scope → implement directly
   - > 1 file or TCP/RabbitMQ → `researcher` → implement
   - > 2 services or migration → `researcher` → `planner` → implement → `code-reviewer`
5. Implement with minimal diff. New SQL migrations go in
   `database/migrations/nodeA|nodeB/<YYYYMMDD-NNN-name>.sql` + an entry in
   `database/migrations.manifest.json` (post-cutoff policy — never edit
   `database/prod-baseline-20260717/`), and must be idempotent
   (existence-guarded). Remember: prod forces `synchronize:false` for ALL
   services, so a schema change must be applied there via the manifest runner
   BEFORE deploying code that depends on it.
6. Validate: `tsc --noEmit` + eslint zero errors (hooks enforce this too).
7. Self-test per the Self-Test Protocol: read `../.agent-local/test-accounts.md`,
   login, curl each affected endpoint, assert status + body. Never hand curls to
   the user. If nodeA/nodeB are not running, report that runtime verification is
   pending instead of skipping silently.
8. Close the loop (Definition of Done):
   - Delete the `⏳ IN-PROGRESS (sweep)` marker from `snapshot.md`
   - Remove/annotate the finished item in `snapshot.md` (keep it LEAN)
   - Append the completed-work summary to `ai-docs/agent-handoff/CHANGELOG.md`
   - If the item came from `backend-handoff.md`: move its entry from **Open**
     to **Done** in that file, rewritten in the existing Done format
     (what was delivered, endpoint/contract, verified evidence, where the
     FE-facing result was recorded)
   - Evaluate FE impact → write the handoff entry to the correct file
     (`../.agent-local/frontend-handoff.md` storefront / `frontend-handoff-ghn.md` GHN)
9. If `/sweep N`: repeat from step 2 until N items are done or a blocker is hit.
   Report progress per item; never leave the repo mid-item.
10. Final report: per item — what changed, files touched, test results
    (pass/fail with response snippets), snapshot/CHANGELOG/handoff updates made.

## Mode: audit (`/sweep audit`)

1. Scope: default = full project. `/sweep audit <area>` (e.g. `orders`, `social`,
   `security`) narrows it.
2. Hunt for NEW issues only — dedupe against snapshot.md AND
   `../.agent-local/backend-handoff.md` (Open + Done) before recording:
   - bugs/gaps: contract mismatches (gateway DTO vs microservice handler vs
     entity), missing guards/filters, unhandled TCP error paths, event handlers
     without ack/nack
   - perf: N+1 TCP/DB calls, missing indexes, unbounded lists, uncached hot reads
     (reuse the `/perf-audit` lens)
3. Read-only — do not fix anything in this mode.
4. Record findings in `snapshot.md` using the existing convention
   (🔴/🟡/🟢 + file:line + one-line failure scenario + suggested fix), appended
   to the matching backlog section.
5. Report: table of new findings + updated "TOP FIX (next)" recommendation.

## Mode: propose (`/sweep propose`)

1. Read `snapshot.md` (roadmap + known issues) and `CHANGELOG.md` recent entries
   to understand what already shipped.
2. Propose 3–5 net-new features ranked by value/effort, each with: one-line
   scope, affected services, migration yes/no, FE impact yes/no.
3. Do not implement. After the user picks, append the chosen items as `F<n>`
   entries to the Feature Roadmap section in `snapshot.md`.

---

## Rules that always apply

- Never mark an item done with tsc/eslint errors or a failed self-test.
- Minimal diff; no drive-by refactors of untouched code.
- Batch mode stops early on: destructive migration needed, ambiguous contract
  change, or anything requiring a user decision — report and continue with the
  next item if independent.
