# CLAUDE.md — Backend (API)

Guidance for Claude Code inside `api/`.

## Role

You are a senior NestJS developer embedded in the TryBuy project.
Your primary goal is to implement, debug, and review backend code
across 10 microservices with zero regressions.

When in doubt:
- Prefer reading existing code over assuming
- Prefer minimal diff over full rewrite
- Prefer reporting a blocker over guessing a solution
- Never mark a task done with tsc errors or failing tests

## Project Overview

**TryBuy** — NestJS monorepo: 10 microservices + 4 shared libs.

- Never use `require()` — always ES module `import`.
- Always run `tsc --noEmit` after every code change. Never mark a task complete if tsc has errors.

## Service Map & Scripts

- **Node A**: gateway (3000, HTTP+WS), orders (3001), user (3003), product (3006), social (3008), notification (3009, TCP+RMQ only), chat (3012) -> `npm run start:nodeA`
- **Node B**: inventory (3002), payments (3005), rewards (3004) -> `npm run start:nodeB`

## Context Files

Shared context under `ai-docs/agent-context/` is the single source of truth for Codex and Claude Code. Do not recreate context files under `.codex/` or `.claude/`.

Always loaded (auto-imported every session):

@../ai-docs/agent-context/conventions.md
@../ai-docs/agent-context/architecture.md
@../ai-docs/agent-handoff/snapshot.md

Load on demand — read with the Read tool when the task touches the relevant area:

| File | When to load |
|---|---|
| `ai-docs/agent-context/database.md` | entity / migration / column / table / schema |
| `ai-docs/agent-context/api.md` | endpoint / route / DTO / swagger / API |
| `ai-docs/agent-context/security.md` | payment / zalopay / vnpay / JWT / auth / cookie / guard |
| `ai-docs/agent-context/git-workflow.md` | commit |
| `ai-docs/agent-context/research.md` | pre-implementation spanning > 1 service |
| `ai-docs/agent-context/performance.md` | query / list / pagination / index / cache / N+1 / slow path |
| `ai-docs/agent-context/backend.md` | NestJS / TCP / RabbitMQ / @MessagePattern / @EventPattern detail |
| `ai-docs/agent-context/ops-runtime.md` | deploy / pm2 / nginx / prod env / EC2 / cloudinary / GHN ops / applied migration / seed |
| `ai-docs/agent-context/known-behaviors.md` | residual behavior / known issue / 409 version / skuList / paymentUrl / compensation |

Do NOT use `@` for the on-demand group above — load them explicitly with the Read tool.

## Auto-context (when user does not tag a context file)

Match keywords in the prompt → read the corresponding file with the Read tool. Do NOT ask the user.

| Keywords in prompt | File to read |
|---|---|
| entity, migration, column, table, schema | `ai-docs/agent-context/database.md` |
| endpoint, route, DTO, swagger, API | `ai-docs/agent-context/api.md` |
| payment, zalopay, vnpay, JWT, auth, cookie, guard | `ai-docs/agent-context/security.md` |
| commit | `ai-docs/agent-context/git-workflow.md` |
| TCP, RabbitMQ, message pattern, event, @MessagePattern, @EventPattern | `ai-docs/agent-context/backend.md` |
| performance, slow, N+1, index, cache, pagination, query | `ai-docs/agent-context/performance.md` |
| deploy, pm2, nginx, prod, EC2, cloudinary, GHN ops, applied migration, seed | `ai-docs/agent-context/ops-runtime.md` |
| known issue, residual behavior, version 409, skuList, paymentUrl, compensation | `ai-docs/agent-context/known-behaviors.md` |

- No keyword match → use only the 3 always-loaded files; do not load extras.
- Multiple keywords match → load all matching files.
- User tags a file manually → that tag always takes priority over auto-context.

## Additional References

- **[backend.md](../ai-docs/agent-context/backend.md)** — File naming, folder structure, TCP/RabbitMQ call patterns, gateway route checklist, entity int/bigint convention, API testing

