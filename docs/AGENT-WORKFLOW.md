# Agent workflow — the long version

`AGENTS.md` at the repository root is the short contract: what this repo is, how
to run it, and the rules that are non-negotiable. This file is everything that
did not fit — the context-loading protocol, the knowledge-base mechanics, and
the verification steps that run before a task is called done.

It is written for an AI coding agent, but a human joining the project can read
it as "how work gets verified here" and skip nothing.

---

## 1. Context loading

Shared context lives under `ai-docs/agent-context/` and is the single source of
truth for every agent that works in this repo. Do not recreate context files
under `.codex/` or `.claude/`.

**Always read at the start of a task:**

- `ai-docs/agent-context/conventions.md`
- `ai-docs/agent-context/architecture.md`
- `ai-docs/agent-handoff/snapshot.md`

**Read the rest only when the task touches its domain.** Loading all of them on
every task is how a context window gets spent on nothing.

| Keywords in the request | File to read |
|---|---|
| entity, migration, column, table, schema | `database.md` |
| endpoint, route, DTO, swagger, API | `api.md` |
| payment, zalopay, vnpay, JWT, auth, cookie, guard | `security.md` |
| commit | `git-workflow.md` |
| TCP, RabbitMQ, message pattern, `@MessagePattern`, `@EventPattern` | `backend.md` |
| performance, slow, N+1, index, cache, pagination, query | `performance.md` |
| deploy, pm2, nginx, prod, EC2, cloudinary, GHN ops, applied migration, seed | `ops-runtime.md` |
| planned, roadmap, next feature, AI feature, Gemini, visual search, voucher stacking, phase 2 | `planned-work.md` |
| pre-implementation research spanning more than one service | `research.md` |
| any **shipped** behaviour you are about to re-diagnose or change | `known-behaviors.md` — **two-stage, see §2** |

Rules: no keyword match → the three always-loaded files only. Several match →
load all of them. The user naming a file explicitly always wins. If a referenced
file does not exist, search nearby `ai-docs/` paths once, then report it missing
and continue from source.

When documentation and source disagree, **source wins** — and say so in the
report rather than silently following one of them.

---

## 2. `known-behaviors.md` is two-stage — never read it whole

The file is ~15k words documenting 58 shipped behaviours: what was decided, why,
and what it costs. Loading it because a request said "inventory" is pure waste.
Its keyword list is deliberately broad to favour recall, which makes staged
reading mandatory rather than optional.

**Stage 0 — automatic (Claude Code only).** A `UserPromptSubmit` hook
(`.claude/hooks/kb-hint.mjs`) matches the prompt against per-entry anchors and
injects a `<kb-hint>` block listing matching ids and one-line summaries. Treat
that as stage 1 already done: jump to stage 2 for the ids that are actually
relevant and ignore the rest. An id marked `[STALE]` has had its owning files
change since it was baselined — read the code first and treat the entry as a
claim to check, not a fact. Codex does not run this hook; do stage 1 by hand.

**Stage 1 — free.** `snapshot.md` is already loaded and its "Known Issues —
index only" section lists every entry as `- <ID> — <one-line summary>`, grouped
by domain. Match the task against it **by meaning, not by keyword**. Carrying
the summaries in an always-loaded file is exactly what makes that possible: the
stage-0 hook only greps `keys=`, so it is blind to paraphrase and to wording
nobody thought to write a key for. You are not.

**Stage 2 — targeted.** Only when an id matches, grep that id out of
`known-behaviors.md` and read *that entry* — each is one `##` heading. Read the
file end to end only when the task genuinely is a survey of residual behaviour.

**Why this exists.** The trigger list was once six words while the entries
covered GHN, vouchers, mail, password reset, search, roles and crons — so the
file almost never loaded, and an agent would happily re-derive a behaviour that
had already been decided and documented. Worse, `ETA` routed to
`planned-work.md`, which has no ETA content, instead of the GHN-ETA-01 entry.
Both were fixed on 2026-09-16.

### Adding an entry — four requirements, all mechanically enforced

`npm run check:conventions` runs `node .claude/hooks/kb-hint.mjs --check` and
fails if any is missing.

1. **An id in the `##` heading.**

