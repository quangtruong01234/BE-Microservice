# Snapshot — Current State

> Auto-loaded every session. Keep this LEAN: only the live picture (overview,
> active/open work, open questions). Finished work lives in `CHANGELOG.md`
> (same folder, not auto-loaded). Ops facts (deploy, pm2, nginx, env, applied
> migrations, GHN ops) live in `ai-docs/agent-context/ops-runtime.md`. Residual
> behaviours of shipped fixes (NOT open bugs) live in
> `ai-docs/agent-context/known-behaviors.md`. Conventions/rules live in
> `ai-docs/agent-context/` — do not duplicate any of them here.

## System Overview

TryBuy — NestJS monorepo, 10 microservices + 4 shared libs.
Transport: TCP (sync) + RabbitMQ FANOUT (async).
DB: Aiven MySQL 8 (orders/user/product/social/notification/chat) + Aiven
PostgreSQL (inventory/payments/rewards). Cache: Redis (Docker).
Node A: gateway:3000 (HTTP+WS /chat+/notifications), orders:3001, user:3003,
product:3006, social:3008, notification:3009 (TCP+RMQ only, no HTTP), chat:3012 (TCP).
Node B: inventory:3002, payments:3005, rewards:3004.
Base URL: http://localhost:3000 | Swagger: /doc
Prod: EC2 + pm2 (compiled dist), nginx in front, https://<PROD_API_DOMAIN>.

**Status:** backend is deploy-ready and deployed. All P0/P1/P2 FE-blockers,
deploy gate G1–G5, feature roadmap F1–F7, SEC backlog, PERF backlog,
SCALE-01..05/07, PUBID-00..07, DEP-01, CD-01/02 are DONE — see `CHANGELOG.md`.

**Public-id contract (PUBID, shipped 2026-07-17):** converted domains expose
ONLY opaque public ids on HTTP/WS (`ord_`, `usr_`, `prod_`, `conv_`, `msg_`,
`addr_`, `ntf_`, `rr_`, `post_`, `cmt_` + 16 base62 chars); numeric ids on those
route params → 400. Internals (PKs, FKs, TCP/RMQ payloads, JWT `req.user.id`)
stay numeric. Utils: `libs/common/src/public-id/public-id.util.ts` +
`libs/constant/public-id.constant.ts` (note: `@app/constant` alias is NOT in
tsconfig — import as `libs/constant/...`). NOT converted (deliberate):
order_items, product_skus, product_reviews, wishlist_items, cart_items, brands,
categories, vouchers (by `code`), roles/resources, inventory, payments,
reward_points, shipping_history, voucher_redemptions.

## Active Tasks

### PRODTEST-0806 — defects found by the full prod API sweep (2026-08-06)

Full workflow sweep of all 141 gateway routes on `https://<PROD_API_DOMAIN>`
passed functionally (auth → catalog → moderation → cart → checkout → GHN →
fulfilment → returns → social → chat/WS → notifications → admin → callbacks).
Nine real defects, none of them blockers. The first three (duplicate register →
500, role-entity leak, inconsistent pagination) are FIXED and, as of 2026-08-10
(commit `b0e982d`), DEPLOYED AND VERIFIED ON PROD — see `CHANGELOG.md`
2026-08-06. Of the six that remained, five are now closed (#1 RESIL-01, #2
GHN-CREATE-01, #3 misdiagnosed, #5 ENVELOPE-01, #6 ENUM-MSG-01); the only live
work is the two class-C sub-items under #4. Kept in full for the audit trail:

1. ~~**GHN failures surface as opaque 500/502.**~~ FIXED 2026-08-10 by RESIL-01,
   DEPLOYED 2026-08-12 — every GHN call is mapped: refusal → 400 with GHN's own
   message, outage/401/403/429 → 503, plus a circuit breaker. See `CHANGELOG.md`
   "RESIL-01".
2. ~~**Order create swallows a waybill failure**~~ FIXED 2026-08-13 (GHN-CREATE-01)
   — `POST /api/order` now propagates a deterministic GHN refusal (unknown
   district, cross-district ward, unresolvable free-text) as a 400 from the fee
   preview, before anything is reserved or committed, instead of booking an
   unshippable order at fee 0. A GHN *outage* still fails open (fee 0, order
   placed) and `readyToShip` already re-creates the missing waybill. See
   `CHANGELOG.md` 2026-08-13.
3. ~~**Our own address proxy can yield unshippable selections**~~ — LIKELY
   MISDIAGNOSED, re-probed 2026-08-10. The recorded reproducer (district 1534 /
   ward 22306, Huyện Nhà Bè) now returns `201` with a fee on BOTH local and
   **prod** (2 prod calls, different weights/prices, on the pre-RESIL-01 build),
   so the 3 failures on 2026-08-06 were a transient GHN sandbox outage reported
   as an opaque 502 — i.e. defect #1, not a bad ward. Do not spend time
   filtering `/api/shipping/wards`. After RESIL-01 deploys, the same symptom
   self-classifies: `503` ⇒ GHN was down (expected, retry), `400` + GHN's
   message ⇒ the ward really is unshippable and only then is this a real defect.
   GHN-DIST-01 (2026-08-13) adds a third, earlier signal: a district/ward pair
   GHN's master data does not know now 400s before any preview call.
   **REOPENED AND CONFIRMED REAL 2026-08-26** by the self-classification rule
   above. Probed all 19 wards `/api/shipping/wards?districtId=1450` returns for
   Quận 8 against `POST /api/order/shipping-fee` on prod: only **7 of 19** quote
   a fee. Deterministic `400`s, GHN's own message, no 503 anywhere:
   - `910376` / `910375` / `910374` (Rạch Ông, Hưng Phú, Xóm Củi — the 2025
     merged-ward ids) → `phường/xã người nhận không còn hoạt động`. GHN's
     master-data endpoint lists them, GHN's own preview refuses them.
   - `20801`,`20802`,`20803`,`20808`..`20813` → `Lỗi hệ thống - không lấy được
     thông tin kho` (likely a sandbox shop-warehouse coverage gap, not a bad
     ward — re-probe on real GHN credentials before acting on this half).
   So the FE ward dropdown CAN hand a buyer a selection that 400s at checkout,
   and the buyer has no way to tell which. Known-good pair for any manual prod
   test: district `1450` + ward `20816`.
   **FIRST HALF FIXED 2026-08-26 (GHN-WARD-01, class B)** — no preview probe
   needed after all: GHN's own ward payload carries `Status` (1 = live, 3 =
   retired) and the three merged wards are the only `Status: 3` rows, so
   `GET /api/shipping/wards` now filters them out server-side at zero extra GHN
   calls. `?districtId=1450` returns 16 wards, not 19. See `CHANGELOG.md`
   2026-08-26. **Second half is NOT ours to fix, re-probed on prod 2026-08-26**
   (GHN-MSG-01): the nine `Lỗi hệ thống - không lấy được thông tin kho` wards
   are `Status: 1`, i.e. indistinguishable from a good ward. Calling GHN
   directly ruled out every variable on our side (`service_type_id` 2 and 5,
   explicit `from_district_id`/`from_ward_code`, 5kg parcel — all fail
   identically; the shop record is healthy and `available-services` offers both
   services for the lane). Do NOT "fix" it by quoting from
   `/shipping-order/fee`, which answers 200 for those wards: `create` fails with
   the same warehouse error, so that would just re-create the GHN-CREATE-01 bug.
   What DID change: the buyer now gets `GHN_MESSAGE.DESTINATION_NOT_SERVICEABLE`
   instead of GHN's internal system error. **This is live on prod, not a dev-only
   quirk** — prod points at the same `dev-online-gateway` shop `200481`, so 12
   of 19 Quận 8 wards genuinely cannot be ordered to until real GHN credentials
   exist. Re-probe then; only if it persists is the per-district shippable-ward
   cache built from preview probes worth considering.
