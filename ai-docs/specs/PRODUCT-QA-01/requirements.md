# PRODUCT-QA-01 — Requirements

## Problem

A shopper on a product page cannot ask the listing a question ("does it fit a
15-inch laptop?"). Today they have to read the description, scroll every SKU and
skim the reviews themselves. F16 adds a short answer that is grounded only in
that product's own listing, SKUs and reviews, carries numbered citations, and
abstains instead of guessing. Source: snapshot § Feature Roadmap F16
(`/sweep propose` 2026-10-07). The HTTP surface is fixed by
[`contract.md`](contract.md) (`status=agreed`). This spec is the backend that
meets it, on the free tier only.

## Scope

- **In:**
  - `POST /api/products/:id/ask`, exactly as `contract.md`.
  - A new nodeB `assistant` service (TCP 3010 plus a PRODUCT_EXCHANGE consumer).
    It owns a pgvector table and a hand-rolled BM25 index over the same chunks.
  - A thin `product_index_changed {productId}` event from product, plus a
    `product.rag_source` TCP pull.
  - A Gemini client in `libs/common`.
  - A per-user mode for the gateway rate limiter.
  - A prod 5xx allow-list for `ASSISTANT_UNAVAILABLE`.
  - A pending-retry cron.
  - A paced backfill script.
  - env/pm2/build wiring.
- **Out:**
  - Cross-product search, so no HNSW index.
  - Chat history or multi-turn conversation.
  - Streaming.
  - Answer caching.
  - Indexing `sellerNotes`, images or stock.
  - An admin re-index route.
  - The offline eval set (F17 RAG-EVAL-01). `RAG_MIN_SIMILARITY` is only
    defaulted here; F17 tunes it.
  - Fixing the IP-keying of every other `@RateLimit` route (recorded in
    design § Findings).

## Acceptance criteria

- **[AC-1]** **Answered.**
  - Given: an active product whose text is indexed, and a question the text
    supports.
  - When: a signed-in user asks.
  - Then: `200` with `abstained:false` and `abstainReason:null`.
  - `answer` contains at least one `[n]`, and every `[n]` has a citation.
  - `citations[].index` runs 1..N in first-appearance order with no gaps.
  - Every `snippet` is at most 300 chars.
  - No author, user id or review id appears anywhere.
- **[AC-2]** **No sources.**
  - Given: an active product with no indexed chunks.
  - When: a user asks.
  - Then: `200` with `{answer:null, abstained:true, abstainReason:"NO_SOURCES", citations:[]}`.
  - Gemini is not called at all.
- **[AC-3]** **Low confidence.** The response is `200` with
  `abstainReason:"LOW_CONFIDENCE"`, `answer:null` and `citations:[]` in either
  of these cases:
  - Every BM25 score is 0 AND the best cosine similarity is below
    `RAG_MIN_SIMILARITY`. In this case `generateContent` is not called.
  - The model returns `abstain:true`, or an answer with zero resolvable
    citations, or unparsable or blocked output.
- **[AC-4]** **Plain-text answer.** The answer text meets every rule in
  `contract.md` § Answer text:
  - No Markdown emphasis, headings, code, links or images.
  - `[Sk]` labels are renumbered to `[n]`, and unresolved labels are dropped.
  - Any other `[digits]` becomes `(digits)`.
  - There is at most one blank line in a row, and the text is trimmed.
- **[AC-5]** **400 on bad input.**
  - Any of these is a `400` with the class-validator message, never a 500:
    - `question` is missing, not a string, whitespace-only, or shorter than 3 /
      longer than 300 chars after trim.
    - `:id` is not `prod_` + 16 alphanumerics.
  - The request still uses a rate-limit slot.
- **[AC-6]** **401.** Without a valid session the route is a `401 UNAUTHENTICATED`.
  The request uses no rate-limit slot.
- **[AC-7]** **404.** An unknown product id, or a product with
  `isActive=false`, is a `404`. The assistant service is not called.
- **[AC-8]** **429.**
  - The 6th authenticated request from one user within 60 s is a `429` with
    message `Too many requests. Max 5 requests per 60 seconds`.
  - The count is per user across all products.
  - Two users behind one IP do not share a counter.
- **[AC-9]** **503.**
  - When any of these happens, the response is exactly the contract 503 body
    (`errorCode:"ASSISTANT_UNAVAILABLE"`, its fixed message) in every
    environment, prod included:
    - Gemini answers 429 or 5xx, times out, or is aborted.
    - `GEMINI_API_KEY` is missing.
    - The assistant service is down or exceeds the gateway WRITE timeout.
    - The product lookup leg times out or hits a transport failure.
  - Every other prod 5xx is still sanitized to `Internal server error` with no
    `errorCode`.
- **[AC-10]** **Index freshness.**
  - These product writes each publish `product.index_changed {productId}` after
    the commit, best-effort:
    - product create, update and delete;
    - review create and delete;
    - the bulk deactivations (brand reject, category reject, account purge).
  - The assistant then re-pulls the product and replaces its chunks.
  - A product that is deleted or inactive loses all of its chunks.
  - An unchanged content hash triggers no Gemini call.
  - Replaying or reordering events converges on the current product state.
- **[AC-11]** **Quota and failure handling.**
  - A Gemini or product-leg failure while indexing leaves the
    `rag_documents.status='pending'` row, and the message is ACKed.
  - A cron retries at most `RAG_RETRY_BATCH` pending products every 5 min,
    each at most `RAG_MAX_ATTEMPTS` times.
  - A malformed payload is dead-lettered (`nack(requeue=false)`).
  - A PostgreSQL error is requeued.
- **[AC-12]** **PII.**
  - Phone numbers and email addresses in review and description text are
    replaced with `[phone]` / `[email]` before embedding, storage and
    prompting.
  - `product.rag_source` returns only review `comment` and `rating`, never a
    user id or name.
  - No API key, review-bearing prompt or full answer is logged at info level.
- **[AC-13]** **Backfill.**
  - `npm run rag:backfill` enqueues one `product.index_changed` per active
    product to the assistant queue, paced by `RAG_BACKFILL_DELAY_MS`.
  - `--dry-run` only counts.
- **[AC-14]** **No regression.** A `@RateLimit` without `per` still counts in
  the global guard with the same key as today.

## Contract impact

| Surface | Change | Release class |
|---|---|---|
| `POST /api/products/:id/ask` | new route ([`contract.md`](contract.md)) | B |
| `errorCode` `ASSISTANT_UNAVAILABLE` | new additive code (503) | B |
| RMQ event `product.index_changed` on `product.fanout` | new, `{productId:number}` | A (internal) |
| TCP `product.rag_source`, `assistant.ask` | new | A (internal) |
| `@RateLimit` options `per` | new optional field, default unchanged | A |
| Prod 5xx sanitizer | one allow-listed code survives | A (no existing response changes) |

Overall: **B**. A new route and a new code are additive, and no existing
response changes.

## Known behaviours touched

- **RMQ-DLQ-01**
  - Queues that have no handler ack `product.index_changed`, so it never
    dead-letters there.
  - A malformed payload is `nack(false,false)` and goes to the DLQ.
- **OUTBOX-SCOPE-01** — the new publish is best-effort. A lost event is healed by
  the next write or by the backfill.
- **WISHLIST-ALERT-01** — this change reuses the same PRODUCT_EXCHANGE raw
  publisher, including its live-channel guard.
- **ACCOUNT-DELETE-01** — `purgeUserData` deactivates products, which now also
  drop out of the index. Reviews by deleted users stay indexed, as text only.
- **BUG-B** — `isActive=false` is a 404 on this route even though the detail
  read returns the product.
- **XSS-DESC-01** — the description is stored as sanitized HTML, so it is
  converted to plain text before chunking.
- **ENVELOPE-01** / **CHG-PW-02**
  - The 503 `error` is the reason phrase.
  - The errorCode is built in the gateway, so no RPC filter needs to forward it.
- **SHAPE-01** — `citations` is never null.
- **EMAIL-REAUTH-01** — this entry claims "per user", but the route is IP-keyed.
  Recorded only (design § Findings).

## Open questions

- Confirm that the brief's default model ids (`gemini-embedding-2`,
  `gemini-3.5-flash-lite`) are served to this key on the free tier. Phase 3
  checks this with one live call. Both are env-overridable, and a wrong id is
  only a 503 / pending, never a crash.