2. **An anchor line directly under the heading:**

   ```
   <!-- kb: id=X; group=G; aka=Y,Z; files=a.ts,b.ts; sha=…; verified=prod:2026-09-16; keys=a,b,c; summary=one sentence -->
   ```

   Required: `id`, `group`, `verified`, `keys`, `summary` (last — it may contain
   `;`). Optional: `aka` (sub-ids, so grepping one finds the parent) and `files`.

   - `keys` is what the stage-0 hook greps. Write the words someone would
     actually type: column names, route fragments, function names. A one-word
     key matches on a word boundary. **Give every entry Vietnamese keys too** —
     requests here are mixed VN/EN. Matching folds diacritics, so `tồn kho` also
     fires on `ton kho`. A multi-word key matches only as a contiguous phrase,
     which is exactly why GHN-FAIL-NTF-01 was unreachable until 2026-09-16.
   - `verified` is **provenance, not confidence**: `prod:<date>` or
     `local:<date>` only when the entry itself records where it was checked,
     otherwise `unrecorded[:<date>]`. Never upgrade a tag you did not earn —
     the field exists to show which entries have never actually been exercised.
   - `files` names the file(s) that *own* the behaviour; omit it when there is
     no honest owner. Never hand-write `sha` — run
     `node .claude/hooks/kb-hint.mjs --rebaseline <id>`.

3. **A `group=`** naming one of ten domains: `orders`, `ghn`, `products`,
   `shape`, `social`, `search`, `vouchers`, `auth`, `ops`, `messaging`. It
   decides the heading the entry renders under in the snapshot index; an unknown
   value fails `--check`. To add a group, declare it in `GROUPS` inside
   `kb-hint.mjs` — that array is the display order.

4. **A regenerated snapshot index.** The `snapshot.md` "Known Issues" section is
   **generated** from the `summary=` anchors — never hand-edit it. Run
   `node .claude/hooks/kb-hint.mjs --index --write` after adding an entry or
   rewording a summary; `--check` compares the render byte-for-byte, so the index
   cannot silently fall behind. Consequence for whoever writes the summary: it is
   what every future session reads at stage 1, so make it a standalone sentence
   stating the behaviour — not "see the entry", not a restatement of the id.

### Staleness is a warning, not a gate

`check:conventions` also runs `kb-hint.mjs --stale`, which re-hashes each entry's
`files` (working-tree content, so an uncommitted edit counts) and flags entries
whose owning code has moved since baseline. **It always exits 0 on purpose:** an
owning file holds a hundred unrelated lines, so most changes do not invalidate
the entry, and a hard failure would only train people to skip the check.

When an id you touched is flagged, re-read the entry against the code. Still
true ⇒ `--rebaseline <id>`. No longer true ⇒ fix the entry first. Rebaselining
without re-reading defeats the entire mechanism.

---

## 3. Self-test protocol

**Run the tests yourself. Never hand curl commands to the user.** If a test is
genuinely blocked — missing credentials, a local service that is down, an
external dependency, an approval policy — report the evidence and the exact next
action needed, rather than declaring the path untested and moving on.

After `tsc` and eslint pass on a task that adds or changes an endpoint:

1. Read `../.agent-local/test-accounts.md` and pick an account with the required
   role (user / admin / shop).
2. Log in via `POST /api/user/login` with `-c tmpcookies_test.txt` to capture
   the cookie.
3. Run each test request with `-b tmpcookies_test.txt`.
4. Assert the response — HTTP status **and** the key fields in the JSON body.
5. Report pass/fail per case inline, with the actual response snippets.

**Picking the role:**

| Endpoint | Account needed |
|---|---|
| `@Public()` | none |
| `JwtAuthGuard` only | any `user` |
| `@CheckPermission('x', 'create:own')` | `shop` |
| `@CheckPermission('x', 'read:any')` | `admin` |

### Secret and cookie safety

- Never print plaintext passwords, cookies, access or refresh tokens, or
  `Authorization` headers in a final response.
- Use existing credentials from `../.agent-local/test-accounts.md` only — that
  file sits above the git repo by design. Never copy it in, never invent users.
- Delete temporary cookie files (`tmpcookies_*.txt`) after the self-test.
- Never store plaintext credentials in git-tracked files, Postman collections,
  or summaries.
- A test account you create during a task (register, seed, manual creation) is
  appended to `../.agent-local/test-accounts.md` immediately, in this shape:

  ```
  ## <username>
  - Password: <password>
  - User ID: <id>
  - Role: <role>
  - Created: <date or task context>
  ```

### Postman MCP, when it is used

- Read the `postman://instructions` MCP resource before any Postman tool call.
- Prefer an existing TryBuy workspace, collection, environment and request.
  Search and list before creating; do not duplicate assets.