4. **Numeric internal ids still leak on PUBID domains** — MOSTLY FIXED
   2026-08-13 (IDLEAK-01, class B): `stock-check.productId`, return-request
   `reviewedBy`, moderation `moderatorId`, and the social `"Post 1 not found"` /
   `"Comment 1 not found"` messages all carry a public id (or no id) now. Two
   sub-items were verified ALREADY FIXED earlier and are stale in this list:
   review-create `userId` (REVIEW-ID-01) and the notification message text
   (`orderLabel` is publicId-safe). The last two sub-items (`submittedBy` on the
   pending brand/category queues, `topProducts[].productId` on analytics) are
   **DONE AND RELEASED** — implemented on the backend 2026-08-15 (IDLEAK-02,
   release class C), pushed 2026-08-16 (`6bcb6da..44d976e`) once both FE cells
   went ✅, and the `release-gate.md` entry now sits under **Released**. The
   class-C hold that used to be described here is OVER — do not treat the `api`
   working tree as blocked by it. See `CHANGELOG.md` 2026-08-15. With that,
   defect #4 has nothing left to implement.
   (Fixed and deployed 2026-08-12 by GHN-HIST-01: shipping-history `actorId`
   and every GHN action/status message now carry `usr_`/`ord_`. Wishlist `id`
   was fixed by the 08-11 batch.)
5. ~~**Envelope inconsistency**~~ FIXED 2026-08-13 (ENVELOPE-01) — the gateway
   filter no longer falls back to the exception class name; `error` is the
   status-derived reason phrase in every branch and in both environments. See
   `CHANGELOG.md` 2026-08-13.
6. ~~**`@IsEnum([...])` with array literals**~~ FIXED 2026-08-13 (ENUM-MSG-01)
   — both review DTOs use `@IsIn([...])`, so the 400 now reads `action must be
   one of the following values: approve, reject`.

Observations (not defects): `/ready` reports `database:not_configured` and
`rabbitmq:not_checked`, so readiness stays green even if RMQ is down. The
`GET /api/cart` → `data:null` observation is CLOSED — SHAPE-01 (2026-08-26) now
answers `{"id":null,"userId","items":[]}` for a user with no cart row. The
`shippingFee: 0` observation is CLOSED —
the GHN dev gateway returns zero for every destination/weight on both fee
endpoints; see `ops-runtime.md` → GHN.

### RESIL-01..03 — resilience patterns borrowed from a flash-sale reference (2026-08-10)

Reviewed a high-concurrency flash-sale/seckill reference architecture against
this codebase. Most of what it prescribes ALREADY EXISTS here — do not re-open
these: idempotency key (`order.service.ts` Redis `SET NX`, 24h replay, 409 on
concurrent double-submit), oversell protection (`inventory.service.ts`
`pessimistic_write` + reservation ledger keyed by `reservationKey`), SAGA
compensation (`releaseReservedItems()` on every failure path), rate limiting
(`CustomRateLimitGuard`, Redis Lua window, fail-closed in prod), load-test
baselines (`scripts/load/baseline.mjs`). Three real gaps are worth closing, in
this order:

- **RESIL-01 — circuit breaker + error mapping around GHN — DONE 2026-08-10,
  DEPLOYED 2026-08-12.** See `CHANGELOG.md`. The reusable breaker now lives at
  `libs/common/src/resilience/circuit-breaker.ts` (exported from `@app/common`);
  it is deliberately in-process, so with multiple instances each learns an
  outage on its own. GHN is currently its only consumer — reuse it for any other
  outbound third-party integration rather than writing a second one.
