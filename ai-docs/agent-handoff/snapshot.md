# Snapshot — Current State

> Auto-loaded every session. Keep this LEAN: only the live picture (overview,
> active work, open issues, ops facts). Push finished work to `CHANGELOG.md`.
> Conventions/rules live in `ai-docs/agent-context/` — do not duplicate them here.

## System Overview

TryBuy — NestJS monorepo, 7 microservices + 4 shared libs.
Transport: TCP (sync) + RabbitMQ FANOUT (async).
DB: MySQL 8 (orders/user/product) + PostgreSQL (inventory/payments/rewards). Cache: Redis.
Node A: gateway:3000 (HTTP+WS /chat+/notifications), orders:3001, user:3003, product:3006, social:3008, notification:3009 (TCP+RMQ only, no HTTP), chat:3012 (TCP)
Node B: inventory:3002, payments:3005, rewards:3004
Base URL: http://localhost:3000 | Swagger: /doc

## Active Tasks

### Architecture prep - hybrid TCP/RabbitMQ hardening (recorded 2026-06-30)

> Decision: keep the current hybrid transport model. Do NOT migrate all
> service-to-service calls to RabbitMQ. Use TCP for commands/queries that need an
> immediate result (gateway reads, auth, checkout stock check/reserve/release/
> consume). Use RabbitMQ fanout for post-commit integration events and side
> effects (`order_created`, `payment_completed`, `order_canceled`, notification,
> rewards, analytics/email later).
>
> Current order/payment/inventory flow is intentionally not "payment_completed
> -> inventory directly deducts stock": Orders reserves stock synchronously at
> order creation, Payments emits `payment_completed`, Orders handles payment/GHN,
> and reserved stock is consumed when the order reaches COMPLETED. Cancel/return
> releases reserved stock. Keep Orders as the lifecycle coordinator, Inventory as
> stock/reservation owner, and Payments as payment-state owner.
>
> Next architecture improvement when ready: add an outbox-style publish path for
> critical domain events so DB commit + event publish cannot drift. Preserve
> idempotency via `orderId`/`reservationKey`/ledger or unique constraints in all
> consumers. This is reliability hardening, not a release gate.

### 🚀 DEPLOY GATE — "best deploy point" (recorded 2026-06-28)

> The user asked: which task to reach so deploy is cleanest. Answer: **deploy is
> ngon nhất once the items below close** — features are already deploy-complete
> (all P0/P1/P2 closed; GHN Phase 1 + B1 cancel/return + B2 update-COD/receiver +
> webhook dual-path done). What is NOT ready is the **production run/build
> pipeline**. Analytics is POST-LAUNCH, not a gate item — do not block deploy on it.
>
> **ACTION FOR ANY FUTURE SESSION:** when all gate items below are checked off,
> tell the user "backend is deploy-ready" — this is the signal they asked to be
> notified at.
>
> **STATUS (2026-06-28):** ALL GATE ITEMS CLOSED — **backend is deploy-ready.**
> G1+G2+G3 DONE (build green, all 10 `dist/apps/<svc>/main.js` emitted, fail-fast
> verified). G4 DONE (notification controller filter added; payments/inventory/
> rewards/product already had it). G5 verified (nginx conf exists under `api/`,
> valid). Nothing further gates deploy.
>
> **Deploy gate items (production-readiness, verified 2026-06-28):**
> - [x] **G1 — `npm run build` fixed.** `nest-cli.json` default project repointed
>   off the removed `apps/ecommerce-nestjs-zzzzz` to `gateway` (+ dead project entry
>   removed, `deleteOutDir:false`); `package.json` `build` now runs `npm run clean`
>   then `nest build <svc>` for all 10 real services, `start:prod` → `pm2 start
>   ecosystem.config.js --env production`, plus per-service `start:prod:<svc>` →
>   `node dist/apps/<svc>/main`. Verified: full build green, all 10
>   `dist/apps/<svc>/main.js` present.
> - [x] **G2 — `ecosystem.config.js` now runs compiled prod.** Replaced the two
>   `npm run start:nodeA|nodeB` wrappers with one pm2 app per microservice running
>   `node dist/apps/<svc>/main.js` (fork mode, autorestart, 500M max-mem). pm2 now
>   supervises each service directly so a single runtime crash IS restarted. Per-node
>   start via `--only "gateway,orders,…"` (Node A) / `--only "inventory,payments,
>   rewards"` (Node B), documented in the file header.
> - [x] **G3 — JWT_SECRET fail-fast added.** Gateway `main.ts` throws right after
>   `dotenv.config` if `JWT_SECRET` is absent (before any port bind); the
>   `JwtModule` useFactory in `gateway.module.ts` also throws on an undefined secret.
>   Verified: `JWT_SECRET="" node dist/apps/gateway/main.js` → exit 1 with the guard
>   message; normal boot with the secret present → login still 201.
> - [x] **G4 — `HttpToRpcExceptionFilter` coverage complete.** Audit found
>   payments/inventory/rewards/product controllers ALREADY had `@UseFilters(
>   HttpToRpcExceptionFilter)` (commit 83b567c); user is covered by its global
>   `AllRpcExceptionFilter`. The only real gap was `notification.controller.ts` —
>   filter now added there. Gateway is HTTP-facing (uses `HttpExceptionFilter`),
>   correctly excluded. `nest build notification` green.
> - [x] **G5 — nginx config verified.** `nginx/trybuy.conf` DOES exist under
>   `api/` (the prior "no nginx/ dir" note was stale) + `nginx/trybuy-local.conf`.
>   `trybuy.conf` is a valid prod conf: `/` → gateway `localhost:3000`,
>   `/socket.io/` → `:3010` (WS upgrade), zalopay/vnpay callbacks → `:3007`,
>   TLS via letsencrypt, `server_name yourdomain.com` placeholder + deploy steps
>   in header. Replace the domain placeholder + run certbot at deploy time.
>
> **Not gate items (ship without them):** `storing` action, analytics aggregation
> endpoints, GHN webhook public-URL registration (operational — email api@ghn.vn at
> deploy time, code already 200/PascalCase-ready). (B2 update-COD/update-receiver is
> now DONE — see CHANGELOG + Ops/Runtime.)