- For collection runs use the collection UID (`<ownerId>-<collectionId>`),
  select the matching environment, and report pass/fail counts plus the failing
  request and its error.
- Treat Postman cloud state as **external shared state**: never create, update
  or delete workspaces, collections, environments, mocks or monitors unless the
  task requires it, and never fire a destructive or state-transition request as
  a smoke test.
- Collections in `postman/` are not auto-synced with the cloud; import or update
  explicitly when required.
- A cloud runner may not reach `localhost`. A network error there is a runner
  limitation to verify locally and report — not an API regression.

---

## 4. Change-impact review — mandatory after the self-test

A passing self-test only proves the happy path of the endpoint you touched. It
does not catch side effects, downstream legs, or the edge cases the change just
opened. Before calling a task done, re-read everything you changed and hunt for
what the functional test did not exercise.

1. **List your own diff first** — `git diff --stat`, then read each hunk with
   `git diff`. Review the changed lines, not your memory of them.
2. For each change, ask:
   - **Untested legs** — does a code path run *later* or *elsewhere* off this
     change that the self-test never reached? A value persisted now but consumed
     by a different endpoint, a cron, a ship-time waybill, an RMQ consumer. A
     test that only hit the write path did not verify the read path.
   - **Asymmetric behaviour** — do two paths sharing the new code diverge, one
     swallowing an error and defaulting while the other throws, so the same bad
     input yields two different HTTP statuses?
   - **Contract edges** — string/number coercion, `null` and partial inputs,
     empty arrays, missing optional fields, `@IsInt` without `@Type`, bounds.
   - **Persistence vs. use** — a new column written but never read back, or read
     by code still using the old fallback.
   - **Blast radius** — grep every other caller of a function or handler you
     edited. Did the signature or behaviour change break them?
3. Found a gap? Fix it with a minimal diff, re-run `tsc` and eslint, re-test the
   affected leg, and repeat this review on the new diff.
4. A leg that genuinely cannot be verified now (seed gap, external API, missing
   infrastructure) is **not** silently passed. Record it in `snapshot.md` under
   Known Issues as `⏳ PENDING RUNTIME TEST (<item id>)` with the exact steps and
   assertions to run once the blocker clears.
5. Report the outcome: what you re-checked, what you found and fixed, and what
   remains as pending-test debt.

---

## 5. Closing a task

**Handoff notes.** Keep `ai-docs/agent-handoff/snapshot.md` lean — live state
only (active tasks, known issues, ops facts). The completed-work summary goes to
`ai-docs/agent-handoff/CHANGELOG.md`, never to the snapshot, and never duplicates
a rule that already lives in `ai-docs/agent-context/`.

**Frontend handoff.** When a finished task has a frontend-facing consequence —
a new or changed endpoint, response field, status code, RabbitMQ/WebSocket
event, or a behaviour the frontend was mitigating client-side — route it to the
right file. Both live at the `MCR/` workspace root, outside every git repo, and
are never committed:

| Consumer | Handoff file | Its waiting backlog |
|---|---|---|
| Storefront (`../frontend`, React + Vite, dev `5173`) — catalog, cart, orders, checkout, payments, chat, social | `../.agent-local/frontend-handoff.md` | `../frontend/.ai/agent-handoff/snapshot.md` |
| Shipping console (`../web-flow-GHN`, Next.js, dev `3013`) — shipping auth and role gating, `/api/order/admin/ghn/*`, GHN sync and history | `../.agent-local/frontend-handoff-ghn.md` | — |

Read the matching backlog first and reuse its waiting-item id, then append a
contract-first entry (route, method, request and response shape, status codes)
under **Open** using that file's template. Never cross-file an item; if a change
truly affects both consumers, write a tailored entry in each. No frontend
impact ⇒ skip the step entirely. A change with an `ai-docs/specs/<KEY>/contract.md`
gets a short entry that points at the contract (path, status, branch, FE action)
instead of restating its shape — a second copy is the one that drifts.

**Release gate.** Classify every finished change:

- **A — standalone.** Nothing frontend-visible: internal fix, data cleanup,
  logging, performance, resilience, refactor. Ship freely.
- **B — additive.** Frontend-visible, but the *currently deployed* frontend still
  behaves correctly: a new optional field, a new endpoint, a new query
  parameter, looser validation, clearer error text. Ship alone.