- **RESIL-02 — transactional outbox for `order_created` — DONE 2026-08-13,
  DEPLOYED 2026-08-15.** See `CHANGELOG.md`. Two things a future session must
  know: the migration `nodeA-20260813-001-add-order-outbox` was applied to prod
  by that deploy (no longer owed); and the fix included the missing
  `await app.init()` in
  `apps/orders/src/main.ts` — see Known Issues. Follow-up (2026-08-14): that
  `init()` also started running `OrdersService.onModuleInit()`, whose eager
  `client.connect()` calls crashed the process when a peer was not listening
  yet — orders and product each refused to boot while the other was down. Both
  warmups are best-effort now (warn + lazy connect on first send).
- **RESIL-03 — Prometheus metrics — DONE 2026-08-14, DEPLOYED 2026-08-15.** See
  `CHANGELOG.md`. `GET /metrics` on the gateway (default process metrics +
  `http_requests_total` / `http_request_duration_seconds` /
  `http_requests_in_flight`, labelled with the ROUTE PATTERN, unmatched paths
  collapsed). Prod needs `METRICS_TOKEN` in `local/nodeA/.env` — still UNSET, so
  `/metrics` currently 404s on prod (verified 2026-08-15); set it only when a
  scraper actually exists. Only the gateway is instrumented; the other 9
  services still have no metrics surface, and the registry is per-process, so
  `GATEWAY_INSTANCES>1` would need `prom-client`'s cluster aggregator.
- **TCP-RESIL-01 — null-socket race fixed at the transport — DONE and DEPLOYED
  2026-08-15** (commit `6bcb6da`, class A). See `CHANGELOG.md`. All 35 TCP
  client registrations now use
  `customClass: ResilientClientTCP` (`libs/common/src/resilience/`), which
  reconnects-and-republishes the unsent packet (safe on writes too), fails a
  send on an already-closed socket immediately instead of hanging out the
  caller's timeout, and sets TCP keep-alive. `retryOnTransportError()` is kept
  as the outage layer and is still reads-only. **Any new client registration
  must use `customClass`, not `transport: Transport.TCP`.**

Deliberately NOT doing (decided, do not re-propose): full DDD refactor (huge
diff, zero behaviour change); async order placement via queue (breaks the
synchronous checkout contract the FE depends on for `paymentUrl`/`orderUrl`);
Kafka replacing RabbitMQ (hybrid TCP/RMQ was settled 2026-06-30); stock
bucketing. **Gated:** Redis pre-deduct STOCK via atomic Lua — the real seckill
core, and the fix for reserve serializing on a hot row lock, but only if a real
flash-sale event is planned. The primitive now exists and is proven:
VOUCHER-CONC-01 (2026-08-18) put the same pattern in front of the voucher quota
(`CachedService.claimFromSeededQuota` / `releaseToSeededQuota`, seed+check+decr
in one Lua step, TTL self-healing, fails open). Extending it to stock reuses
that helper — the hard part left is per-SKU seeding and the compensation matrix,
not the Lua. Second tier of local cache in front of Redis is also open but only
safe for brand/category (multi-instance staleness).

### CI/CD

- **CD-01 deploy workflow is LIVE** — first successful production run 2026-08-06
  (sha `19309f6`); it applied the owed `product_reviews.product_id` migration and
  restarted all 10 pm2 apps. Box/secret facts + the two traps that broke run #1
  are in `ops-runtime.md` → CI/CD.
- **Merging into `main` releases to prod (CD-04, settled 2026-08-06).** Deploy
  triggers on CI completion for `main` and runs only when CI ended green; a
  direct push to `main` ships the same way. `workflow_dispatch` is kept for
  redeploys no commit triggers (box was stopped, rollback, env change). Nothing
  gates the release — the `production` Environment cannot carry protection rules
  (GitHub gates required reviewers to paid plans on private repos). Two accepted
  consequences: docs-only commits redeploy prod, and a merge landing inside the
  EC2's stopped window fails at the SSH step, leaving prod on the previous build
  until someone starts the box and dispatches manually.
- **CD-05 env ownership — DEPLOYED AND VERIFIED 2026-08-10 (commit `6400656`)** —
  `FRONTEND_URL` + `AUTH_COOKIE_SAME_SITE` live in `ecosystem.config.js`, not
  `local/node*/.env`, and deploy uses `pm2 startOrRestart --env production
  --update-env`. Two prod FE origins, storefront FIRST (payments reads entry
  `[0]`): `https://fe-react-vite.quangtruong01234.workers.dev` (storefront) and
  `https://web-flow-ghn.vercel.app` (GHN console).
  - **`--update-env` is now PROVEN to be enough — no manual pm2 step.** The
    owed-once `pm2 delete gateway payments && pm2 start …` was never run: CORS
    came back on its own ~3.5 min after the push, purely from the deploy. Do
    not prescribe the delete/start recipe for a future env change; it is only a
    fallback if `--update-env` ever fails to take.
  - Post-deploy curl evidence: both origins get
    `Access-Control-Allow-Origin: <origin>` + `Access-Control-Allow-Credentials:
    true` (`Vary: Origin`); an unlisted origin gets NO allow-origin (still 200,
    the browser is what blocks); `OPTIONS /api/user/login` preflight → 204 with
    `Allow-Methods GET,HEAD,PUT,PATCH,POST,DELETE`; login sets
    `HttpOnly; Secure; SameSite=None; Path=/; Max-Age=18000`, and that cookie
    authenticates a follow-up `GET /api/user/me` → 200.
  - **Verify with curl, not `pm2 env <id>`** — pm2 prints only what it injected,
    never what `dotenv` loads inside the process, so it cannot tell you the
    runtime value:
    `curl -sI -H "Origin: <fe-origin>" https://<PROD_API_DOMAIN>/live | grep -i access-control`.
  - Ordering that caused the 2026-08-09 outage: the box `.env` `FRONTEND_URL`
    was commented out BEFORE the pm2-injected replacement shipped, leaving the
    allow-list empty. Change the source of truth first, deploy, then clean up
    the old one — never the reverse. See `CHANGELOG.md` and `ops-runtime.md`.