### GHN Web integration next steps

> Backend Phase 1/1.1 for GHN shipping is complete enough for web integration.
> Next FE workspace: `C:\Users\Quang Truong\Desktop\MCR\web-flow-GHN`
> (Next.js app at repo root, dev port `3013`). The next task should connect
> auth only: `POST /api/user/login`, `POST /api/user/logout`,
> `GET /api/user/me`, using `credentials: "include"` and configurable gateway
> base URL defaulting to `http://localhost:3000/api`.

Implementation order for GHN Web:
- Step 1: auth API integration only; add TanStack Query provider, login submit,
  auth hydration, protected layout, logout, unauthenticated redirect to `/login`,
  forbidden redirect to `/403`; do not connect shipment APIs yet.
- Step 2: ✅ DONE (2026-06-27, runtime-verified) — backend roles/grants for
  `logistics_operator` (shipping `read:any`) and `shipping_manager` (shipping
  `read:any` + `update:any`) added to `apps/user/src/rbac/grants.ts`; `RoleName`
  enum + gateway `UserRole` type extended; migration
  `database/add_shipping_roles.sql` (enum extend + `shipping` resource + 2 role
  rows) applied to Aiven. Test accounts `logistics_test` / `shipmgr_test`
  (pwd `Ship@1234`) seeded. FE may now target these roles instead of admin.
- Step 3: read-only GHN shipment APIs for list/detail/history via TanStack
  Query; keep server order data out of Zustand.
- Step 4: manual sync API mutation only; invalidate list/detail/history and
  refetch; never let FE manually set GHN status or call GHN directly.
- Step 5: production-like API error handling (`401`, `403`, `404`, `400`,
  `500/503`) while preserving loading/empty/error UI states.
- Step 6: settings page remains read-only/mock for GHN config; do not expose or
  save real GHN token/shop config from FE.
- Step 7: add FE tests after auth/API integration; prioritize login, auth
  redirect, protected layout, status mapping, shipment table/detail, sync modal,
  and history timeline.

GHN Web dependencies to add now:
`@tanstack/react-query`, `zustand`, `clsx`, `tailwind-merge`, `lucide-react`.
Do not install `recharts` or `shadcn/ui` yet. GHN action APIs **cancel + return
(B1) and update-COD + update-receiver (B2) are now live** (Phase 2 — see
Ops/Runtime + `frontend-handoff-ghn.md`); delivery-again is **dropped** (not
shop-callable per the GHN probe). Only remaining backend contract still blocking
FE: analytics charts.

