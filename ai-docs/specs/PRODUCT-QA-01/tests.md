# PRODUCT-QA-01 — Tests

Every [AC-n] in `requirements.md` has at least one [TC-n] here, and every test in
code carries its [TC-n] id in its name.

## Unit tests

Run them scoped (`npx jest <path>`). Mock factories live in `test/utils/`.
Gemini is always a mocked `fetch` / `GeminiClient`, never the network.

| Id | Covers | File | Case | Status |
|---|---|---|---|---|
| [TC-1] | [AC-1], [AC-3] | `libs/common/src/rag/rag-text.util.spec.ts` | `[TC-1] tokenize lowercases, strips diacritics and đ→d, splits on non-alphanumerics` — "Pin sạc ĐƯỢC 20.000mAh!" → `["pin","sac","duoc","20","000mah"]`; empty input → `[]` | ⏳ |
| [TC-2] | [AC-1], [AC-3] | same | `[TC-2] bm25Scores ranks the chunk with the rarer matching term higher and returns all zeros when no query term occurs` (k1=1.2, b=0.75, golden values to 4 dp) | ⏳ |
| [TC-3] | [AC-1] | same | `[TC-3] reciprocalRankFusion uses k=60, gives zero-BM25 chunks no BM25 rank, breaks ties by vector rank then id, keeps 6` | ⏳ |
| [TC-4] | [AC-1], [AC-4] | same | `[TC-4] renumberCitations` — `[S3] … [S1] … [S3]` → `[1] … [2] … [1]`, order `[S3,S1]`; `[S1, S3]` → `[1][2]`; `[S9]` with 6 labels is dropped; `[2024]` → `(2024)`; a model `[1]` → `(1)`; `[note]` kept; nothing resolvable → empty order | ⏳ |
| [TC-5] | [AC-4] | same | `[TC-5] stripMarkdown removes bold/italic/headings/code/links/images/blockquotes, turns * and + bullets into "- ", leaves snake_case and "- " bullets intact` | ⏳ |
| [TC-6] | [AC-4] | same | `[TC-6] whitespace cleanup collapses \n{3,} to one blank line, removes space before punctuation and trims` | ⏳ |
| [TC-7] | [AC-1] | same | `[TC-7] cutSnippet returns ≤300 code points unchanged; a longer string becomes ≤300 code points ending in "…", cut at whitespace inside the last 40, never splitting a surrogate pair` | ⏳ |
| [TC-8] | [AC-12] | same | `[TC-8] scrubPii replaces 0912345678, 0912 345 678, 0912.345.678, +84 912 345 678 and a@b.vn; keeps "15.6 inch", "199000", "1.200.000đ", "2024"` | ⏳ |
| [TC-9] | [AC-10], [AC-12] | same | `[TC-9] buildChunks orders PRODUCT, SKU, REVIEW (newest first), caps at 100, scrubs PII before hashing; contentHash is stable for equal input and changes with the embed model` | ⏳ |
| [TC-10] | [AC-10] | `libs/common/src/utils/rich-text-html.util.spec.ts` | `[TC-10] htmlToPlainText turns block tags into newlines, strips tags and decodes basic entities` | ⏳ |
| [TC-11] | [AC-9], [AC-12] | `libs/common/src/gemini/gemini.client.spec.ts` | `[TC-11] GeminiClient` cases below | ⏳ |
| [TC-12] | [AC-2] | `apps/assistant/src/assistant.service.spec.ts` | `[TC-12] no chunks → NO_SOURCES with answer null and citations [], and no Gemini call at all` | ⏳ |
| [TC-13] | [AC-3] | same | `[TC-13] all BM25 zero and best similarity below RAG_MIN_SIMILARITY → LOW_CONFIDENCE without generateContent; one BM25 hit passes the gate` | ⏳ |
| [TC-14] | [AC-3] | same | `[TC-14] model abstain:true, zero resolvable citations, invalid JSON and a blocked candidate each → LOW_CONFIDENCE` | ⏳ |
| [TC-15] | [AC-1], [AC-4] | same | `[TC-15] an answer citing [S2] then [S1] returns [1]/[2], citations index 1..N in that order with the right source and snippet, and no id fields` | ⏳ |
| [TC-16] | [AC-9] | same | `[TC-16] GeminiUnavailableError or GeminiRequestError during ask → ServiceUnavailableException (RPC 503)` | ⏳ |
| [TC-17] | [AC-12] | same | `[TC-17] the generate request body contains only S-labelled passages and the question — no product/user ids — and the logger never receives prompt or answer text` | ⏳ |
| [TC-18] | [AC-10] | `apps/assistant/src/rag-indexer.service.spec.ts` | `[TC-18] null source and isActive=false delete chunks + document and ack; an unchanged hash skips the embed and acks; a changed hash replaces chunks in one tx under the advisory lock` | ⏳ |
| [TC-19] | [AC-11] | same | `[TC-19] invalid payload → nack(false,false); product-leg error → pending attempts+1, ack; Gemini error or dim≠768 → pending, old chunks kept, ack; PG error → nack(false,true)` | ⏳ |
| [TC-20] | [AC-11] | same | `[TC-20] retry cron takes ≤RAG_RETRY_BATCH pending rows with attempts < RAG_MAX_ATTEMPTS ordered by updated_at, and skips while a previous run is in flight` | ⏳ |
| [TC-21] | [AC-10], [AC-12] | `apps/product/src/product.service.spec.ts` | `[TC-21] getRagSource returns the documented shape, active SKUs with variation labels and numeric price, the newest 200 non-empty review comments with rating only (no userId), and null for an unknown id` | ⏳ |
| [TC-22] | [AC-10] | same | `[TC-22] create/update/delete product, create/delete review, brand reject, category reject and purgeUserData each publish product.index_changed per affected id with the {pattern,data} envelope; a throwing or missing channel never fails the write` | ⏳ |
| [TC-23] | [AC-6], [AC-8], [AC-14] | `apps/gateway/src/common/guards/rate-limit.guard.spec.ts` | `[TC-23] per:"user" without request.user returns true and never increments; with request.user counts key …:user:<id>; request.rateLimit already set returns true without counting; no per → counted with the ip key exactly as before` | ⏳ |
| [TC-24] | [AC-8] | `apps/gateway/src/common/decorators/rate-limit.decorator.spec.ts` | `[TC-24] RateLimit({per:"user"}) attaches CustomRateLimitGuard via __guards__ metadata; RateLimit() and RateLimit({limit}) do not` | ⏳ |
| [TC-25] | [AC-9] | `apps/gateway/src/common/filters/http-exception.filter.spec.ts` | `[TC-25] in production a 503 with errorCode ASSISTANT_UNAVAILABLE keeps the code and the constant message (even if the thrown message differs); a 503 RATE_LIMIT_UNAVAILABLE and a plain 500 are still sanitized with errorCode dropped; non-production unchanged` | ⏳ |
| [TC-26] | [AC-7], [AC-9] | `apps/gateway/src/product/product.service.spec.ts` | `[TC-26] askProductQuestion` cases below | ⏳ |
| [TC-27] | [AC-5] | `apps/gateway/src/product/dto/product.dto.spec.ts` | `[TC-27] AskProductQuestionDto trims, rejects missing / non-string / whitespace-only / 2-char / 301-char, accepts 3 and 300 chars after trim` | ⏳ |

