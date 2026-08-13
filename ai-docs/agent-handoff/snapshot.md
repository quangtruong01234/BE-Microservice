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

> ⏳ IN-PROGRESS (sweep): SOCIAL-502 rollout — step: researching

### SOCIAL-502 follow-up — roll the transport retry out beyond social (optional)

`retryOnTransportError()` (`apps/gateway/src/common/exception/transport-error.ts`)
is applied to the 7 idempotent read call sites in `social.service.ts` only. The
same null-socket race can hit ANY gateway TCP read; the sanitizing 502 branch in
`MicroserviceErrorHandler` already covers all 14 gateway services, so what is
left is purely the retry. Extend it read-by-read (cart, chat, product, order,
notification, …) — **reads only**, and always AFTER `timeout(...)` so each
attempt keeps its own budget and an rxjs `TimeoutError` is never retried. Never
put it on a write: a retried write can apply twice.

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
4. **Numeric internal ids still leak on PUBID domains** — MOSTLY FIXED
   2026-08-13 (IDLEAK-01, class B): `stock-check.productId`, return-request
   `reviewedBy`, moderation `moderatorId`, and the social `"Post 1 not found"` /
   `"Comment 1 not found"` messages all carry a public id (or no id) now. Two
   sub-items were verified ALREADY FIXED earlier and are stale in this list:
   review-create `userId` (REVIEW-ID-01) and the notification message text
   (`orderLabel` is publicId-safe). **Still open, and deliberately deferred as
   release class C** — both have a live FE consumer typed `number`, so backend
   and FE must ship together:
   - `submittedBy` on pending brands/categories — rendered as `#{submittedBy}`
     in `PendingBrandsPage.tsx:101` / `PendingCategoriesPage.tsx:101`, typed
     `submittedBy: number` in `frontend/src/types/catalog.ts`.
   - `topProducts[].productId` on the analytics response.
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
`rabbitmq:not_checked`, so readiness stays green even if RMQ is down;
`GET /api/cart` returns `data:null` after the last item is removed (cart row is
deleted) rather than an empty cart. The `shippingFee: 0` observation is CLOSED —
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
- **RESIL-02 — transactional outbox for `order_created` — DONE 2026-08-13, NOT
  YET DEPLOYED.** See `CHANGELOG.md`. Two things a future session must know:
  the migration `nodeA-20260813-001-add-order-outbox` is **owed on prod** (the
  CD workflow applies it before the restart, so the push that ships this covers
  it); and the fix included the missing `await app.init()` in
  `apps/orders/src/main.ts` — see Known Issues. Follow-up (2026-08-14): that
  `init()` also started running `OrdersService.onModuleInit()`, whose eager
  `client.connect()` calls crashed the process when a peer was not listening
  yet — orders and product each refused to boot while the other was down. Both
  warmups are best-effort now (warn + lazy connect on first send).
- **RESIL-03 — Prometheus metrics — DONE 2026-08-14, NOT YET DEPLOYED.** See
  `CHANGELOG.md`. `GET /metrics` on the gateway (default process metrics +
  `http_requests_total` / `http_request_duration_seconds` /
  `http_requests_in_flight`, labelled with the ROUTE PATTERN, unmatched paths
  collapsed). Prod needs `METRICS_TOKEN` in `local/nodeA/.env` — unset means the
  route 404s in production. Only the gateway is instrumented; the other 9
  services still have no metrics surface, and the registry is per-process, so
  `GATEWAY_INSTANCES>1` would need `prom-client`'s cluster aggregator.

Deliberately NOT doing (decided, do not re-propose): full DDD refactor (huge
diff, zero behaviour change); async order placement via queue (breaks the
synchronous checkout contract the FE depends on for `paymentUrl`/`orderUrl`);
Kafka replacing RabbitMQ (hybrid TCP/RMQ was settled 2026-06-30); stock
bucketing. **Gated:** Redis pre-deduct stock via atomic Lua — the real seckill
core, and the fix for reserve serializing on a hot row lock, but only if a real
flash-sale event is planned. Second tier of local cache in front of Redis is
also open but only safe for brand/category (multi-instance staleness).

### PROD-PAY-01 — ZaloPay callback leg still unverified end-to-end

VNPay IPN is CLOSED (PROD-PAY-02, 2026-08-13 — see `CHANGELOG.md`). The ZaloPay
callback has never been exercised by a real sandbox payment; the handler itself
is unchanged and untested against a live provider call.

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
- GHN-DIST-01: an unknown `toDistrictId` / a ward from another district is a 400
  on `POST /api/order/shipping-fee`, on `POST /api/order` (GHN-CREATE-01) and at
  waybill create — but validation is fail-open (outage/empty list ⇒ quote and
  place the order anyway).
- Storefront catalog defaults `isActive:true` unless `isActive` or single
  `userId` is passed; `?userId=` shows that seller's hidden products by design;
  `GET /api/products/:id` still returns deactivated products with 200.
- ORD-CRON-01: orders `@Cron`s were NEVER scheduled before 2026-08-13 —
  `main.ts` called neither `listen()` nor `init()`, so no lifecycle hook ran.
  Consequence of the fix: `sweepStaleReservations()` starts running hourly for
  the first time and has a backlog to clear (58 sweepable orders on DEV; prod
  count unknown), canceling abandoned PENDING/CONFIRMED/PROCESSING orders with
  no GHN code older than `ORDER_STALE_RESERVATION_TTL_HOURS` (24) and releasing
  their stock. Capped at 25 orders/tick, so a backlog drains over hours, not in
  one burst. Buyers of those orders get a cancel notification — expected, but
  it will look like a wave on the first day after deploy.
- OUTBOX-SCOPE-01: RESIL-02 covers `order_created` ONLY. The other publish
  sites in `orders.service.ts` (`payment_completed`, `order.status_changed`)
  still guard with a plain `if (this.fanoutChannel)` truthiness check, which
  the self-healing publisher proxy always passes — during a broker outage they
  silently no-op and the event is lost. Use `isFanoutChannelLive()` if/when
  those are made durable too.
- PATCH-ATOMIC-01: `PATCH /api/products/:id` is NOT one transaction — product
  fields, `skuList`, and the inventory stock write are three sequential steps
  across two databases. A late inventory failure rolls the stock mirror back but
  leaves the product fields committed behind an error response.

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