### ⛔ Highest priority — FE-blocking backend work

> Source: `frontend/.ai/snapshot.md` (FE readiness audit, 2026-06-25). FE has
> shipped client-side mitigations; these items can only be closed by backend and
> are gating the production release (all P0 must close + regression-tested).

**P0 — release blockers**

> All P0 items are DONE — see `CHANGELOG.md`: P0-02 (tierIdx contract), P0-03
> (atomic product+inventory create & orphan cleanup), P0-04 (create-order
> idempotency key), P0-05 (SKU diff + reference protection on product edit).
> Runtime endpoint self-test for P0-03/P0-04/P0-05 is still pending a full-stack run.

**P1**

> P1-01 (seller order lifecycle) and P1-02 (order item enrichment + server-side
> per-status counts) are DONE — see `CHANGELOG.md`; their runtime endpoint
> self-test is still pending a full-stack run. P1-03 (social↔commerce: post
> `productId` attach, PATCH edit, report endpoint) is DONE and runtime-verified
> (8/8 curl self-tests passed; both migrations applied to Aiven). P1-04
> (multi-category hydrate) is DONE and runtime-verified — every gateway product
> read path now returns a flat `categoryIds: number[]` alongside the full
> `categories[]` (list, by-id, by-sku, by-category, search, with-inventory;
> 5/5 curl self-tests passed, multi-category products confirmed). Note: order item
> `image` is still resolved live from the product service — purchase-time snapshot
> remains open as P2-02.

> P1-06 (chat conversation metadata) is DONE and runtime-verified — see
> `CHANGELOG.md`. `GET /chat/conversations` now returns `lastMessage` +
> `unreadCount` per conversation (active-first order); new
> `POST /chat/conversations/:id/read` resets the viewer's unread. Migration
> `database/add_read_tracking_to_conversations.sql` applied to Aiven 2026-06-26.

**P2**

> P2-02 (order snapshot) is DONE and runtime-verified — `order_items` now stores
> `product_image` + `sku_label` captured from the authoritative product at
> checkout; gateway read paths (buyer detail/list, seller detail) prefer the
> snapshot and skip the live product fetch for snapshot-bearing items, so
> deleted/edited products no longer break historical orders. Migration
> `database/add_snapshot_columns_to_order_items.sql` applied to Aiven 2026-06-26.
> Verified on order 108 (3/3 read paths return the snapshot image, zero live
> lookup). See `CHANGELOG.md`.
> P2-05 (pagination/stat endpoints) is DONE — see `CHANGELOG.md`. Admin pagination
> (`GET /user?page=&limit=`, `@Roles("admin")`), notifications
> `GET /notifications/unread-count`, and shop `GET /products/shop/stats` are live;
> server-side product search by name/SKU already existed. Admin pagination +
> unread-count are runtime-verified; shop-stats is now runtime-verified too
> (`{productCount:12,totalStock:961,lowStockCount:0}`) after the nodeB idle-crash
> fix below.

### 🌱 Feature Roadmap — post-launch enhancement backlog (recorded 2026-06-30)

> All P0/P1/P2 + deploy gate are closed and the backend is deploy-ready. These are
> NET-NEW features to grow the product beyond MVP — none gate deploy. Ordered by
> value/effort; pick top-down. Each needs the usual researcher → (planner if >2
> services / migration) → implement → self-test loop. Move an item to CHANGELOG
> when shipped and delete its line here.

- [x] **F1 — Product reviews & ratings** — DONE (was already implemented in commits
  `3ceb9f6`/`984ff2b`; the roadmap entry was stale). Runtime-verified 2026-06-30
  (8/8 self-tests). `product_reviews` table + `product.rating`/`ratingCount`
  aggregate; gateway `GET/POST /api/products/:id/reviews` (POST gated on a COMPLETED
  order containing the product via `order.verify_product_purchased`, 404 if not
  purchased, 409 on duplicate) + `DELETE /api/products/reviews/:reviewId` (owner only,
  403 otherwise). See CHANGELOG + Ops/Runtime applied-migration note.