Cases for **[TC-11]** (`GeminiClient`):
- A missing key throws `GeminiUnavailableError`, and `fetch` is never called.
- HTTP 429, 500 and 503, an `AbortError`, a `TimeoutError` and a network error each throw `GeminiUnavailableError`.
- HTTP 400 and 404 throw `GeminiRequestError`.
- The key is sent in the `x-goog-api-key` header and is never in the URL.
- No logger call ever receives the key or the request body.

Cases for **[TC-26]** (`askProductQuestion`):
- An unknown product is a 404, and the assistant is not called.
- `isActive=false` is a 404, and the assistant is not called.
- On the product leg, a `TimeoutError` and a transport error are each the contract 503 body.
- On the assistant leg, a `TimeoutError`, a transport error and an RPC `{statusCode:503}` are each the contract 503 body.
- An RPC 400 passes through `MicroserviceErrorHandler`.
- The assistant is sent `{productId: Number(product.id), question}` with `TCP_TIMEOUT_MS.WRITE`, and is not retried.

Each test was seen **red** before it went green: break the code or the
assertion once, watch it fail, then restore. A test that never failed proves
nothing.

## Runtime checks (self-test)

Run per `docs/AGENT-WORKFLOW.md` §3, on local nodeA and nodeB with a real
`GEMINI_API_KEY` in the local nodeB `.env`. Accounts come from
`../.agent-local/test-accounts.md` and are named here by role only. `<P>` is an
active product's `prod_…` id that has a description and at least one review.
Run `npm run rag:backfill -- --limit=…`, or PATCH `<P>`, first so that `<P>` is
indexed.

