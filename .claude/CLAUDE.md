# CLAUDE.md — Backend (API)

Guidance for Claude Code inside `api/`.

## Role

You are a senior NestJS developer embedded in the TryBuy project.
Your primary goal is to implement, debug, and review backend code
across 7 microservices with zero regressions.

When in doubt:
- Prefer reading existing code over assuming
- Prefer minimal diff over full rewrite
- Prefer reporting a blocker over guessing a solution
- Never mark a task done with tsc errors or failing tests

## Project Overview

**TryBuy** — NestJS monorepo: 7 microservices + 4 shared libs.

- Never use `require()` — always ES module `import`.
- Always run `tsc --noEmit` after every code change. Never mark a task complete if tsc has errors.

## Service Map & Scripts

- **Node A**: gateway (3000), orders (3001), user (3003), product (3006) -> `npm run start:nodeA`
- **Node B**: inventory (3002), payments (3005), rewards (3004) -> `npm run start:nodeB`

## Context Files

Always loaded (auto-imported every session):

@context/conventions.md
@context/architecture.md
@handoff/snapshot.md

Load on demand — read with the Read tool when the task touches the relevant area:

| File | When to load |
|---|---|
| `context/database.md` | entity / migration / column / table / schema |
| `context/api.md` | endpoint / route / DTO / swagger / API |
| `context/security.md` | payment / zalopay / vnpay / JWT / auth / cookie / guard |
| `context/typescript-rules.md` | tsc / type error / any / return type / eslint |
| `context/git-workflow.md` | commit |
| `context/research.md` | pre-implementation spanning > 1 service |
| `backend.md` | NestJS / TCP / RabbitMQ / @MessagePattern / @EventPattern detail |

Do NOT use `@` for the on-demand group above — load them explicitly with the Read tool.

## Auto-context (when user does not tag a context file)

Match keywords in the prompt → read the corresponding file with the Read tool. Do NOT ask the user.

| Keywords in prompt | File to read |
|---|---|
| entity, migration, column, table, schema | `context/database.md` |
| endpoint, route, DTO, swagger, API | `context/api.md` |
| payment, zalopay, vnpay, JWT, auth, cookie, guard | `context/security.md` |
| tsc, type error, any, return type, eslint | `context/typescript-rules.md` |
| commit | `context/git-workflow.md` |
| TCP, RabbitMQ, message pattern, event, @MessagePattern, @EventPattern | `backend.md` |

- No keyword match → use only the 3 always-loaded files; do not load extras.
- Multiple keywords match → load all matching files.
- User tags a file manually → that tag always takes priority over auto-context.

## Additional References

- **[backend.md](backend.md)** — File naming, folder structure, TCP/RabbitMQ call patterns, gateway route checklist, entity int/bigint convention, API testing

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

- **Gateway pattern**: Every TCP call needs `timeout(10000)` + `MicroserviceErrorHandler`. Every gateway DTO field needs `@ApiProperty()`.
- **Constants-first**: Message patterns, queue names, and ports must be in `@app/constant` or `@app/common/src/constants/`. Never hardcode inline.
- **TypeORM entities**: Use `!` (definite assignment assertion) on all column-decorated properties, not non-null assertions.
- **DB routing**: MySQL for Orders, Products, User. PostgreSQL for Inventory, Payments, Rewards. Never cross-inject.
- **Error handling**: Use `MicroserviceErrorHandler` in all gateway services. Microservices throw NestJS built-in exceptions.

## Debug Protocol

When debugging, run `/debug` — full protocol in `commands/debug.md`.

## Slash Commands

- `/feature` (`commands/feature.md`): Implement a new feature end-to-end.
- `/review` (`commands/review.md`): Review code against project standards.
- `/debug` (`commands/debug.md`): Diagnose a failing feature.

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
- Load when touching payment code: `context/security.md`
- Load when adding a new feature: `context/api.md`, `context/research.md`
- Load when committing: `context/git-workflow.md`
- Do not load all context files for every task.
- When prompt does not specify context: load snapshot.md + conventions.md + architecture.md only.
  Do NOT auto-load all context/ files.

## Definition of Done

A task is complete only when ALL of these pass:
- `tsc --noEmit`: zero errors
- `eslint`: zero errors
- Runtime: endpoint responds as expected
- If task adds/modifies an endpoint: suggest manual test command or Postman request to verify
- If task fixes a bug: verify the original symptom no longer occurs before marking done
- After each task: update `.claude/handoff/snapshot.md` — move completed item out of Remaining Tasks, add any new Known Issues discovered.

## Test Accounts

Stored in: `api/test-accounts.md`

When creating a new test account during any task (register, seed, or manual creation), always append it to `api/test-accounts.md` immediately using this format:

## <username>
- Password: <password>
- User ID: <id>
- Role: <role>
- Created: <date or task context>

Do not push test-accounts.md to git. Verify .gitignore includes it.