- [x] **F2 — Buyer-initiated return/refund request** — DONE and runtime-verified
  2026-06-30 (7/7 self-tests). `order_return_requests` lifecycle: buyer `POST
  /api/order/:id/return-request` (eligible only on own DELIVERING/COMPLETED orders;
  dedupes active requests; order → RETURN_REQUESTED), seller(order owner)/admin
  review via `POST /api/order/return-requests/:id/{approve,reject}` (gated
  in-service by seller product ownership or admin role). Approve → best-effort GHN
  return + release reserved stock + refund **recorded/simulated** (online→`refunded`,
  COD→`manual_pending`, NO real gateway call) + order → REFUNDED; reject (reason
  required) restores `previousOrderStatus`. Lists: buyer `GET
  /api/order/return-requests/mine`, seller/admin `GET /api/order/return-requests`
  (seller-scoped by owned products, `status` filter). Async fanout
  `order.return_{requested,approved,rejected}` → notification consumers. See
  CHANGELOG + Ops/Runtime applied-migration note.
- [x] **F3 — Voucher / coupon / discount codes** — DONE and runtime-verified
  2026-06-30 (10/10 self-tests). OWNED BY ORDERS (MySQL), not Rewards — chosen for
  transactional integrity (redemption + discount recorded in the same tx as order
  create; Rewards has no TCP server). `vouchers` + `voucher_redemptions` tables;
  `orders.voucher_code`/`discount_amount` columns. Admin CRUD: `POST/GET
  /api/order/admin/vouchers`, `PATCH /api/order/admin/vouchers/:id/deactivate`
  (`@CheckPermission("order", create:any|read:any|update:any)`). Buyer preview:
  `POST /api/order/voucher/validate` (JwtAuthGuard; prices the basket via product
  service, returns discount without consuming). Checkout: optional `voucherCode` on
  `POST /api/order` — validated + priced server-side, redemption consumed atomically
  in the create tx (conditional `used_count+1` UPDATE guards the usage cap). Discount
  applies to goods subtotal only (never shipping), clamped to subtotal, percent honours
  `maxDiscountAmount`. **Single-seller only** — multi-seller baskets reject voucher with
  400. See CHANGELOG + Ops/Runtime migration note.
- [ ] **F4 — Seller analytics dashboard**. Already flagged post-launch + the GHN
  console is waiting on analytics charts. Aggregation endpoints: revenue/orders over
  time, top products, status distribution (seller-scoped + shipping-scoped). Read-only;
  orders + product, no migration. Unblocks the one remaining GHN-console FE contract.
- [ ] **F5 — Post moderation actions**. `POST /posts/:id/report` exists but admin has
  no review/resolve flow. Admin list reported posts + hide/dismiss/delete + resolve
  the report row. Small; social + gateway, maybe a `status` column on `post_reports`.
- [ ] **F6 — Wishlist / favorites**. Basic UX gap. `wishlist_items` table + add/remove/
  list endpoints. Small; product or user service + migration.
- [ ] **F7 — Email notifications**. In-app + WS only today → lost when offline. Add an
  email channel (order confirmed, payment, shipping) off the existing notification
  RMQ consumers. Notification service + provider config; no migration.

## Known Issues

- GHN free-text address resolution is best-effort: a garbage/placeholder address (e.g. `District 1 | Ward 1`) can resolve to a wrong-but-valid GHN location instead of failing, because short numeric master-data names match many free-text parts via containment. Real well-formed VN addresses resolve correctly. Durable fix is collecting GHN numeric IDs at checkout rather than resolving free-text at ship time. (Truly unresolvable addresses now correctly return 400, not 502 — see the ready-to-ship ops note below.)
- nodeB services (inventory/payments/rewards) used to silently crash after an idle period (e.g. machine sleep / broker restart): `RmqModule.registerDirectPublisher()` opened a raw amqplib connection+channel with NO `'error'`/`'close'` listeners, so an idle connection drop was thrown as an uncaught exception and killed the process (the `nest --watch` wrapper survived, masking it). FIXED 2026-06-26: the publisher now attaches error/close handlers, uses a `?heartbeat=30` URI, connects in the background (never blocks bootstrap), and auto-reconnects via a self-healing Proxy. If a nodeB service is ever found down, check whether its compiled `dist/apps/<svc>/main` process is actually running — `--watch` does NOT auto-restart a runtime crash.
- Login route is `POST /api/user/login` (sets the HttpOnly `access_token` cookie). (The CLAUDE.md self-test protocol text was corrected to match on 2026-06-28.)