- **CD-03 — build-on-runner variant**: only if the EC2 gets smaller/slower
  (CI-built `dist/` rsync + `npm ci --omit=dev` + restart). Not needed while
  CD-01 works.

### Architecture prep — hybrid TCP/RabbitMQ (decided 2026-06-30)

Keep the hybrid model — do NOT migrate everything to RabbitMQ. TCP for
commands/queries needing an immediate result (gateway reads, auth, checkout
stock check/reserve/release/consume); RabbitMQ fanout for post-commit
integration events (`order_created`, `payment_completed`, `order_canceled`,
notification/rewards). Orders = lifecycle coordinator; Inventory = stock/
reservation owner; Payments = payment-state owner. Reserved stock is consumed
at COMPLETED; cancel/return releases it.
**Next improvement when ready (not a gate):** outbox-style publish path for
critical domain events so DB commit + event publish cannot drift; keep
idempotency via `orderId`/`reservationKey`/unique constraints in consumers.

### GHN Web console — remaining FE steps (backend ready)

FE workspace: `../web-flow-GHN` (Next.js, dev `3013`). Backend Phase 1/1.1 + B1
(cancel/return) + B2 (update-COD/receiver) are live; delivery-again is
**dropped** (not shop-callable per live GHN probe). Only backend contract still
blocking FE: analytics charts. Remaining FE steps (top-down): 3) read-only
shipment list/detail/history via TanStack Query; 4) manual-sync mutation +
invalidate/refetch (FE never sets GHN status or calls GHN directly); 5) prod-like
error handling 401/403/404/400/500-503; 6) settings page stays read-only/mock
(never expose GHN token); 7) FE tests. Deps to add: `@tanstack/react-query`,
`zustand`, `clsx`, `tailwind-merge`, `lucide-react` (no `recharts`/`shadcn/ui`
yet). Auth: cookie `credentials:"include"`, roles `logistics_operator` /
`shipping_manager` (test accounts seeded — see `../.agent-local/test-accounts.md`).

### GHN-ETA-01 — persist + expose the GHN delivery ETA (planned, 1 additive migration)

GHN DOES return a delivery estimate, but as an **absolute timestamp**, not a
duration and not a distance: `expected_delivery_time` (ISO 8601 UTC) on
`/v2/shipping-order/preview` AND on `/v2/shipping-order/create`, computed from
`from_district/ward → to_district/ward` + `service_type_id`. There is no km or
hours/days field. Probed on the dev sandbox 2026-08-13: fee is 0 as always but
`expected_delivery_time` carries a REAL value, so this is not blocked on prod
GHN credentials. GHN also has a dedicated `POST /v2/shipping-order/leadtime`
(`{leadtime, leadtime_order:{from_estimate_date,to_estimate_date}}`) — we do not
call it and do not need to; preview already hands us the same value for free.

Already wired: `previewShippingFee` (`ghn.service.ts:408`) → `POST
/api/order/shipping-fee` returns `{shippingFee, expectedDeliveryTime}`, and
`getOrderDetail` (`ghn.service.ts:657-658`) maps both `expectedDeliveryTime` and
`leadtime` into `GhnOrderDetail` for the admin GHN console.

Gap: `createShippingOrder` (`ghn.service.ts:365`) reads only `order_code` and
DROPS the `expected_delivery_time` sitting in the same response; no column on
`orders` stores it. So the buyer sees an ETA once at checkout and never again —
`GET /api/order/:id` has no such field.

To do: `orders.expected_delivery_time DATETIME NULL` (additive), write it at
waybill create, refresh on webhook/manual sync, expose on the order read. FE
renders "giao trong X ngày" by diffing against now — do NOT compute a duration
server-side. Release class **B** (current FE keeps working).

### AI-02F5 — pHash lookup scale path (gated, not calendar-scheduled)

Current Hamming comparison is an O(catalog) scan — fine for the present small
catalog. Trigger: catalog/load evidence near ~10k products. Then benchmark and
replace with persisted hash buckets/BK-tree (retain exact Hamming verification
after candidate retrieval); add index/migration only after the benchmark picks
the design.

### AI-03 — Sell From Photo (Gemini; planned, no migration)

- **Flow:** seller uploads photo via existing Cloudinary signature flow → FE
  sends the Cloudinary URL → `POST /api/products/ai/draft-from-photo {imageUrl}`
  (JwtAuthGuard + explicit `@RateLimit`) → gateway `AiModule` (stateless, no
  product-service hop): SSRF guard (URL must be our Cloudinary cloud) →
  download bytes → shared `GeminiClient` (`libs/common/src/gemini/`,
  `GEMINI_API_KEY`/`GEMINI_MODEL` env, flash model, responseSchema JSON mode) →
  prompt includes the REAL category list (from the cached brand/category read)
  → returns `{name, description, categoryIds, condition, attributes[],
  confidence}` in Vietnamese. Always editable, never auto-published.
- **Reuse:** upload signature flow untouched; Redis dedupe cache keyed by image
  URL hash (`@app/cached`); rate-limit guard.