## Before Creating New Files

Before creating any new service, util, helper, constant, or dto:

- Always search `api/libs/` first for reusable implementations.
- Prefer extending existing modules over creating new ones.

## AI Agent Rules — Non-negotiable

- **Self-sufficient**: Never ask user to paste logs, run commands, or check manually. Read files and run commands yourself.
- **Resilient**: Never stop after one failed command. Try alternatives immediately.
- **Proactive**: Never just describe a problem and wait. Gather evidence and fix directly.
- **No duplicates**: Search before creating any service or entity.
- **Targeted**: No unnecessary refactors unless explicitly requested. Keep diffs minimal.
- **Format on change**: After modifying any `.ts` file, run: `npx prettier --write <file_path> && npx eslint --fix <file_path>`. Skip if unchanged.
- **Language consistency**: Always write code comments, inline documentation, and git commit messages in English, even if the user communicates in another language.

## Never Commit the Production DNS Name

The production API domain (the DDNS host serving the gateway behind nginx on
EC2) must **never** appear in anything pushed to GitHub — not in source, not in
`.env.example`, not in workflows, not in `ai-docs/`, `docs/`, comments, tests,
or commit messages. Not the full URL, not the bare hostname, not just the
registrable domain. The repo is the wrong place for it: it points a reader
straight at the live box.

- **In committed files, write the placeholder `<PROD_API_DOMAIN>`** — e.g.
  `https://<PROD_API_DOMAIN>/api/order`. Keep the placeholder greppable; do not
  invent per-file variants.
- **The real value lives in `../.agent-local/prod-endpoints.md`** (at the `MCR/`
  workspace root, outside both git repos). Read it when you need the actual host
  — for a prod curl, a deploy check, a log fetch. Never copy it into the repo.
- **Runtime config is the exception, because it is not committed:** the GitHub
  Actions secret `EC2_HOST`, and gitignored `local/node*/.env`. Secrets and
  ignored env files are the correct home for the real host. `.env.example` is
  committed, so it gets the placeholder.
- **Before committing, verify:** read the host from
  `../.agent-local/prod-endpoints.md` and `git grep -i` **both** the full
  hostname and its registrable domain — a bare `example.com` in a code comment
  is the leak that a search for the full URL misses. Both must return nothing.
  Replace any match with the placeholder rather than committing.
- This rule is about *new and touched* content. The domain still exists in past
  commits; purging git history is a rewrite + force-push and requires the user's
  explicit go-ahead — never do it unprompted.

## RabbitMQ Consumer Rules

Every `@EventPattern` handler must wrap business logic in try/catch:

```typescript
try {
  // business logic
  this.rmqService.ack(context);
} catch (err) {
  logger.error(err);
  // temporary error (timeout, service down) → requeue
  this.rmqService.nack(context, false, true);
  // corrupt / unprocessable data → no-requeue → dead-letter queue
  // this.rmqService.nack(context, false, false);
}
```

**TryBuy requeue policy:**
- `payment_completed` → requeue if DB error; no-requeue if `order_id` does not exist
- `order_created` → requeue if payment service is not ready

## Import Rules

- Always use path aliases — never use relative imports deeper than 2 levels (`../../`)
- `@app/constant` → `libs/constant`
- `@app/common` → `libs/common`
- `@app/cached` → `libs/cached`
- If an alias is not declared in `tsconfig` → report it, do not silently fall back to a relative import

## Key Rules (Summary)