| Id | Covers | Request | Role | Expected |
|---|---|---|---|---|
| [TC-30] | [AC-1], [AC-4] | `POST /api/products/<P>/ask` `{"question":"<something its description answers>"}` | user | `200`; `data.abstained:false`; `data.answer` matches `/\[\d+\]/`, has no `**`/`#`/backtick; every `[n]` in `answer` has a `data.citations[n-1].index===n`; each snippet ≤300 chars |
| [TC-31] | [AC-3] | same, `{"question":"what is the capital of Mongolia?"}` | user | `200`, `abstainReason:"LOW_CONFIDENCE"`, `answer:null`, `citations:[]` |
| [TC-32] | [AC-5] | `{"question":"  a  "}`; then `POST /api/products/prod_bad/ask` | user | both `400` with a validation message |
| [TC-33] | [AC-6] | `POST /api/products/<P>/ask` with no cookie | none | `401`. Then 5 calls as a fresh user all answer non-429, so the 401 used no slot |
| [TC-34] | [AC-7] | unknown `prod_` + 16 alphanumerics; then `<Q>`, a product the shop owner sets `isActive:false` | user (+ shop to deactivate) | both `404` `Product not found` |
| [TC-35] | [AC-8] | 6 asks in < 60 s across two different products | user | calls 1-5 are not 429; call 6 is `429` "Too many requests. Max 5 requests per 60 seconds". Then 1 ask as a second user (same machine/IP) is not 429 |
| [TC-36] | [AC-9] | restart assistant with `GEMINI_API_KEY` set to an invalid value, ask `<P>`; then stop assistant, ask again | user | both `503` with the exact contract body (`errorCode:"ASSISTANT_UNAVAILABLE"`) |
| [TC-37] | [AC-2], [AC-11] | with the invalid key still set, the shop creates product `<N>` and the user asks `<N>` | shop, user | `rag_documents` for `<N>` is `pending`, `attempts≥1`; the ask answers `200 NO_SOURCES`. Restore the key and restart; within 5 min the cron indexes `<N>` (`status='indexed'`) |
| [TC-38] | [AC-10] | the shop PATCHes `<P>`'s description, then re-sends the identical PATCH, then sets `isActive:false` | shop | 1st: `indexed_at` advances and the chunks change. 2nd: no new `indexed_at` and no embed call in the log. 3rd: `rag_chunks` count for `<P>` = 0. Restore `isActive:true` afterwards |
| [TC-39] | [AC-12] | the user posts a review on a completed-order product containing a phone and an email; then `SELECT content FROM rag_chunks WHERE source='REVIEW'` for it | user | content shows `[phone]` / `[email]`, never the raw values; assistant logs contain no review text |
| [TC-40] | [AC-13] | `npm run rag:backfill -- --dry-run`; then `RAG_BACKFILL_LIMIT=2 npm run rag:backfill` | — | dry-run prints the active-product count and publishes nothing (the queue depth is unchanged). The limited run enqueues 2 messages, spaced ≥ `RAG_BACKFILL_DELAY_MS` |
| [TC-41] | [AC-14] | 6 calls to the existing change-password route (`@RateLimit({limit:5})`, `apps/gateway/src/user/user.controller.ts:140`), each with a WRONG current password | user | calls 1-5 are `401` and call 6 is `429`. The Redis key is still `throttle:POST:<route>:ip:<ip>`, so the route stays IP-keyed |

## Legs not covered here

Each becomes a `⏳ PENDING RUNTIME TEST (PRODUCT-QA-01)` note in `snapshot.md`
Known Issues:

- **Prod sanitizer on real prod.** After deploy, ask with nodeB `GEMINI_API_KEY`
  unset or wrong, using the user role on `<PROD_API_DOMAIN>`. Expect the exact
  503 body. Then confirm that an unrelated 5xx is still `Internal server error`.
  Unit-covered by TC-25 only.
- **`CREATE EXTENSION vector` on the prod Aiven PG.** Confirm that the CD
  migrate step applied `nodeB-20261007-001-add-rag-tables`. If it was refused,
  the deploy stops before restart; enable pgvector in the Aiven console and
  re-run the deploy.
- **The free-tier quota under the backfill.** Run `npm run rag:backfill` on
  prod with the defaults. Then confirm the pending count drains through the
  cron, with no 429 storm in the assistant logs.
- **Latency under real Gemini on prod.** The p95 of `POST /api/products/:id/ask`
  must be < 10 s (`http_request_duration` in Grafana). Check this after a few
  real asks.
- **A malformed payload reaching the DLQ.** Publish
  `{"pattern":"product.index_changed","data":{"productId":"x"}}` to
  `ASSISTANT_PRODUCT_SERVICE` from the RabbitMQ management UI locally. It must
  appear in `trybuy.dead_letter`. TC-19 covers the nack call only.
