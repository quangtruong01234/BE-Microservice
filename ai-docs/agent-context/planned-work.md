# Planned Work — designs decided but NOT started

> Load on demand — keywords: planned, roadmap, next feature, AI feature, Gemini,
> visual search, stacking, phase 2. Moved out of `snapshot.md` on
> 2026-09-10 so the auto-loaded snapshot carries only the live picture.
>
> Everything here is **designed and decided, not implemented**. `snapshot.md`
> keeps a one-line pointer per item; the reasoning lives here. When one of these
> ships, move its entry to `CHANGELOG.md` and delete it from this file.

## SOCIAL-LIKE-NTF-01 — liking a post notifies nobody (product decision, not a bug)

`comment` and `reply` both notify the post owner (verified on prod 2026-08-13 —
badge moves in realtime, no reload). Like does not: `likePost()`
(`apps/social/src/social.service.ts:506`) only writes `post_like` + bumps the
cached counter, emits no event, and `apps/notification/` has no `like` handler —
it was never implemented, so do NOT go hunting for a dropped event. Adding it is
an emit + a handler + a notification type; the open question is product-side
(likes are high-frequency, so it likely needs batching/throttling, e.g. "X and 4
others liked your post", rather than one notification per like). FE needs
nothing until that is decided.

## VOUCHER-SHOP-01 phase 2 — Shopee-style stacking + multi-shop apportionment

Phase 1 + VOUCHER-EDIT-01 are shipped and released (see `CHANGELOG.md`
2026-08-25 / 2026-08-26). Phase 2 is NOT started.

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

**Two invariants phase 2 must not break** (they are what makes phase 1 correct):
- **One rules engine.** `evaluateVoucher()` (`apps/orders/src/orders.service.ts`)
  is pure and non-throwing; the list maps it to a response and
  `validateVoucherForCheckout` maps it to a 400 via `voucherRejection()`. Never
  re-implement a rule in the list path — list and apply drifting apart is the
  exact failure this design exists to prevent.
- **Visible ≠ applicable.** The list is a hint; applying an ineligible code still
  400s on `voucher/validate` and on `POST /api/order`.

## AI-03 — Sell From Photo (Gemini; no migration)

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

## AI-04 — Visual Search (reuses the AI-03 client; 1 additive migration)

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

## AI-02F5 — pHash lookup scale path (gated, not calendar-scheduled)

Current Hamming comparison is an O(catalog) scan — fine for the present small
catalog. Trigger: catalog/load evidence near ~10k products. Then benchmark and
replace with persisted hash buckets/BK-tree (retain exact Hamming verification
after candidate retrieval); add index/migration only after the benchmark picks
the design.

## Resilience — decided NOT to do, and the one gated item

Reviewed against a high-concurrency flash-sale/seckill reference architecture
(2026-08-10). Most of what it prescribes ALREADY EXISTS here — do not re-open:
idempotency key (`order.service.ts` Redis `SET NX`, 24h replay, 409 on
concurrent double-submit), oversell protection (`inventory.service.ts`
`pessimistic_write` + reservation ledger keyed by `reservationKey`), SAGA
compensation (`releaseReservedItems()` on every failure path), rate limiting
(`CustomRateLimitGuard`, Redis Lua window, fail-closed in prod), load-test
baselines (`scripts/load/baseline.mjs`). RESIL-01/02/03 and TCP-RESIL-01 closed
the three real gaps — see `CHANGELOG.md`.

**Deliberately NOT doing (decided, do not re-propose):** full DDD refactor (huge
diff, zero behaviour change); async order placement via queue (breaks the
synchronous checkout contract the FE depends on for `paymentUrl`/`orderUrl`);
Kafka replacing RabbitMQ (hybrid TCP/RMQ was settled 2026-06-30); stock
bucketing.

**Gated:** Redis pre-deduct STOCK via atomic Lua — the real seckill core, and
the fix for reserve serializing on a hot row lock, but only if a real flash-sale
event is planned. The primitive now exists and is proven: VOUCHER-CONC-01
(2026-08-18) put the same pattern in front of the voucher quota
(`CachedService.claimFromSeededQuota` / `releaseToSeededQuota`, seed+check+decr
in one Lua step, TTL self-healing, fails open). Extending it to stock reuses
that helper — the hard part left is per-SKU seeding and the compensation matrix,
not the Lua. Second tier of local cache in front of Redis is also open but only
safe for brand/category (multi-instance staleness).

## EXPORT-CSV-01 — seller order export to CSV (no migration, class B)

Sellers can read their orders but cannot compute on them: reconciling GHN
payouts, summing revenue per SKU, or handing figures to an accountant all mean
paging through a list by hand. CSV is the escape hatch — and it also closes
future backlog, because "add column X to the report" becomes "export and pivot".

**The finding that shapes the whole design:** `order_items`
(`apps/orders/src/entity/order_item.entity.ts:36-86`) already snapshots
`sellerId`, `productName`, `productPublicId`, `skuLabel`, `price`, `quantity`,
and `orders.public_id` is on the order row. So the CSV needs **no product-service
enrichment, no `buildProductMap`, no N+1** — one query inside the orders service
has every column. Do not route this through the gateway enrichment path.

**Transport precedent to copy, not reinvent:** the PDF invoice already ships a
file over TCP — orders returns a `Buffer`, TCP serializes it as
`{type:'Buffer', data:number[]}`, gateway does `Buffer.from(result.data)` then
`res.end()`. See `apps/gateway/src/order/order.controller.ts:541-570` and
`order.service.ts:1058-1090`.

**Shape: synchronous with a hard cap, NOT an async job.** Async (job table +
worker + storage + poll endpoint + cleanup cron) is the right answer at scale and
the wrong one here — it is ~5x the work for a catalog this size. Cap the window
instead: **90 days / 5.000 rows**, `COUNT` first and 400 with the real row count
before building anything. Buffer the whole file in memory (~1.2 MB at the cap) —
do **not** stream chunks: once `res.write()` fires the response is committed, so
a failure on page 3 can no longer become a 4xx and the client silently receives a
truncated file that looks valid. That is the worst failure mode of CSV export.

### T1 — `libs/common/src/utils/csv.util.ts` (standalone, class A)

Nothing exists in `libs/` today. Build `toCsv(rows, columns)` once and every
later export (inventory, admin orders, revenue) is just "query + column list".
Four things it must handle, none optional:
1. **BOM `﻿`** first — without it Excel VN renders `Ão thun`. Most common
   Vietnamese CSV bug there is.
2. **Escape** — wrap in `"` and double inner `"` for values containing `,`, `"`,
   or newline. A `skuLabel` like `Đen, size L` breaks columns otherwise.
3. **CSV injection** — a cell starting `=`, `+`, `-`, `@` executes as an Excel
   formula. `productName` is seller-supplied text, so this is a real hole, not a
   theoretical one. Prefix with `'`.
4. **Excel mangling numerics** — long tracking codes / phone numbers become
   `1.23E+11`. Emit `="GHN123456"` where the literal must survive.
Unit-test all four. Ships alone, invisible to FE.

### T2 — orders service leg (class A, still no HTTP route)

- `EXPORT_SELLER_ORDERS_CSV: "order.export_seller_csv"` in
  `libs/constant/message-pattern.constant.ts` (never inline).
- `@MessagePattern` handler in `orders.controller.ts` returning the `Buffer`.
- `orders.service.ts`: `COUNT` gate → over cap throws `BadRequestException`
  naming the actual row count and telling the caller to narrow the range; then
  ONE query filtered on **`items.seller_id`**, `order.created_at BETWEEN`, and
  optional status.
- **Do not reuse `getOrdersBySeller()` (`orders.service.ts:3710`).** It
  `leftJoinAndSelect`s *every* item of any order containing one of the seller's
  products. Harmless today because checkout splits per seller
  (`CREATE_MULTI_SELLER_ORDER` returns an array of orders), but filtering at the
  item level is what makes the `lineTotal` column sum to that seller's revenue
  and keeps it correct if orders are ever un-split.

### T3 — gateway leg, makes it live (class B, push freely)

- `ExportSellerOrdersQueryDto` — `from`/`to` required, ≤ 90 days, optional
  `status`; `@ApiProperty()` on every field.
- Route + `@Res()`, `Content-Type: text/csv; charset=utf-8`,
  `Content-Disposition: attachment; filename="trybuy-orders-<from>-<to>.csv"`.
- TCP call with `timeout(TCP_TIMEOUT_MS.WRITE)` (heavier than a list read) +
  `retryOnTransportError()` + `MicroserviceErrorHandler`.
- ⚠️ **Route order: `@Get("seller/export")` must be declared BEFORE
  `@Get("seller/:id")`** (currently `order.controller.ts:638`) or `:id` swallows
  `export` and `ParsePublicIdPipe` 400s. `seller/analytics` already sits above
  it — put `export` next to that one.
- DoD: self-test with a shop account from `../.agent-local/test-accounts.md`,
  actually open the downloaded file and confirm Vietnamese + escaping, then
  append the contract entry to `../.agent-local/frontend-handoff.md`. FE work is
  a button + two date pickers; `window.location.href = url` is enough because the
  auth cookie is HttpOnly and rides along.

### Columns — one row per ITEM

`orderId, orderDate, status, paymentMethod, paidAt, productId, productName,
skuLabel, quantity, unitPrice, lineTotal, shippingFee, orderTotal, trackingCode,
ghnStatus`

**`shippingFee` and `orderTotal` belong to the ORDER, not the row.** Repeat them
on every item row and a seller's SUM double-counts, and they will report it as
"the app computes money wrong". Write them on the **first row of each order
only**, blank afterwards — this is what marketplaces do. Item granularity is
chosen because it pivots up to order level trivially in Excel, while order
granularity loses the SKU breakdown permanently.

### Open decisions (defaults assumed if nobody answers)

- **Buyer PII**: default = include name + phone, **exclude full address**. Enough
  to reconcile, without turning the file into a portable customer list. The
  seller may see it in-app, but a CSV leaves the system.
- Cap 90 days / 5.000 rows — raise only with evidence.

### T4 — admin export (optional, later)

`GET /api/order/admin/export` across all sellers with a `sellerId` column, gated
on `order read:any`. Reuses T1 + T2 wholesale; only the filter changes.

### T5 — async job variant (gated, do NOT build speculatively)

Only if "I need a full year" becomes a real, repeated complaint. Then: job row +
worker + Cloudinary/S3 artifact + poll endpoint + expiry cron. Everything in
T1/T2 survives the upgrade — the public route can keep its shape and answer 202.

## GHN Web console — remaining FE steps (backend ready)

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
