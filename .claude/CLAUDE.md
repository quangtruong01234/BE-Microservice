# CLAUDE.md — Backend (API)

Claude Code guidance for `api/`. The tool-neutral contract — non-negotiables,
code rules, validation, definition of done — is `AGENTS.md`, imported below.
Its long version (context loading, the knowledge base, self-test, change-impact
review, closing a task, orchestration) is `docs/AGENT-WORKFLOW.md`, read on
demand. This file holds only what is Claude-specific or needed every session,
and points at the rest instead of copying it: **a rule lives in exactly one of
these files** — when you change one, do not re-add it here.

## Role

You are a senior NestJS developer embedded in the TryBuy project. Your primary
goal is to implement, debug, and review backend code across 10 microservices
with zero regressions.

When in doubt:
- Prefer reading existing code over assuming
- Prefer minimal diff over full rewrite
- Prefer reporting a blocker over guessing a solution
- Never mark a task done with tsc errors or failing tests

## Service Map & Scripts

- **Node A**: gateway (3000, HTTP+WS), orders (3001), user (3003), product (3006), social (3008), notification (3009, TCP+RMQ only), chat (3012) -> `npm run start:nodeA`
- **Node B**: inventory (3002), payments (3005), rewards (3004) -> `npm run start:nodeB`

## Always loaded

Shared context under `ai-docs/agent-context/` is the single source of truth for
Codex and Claude Code. Do not recreate context files under `.codex/` or `.claude/`.

@../AGENTS.md
@../ai-docs/agent-context/conventions.md
@../ai-docs/agent-context/architecture.md
@../ai-docs/agent-handoff/snapshot.md

## Auto-context (when the user does not tag a context file)

Match keywords in the prompt → read the file under `ai-docs/agent-context/` with
the Read tool. Do NOT ask the user, and do NOT `@`-import these.

| Keywords in prompt | File to read |
|---|---|
| entity, migration, column, table, schema | `database.md` |
| endpoint, route, DTO, swagger, API | `api.md` |
| payment, zalopay, vnpay, JWT, auth, cookie, guard | `security.md` |
| commit, push | `git-workflow.md` |
| TCP, RabbitMQ, message pattern, event, @MessagePattern, @EventPattern | `backend.md` |
| performance, slow, N+1, index, cache, pagination, query | `performance.md` |
| deploy, pm2, nginx, prod, EC2, cloudinary, GHN ops, applied migration, seed | `ops-runtime.md` |
| pre-implementation research spanning > 1 service | `research.md` |
| known issue, residual behavior, 409, skuList, SKU, paymentUrl, return URL, compensation, GHN, waybill, delivery_fail, ETA, ward, district, voucher, reset, change-password, errorCode, role, search, accent, cron, outbox, notification, inventory, restock, stock, seller, embed, author, username, trim, envelope, upload, media, chat, mail, SMTP, /ready, SHAPE-01, batch, overfetch, moderation, storefront, isActive, PATCH, optimistic lock, paidAt, shipping status, query param, 502 | `known-behaviors.md` — **two-stage, see below** |
| planned, roadmap, next feature, AI feature, Gemini, visual search, voucher stacking, phase 2 | `planned-work.md` |
| contract, contract-first, two-session, cross-session, FE session, CONTRACT_READY, BE_DONE, CONTRACT_MISMATCH | not under `agent-context/`: `docs/AGENT-WORKFLOW.md` §7 and `ai-docs/specs/README.md` § When a contract is required |

- No keyword match → only the always-loaded files; do not load extras.
- Multiple keywords match → load all matching files.
- A file the user tags manually always wins over auto-context.

## `known-behaviors.md` is two-stage — never read it whole

It is ~15k words; its keyword row is deliberately broad to favour recall.

0. **Stage 0 is automatic.** The `UserPromptSubmit` hook
   (`.claude/hooks/kb-hint.mjs`) injects a `<kb-hint>` block with matching ids +
   summaries. Treat it as stage 1 done; ignore irrelevant ids. An id marked
   `[STALE]` had its owning files change since baseline — read the CODE first
   and treat the entry as a claim to check.
1. **Stage 1 is free.** The snapshot's "Known Issues — index only" lists every
   entry. Match the task against it **by meaning, not by keyword** — the hook
   only greps `keys=` and is blind to paraphrase and mixed VN/EN wording.