- **Risks:** free-tier quota → per-user rate limit + dedupe + graceful 503 "AI
  đang bận" (FE falls back to manual form — must degrade, never block selling);
  hallucinated categories → validate ids against the real list, drop unknowns;
  NSFW/non-product → map Gemini safety block to 400; NEVER expose the key to FE.
- **Later:** multi-photo, brand detection, AI-01 price wiring, suggested SKUs.

### AI-04 — Visual Search (planned; reuses AI-03 client; 1 additive migration)

- **Index half:** after product create/update, product service fire-and-forget
  Gemini-tags the primary image (normalized VI+EN tags + one-line caption) →
  `products.ai_tags` JSON NULL (+ optional `ai_caption` VARCHAR(512) NULL);
  backfill script tags the existing catalog once; `product.retag` admin pattern
  for refresh.
- **Query half:** `POST /api/products/visual-search {imageUrl, page?, limit?}`
  (JwtAuthGuard + `@RateLimit`) → Gemini tags the query image (same client/
  cache) → new TCP `product.search_by_tags {tags[]}` → weighted-Jaccard tag
  overlap (ties: rating/viewCount) → standard `PaginatedResponse` in the SAME
  shape as `product.search` (FE reuses product cards).
- **Edges:** constrain prompt to a controlled vocabulary (color/type/material/
  style); untagged products invisible → retag path + nightly sweep; empty
  overlap → fall back to text search on caption; upgrade path is CLIP +
  pgvector WITHOUT changing the public API.
- **Shared prerequisites (do once, in AI-03):** `GEMINI_API_KEY`/`GEMINI_MODEL`
  in `local/nodeA/.env` (+ `.env.example`); `GeminiClient` in
  `libs/common/src/gemini/` (typed JSON-schema responses, timeout, quota-error
  classification); image-download util with Cloudinary-host allowlist. All AI
  paths are best-effort: catalog CRUD must never fail because Gemini failed.

### SCALE-06 — load-test evidence (remainder)

Script shipped: `scripts/load/baseline.mjs` (autocannon; profiles
`smoke|500|1k|5k`; baselines recorded in the script header — post-SCALE-04:
anon list 798 req/s, detail 1692 req/s, c=500 survives ~3.6% err; auth ~102
req/s). Remaining: re-run behind nginx on the target VPS (attributes SCALE-03
gains) and re-measure `GATEWAY_INSTANCES>1` there — the dev-machine cluster
probe was noisy/no stable gain. Aiven-free hard wall ≈ 76 conns ≈ 300 req/s
across ALL services; true 10k sustained likely needs a bigger VPS/Aiven tier.

### SOCIAL-LIKE-NTF-01 — liking a post notifies nobody (product decision, not a bug)

`comment` and `reply` both notify the post owner (verified on prod 2026-08-13 —
badge moves in realtime, no reload). Like does not: `likePost()`
(`apps/social/src/social.service.ts:506`) only writes `post_like` + bumps the
cached counter, emits no event, and `apps/notification/` has no `like` handler —
it was never implemented, so do NOT go hunting for a dropped event. Adding it is
an emit + a handler + a notification type; the open question is product-side
(likes are high-frequency, so it likely needs batching/throttling, e.g. "X and 4
others liked your post", rather than one notification per like). FE needs
nothing until that is decided.

### GHN-FAIL-NTF-01 — notify the buyer on a failed delivery attempt (planned, class B, no migration)

Left open by GHN-FAIL-01 (2026-08-16): `delivery_fail` moves no local status and
notifies nobody. Decided shape — implement as-is, the design work is done:

- **Scope: `delivery_fail` ONLY**, of the ten `GHN_STATUSES_WITHOUT_LOCAL_STATUS`.
  It is the only one the buyer can act on (wrong address / nobody home / phone
  unreachable) and the last chance to fix it before the return family cancels the
  order. The in-transit legs are GHN-internal noise. `exception`/`damage`/`lost`
  deliberately do NOT auto-notify — telling a buyer their parcel is lost before a
  human has decided the remedy is worse than silence; warn internally instead.
- **Buyer only, in-app only, no email.** `EMAILED_STATUSES` is milestones only
  (`shipped`/`delivering`/`completed`); emailing a retryable event generates
  "is my order broken?" tickets. Seller can do nothing about a missed attempt.
- **Dedupe is the hard part** — `applyGhnStatus` returns `changed:false`, so
  there is NO transition to hang idempotency on (unlike every existing order
  notification), GHN retries ~3×, webhooks redeliver, and all three entry points
  (webhook / manual sync / demo-status) hit the same function. Emit naively and
  one order yields 3–5 identical notifications. **Use `shipping_history` as the
  ledger: emit only when this is the FIRST `delivery_fail` row for the order.**
  The row is written in that code path anyway — one existence query on
  `shippingHistoryRepository` (already injected, `orders.service.ts:129`), no
  Redis, no new column, no migration. Later attempts still write history for the
  console; they just stop pestering the buyer.
- **New event, do NOT reuse `order.status_changed`** — its payload's
  `status`/`previousStatus` mean `OrderStatus`, and `statusChangedMessage()`
  would need a branch for a "status" that does not exist.
- `type = "order_delivery_attempt_failed"` (`type` is free-form `varchar(50)`;
  an unmapped type falls back to default rendering on FE — NOTIF-LIFECYCLE-01
  precedent). Wording must read as not-final: "Giao hàng chưa thành công, đơn vị
  vận chuyển sẽ giao lại…", never a bare "thất bại".
- **Still the user's call:** whether the notification carries a CTA. A buyer
  cannot self-serve an address fix after the waybill exists (`update_receiver` is
  an admin/`shipping_manager` action), so it is either purely informational or
  "liên hệ người bán", which shifts load onto the shop.

### VOUCHER-SHOP-01 — phase 1 + edit routes DONE; phase 2 (stacking) still open

Phase 1 (per-shop vouchers + basket eligibility list) and VOUCHER-GUARD-01 (the
fixed-value-vs-threshold guard) are IMPLEMENTED, self-tested and release **class
B** — see `CHANGELOG.md` 2026-08-25. **RELEASED TO PROD 2026-08-26** (`e10506f`),
migration applied and verified live. What shipped, in one line each: a shop can
create/list/deactivate its own vouchers (`/api/order/vouchers*`, new RBAC
resource `voucher`), an admin can assign one to a shop; `POST
/api/order/vouchers/available` prices every relevant voucher against the basket
and returns `isEligible` + `ineligibleReason` + `amountToAdd`; a shop voucher is
priced against **that seller's slice**, a platform voucher against the whole
goods subtotal.

**VOUCHER-EDIT-01 (2026-08-26, class B, no migration)** closed the last open item
in `backend-handoff.md`: `PATCH /api/order/vouchers/:id` (shop, own only) and
`PATCH /api/order/admin/vouchers/:id` (admin, any). Partial body; `null` clears a
nullable field; `{"isActive":true}` is the reactivate path (deactivate used to be
one-way). `code`/`discountType`/`discountValue` are absent from `UpdateVoucherDto`
on purpose — immutable, so the gateway whitelist 400s them before orders is
reached. On a REDEEMED voucher only LOOSENING is allowed (`isStricterCap()` in
`orders.service.ts`); an untouched voucher edits freely. Changing `usageLimit`
drops the VOUCHER-CONC-01 Redis quota key so the next claim re-seeds instead of
enforcing the old cap for up to 300s. Same commit: an explicit `sellerId: null`
on voucher create is now a platform voucher instead of a `404 User not found`.
See `CHANGELOG.md` 2026-08-26.

**Two invariants a future session must not break:**
- **One rules engine.** `evaluateVoucher()` (`apps/orders/src/orders.service.ts`)
  is pure and non-throwing; the list maps it to a response and
  `validateVoucherForCheckout` maps it to a 400 via `voucherRejection()`. Never
  re-implement a rule in the list path — list and apply drifting apart is the
  exact failure this design exists to prevent.
- **Visible ≠ applicable.** The list is a hint; applying an ineligible code still
  400s on `voucher/validate` and on `POST /api/order`.

**Phase 2 — Shopee-style stacking + multi-shop apportionment (NOT started):**
- Keep it class B by adding an optional `voucherCodes?: string[]` *alongside* the
  existing `voucherCode` rather than changing that field's type (changing it is
  class C and would need a `release-gate.md` hold).