- **C — coupled.** The deployed frontend breaks, or the new frontend cannot work
  without this: a retyped or renamed field, a changed status code, a new required
  request field, a changed meaning, a guard that turns a 200 into a 4xx. **Hold**
  until every repository is ready.

The tie-breaker: *if the backend deploys at 10:00 and the frontend at 10:30, does
a user see something wrong in between?* Yes ⇒ C.

Merging to `main` deploys straight to production and both frontends deploy
independently, so there is no window in which "ship now, the frontend catches up
later" is safe. A held item goes into `../.agent-local/release-gate.md` with a
per-repository status. The working tree cannot be split at push time, so **a
tree mixing classes takes the highest class present** — isolate an urgent
standalone fix on its own branch instead of pushing the mix. When everything is
ready, push the backend first and the frontend immediately after, in the same
session. For anything risky, make the backend accept both the old and the new
shape so the gap between the two deploys is harmless.

---

## 6. Agent orchestration

| Situation | Approach |
|---|---|
| One service, clear scope | Implement directly, no sub-agent |
| More than one file, or TCP/RabbitMQ involved | `researcher` → implement |
| More than two services, or a migration | `researcher` → `planner` (writes the spec to `ai-docs/specs/<KEY>/`) → implement → `test-guard` → `code-reviewer` |
| A bug or crash | Debug directly; do not route through `researcher` |

Paste the researcher's output into the next prompt. Never let the next agent
re-research what has already been found. That covers *code facts* (file:line,
patterns, entities) only — the ticket, the spec and the contract are always
handed over as a **path**, never as your summary of them (E1 below).

Agent definitions live in `.codex/agents/` (Codex) and `.claude/agents/`
(Claude Code): `researcher` (read-only research), `planner` (cross-service
and migration planning; writes the spec — see `ai-docs/specs/README.md`),
`test-guard` (unit tests for the touched legs, red → green, scoped jest;
Claude Code only — under Codex follow its file as a procedure) and
`code-reviewer` (read-only post-implementation review). Shared test mocks live
in `test/utils/`, imported as `@app/testing`. Spawn them only when the work
actually calls for it.

### Keeping a chain from compounding errors

A chain of *n* steps that each trust the previous step's output succeeds with
probability *p*ⁿ (0.9⁵ ≈ 59 %). The risk is not the number of agents; it is a
step consuming an earlier step's claim **without a check**. Each rule removes a
dependency or inserts a check:

| # | Rule | Removes |
|---|---|---|
| E1 | Every agent reads the ticket, spec and contract **files** itself. A brief carries their paths, never a paraphrase | telephone-game loss at each hand-off |
| E2 | At most **three** agents run back-to-back without a gate between them. Independent work (gateway DTO vs service handler vs tests) runs as **parallel** agents on one brief each, then is integrated and gated once | *p*ⁿ growth |
| E3 | A deterministic gate runs between dependent steps: the spec at `status=approved` (a contract at `status=agreed`), `npx tsc --noEmit`, scoped `npx jest`, the §3 self-test. A "done" without gate output is not done | trusting an unverified claim |
| E4 | The agent that wrote the code never reviews it — `code-reviewer` runs as a separate agent on the diff | correlated blind spots |
| E5 | A brief is concrete: file paths, function and DTO names, the spec/contract path, and the stop condition. Never "handle the order flow" | requirements invented to fill a vague brief |
| E6 | After a sub-agent reports success, the orchestrator **re-runs the gate itself** and reads the output; it does not forward the report | report/actual drift, compaction loss |
| E7 | Messages between sessions carry paths and commands, never API descriptions (§7) | a lossy second copy of the contract |
| E8 | An agent result that contradicts the spec or contract **stops the chain** and goes to the user. No agent patches around it — fix the contract or the code, never the report | silent error propagation |

The longest row of the table above (`researcher` → `planner` → implement →
`test-guard` → `code-reviewer`) satisfies E2 because each arrow is gated: the
spec is approved before implementing, and `tsc` + scoped jest are re-run by the
orchestrator before and after `test-guard`.

---

## 7. Two-session mode — one Claude Code session per repository

For a small full-stack feature built in parallel: one session in `MCR/api`, one
in `MCR/frontend`. Claude Code only — it relies on `ListAgents` and
`SendMessage`. Under Codex, or with no second session, the user relays the same
messages by hand and the rest of this section still applies.

**Fit.** One new endpoint, or one new field on an existing one, plus one screen
change. Not for anything that needs a migration or touches more than two
services — run that in one backend session with the planner, then hand off.

