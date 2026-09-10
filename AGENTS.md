# AGENTS.md — Backend (API)

Guidance for Codex inside `api/`.

## Role

You are a senior NestJS developer embedded in the TryBuy project.
Your primary goal is to implement, debug, and review backend code
across its applications and shared libraries with zero regressions.

When in doubt:
- Prefer reading existing code over assuming
- Prefer minimal diff over full rewrite
- Prefer reporting a blocker over guessing a solution
- Never mark a task done with tsc errors or failing tests

## Project Overview

TryBuy is a NestJS monorepo with multiple applications under `apps/` and shared libraries under `libs/`.

Before making assumptions about service boundaries, startup scripts, ports, database ownership, or transports, inspect the actual repo:

- `apps/`
- `libs/`
- `package.json`
- `nest-cli.json`
- shared constants under `libs/constant` and `libs/common/src/constants`

Do not rely on stale service counts. If documentation and source differ, treat source code as the source of truth and report the mismatch.

- Never use `require()` — always ES module `import`.
- Always run `npx tsc --noEmit` after every TypeScript code change. Never mark a task complete if TypeScript has errors.

## Service Map & Scripts

- `npm run start:nodeA`
- `npm run start:nodeB`

Before editing runtime, startup, or service-boundary logic, inspect `package.json` scripts and the actual `apps/` directory. If the listed services differ from this document, follow the source code and report the documentation mismatch. Do not hardcode a permanent exact service list unless it is generated from the current repo during the task.

## Context Files

Shared context under `ai-docs/agent-context/` is the single source of truth for Codex and Claude Code. Do not recreate context files under `.codex/` or `.claude/`.

At the start of each task, treat `AGENTS.md` as the root instruction file and read:

- `ai-docs/agent-context/conventions.md`
- `ai-docs/agent-context/architecture.md`
- `ai-docs/agent-handoff/snapshot.md`

Only load additional references when the task matches the domain table. Do not load all context files by default.

If a referenced context file does not exist, search nearby `ai-docs/` paths once. If it is still missing, report the missing file and continue using available repo source.

| File | When to load |
|---|---|
| `ai-docs/agent-context/database.md` | entity / migration / column / table / schema |
| `ai-docs/agent-context/api.md` | endpoint / route / DTO / swagger / API |
| `ai-docs/agent-context/security.md` | payment / zalopay / vnpay / JWT / auth / cookie / guard |
| `ai-docs/agent-context/git-workflow.md` | commit |
| `ai-docs/agent-context/research.md` | pre-implementation spanning more than one service |
| `ai-docs/agent-context/performance.md` | query / list / pagination / index / cache / N+1 / slow path |
| `ai-docs/agent-context/backend.md` | NestJS / TCP / RabbitMQ / @MessagePattern / @EventPattern detail |
| `ai-docs/agent-context/ops-runtime.md` | deploy / pm2 / nginx / prod env / EC2 / cloudinary / GHN ops / applied migration / seed |
| `ai-docs/agent-context/known-behaviors.md` | residual behavior / known issue / 409 version / skuList / paymentUrl / compensation |
| `ai-docs/agent-context/planned-work.md` | planned / roadmap / next feature / AI feature / Gemini / visual search / ETA / voucher stacking / phase 2 |

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
| planned, roadmap, next feature, AI feature, Gemini, visual search, ETA, voucher stacking, phase 2 | `ai-docs/agent-context/planned-work.md` |

- No keyword match → use only the 3 always-loaded files; do not load extras.
- Multiple keywords match → load all matching files.
- User tags a file manually → that tag always takes priority over auto-context.

## Additional References

- **[backend.md](ai-docs/agent-context/backend.md)** — File naming, folder structure, TCP/RabbitMQ call patterns, gateway route checklist, entity int/bigint convention, API testing

## Before Creating New Files

Before creating any new service, util, helper, constant, or dto:

- Always search `api/libs/` first for reusable implementations.
- Prefer extending existing modules over creating new ones.

## AI Agent Rules — Non-negotiable