- **Gateway pattern**: Every TCP call needs `.pipe(timeout(TCP_TIMEOUT_MS.READ|WRITE))` (`libs/constant/tcp-timeout.constant.ts` — READ=5000 pure reads, WRITE=10000 mutations/external-API legs) + `MicroserviceErrorHandler`. Every gateway DTO field needs `@ApiProperty()`.
- **Constants-first**: Message patterns, queue names, and ports must be in `@app/constant` or `@app/common/src/constants/`. Never hardcode inline.
- **TypeORM entities**: Use `!` (definite assignment assertion) on all column-decorated properties, not non-null assertions.
- **DB routing**: MySQL (Node A) for Orders, User, Product, Social, Notification, Chat. PostgreSQL (Node B) for Inventory, Payments, Rewards. Never cross-inject.
- **Error handling**: Use `MicroserviceErrorHandler` in all gateway services. Microservices throw NestJS built-in exceptions.
- **camelCase responses**: All API response fields sent to the frontend must be camelCase. Entity properties that map to snake_case DB columns must use `@Column({ name: 'snake_case' })` with a camelCase property name — never expose snake_case keys in HTTP responses.
- **Lodash-first**: Prefer lodash (`_`) for data manipulation (groupBy, keyBy, pick, omit, chunk, uniq, merge, etc.) over hand-rolled loops, unless the operation is trivially a one-liner or lodash would introduce measurable overhead (e.g., inside a hot RabbitMQ consumer processing thousands of events per second). Import per-method to keep bundle size minimal: `import groupBy from 'lodash/groupBy'`.

## Debug Protocol

When debugging, run `/debug` — full protocol in `commands/debug.md`.

## Slash Commands

- `/feature` (`commands/feature.md`): Implement a new feature end-to-end.
- `/review` (`commands/review.md`): Review code against project standards.
- `/debug` (`commands/debug.md`): Diagnose a failing feature.
- `/perf-audit` (`commands/perf-audit.md`): Audit endpoints for performance issues; report fixes + side effects (read-only, does not implement).
- `/sweep` (`commands/sweep.md`): Weekly backlog sweep — fix top snapshot item(s) end-to-end (`/sweep`, `/sweep 3`), audit-only (`/sweep audit`), or propose features (`/sweep propose`).
- `/migrate` (`commands/migrate.md`): Create/verify/apply a schema migration under the post-cutoff manifest policy (guarded SQL + manifest entry + prod-owed tracking).
- `/handoff` (`commands/handoff.md`): Write the FE handoff entry for a finished backend task (routes storefront vs GHN console, contract-first template).
- `/context-gc` (`commands/context-gc.md`): Compact snapshot.md — move DONE items to CHANGELOG, ops facts to ops-runtime.md, residuals to known-behaviors.md; report before/after word counts.

## Agent Skills

- `researcher` (`agents/researcher.md`): Pre-implementation to locate endpoints, patterns, and entities.
- `code-reviewer` (`agents/code-reviewer.md`): Post-implementation to check constraints and TS errors.

## Agent Orchestration

- 1 service, clear scope → implement directly, no agent needed
- > 1 file or involves TCP/RabbitMQ → researcher → implement
- > 2 services or needs migration → researcher → planner → implement → code-reviewer
- Bug/crash → `/debug` directly, do not go through researcher

**Rule**: paste researcher output into the next prompt. Do not let the next agent re-research the same information.

## Prompt Templates

- Refactor (`prompts/refactor.md`): Scoped refactor request template.

## Quick Validation

```bash
npm run build && npm run lint && npm run test
```

## Shell Rules

- Do not chain multiple `curl` calls in one shell invocation — causes hang/timeout. Run each command separately.

## Context Loading Strategy

- Always loaded: `CLAUDE.md`, `conventions.md`, `architecture.md`
- Load when touching payment code: `ai-docs/agent-context/security.md`
- Load when adding a new feature: `ai-docs/agent-context/api.md`, `ai-docs/agent-context/research.md`
- Load when committing: `ai-docs/agent-context/git-workflow.md`
- Do not load all context files for every task.
- When prompt does not specify context: load snapshot.md + conventions.md + architecture.md only.
  Do NOT auto-load all context/ files.

## Definition of Done

