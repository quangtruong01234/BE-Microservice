# PRODUCT-QA-01 — Tasks

Execute in order. Every phase ends with `npx tsc --noEmit` clean, and the
touched `.ts` files are formatted
(`npx prettier --write <path> && npx eslint --fix <path>`). Details for each
file are in [`design.md`](design.md) § Files. The HTTP surface is
[`contract.md`](contract.md) and is never edited.

## Phase 0 — Migration SQL

| Field | Value |
|---|---|
| File | `database/migrations/nodeB/20261007-001-add-rag-tables.sql` (creates the `nodeB/` dir) + entry `nodeB-20261007-001-add-rag-tables` appended to `database/migrations.manifest.json` |
| Action | `CREATE EXTENSION IF NOT EXISTS vector`; `CREATE TABLE IF NOT EXISTS rag_documents`, `rag_chunks` (`UNIQUE (product_id, chunk_index)`); `CREATE INDEX IF NOT EXISTS idx_rag_documents_status_updated`. DDL as in design § Data |
| Target DB | Node B PostgreSQL |
| Depends on | — |
| Risk | medium. pgvector is the first extension in this DB; if Aiven refuses it, the whole file rolls back and the CD migrate step fails before restart |
| Verify | `npm run db:migrate:dry-run -- --target=nodeB`, then apply locally (`npm run db:migrate:nodeB`). Then `\d rag_chunks` shows `embedding vector(768)`. Re-running is a no-op (checksum ledger) |

- [ ] Phase 0 done

## Phase 1 — libs (constants, Gemini client, RAG text utils)

| Field | Value |
|---|---|
| Files | `libs/constant/port-tcp.constant.ts`, `message-pattern-product.constant.ts`, `message-pattern-assistant.constant.ts` (new), `error-code.constant.ts` (code + `PROD_PRESERVED_5XX_ERROR_CODES` + comment :23-27), `response-message.constant.ts` (`ASSISTANT_MESSAGE`); `libs/common/src/constants/event.ts`, `queues.ts`; `libs/common/src/types/product-index-changed-event.ts` (new); `libs/common/src/gemini/*` (new); `libs/common/src/rag/rag-text.util.ts` (new); `libs/common/src/utils/rich-text-html.util.ts` (`htmlToPlainText`); `libs/common/src/index.ts` |
| Action | All constants; `GeminiClient` (`embedContent`, `batchEmbedContents`, `generateContent`, error classes); the pure functions `tokenize`, `bm25Scores`, `reciprocalRankFusion`, `scrubPii`, `stripMarkdown`, `renumberCitations`, `cleanWhitespace`, `cutSnippet`, `buildChunks`, `contentHash` |
| Covers | [AC-1], [AC-3], [AC-4], [AC-9], [AC-12] (unit level) |
| Depends on | — |
| Risk | low. Pure code and additive constants |
| Verify | `npx tsc --noEmit` + `npx jest libs/common/src/rag libs/common/src/gemini libs/common/src/utils/rich-text-html` (TC-1..TC-11) + `npm run check:conventions`. `assistant.ask` has no handler and no sender yet; if the check flags it, note it and confirm it clears after Phase 4 |

- [ ] Phase 1 done

## Phase 2 — product service (emit + RAG source)

| Field | Value |
|---|---|
| Files | `apps/product/src/product.service.ts`, `apps/product/src/product.controller.ts`, `apps/product/src/product.service.spec.ts` |
| Action | `getRagSource(productId)` + `@MessagePattern(PRODUCT_MESSAGE_PATTERNS.PRODUCT_RAG_SOURCE)` (bare string, returns the object or `null`). `publishIndexChanged(productIds)` modelled on `notifyWishlisters` (live-channel guard, `{pattern,data}`, try/catch, never throws). Call it after commit in `createProduct`, `updateProduct`, `deleteProduct`, `createReview`, `deleteReview`, the brand-reject and category-reject branches, and `purgeUserData`. The last three `SELECT id` the affected rows before the bulk update |
| Covers | [AC-10], [AC-12] |
| Depends on | Phase 1 |
| Risk | medium. Eight write paths change. The emit must sit after the transaction commits and must never turn a successful write into an error |
| Verify | `npx tsc --noEmit` + `npx jest apps/product/src/product.service.spec.ts` (TC-21, TC-22). Then start nodeA and PATCH a product as the shop role. The notification and inventory logs show no error, and `NOTIFICATION_PRODUCT_SERVICE` / `INVENTORY_PRODUCT_SERVICE` depth stays 0, because the unhandled event is acked (RMQ-DLQ-01) |