- Target is one shop voucher per shop + one platform voucher.
- Lifting the `SINGLE_SELLER_ONLY` block (gateway `createOrder` AND
  `validateVoucher`, `apps/gateway/src/order/order.service.ts`) belongs to
  phase 2. **Landmine when you do:** `previewVoucher()`
  (`apps/orders/src/orders.service.ts`) does not build the seller map from the
  items — it assigns the WHOLE `itemsTotal` to the single `sellerId` the
  gateway passes. That is correct today only because the gateway 400s a
  multi-seller basket first. Lift the guard without switching preview to
  `buildSubtotalBySellerId(items)` and a shop voucher gets priced against the
  entire multi-shop cart, i.e. exactly the list-vs-apply drift this design
  exists to prevent.
- **Voucher codes are globally unique** (`uq_vouchers_code`) and checkout looks
  a voucher up **by code alone**. So the first shop to take `SALE10` blocks
  every other shop and the platform forever, where Shopee namespaces codes per
  shop. Fixing it is a composite unique `(seller_id, code)` PLUS a lookup that
  resolves the code within the basket's sellers — bigger than it looks, decide
  in phase 2. Related minor: the shop-facing create echoes the code in its 409
  (`ALREADY_EXISTS`), which lets a shop probe whether a rival's code exists —
  same class as the leak closed on deactivate, low severity because codes are
  meant to reach buyers anyway.
- **Wrinkle to settle first:** a platform voucher across a multi-shop checkout
  writes one `voucher_redemptions` row **per sub-order** (unique key is
  `(voucher_id, order_id)`), so it burns N redemptions against `usage_limit`
  where Shopee counts 1 — and the Redis quota mirror (VOUCHER-CONC-01)
  decrements N times too. Decide the counting unit (per checkout vs per order)
  before writing the redemption path.

### Open questions

- **OQ-2:** can GHN webhook `?token=` query auth be REMOVED entirely (header
  `x-ghn-webhook-token` is preferred and a deprecation warn already logs on
  query use)? Depends on what the GHN dashboard supports.
- **OQ-6:** target rate-limit numbers for login/register/upload/checkout
  (product decision) — also informs nginx `limit_req` tuning if FE fan-out
  trips 429.

## Known Issues

> Details for all of these live in `ai-docs/agent-context/known-behaviors.md` —
> they are residual/deliberate behaviours of shipped fixes, NOT open bugs. Do
> not re-diagnose them; do not assert the opposite contract in tests.

- ORD-RBAC-01: `PATCH /api/order/:id/{ship,deliver,complete}` is admin-only —
  role `shop` gets 403 before the order is loaded (so 403 even for a bad id).
  `confirm` / `ready-to-ship` still accept `shop`; recovery is admin GHN sync.
- ORD-GUARD-01: seller transitions 400 on a non-COD order with `paidAt` NULL;
  `paidAt` is exposed on every order read; the backfill treats legacy
  hand-walked orders as paid.