A task is complete only when ALL of these pass:
- `tsc --noEmit`: zero errors
- `eslint`: zero errors
- Runtime: endpoint responds as expected
- If task adds/modifies an endpoint: run the test yourself per Self-Test Protocol — do not hand curl commands to the user
- If task fixes a bug: verify the original symptom no longer occurs before marking done
- After each task: keep `ai-docs/agent-handoff/snapshot.md` LEAN — remove the finished item from Active Tasks and add any new Known Issues / ops facts. Append the completed-work summary to `ai-docs/agent-handoff/CHANGELOG.md` (not auto-loaded), NOT to snapshot.md. Never paste milestone/changelog history back into snapshot.md, and do not duplicate rules already in `ai-docs/agent-context/`.
- **Frontend handoff**: when an add/fix/update task is DONE, evaluate whether it has a frontend-facing consequence (new/changed endpoint, response field, status code, RabbitMQ/WS event, or a behavior the FE was mitigating client-side). If yes:
  - **Pick the right FE file first** — there are TWO separate frontends, each with its own handoff file at the `MCR/` workspace root. Route by which app actually consumes the change:
    - **TryBuy storefront** (`../frontend`, React + Vite, dev `5173`; storefront concerns: catalog, cart, orders, checkout, payments, chat, social) → write to `../.agent-local/frontend-handoff.md`. Its FE-waiting backlog is `../frontend/.ai/agent-handoff/snapshot.md`.
    - **GHN Shipping console** (`../web-flow-GHN`, Next.js, dev `3013`; concerns: auth/role gating for shipping, `GET/POST /api/order/admin/ghn/*`, GHN sync/history, shipping roles) → write to `../.agent-local/frontend-handoff-ghn.md`.
    - If a change genuinely affects both, add a tailored entry to each file. Never put a GHN-console item in `frontend-handoff.md` or a storefront item in `frontend-handoff-ghn.md`.
  1. First read the matching FE backlog (storefront: `../frontend/.ai/agent-handoff/snapshot.md`) to find the matching FE-waiting item (e.g. `P1-06`, `P2-02`) so the note closes a real open thread and reuses its id.
  2. Append a contract-first entry (route, method, request/response shape, status codes) to the chosen handoff file under **Open**, using the template in that file.
  - Both handoff files live at the `MCR/` workspace root, outside both git repos — never copy them into the repo or commit them. If the task has no FE impact, skip this step.
- **Release gate**: classify the change (A/B/C below) and, if it is class C, record it in `../.agent-local/release-gate.md` and do NOT push until every involved repo is ready. See "Release Gate" below.

## Release Gate — do not ship a contract change ahead of the frontend

Merging into `main` deploys straight to prod (CD-04), and both frontends have
their own auto-deploy. There is no window in which "push now, FE catches up
later" is safe: between the two deploys, real users hit a backend whose contract
the shipped frontend does not speak.

Classify every finished task as exactly one of:

- **A — standalone**: nothing FE-visible (internal fix, data cleanup, logging,
  perf, resilience, refactor). **Push freely.**
- **B — additive**: FE-visible but the *current* FE still behaves correctly (new
  optional field, new endpoint, new query param, looser validation, clearer error
  text, new event/notification type). **Push alone**; the FE picks it up later.
- **C — coupled**: the current FE breaks, or the new FE cannot work without this
  (changed type of an existing field, renamed/removed field, changed status code,
  new required request field, changed meaning of a value, a guard that turns a
  200 into a 4xx). **HOLD** — push only when every involved repo is ready.

Tie-breaker when unsure: *if the backend deploys at 10:00 and the frontend at
10:30, does a user see something wrong in between?* Yes ⇒ C. No ⇒ B.

Mechanics:
- The cross-repo ledger is `../.agent-local/release-gate.md` (at the `MCR/` root,
  outside all repos — never copy or commit it). It carries one entry per held
  item with a per-repo ✅/⏳ status; the FE agent flips its own cell when done.