- **Self-sufficient**: Do not ask the user to run commands manually when the command can be run inside the workspace. If blocked by missing credentials, missing local services, approval policy, or external dependency access, report the blocker with evidence and the exact next action needed.
- **Resilient**: Never stop after one failed command. Try alternatives immediately.
- **Proactive**: Never just describe a problem and wait. Gather evidence and fix directly.
- **No duplicates**: Search before creating any service or entity.
- **Targeted**: No unnecessary refactors unless explicitly requested. Keep diffs minimal.
- **Format on change**: After modifying any `.ts` file, run: `npx prettier --write <file_path> && npx eslint --fix <file_path>`. Skip if unchanged.
- **Language consistency**: Always write code comments, inline documentation, and git commit messages in English, even if the user communicates in another language.

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

- Always use path aliases — never use relative imports deeper than 2 levels
  (`../../`). Enforced by eslint `no-restricted-imports`; two RBAC files carry a
  documented override.
- `@app/constant` → `libs/constant`
- `@app/common` → `libs/common`
- `@app/cached` → `libs/cached`
- If an alias is not declared in `tsconfig` → report it, do not silently fall back to a relative import

## Key Rules (Summary)

- **Gateway pattern**: Every TCP call needs `timeout(10000)` + `MicroserviceErrorHandler`. Every gateway DTO field needs `@ApiProperty()`.
- **Constants-first**: Message patterns, queue names, and ports must be in `@app/constant` or `@app/common/src/constants/`. Never hardcode inline.
- **TypeORM entities**: Use `!` (definite assignment assertion) on all column-decorated properties, not non-null assertions.
- **DB routing**: Follow the actual database module and entity ownership in the source. Known current pattern: MySQL-backed app domains include Orders, Products, User, and other MySQL services; PostgreSQL-backed app domains include Inventory, Payments, and Rewards. Never cross-inject repositories across unrelated service/database ownership.
- **Error handling**: Use `MicroserviceErrorHandler` in all gateway services. Microservices throw NestJS built-in exceptions.
- **camelCase responses**: All API response fields sent to the frontend must be camelCase. Entity properties that map to snake_case DB columns must use `@Column({ name: 'snake_case' })` with a camelCase property name — never expose snake_case keys in HTTP responses.
- **Lodash-first**: Prefer lodash (`_`) for data manipulation (groupBy, keyBy, pick, omit, chunk, uniq, merge, etc.) over hand-rolled loops, unless the operation is trivially a one-liner or lodash would introduce measurable overhead (e.g., inside a hot RabbitMQ consumer processing thousands of events per second). Import per-method to keep bundle size minimal: `import groupBy from 'lodash/groupBy'`.

## Debug Protocol

When debugging, invoke `$debug`.

## Repo Skills

- `$feature`: implement a feature end-to-end.
- `$review`: review code against project standards.
- `$debug`: diagnose a failing feature.
- `$perf-audit`: audit performance without editing.
- `$sweep`: work through the backend backlog or run sweep audit/propose mode.
- `$commit`: create scoped local commits.
- `$refactor`: perform a constrained refactor.

## Custom Agents

Project agents are defined in `.codex/agents/`:

- `researcher`: read-only codebase research.
- `planner`: plans changes spanning services or migrations.
- `code-reviewer`: read-only post-implementation review.

Spawn them only when the user explicitly requests subagents or parallel agent work.

## Agent Orchestration

- 1 service, clear scope → implement directly, no agent needed
- > 1 file or involves TCP/RabbitMQ → researcher → implement
- > 2 services or needs migration → researcher → planner → implement → code-reviewer
- Bug/crash → `$debug` directly, do not go through researcher

**Rule**: paste researcher output into the next prompt. Do not let the next agent re-research the same information.

## Prompt Templates

- Refactor (`$refactor`): Scoped refactor request template.

## Quick Validation

```bash
npx tsc --noEmit
npm run check:conventions   # TCP invariants eslint cannot express
npm run build
npm run lint
npm run test
```

`npm run lint` may auto-fix files when the repository script includes `--fix`. Review the diff after running it.

## Shell Rules

- Do not chain multiple `curl` calls in one shell invocation — causes hang/timeout. Run each command separately.

## Definition of Done

A task is complete only when the relevant checks pass:

- TypeScript/code changes: `npx tsc --noEmit` has zero errors.
- Files changed by formatter/linter: review the diff after formatting/linting.
- Endpoint behavior changes: run runtime API tests and verify HTTP status plus key response fields.
- Service communication, auth, payment, RabbitMQ, startup, or runtime changes: verify the affected runtime flow.
- Bug fixes: verify the original symptom no longer occurs.
- Docs-only changes: runtime endpoint tests are not required.
- After non-trivial backend tasks: keep `ai-docs/agent-handoff/snapshot.md` LEAN (live state only — Active Tasks, Known Issues, ops facts). Append the completed-work summary to `ai-docs/agent-handoff/CHANGELOG.md` (not auto-loaded), never to snapshot.md, and do not duplicate rules already in `ai-docs/agent-context/`.
- Frontend handoff: when an add/fix/update task is DONE, evaluate whether it has a frontend-facing consequence (new/changed endpoint, response field, status code, RabbitMQ/WS event, or a behavior the FE was mitigating client-side). If yes, **route to the right of the two FE handoff files** (both at the `MCR/` workspace root, outside both git repos — never commit):
  - **TryBuy storefront** (`../frontend`, React + Vite, dev `5173`; catalog/cart/orders/checkout/payments/chat/social) → `../.agent-local/frontend-handoff.md`; its FE-waiting backlog is `../frontend/.ai/agent-handoff/snapshot.md`.
  - **GHN Shipping console** (`../web-flow-GHN`, Next.js, dev `3013`; shipping auth/role gating, `GET/POST /api/order/admin/ghn/*`, GHN sync/history) → `../.agent-local/frontend-handoff-ghn.md`.
  - Never cross-file an item (no GHN-console item in `frontend-handoff.md`, no storefront item in `frontend-handoff-ghn.md`); if a change affects both, add a tailored entry to each. First read the matching FE backlog and reuse its waiting-item id, then append a contract-first entry (route, method, request/response shape, status codes) under **Open** using the template in that file. Skip this step if the task has no FE impact.
  - **Mandatory BE→FE routing:** every backend add/update must identify its actual frontend consumer before closure. Record required storefront work in `frontend-handoff.md`, required GHN-console work in `frontend-handoff-ghn.md`, and tailored entries in both only when both consumers are affected; never add an entry to an unaffected handoff.

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

## Secret and Cookie Safety

- Never print plaintext passwords, cookies, access tokens, refresh tokens, or Authorization headers in the final response.
- Use existing local test credentials only from `../.agent-local/test-accounts.md`.
- Delete temporary cookie files such as `tmpcookies_test.txt` after self-test when possible.
- Do not store plaintext credentials in shared docs, Postman collections, git-tracked files, or final summaries.

## Self-Test Protocol

### Postman MCP

- Before using any Postman MCP tool, read the MCP resource `postman://instructions` and follow it.
- Prefer an existing TryBuy workspace, collection, environment, and request. Search/list before creating anything; do not duplicate collections or environments.
- For collection runs, use the collection UID (`<ownerId>-<collectionId>`), select the matching environment when variables are required, and report request/test pass-fail counts plus the failing request and error.
- Treat Postman cloud state as external shared state: do not create, update, or delete workspaces, collections, environments, mocks, or monitors unless the task requires it. Never run destructive or state-transition requests merely as a smoke test.
- Postman MCP collections are not automatically synchronized with JSON files under `postman/`; explicitly import/create or update the remote collection when required.
- A Postman MCP runner may not be able to reach `localhost`. If the run returns a network/connectivity error, verify the local service and endpoint directly from this workspace, then report the runner limitation; do not misclassify it as an API regression.
- Authenticated runs still follow the Test Accounts rules: read `../.agent-local/test-accounts.md`, use an existing role-appropriate account, and never persist plaintext credentials or live cookies in shared Postman collections/environments.
- Prefer Postman MCP `runCollection` when a suitable collection exists. Otherwise use the direct self-test flow below; do not create permanent Postman assets solely to replace one ad-hoc request unless requested.

Codex runs API tests directly when they can be run inside the workspace. If testing is blocked by missing credentials, local services, approval policy, or external access, report the evidence and exact next action needed.

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
     an RMQ consumer)? A self-test that only hits the write path did NOT verify
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