- SKU edit: `skuList` is the FULL desired set (not a delta); mirror stock only
  pushed on change; reference check fails safe → deactivate.
- STOCK-SYNC-01: stock now syncs BOTH ways (product PATCH → base inventory row;
  `PUT /inventory/:id` → mirror via `stock_changed`). Absolute set, not a delta;
  SKU-matrix / row-less products are warn-and-skip; on an inventory failure the
  PATCH fails with only the stock mirror rolled back.
- Checkout: single-seller `POST /api/order` has NO `paymentUrl` — client calls
  `GET /api/order/:id/payment-url` → key is `orderUrl`.
- Payment return URL now carries `?order=ord_<16>`; payments created BEFORE
  2026-08-07 keep a signed URL with the numeric id and cannot be rewritten.
- `PATCH /api/products/:id`: `null` clears only the six nullable columns
  (description, sku, brandId, sellerNotes, weight, imageUrls); `null` on any
  other field is a 400 by design, not an oversight.
- P0-03 compensation: trigger is an `inventory.sku` unique collision;
  discrimination reads `error.driverError.detail`, not `error.message`.
- Product PATCH optimistic locking: `version` is opt-in; background writers
  bump it; 409 = "reload and re-apply".
- Approved return restocks via `inventory.restock_returned`, NOT a release; new
  terminal ledger state `RETURNED`; the restock is non-fatal to the refund.
- Buyer cancel: GHN cancel is detached (2×5s); both fail → live waybill
  remains, remedy = admin GHN cancel.
- Array query params: `?categoryIds[]=` → 400; use repeated keys or scalar.
- GHN free-text address is best-effort; exact `toDistrictId`+`toWardCode` skip
  resolution; `toWardCode` stays a string (leading zeros).
- GHN-FAIL-01: `delivery_fail` (plus `ready_to_pick`, the in-transit legs,
  `exception`/`damage`/`lost`) deliberately does NOT move the local status — it
  is a failed delivery ATTEMPT and GHN retries before the return family, which
  already cancels. The history row now reads "acknowledged; no local
  equivalent"; only a GHN status we have never seen still reads "Unhandled"
  (now at warn). Not a gap — do not map it.
- GHN-DIST-01: an unknown `toDistrictId` / a ward from another district is a 400
  on `POST /api/order/shipping-fee`, on `POST /api/order` (GHN-CREATE-01) and at
  waybill create — but validation is fail-open (outage/empty list ⇒ quote and
  place the order anyway).
- Storefront catalog defaults `isActive:true` unless `isActive` or single
  `userId` is passed; `?userId=` shows that seller's hidden products by design;
  `GET /api/products/:id` still returns deactivated products with 200.
- ORD-CRON-01 (LIVE ON PROD since the 2026-08-15 deploy — the first sweep wave
  is happening now): orders `@Cron`s were NEVER scheduled before 2026-08-13 —
  `main.ts` called neither `listen()` nor `init()`, so no lifecycle hook ran.
  Consequence of the fix: `sweepStaleReservations()` starts running hourly for
  the first time and has a backlog to clear (58 sweepable orders on DEV; prod
  count unknown), canceling abandoned PENDING/CONFIRMED/PROCESSING orders with
  no GHN code older than `ORDER_STALE_RESERVATION_TTL_HOURS` (24) and releasing
  their stock. Capped at 25 orders/tick, so a backlog drains over hours, not in
  one burst. Buyers of those orders get a cancel notification — expected, but
  it will look like a wave on the first day after deploy.
- OUTBOX-SCOPE-01 (silent-drop half FIXED 2026-08-15): every RMQ publish site
  in all 6 publishing services now guards with the shared
  `isRmqPublisherLive()` (`libs/common/src/rmq/rmq-publisher.util.ts`), so a
  broker outage produces a log naming the dropped event instead of a silent
  no-op — payments had NO guard at all and now logs at error level because a
  lost `payment_completed` leaves a paid order unflipped and needs manual
  reconciliation. What is unchanged and deliberate: only `order_created` is
  DURABLE (RESIL-02 outbox). The rest stay best-effort — their state-critical
  work already ran synchronously before the publish, so the events are
  notification-grade; routing them through the outbox would risk duplicate
  notifications (`order.status_changed` has no idempotency key). Do not
  re-open as a silent-loss bug; re-open only if one of those events becomes
  state-critical.
- PATCH-ATOMIC-01: `PATCH /api/products/:id` is NOT one transaction — product
  fields, `skuList`, and the inventory stock write are three sequential steps
  across two databases. A late inventory failure rolls the stock mirror back but
  leaves the product fields committed behind an error response.
- VOUCHER-CONC-01: the Redis quota gate in front of a capped voucher FAILS OPEN
  (Redis down ⇒ checkout proceeds, the conditional UPDATE still enforces the
  cap) and is only a mirror of `usage_limit - used_count`, so a lost refund can
  make it pessimistic for up to its 300s TTL — a buyer gets 409
  `JUST_FULLY_REDEEMED` on a code that still has room. Deliberate. Also
  unchanged by that work: a payment-init failure after commit cancels the order
  but does NOT give the redemption back.
- VOUCHER-SHOP-01 residuals (deliberate): the admin `sellerId` on
  `POST /api/order/admin/vouchers` is only checked to be an EXISTING user (404
  otherwise), not a `shop`-role one — assigning it to a buyer just yields a
  voucher no basket ever matches. `GET /api/order/vouchers/available` caps at 50
  vouchers and is uncached (it prices against the live basket). A shop's 403 on
  another shop's voucher carries NO code in the message, on purpose — otherwise
  walking numeric voucher ids harvests other shops' codes.