- [ ] Phase 2 done

## Phase 3 — assistant service (new, nodeB)

| Field | Value |
|---|---|
| Files | `apps/assistant/**` (design § Files); `nest-cli.json`; `package.json` (build :10, `start:prod:assistant`, `start:assistant`, `start:nodeB` :51); `ecosystem.config.js` (:15 comment, :73 `PG_POOL.assistant: 2`, `service("assistant")` with the nodeB apps :128-131); `scripts/build-nodeB.sh:15`, `scripts/start-nodeB-prod.sh:13`; `local/nodeB/run.sh` + `local/nodeB/run-assistant.sh` (new, modelled on `run-rewards.sh`) |
| Action | Bootstrap TCP 3010 + an RMQ consumer on `ASSISTANT_PRODUCT_SERVICE` bound to `PRODUCT_EXCHANGE` (`getOptionsTopic`). Add its own `TypeOrmModule.forRoot` (`synchronize:false`), `ScheduleModule`, and a PRODUCT TCP client (`ResilientClientTCP`). The controller gets `@UseFilters(HttpToRpcExceptionFilter)`. `ASK` returns `ProductAnswer`. `@EventPattern(PRODUCT_INDEX_CHANGED_EVENT)` follows the consumer matrix. Add `RagIndexer` (mutex, hash skip, batch embed, advisory-locked replace) and the retry cron. Log a warning once at boot when the key is missing |
| Covers | [AC-1], [AC-2], [AC-3], [AC-9], [AC-10], [AC-11], [AC-12] |
| Depends on | Phase 0, Phase 1, Phase 2 |
| Risk | high. This is a new process, the first nodeB → nodeA TCP client, the first pgvector use and an external API. It adds +2 PG connections against the free-tier ceiling |
| Verify | `npx tsc --noEmit` + `npx jest apps/assistant` (TC-12..TC-20) + `npx nest build assistant`. Start nodeB with a real key. PATCH a product as the shop role, and its `rag_documents` row turns `indexed` with `rag_chunks` rows. This one live call also proves both model ids are served (requirements § Open questions). If one is not, set the env to the current free-tier id and record it in `ops-runtime.md` |

- [ ] Phase 3 done

## Phase 4 — gateway (limiter, sanitizer, route)

| Field | Value |
|---|---|
| Files | `apps/gateway/src/common/decorators/rate-limit.decorator.ts`, `common/guards/rate-limit.guard.ts`, `common/types/rate-limit.types.ts`, `common/filters/http-exception.filter.ts`; `apps/gateway/src/product/product.module.ts` (ASSISTANT client), `product.controller.ts`, `product.service.ts`, `dto/product.dto.ts`; specs next to each |
| Action | Add the `per:"user"` mode (design § Per-user rate limit) and the prod 5xx allow-list (design § Prod 5xx allow-list). Add `@Post(":id/ask")` with `@RateLimit({limit:5, ttl:60, per:"user"})`, `@HttpCode(200)`, `ParsePublicIdPipe(PUBLIC_ID_PREFIXES.PRODUCT)` and the `AskProductQuestionDto` body, plus `@ApiResponse` 200/400/401/404/429/503. Add `askProductQuestion` (product lookup READ + retry → 404 gate → assistant WRITE, no retry → error mapping). Declare the route before any `:id` catch-all that could shadow it |
| Covers | [AC-5], [AC-6], [AC-7], [AC-8], [AC-9], [AC-14] |
| Depends on | Phase 1, Phase 3 |
| Risk | medium. The guard and filter are global. AC-14 / TC-23 / TC-41 prove the default path is unchanged |
| Verify | `npx tsc --noEmit` + `npx jest apps/gateway/src/common/guards/rate-limit.guard.spec.ts apps/gateway/src/common/decorators apps/gateway/src/common/filters apps/gateway/src/product` (TC-23..TC-27) + `npm run check:conventions` (now clean for `assistant.ask` and `product.rag_source`). Then runtime TC-30..TC-36, TC-41 |