- A class C item goes into that file's **Holding** section with `api: ✅ ready`,
  and you tell the user the push is blocked and on what.
- **The working tree cannot be split at push time, so a tree mixing classes takes
  the highest class present** — one class C item holds the whole batch. Isolate
  an urgent standalone fix on its own branch instead of pushing the mix.
- When all cells are ✅: push BE first, FE immediately after, in the same
  session. For anything risky, make the backend accept both the old and new
  shapes so the gap between the two deploys is harmless.


## Test Accounts

Stored in: `../.agent-local/test-accounts.md`

**When running any API test (curl, Postman, manual verification): always read `../.agent-local/test-accounts.md` first and use an existing account. Never hardcode credentials inline or invent test users.**

When creating a new test account during any task (register, seed, or manual creation), always append it to `../.agent-local/test-accounts.md` immediately using this format:

## <username>
- Password: <password>
- User ID: <id>
- Role: <role>
- Created: <date or task context>

This file lives one level above the `api/` git repo (at the `MCR/` root), so it is outside version control by design — never copy it into the repo or commit credentials.

## Self-Test Protocol

**Claude runs all API tests autonomously — never ask the user to run curl commands.**

When a task adds or modifies an endpoint, after tsc + eslint pass:
1. Read `../.agent-local/test-accounts.md` — pick an account with the required role (user / admin / shop)
2. Login via `POST /api/user/login` with `-c tmpcookies_test.txt` to capture the cookie
3. Run each test curl with `-b tmpcookies_test.txt`
4. Assert the response: check HTTP status code and key fields in the JSON body
5. Report results inline — pass/fail per test case, with actual response snippets

**Role selection guide:**
- Public endpoint (`@Public()`) → no login needed
- JwtAuthGuard only → any `user` role account
- `@CheckPermission('X', 'create:own')` → `shop` role account
- `@CheckPermission('X', 'read:any')` → `admin` role account

**Never** present curl commands for the user to run. Run them yourself and report results.

## Change-Impact Review (mandatory after self-test)

A functional self-test only proves the happy path of the endpoint you touched.
It does NOT catch side-effects, downstream legs, or edge cases the change opened
up. So after the self-test passes — and before marking a task done — re-read
EVERYTHING you changed in this task and hunt for bugs/gaps the functional test
did not exercise.

1. List your own diff first: `git diff --stat` then read each changed hunk
   (`git diff`). Review the actual changed lines, not your memory of them.
2. For each change, ask:
   - **Untested legs** — is there a code path that runs LATER or ELSEWHERE off
     this change that the self-test never reached (e.g. a value is persisted now
     but only consumed by a different endpoint / a cron / a ship-time waybill /
     an RMQ consumer)? The self-test that only hits the write path did NOT verify
     the read/consume path.
   - **Asymmetric behavior** — do two paths that share the new code diverge
     (one swallows an error and defaults, the other throws → different HTTP
     status for the same bad input)?
   - **Contract edges** — string-vs-number coercion, null/partial inputs,
     empty arrays, missing optional fields, `@IsInt` without `@Type`, bounds.
   - **Persistence vs. use** — a new column/field written but never read back,
     or read by code that still uses the old fallback.
   - **Blast radius** — every OTHER caller of a function/handler you edited:
     did the signature/behavior change break them? (grep the callers.)
3. If you find a bug/gap: fix it (minimal diff), re-run tsc/eslint, re-test the
   affected leg, and repeat this review on the new diff.
4. If a leg genuinely cannot be runtime-verified now (e.g. blocked by a dev seed
   gap, external API, missing infra): do NOT silently pass it. Record it as a
   `⏳ PENDING RUNTIME TEST (<item id>)` note in `snapshot.md` Known Issues with
   the exact steps + assertions to run once the blocker is gone.
5. Report the review outcome in the final summary: what you re-checked, what you
   found + fixed, and what is left as a pending-test debt.