- VOUCHER-CANCEL-01 (found on prod 2026-08-26, FIXED the same day): cancelling
  an order now gives the voucher redemption back — `releaseVoucherRedemption()`
  deletes the `voucher_redemptions` row, decrements `used_count` and drops the
  Redis quota mirror on every cancel path. Residual, deliberate: a **returned**
  order reaches CANCELED through `applyGhnStatus`, so a return also gives the
  voucher back; and the release is non-fatal, so if it throws the cancel still
  succeeds and the counter stays pessimistically high (same tolerated state as
  VOUCHER-CONC-01). Cancel-farming a limited code is now possible by design —
  the alternative was permanently burning a slot for an order that was never
  fulfilled. See `CHANGELOG.md` 2026-08-26.
- VOUCHER-EDIT-01: a LOOSENING edit on a redeemed voucher cannot be walked back
  through the API — the reverse is by definition a tightening, which the same
  rule 400s. Bump `usageLimit` 3 → 20 by mistake and the only remedy is
  deactivate + reissue (FE has been told to confirm before widening). Deliberate:
  the alternative is letting a shop tighten the rules of a campaign buyers are
  already playing. Also deliberate: an empty `{}` body is a 200 no-op, and
  `expiresAt` before `startsAt` is still accepted, exactly as on create.
- VOUCHER-NULL-01: on `PATCH .../vouchers/:id`, `minOrderAmount` and `isActive`
  reject an explicit `null` with a 400 (they map to NOT NULL columns — send
  `0` / `false`). The other six fields still take `null` as "clear it".
  Deliberate asymmetry: `POST .../vouchers` still coerces a `null` on those two
  to the default (0 / true) and answers 201 — tightening create would turn a
  currently-succeeding call into a 400 (class C) for no reported benefit.
- SHAPE-01 residuals (deliberate, 2026-08-26; hậu kiểm 2026-08-27): the
  empty-cart shape is `{id:null, userId, createdAt:null, updatedAt:null,
  items:[]}` — the SAME KEY SET as a real cart. The first cut omitted both
  timestamps ("the row does not exist"); the FE pointed out that is one endpoint
  with two shapes, which is what rule 2 bans, and it was fixed.
  `resolveProductIds` preserves INPUT order; `findProductsByIds` does not (plain
  `IN`, no ORDER BY), so `POST /api/products/with-inventory/multiple` answers in
  DB order — callers must key by id, verified 2026-08-27.
  A missing single relation still comes back `null`
  (`inventory`, `brand`, `author`), NOT `{}` — the FE asked for `{}` and it was
  declined. `@IsOptionalNotNull()` was applied only where `null` provably 500s
  today; ~140 other `@IsOptional()` gateway DTO fields still accept a `null` and
  answer 200 — do NOT sweep them, tightening a passing call is class C.
  `POST /api/user/me/addresses {"isDefault":null}` stays a 201 for that exact
  reason (create computes the flag), while the PATCH is a 400.
- BATCH-FAIL-01: on `POST /api/products/with-inventory/multiple`, a
  product-service failure is now a **502**, not `200 []` — `[]` means "the
  catalog resolved none of these ids", which is what makes SHAPE-01 rule 4
  (skip a stale id) safe to rely on. The **inventory** leg still degrades
  silently to `inventory: null` on an outage, deliberately: the product rows
  are the answer, stock is an enrichment, and a `null` there is already part of
  the contract. So a client cannot distinguish "no inventory row" from
  "inventory service down" — that is on purpose, do not re-open it as a gap.
- ENRICH-FAIL-01: the seller/author embed no longer swallows a user-service
  failure. A seller/author that does not RESOLVE is still `user: null` /
  `author: null` (the user-service handlers return null or filter the row, they
  never throw) — only a transport/service failure now surfaces, as the usual
  502/408. Residual, deliberate: a social **write** (`createPost`, like, follow,
  report) exposes its response through `exposeReferences`, so a user-service
  outage in that window turns a committed write into a 502 and a retry can
  duplicate it. That was already true of the sibling post-id/comment-id legs of
  the same `Promise.all`, which never swallowed theirs; the alternative is
  answering 200 with every user id nulled. Untouched on purpose:
  `exposeSubmittedBy` still drops `submittedBy` on a user-service failure so the
  moderation queue stays usable — that field is decoration, not the answer.
- REPORT-TOTAL-01: `deletePost` hard-removes the post and never deletes its
  `post_reports` rows, so orphan reports accumulate forever. Deliberate — the
  rows are the moderation audit trail. Since 2026-08-21 they are invisible to
  `GET /social/admin/reports` (both the page and `total` inner-join `posts`),
  so this is a storage-only residue, not a contract bug.

## Ops / Runtime Reference

Moved to `ai-docs/agent-context/ops-runtime.md` (load on demand — keywords:
deploy, pm2, nginx, prod env, EC2, cloudinary, GHN ops, applied migration,
seed). It covers: prod runtime (FRONTEND_URL via pm2, EC2 stop/start schedule
+ log-reading recipe, GATEWAY_HOST, nginx/SCALE-03), CI/CD, the migration
cutoff + applied-migration ledger, seed/bootstrap (SEED-01), the full GHN
reference (env, webhook, address resolution, admin actions, demo-status),
payments notes, and feature ops contracts (invoice fonts, forgot-password,
email notifications, checkout addressing, analytics, moderation, low-stock,
Cloudinary folders).

## History

Finished milestones and completed tasks live in `CHANGELOG.md` (same folder,
not auto-loaded). Read it only when you need the history or rationale behind a
past change.