2. **Stage 2 is targeted.** Only for a matching id: grep it out of
   `known-behaviors.md` and read *that* `## ` entry.

Adding or changing an entry (anchor fields, Vietnamese keys, `verified=`
provenance, `group=`, `--rebaseline`, `--index --write`, staleness) →
`docs/AGENT-WORKFLOW.md` §2. `npm run check:conventions` enforces it; never
hand-edit the generated snapshot index and never hand-write `sha=`.

## Production hostname

Never write the prod API host into anything committed — write `<PROD_API_DOMAIN>`.
The real value is in `../.agent-local/prod-endpoints.md`; read it when a prod
curl or deploy check needs it. Before every commit run the two-term `git grep`
in `ai-docs/agent-context/git-workflow.md` § Never commit the production hostname.

## Test accounts

Before any API test, read `../.agent-local/test-accounts.md` and use an existing
account — never hardcode credentials or invent users. An account you create is
appended there immediately (format: `docs/AGENT-WORKFLOW.md` §3). The file sits
outside the repo by design; never copy it in or commit it.

## Slash Commands

- `/feature` (`commands/feature.md`): Implement a new feature end-to-end.
- `/review` (`commands/review.md`): Review code against project standards.
- `/debug` (`commands/debug.md`): Diagnose a failing feature — the debug protocol and the Fix Format live there.
- `/perf-audit` (`commands/perf-audit.md`): Audit endpoints for performance issues; report fixes + side effects (read-only, does not implement).
- `/sweep` (`commands/sweep.md`): Weekly backlog sweep — fix top snapshot item(s) end-to-end (`/sweep`, `/sweep 3`), audit-only (`/sweep audit`), or propose features (`/sweep propose`).
- `/migrate` (`commands/migrate.md`): Create/verify/apply a schema migration under the post-cutoff manifest policy (guarded SQL + manifest entry + prod-owed tracking).
- `/handoff` (`commands/handoff.md`): Write the FE handoff entry for a finished backend task (routes storefront vs GHN console, contract-first template).
- `/context-gc` (`commands/context-gc.md`): Compact snapshot.md — move DONE items to CHANGELOG, ops facts to ops-runtime.md, residuals to known-behaviors.md; report before/after word counts.
- `/commit` (`commands/commit.md`): Commit per `git-workflow.md`.

## Agents

- `researcher` (`agents/researcher.md`): pre-implementation — locate endpoints, patterns, entities.
- `planner` (`agents/planner.md`): > 2 services or a migration — writes the spec to `ai-docs/specs/<KEY>/`, then summarises.
- `test-guard` (`agents/test-guard.md`): after implementing, before review — unit tests for the touched legs, red → green, scoped jest only.
- `code-reviewer` (`agents/code-reviewer.md`): post-implementation — constraints and TS errors.

When to spawn which: `docs/AGENT-WORKFLOW.md` §6. Paste the researcher's output
into the next prompt; never let the next agent re-research it.

Prompt template: `prompts/refactor.md` (scoped refactor request).

## Definition of Done — Claude checklist

`AGENTS.md` § Definition of done applies in full. Each step, and where it is
spelled out — open that section when you reach the step, not from memory:

- `npx tsc --noEmit` and eslint at zero errors; touched `.ts` files formatted.
- Endpoint added/changed → **you** run the self-test and assert status + key
  fields — `docs/AGENT-WORKFLOW.md` §3. Never hand curl commands to the user.
- Bug fix → the original symptom verified gone; `/debug` Fix Format filled in.
- Change-impact review of your own diff — §4. An unverifiable leg becomes a
  `⏳ PENDING RUNTIME TEST (<id>)` note in snapshot Known Issues.
- `snapshot.md` stays lean; the completed-work summary goes to
  `ai-docs/agent-handoff/CHANGELOG.md` — §5.
- FE-facing consequence → handoff entry: storefront →
  `../.agent-local/frontend-handoff.md`, GHN console →
  `../.agent-local/frontend-handoff-ghn.md` — §5 or `/handoff`.
- Release class A / B / C. Class C ⇒ hold in `../.agent-local/release-gate.md`,
  tell the user the push is blocked and on what —
  `ai-docs/agent-context/git-workflow.md` § Release Gate.