## Ops / Runtime Reference

- GHN env (local/nodeA/.env): `GHN_API_URL=https://dev-online-gateway.ghn.vn/shiip/public-api`, `GHN_API_TOKEN`, `GHN_SHOP_ID=200481`; `GHN_WEBHOOK_SECRET` required on the gateway webhook (`x-ghn-webhook-token` or `?token=`).
- GHN webhook is served at BOTH `POST /ghn/webhook` (legacy) AND `POST /api/ghn/webhook` (prefix-consistent) — same handler, both excluded from the global `api` prefix (`main.ts` exclude list + `GhnWebhookController` `@Post(["ghn/webhook","api/ghn/webhook"])`). A GHN dashboard configured with either URL works; no more silent 404 if `/api` is included. Body accepts PascalCase (`OrderCode`/`Status`, real GHN) or snake_case (`order_code`/`status`, manual tests).
- GHN shipping_address: pipe-delimited `name|phone|addr|ward|district|province`; failure non-fatal (order saved with ghn_order_code=null).
- GHN address resolution (`apps/orders/src/ghn/ghn.service.ts`): the free-text ward/district/province are resolved to GHN numeric `to_district_id` + string `to_ward_code` at waybill-create time via master-data (`GET /master-data/province|district|ward`, 24h TTL cache) using `normalizeAddressPart` (NFD diacritic strip, đ→d, drops VN admin prefixes, alnum-only) + `rankMasterDataMatches` (exact-normalized first, then containment by closest length). The resolver walks ALL ranked province→district→ward candidates and falls through stub entries — required because the GHN dev sandbox has polluted duplicate provinces (e.g. "Hà Nội 02" ProvinceID 2002 with 0 districts shares the "hanoi" alias with the real Hà Nội 201). Unresolvable address → `BadRequestException` (400).
- ready-to-ship gating: `PATCH /api/order/:id/ready-to-ship` (seller, CONFIRMED→PROCESSING) now creates the GHN waybill BEFORE advancing and persists `ghnOrderCode`. If GHN create fails (400 unresolvable address / 500 GHN unreachable) the error propagates and the order stays at CONFIRMED — never PROCESSING without a waybill. (Replaces the old log-and-silently-advance behavior that left `ghnOrderCode` null.)
- COD: handled via GHN cod_amount; payments service guard skips COD orders (no payment row).
- GHN→local status map (`mapGhnStatus`, used by webhook + manual sync): `picking|picked`→SHIPPED, `delivering`→DELIVERING, `delivered`→COMPLETED (+stock consume/COD payment_completed), `cancel` + any `*return*`→CANCELED (+release reserved stock + `ORDER_CANCELED_EVENT`, no cancel pushed back to GHN). Forward-only by rank; terminal orders (canceled/completed) untouched.
- GHN admin actions (manual cancel/return): `POST /api/order/admin/ghn/orders/:id/cancel` and `:id/return` (`@CheckPermission("shipping","update:any")`, TCP `order.admin_ghn_cancel`/`order.admin_ghn_return`). Both call GHN `POST /v2/switch-status/{cancel|return}` (identical shape `{order_codes:[code]}`→`{data:[{order_code,result,message}]}`) and resolve the local order to CANCELED via `applyAdminGhnAction` (reuses `finalizeGhnCancellation` = release stock + emit `ORDER_CANCELED_EVENT`). GHN rejection → re-throw (gateway 4xx/5xx) + a `success:false` ACTION `shipping_history` row, **local order untouched**. Allowed by the `getAvailableShippingActions` matrix: `cancel` for CONFIRMED/PROCESSING/SHIPPED, `return` for SHIPPED/DELIVERING — both only with a non-null `ghnOrderCode` on a non-terminal order; otherwise 400. No migration (`ShippingHistoryType.ACTION` already existed).
- GHN admin actions (B2, update COD / receiver): `POST /api/order/admin/ghn/orders/:id/update-cod` (`{codAmount:number}`, ≥0; 0 clears COD) and `:id/update-receiver` (`{toName?,toPhone?,toAddress?}`, ≥1 required else 400). Both `@CheckPermission("shipping","update:any")`, TCP `order.admin_ghn_update_cod`/`order.admin_ghn_update_receiver`. update-cod → GHN `POST /v2/shipping-order/updateCOD` (`{order_code,cod_amount}`); update-receiver → GHN `POST /v2/shipping-order/update` (`{order_code,to_name?,to_phone?,to_address?}`). On success: persist locally (`order.codAmount` / rewrite the `name|phone|addr` head of the pipe-delimited `shippingAddress`, preserving ward|district|province) + a `success:true` ACTION `shipping_history` row; on GHN reject: re-throw + `success:false` row, **local order untouched**. Editable window enforced by `getAvailableShippingActions`: `update_cod`/`update_receiver` only for CONFIRMED/PROCESSING with a non-null `ghnOrderCode` (in-transit edits are GHN's call); else 400. No migration. Runtime-verified 2026-06-28 on order 62 (7/7 self-tests).
- GHN shop-callable action surface (established by a live dev-API probe, not guessed): `cancel`, `return`, `storing`, `updateCOD`, `update` (receiver) are shop-callable; `delivered`/`deliver`/`delivering` return 400 "không tìm thấy permission command" → **delivery-again cannot be triggered by the shop** (GHN drives redelivery internally after a failed attempt) and was dropped from Phase 2. `storing` remains available if a future need arises.
- GHN demo-status endpoint (DEMO ONLY): `POST /api/order/admin/ghn/orders/:id/demo-status` (`@CheckPermission("shipping","update:any")`, TCP `order.admin_ghn_demo_status`) simulates a GHN status WITHOUT calling real GHN and drives the local lifecycle through the same `mapGhnStatus`/`applyGhnStatus` path as real sync (writes a MANUAL_SYNC `shipping_history` row with `action:"demo_status"`, returns the sync shape `{orderId,previousStatus,newStatus,ghnStatus,syncedAt}`). Body `{ghnStatus}` ∈ `ready_to_pick|picking|delivering|delivered|delivery_fail|waiting_to_return|returned|cancelled`. **Gated behind env `GHN_DEMO_ENDPOINTS_ENABLED`** — unless set to `"true"` it returns `403 "GHN demo status endpoint is disabled"` (inert in prod; must be ABSENT/false in production). No migration. Lets the GHN console demo `picking→delivering→delivered` on a sandbox order GHN never advances. **Detail override (fixed 2026-06-30):** when demo mode is ON and the latest `shipping_history` row is a `demo_status`, `GET /api/order/admin/ghn/orders/:id` surfaces that demo status as `ghnDetail.status` (overlaying the still-fetched live detail so receiver/COD fields stay real, or synthesizing a minimal detail if the live fetch failed) — so the console GHN badge advances exactly as a real webhook would, instead of staying stuck at the sandbox's `ready_to_pick`. Outside demo mode, live GHN `getOrderDetail.status` wins unchanged.
- Stale-reservation sweeper (orders): hourly `@Cron` cancels orders in PENDING/CONFIRMED/PROCESSING with `ghn_order_code` null older than `ORDER_STALE_RESERVATION_TTL_HOURS` (default 24h, set in `local/nodeA/.env`), reusing the idempotent cancel flow to release stock. Orders with a GHN code are never swept (driven by the delivery webhook).
- payment_methods table: `is_active` controls active options; `PAYMENT_GATEWAY` env is fully unused (strategy chosen per-request from `paymentMethod`).
- CORS: one shared gateway delegate `apps/gateway/src/common/cors.ts` (`gatewayCorsOptions`) used by HTTP (`main.ts` `enableCors`) + both WS gateways (`/chat`, `/notifications`). Allows: no-Origin requests, any origin in `FRONTEND_URL` (comma-split), and — only when `NODE_ENV !== "production"` — any `localhost`/`127.0.0.1` origin on any port. Prod is strict (localhost bypass off) → every allowed web origin MUST be in `FRONTEND_URL`. Sockets live on the gateway origin/port (3000), namespaces `/chat`+`/notifications`, connect `withCredentials:true`.
- Cloudinary: client uploads direct; server signs via `POST /api/upload/signature`; folders `trybuy/products/`, `trybuy/posts/`.
- Deploy: `pm2 start ecosystem.config.js --env production` → `pm2 save && pm2 startup`; set the real domain in `nginx/trybuy.conf`.
- Applied migrations (P1-03, social DB, `synchronize:false`): `database/add_product_id_to_posts.sql` (`posts.product_id INT NULL`) and `database/create_post_reports_table.sql` (`post_reports` table) — both applied to Aiven on 2026-06-25. Re-run on any fresh DB before the post-edit / report endpoints work.
- Applied migration (P1-06, chat read-tracking, `synchronize:false`): `database/add_read_tracking_to_conversations.sql` (`conversations.user1_last_read_at` / `user2_last_read_at` DATETIME NULL) — applied to Aiven on 2026-06-26. Re-run on any fresh DB before `unreadCount` / mark-read work.
- Applied migration (P2-02, order snapshot, `synchronize:false`): `database/add_snapshot_columns_to_order_items.sql` (`order_items.product_image` VARCHAR(2048) NULL, `order_items.sku_label` VARCHAR(512) NULL) — applied to Aiven on 2026-06-26. Re-run on any fresh DB before order-snapshot rendering works.
- Applied migration (F1 product reviews, `synchronize:false`): `database/create_product_reviews_table.sql` (`product_reviews` table: `product_id`, `user_id`, `rating` TINYINT 1–5, `comment`, unique `(product_id,user_id)`) — already present on Aiven (confirmed live 2026-06-30: GET/POST/DELETE review endpoints all work). Re-run on any fresh DB before review endpoints work. `product.rating`/`ratingCount` (already on `products`) are recalculated by the product service on every review create/delete. Note: `product-review.entity.ts` declares `product_id` as `int` while the migration + `products.id` are `bigint` — harmless for current id ranges, latent inconsistency.
- Applied migration (GHN Web Step 2 shipping roles, `synchronize:false`): `database/add_shipping_roles.sql` — extends `roles.rol_name` enum with `logistics_operator`/`shipping_manager`, adds the `shipping` resource (res_id=7 on Aiven), seeds both role rows (rol_id 4/5). Applied to Aiven on 2026-06-27. Authorization is driven by `apps/user/src/rbac/grants.ts` (`ac`), not the DB `rol_grants` JSON. Re-run on any fresh DB before the shipping roles resolve.
- Applied migration (F2 buyer return/refund): `database/create_order_return_requests_table.sql` — extends `orders.status` enum with `return_requested`/`refunded` and creates the `order_return_requests` table (`order_id`, `user_id`, `reason`, `status` enum `pending_review|approved|rejected`, `reject_reason`, `previous_order_status`, `refund_amount`, `refund_method`, `refund_status`, `reviewed_by`, timestamps + idx on order/user/status). NOTE: the orders service runs TypeORM `synchronize:true`, so on a normal restart the new entity/enum auto-sync and the table already exists (confirmed live 2026-06-30 — return-request inserts succeeded). The SQL file is for fresh/`synchronize:false` DBs; run it before the return endpoints work there. Refund is **recorded only** (no real payment-gateway call): online methods (vnpay/zalopay) set `refund_status=refunded`, COD sets `manual_pending`. On approve, reserved stock is released and a GHN return is attempted best-effort (failure non-fatal).
- Applied migration (F3 vouchers): `database/create_vouchers_table.sql` — creates `vouchers` (`code` UNIQUE, `discount_type` enum `percent|fixed`, `discount_value`, `min_order_amount`, `max_discount_amount`, `usage_limit`, `used_count`, `per_user_limit`, `starts_at`, `expires_at`, `is_active`) + `voucher_redemptions` (`voucher_id`, `user_id`, `order_id`, `discount_amount`, UNIQUE `(voucher_id,order_id)`, idx `(voucher_id,user_id)`) and ALTERs `orders` to add `voucher_code` VARCHAR(64) NULL + `discount_amount` DECIMAL(12,2) NULL. NOTE: orders runs TypeORM `synchronize:true`, so a normal restart auto-creates the tables/columns (confirmed live 2026-06-30 — voucher create + checkout-apply succeeded; orders 113). The SQL file is for fresh/`synchronize:false` DBs. Usage cap is enforced atomically via a conditional `used_count = used_count + 1 WHERE id=? AND (usage_limit IS NULL OR used_count < usage_limit)` UPDATE inside the order-create tx; per-user limit via a `voucher_redemptions` count. Codes are normalized to UPPERCASE on create/lookup. Vouchers are single-seller only (multi-seller checkout rejects with 400).

## History

Finished milestones, completed tasks, and the resolved 2026-06-19 audit live in
`CHANGELOG.md` (same folder, not auto-loaded). Read it only when you need the
history or rationale behind a past change.
