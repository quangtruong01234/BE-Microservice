# Planned Work — designs decided but NOT started

> Load on demand — keywords: planned, roadmap, next feature, AI feature, Gemini,
> visual search, ETA, stacking, phase 2. Moved out of `snapshot.md` on
> 2026-09-10 so the auto-loaded snapshot carries only the live picture.
>
> Everything here is **designed and decided, not implemented**. `snapshot.md`
> keeps a one-line pointer per item; the reasoning lives here. When one of these
> ships, move its entry to `CHANGELOG.md` and delete it from this file.

## GHN-ETA-01 — persist + expose the GHN delivery ETA (1 additive migration, class B)

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

## GHN-FAIL-NTF-01 — notify the buyer on a failed delivery attempt (class B, no migration)

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
