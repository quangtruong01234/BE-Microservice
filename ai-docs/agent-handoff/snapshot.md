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
Prod: EC2 + pm2 (compiled dist), nginx in front, https://tryhavejob.ooguy.com.

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

### PROD-PAY-02 — inbound VNPay IPN: one real end-to-end payment still owed

Endpoint PROVEN on prod (replayed real signed IPN → `RspCode 00`); the
`verifyCallback` bug is fixed (commit `cef4981`) and IS deployed. Remaining —
both are user actions:
1. In the VNPay merchant portal set `Kiểu mã hóa` back to **SHA512** (backend
   verifies SHA512; portal currently SHA256). Portal edit page:
   `sandbox.vnpayment.vn/merchantv2/Account/TerminalEdit.htm` (reachable by
   direct URL). `VNPAY_IPN_URL` in env is dead code — VNPay reads the IPN URL
   from the portal only.
2. Pay a sandbox order for real, **close the tab immediately** (so the
   browser-return leg can't mask the result), poll `GET /api/order/:id` until
   `status` leaves `pending`. No payments pm2 log entry ⇒ provider never
   reached us (portal URL/nginx); a rejection entry ⇒ checksum/config mismatch.

ZaloPay callback leg is still unverified end-to-end.

### CI/CD

- **CD-01 deploy workflow is LIVE** — first successful production run 2026-08-06
  (sha `19309f6`); it applied the owed `product_reviews.product_id` migration and
  restarted all 10 pm2 apps. Box/secret facts + the two traps that broke run #1
  are in `ops-runtime.md` → CI/CD.
- **Deploy is MANUAL (CD-04, decided 2026-08-06).** `deploy.yml` no longer has
  the `workflow_run` trigger — release = Actions tab → Deploy → Run workflow.
  Reason: the `production` Environment has no protection rules (GitHub gates
  required reviewers to paid plans on private repos), so auto-deploy shipped
  every green `main` commit unattended, docs-only ones included. The workflow
  does NOT verify CI itself — check CI is green on the target sha before
  dispatching.
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

### F7 follow-up (not scheduled)

Shipping-milestone emails (SHIPPED/DELIVERING/DELIVERED) need new
orders-service events — the GHN webhook updates status without emitting
per-status events today.

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

- SKU edit: `skuList` is the FULL desired set (not a delta); mirror stock only
  pushed on change; reference check fails safe → deactivate.
- Checkout: single-seller `POST /api/order` has NO `paymentUrl` — client calls
  `GET /api/order/:id/payment-url` → key is `orderUrl`.
- P0-03 compensation: trigger is an `inventory.sku` unique collision;
  discrimination reads `error.driverError.detail`, not `error.message`.
- Product PATCH optimistic locking: `version` is opt-in; background writers
  bump it; 409 = "reload and re-apply".
- Buyer cancel: GHN cancel is detached (2×5s); both fail → live waybill
  remains, remedy = admin GHN cancel.
- Array query params: `?categoryIds[]=` → 400; use repeated keys or scalar.
- GHN free-text address is best-effort; exact `toDistrictId`+`toWardCode` skip
  resolution; `toWardCode` stays a string (leading zeros).
- Storefront catalog defaults `isActive:true` unless `isActive` or single
  `userId` is passed; `?userId=` shows that seller's hidden products by design;
  `GET /api/products/:id` still returns deactivated products with 200.

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