**Roles.**

| | Backend session (`MCR/api`) | Frontend session (`MCR/frontend`) |
|---|---|---|
| Owns | `ai-docs/specs/<KEY>/contract.md` and the implementation | the screen, API client, types and mocks |
| Inside the session | normal sub-agents under §6 | the frontend repo's own workflow |
| Never | push, merge, edit `.claude/settings*.json`, move a ticket | the same, plus patching around a backend deviation |

The user creates both branches (`feat/<KEY>-be`, `feat/<KEY>-fe`), opens both
sessions in the **same permission mode** (otherwise messages are held for
approval and the flow stalls), merges both, and runs the end-to-end check.
Committing the contract and the implementation on the feature branch is part of
the task; pushing is not — it follows the release gate in
`ai-docs/agent-context/git-workflow.md`.

**Flow.**

1. Backend writes the contract from `ai-docs/specs/_templates/contract.md` at
   `status=draft`, commits it (`docs(<KEY>): api contract draft`), sends
   `CONTRACT_READY`, and keeps researching while it waits.
2. Frontend reads the **file**, checks every displayed field exists in a
   response and every input maps to a request field, and replies
   `CONTRACT_REVIEW` with `APPROVE` or numbered field-level objections (field,
   type, why — no style opinions).
3. Objections → one revision, `CONTRACT_UPDATED`. Still objected → stop, print
   the disagreement for the user. Approved → `status=agreed`, commit.
4. Both build against the agreed version: backend per §3–§5, frontend against a
   mock copied from the contract's examples. A needed contract change mid-build
   is E8: stop, edit, re-agree.
5. Backend runs its gate (`npx tsc --noEmit`, `npm run lint`, scoped jest,
   `npm run build`, the §3 self-test), sets `status=implemented`, commits, sends
   `BE_DONE`, and stops.
6. Frontend switches the mock to the real endpoint. A difference →
   `CONTRACT_MISMATCH` **and** an entry in `../.agent-local/backend-handoff.md`
   (messages do not survive the session), then stop. None → `FE_DONE`.

**Message kinds.** Each kind is sent at most once. A clean run is four messages
(READY, REVIEW, BE_DONE, FE_DONE); one revision round makes six. If a kind
would be sent a second time, the session stops and prints the situation for
the user instead.

| Kind | From → To | Receiver's next action |
|---|---|---|
| `CONTRACT_READY` | BE → FE | read the file, reply `CONTRACT_REVIEW` |
| `CONTRACT_REVIEW` | FE → BE | `APPROVE` → mark agreed; objections → one revision |
| `CONTRACT_UPDATED` | BE → FE | re-read the file, reply `APPROVE` or stop for the user |
| `BE_DONE` | BE → FE | switch mock → real, verify |
| `CONTRACT_MISMATCH` | FE → BE | stop; the user decides |
| `FE_DONE` | FE → BE | nothing; the user merges |

**Template** — one message per hand-off, conclusion on the first line:

```
<KIND>: <one-line conclusion>
feature: <KEY>
repo: api | frontend   branch: feat/<KEY>-be | feat/<KEY>-fe
contract: <absolute path to ai-docs/specs/<KEY>/contract.md> (status: <x>)
changed files: <list>
gates passed: <commands that ran in THIS session>
ask: <exactly what the receiver does next>
stop when: <condition after which the receiver must not message back>
```

**Rules on top of §6.**

- A message never describes the API. A question about the contract is answered
  by editing the file and replying with its path (E7).
- "Done" in a message means the gate passed in the sending session, and the
  message lists the commands.
- A session never asks the other to do what its own permissions blocked.
- `BE_DONE` also writes the pointer entry in `../.agent-local/frontend-handoff.md`
  (§5), so the hand-off survives once both sessions are closed.
- Step 1 opens the `<KEY>` entry under **Holding** in
  `../.agent-local/release-gate.md` with its class and the cells `api: ⏳`,
  `frontend: ⏳`, `web-flow-GHN: n/a`. Step 5 flips `api` to `✅ ready`; each
  session flips only its own cell, and the user pushes, backend first.

**Judging the trial.** Keep the mode only if the contract removed design chat
(zero API descriptions in messages) and the user intervened at most once.
Otherwise fall back to one session per repository with the user as the bridge.
The run checklist lives in `../.agent-local/two-repo-session-handoff-prompt.md`.