- [ ] Phase 4 done

## Phase 5 — backfill script, env, docs

| Field | Value |
|---|---|
| Files | `scripts/rag-backfill.mjs` (new); `package.json` (`rag:backfill`); `local/nodeB/.env.example`, `local/nodeB/.env.production.example` (key names only: `GEMINI_API_KEY`, `GEMINI_EMBED_MODEL`, `GEMINI_MODEL`, `GEMINI_EMBED_TIMEOUT_MS`, `GEMINI_GENERATE_TIMEOUT_MS`, `RAG_MIN_SIMILARITY`, `RAG_MAX_CHUNKS_PER_PRODUCT`, `RAG_RETRY_BATCH`, `RAG_MAX_ATTEMPTS`, `RAG_BACKFILL_DELAY_MS`, `RAG_BACKFILL_LIMIT`); `README.md` (~150, 178, 262, 420), `database/README.md:6`, `ai-docs/agent-context/database.md:8`, `api.md`, `ops-runtime.md` |
| Action | The backfill does the following: (1) read `SELECT id FROM products WHERE is_active = 1 ORDER BY id` with the nodeA DB env (mysql2); (2) `checkQueue(ASSISTANT_PRODUCT_SERVICE)`; (3) `sendToQueue` `{pattern:"product.index_changed", data:{productId}}`, with names duplicated from the TS constants under a source comment; (4) pace by `RAG_BACKFILL_DELAY_MS` (default 4000), cap by `RAG_BACKFILL_LIMIT`, and support `--from-id`, `--dry-run`. `scripts/validate-environment.sh` stays unchanged: `GEMINI_API_KEY` is deliberately not required. In `ops-runtime.md`, add the env keys, the backfill runbook and the pgvector note |
| Covers | [AC-13] |
| Depends on | Phase 3 |
| Risk | low. Re-running only re-hashes, and unchanged products cost no Gemini call |
| Verify | `npx tsc --noEmit` + TC-37..TC-40. Check that `git diff local/nodeB/` adds key names only. Then run `git grep` for the prod hostname per `git-workflow.md` |

- [ ] Phase 5 done

## Closing

- [ ] Every [TC-n] in `tests.md` passes; every unit test was seen red first.
- [ ] Self-test (`docs/AGENT-WORKFLOW.md` §3) and change-impact review (§4).
  Unreached legs become `⏳ PENDING RUNTIME TEST (PRODUCT-QA-01)` notes (tests.md
  § Legs not covered).
- [ ] `code-reviewer` report: PASS.
- [ ] FE handoff: the two-session contract flow (`BE_DONE` on
  `feat/PRODUCT-QA-01-be`). Note the 200 is `data` inside the standard envelope
  and that 429 also carries `retryAfter`.
- [ ] Release class **B** recorded. No release-gate hold.
- [ ] Prod-owed in the snapshot:
  - `GEMINI_API_KEY` on prod nodeB (pm2 env).
  - Migration `nodeB-20261007-001-add-rag-tables` applied by CD.
  - `npm run rag:backfill` on prod once, after deploy.
- [ ] `known-behaviors.md`:
  - Add a new `PRODUCT-QA-01` entry with these residuals:
    - per-user limit counted before validation;
    - a stale index until the next write or the cron;
    - pending on quota;
    - `[digits]` rewritten;
    - IP-keying elsewhere.
  - Correct the EMAIL-REAUTH-01 "per user" wording (it is per IP).
  - Run `node .claude/hooks/kb-hint.mjs --index --write` and `npm run check:conventions`.
- [ ] `design.md` anchor set to `status=done`; summary → `CHANGELOG.md`; F16
  ticked in `snapshot.md`.
