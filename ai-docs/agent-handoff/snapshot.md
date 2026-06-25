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

9. **P1-06 · Chat conversation metadata.** Return `lastMessage` + `unreadCount` on
   `Conversation` for unread count / last-message preview.

**P2**

10. **P2-02 · Order snapshot.** Persist product name/image/SKU at purchase time so
    historical orders render correctly even if the product changes/is deleted (FE
    only enriches in real time via `useProductsByIds`).
> P2-05 (pagination/stat endpoints) is DONE — see `CHANGELOG.md`. Admin pagination
> (`GET /user?page=&limit=`, `@Roles("admin")`), notifications
> `GET /notifications/unread-count`, and shop `GET /products/shop/stats` are live;
> server-side product search by name/SKU already existed. Admin pagination +
> unread-count are runtime-verified; shop-stats is now runtime-verified too
> (`{productCount:12,totalStock:961,lowStockCount:0}`) after the nodeB idle-crash
> fix below.

## Known Issues

- Semantically invalid/unresolvable GHN shipping addresses pass DTO validation but can surface as a sanitized 502 during order creation instead of a client-facing 400; the known-valid six-part GHN fixture succeeds.
- Gateway JWT config does not fail fast when `JWT_SECRET` is absent; the app can bootstrap with an undefined secret and fail later during authentication.
- Stale REST requests can still send HTTP to Inventory TCP port `3002`: `rest/stock-check.rest.http` calls inventory directly; Inventory binds HTTP and TCP on the same numeric port on different interfaces, making `localhost:3002` ambiguous.
- Root `npm run build` references the removed app `apps/ecommerce-nestjs-zzzzz/tsconfig.app.json`; service-specific gateway/user builds pass.
- BuyerInfo interface in gateway order.service declares 4 fields (id/username/email/name) but user service returns 6 (+ avatar/isActive) — minor type mismatch, no runtime impact.
- nodeB services (inventory/payments/rewards) used to silently crash after an idle period (e.g. machine sleep / broker restart): `RmqModule.registerDirectPublisher()` opened a raw amqplib connection+channel with NO `'error'`/`'close'` listeners, so an idle connection drop was thrown as an uncaught exception and killed the process (the `nest --watch` wrapper survived, masking it). FIXED 2026-06-26: the publisher now attaches error/close handlers, uses a `?heartbeat=30` URI, connects in the background (never blocks bootstrap), and auto-reconnects via a self-healing Proxy. If a nodeB service is ever found down, check whether its compiled `dist/apps/<svc>/main` process is actually running — `--watch` does NOT auto-restart a runtime crash.
- Login route is `POST /api/user/login` (sets the HttpOnly `access_token` cookie) — NOT `/api/auth/login` as the CLAUDE.md self-test protocol text says.

## Ops / Runtime Reference

- GHN env (local/nodeA/.env): `GHN_API_URL=https://dev-online-gateway.ghn.vn/shiip/public-api`, `GHN_API_TOKEN`, `GHN_SHOP_ID=200481`; `GHN_WEBHOOK_SECRET` required on the gateway webhook (`x-ghn-webhook-token` or `?token=`).
- GHN shipping_address: pipe-delimited `name|phone|addr|ward|district|province`; failure non-fatal (order saved with ghn_order_code=null).
- COD: handled via GHN cod_amount; payments service guard skips COD orders (no payment row).
- Stale-reservation sweeper (orders): hourly `@Cron` cancels orders in PENDING/CONFIRMED/PROCESSING with `ghn_order_code` null older than `ORDER_STALE_RESERVATION_TTL_HOURS` (default 24h, set in `local/nodeA/.env`), reusing the idempotent cancel flow to release stock. Orders with a GHN code are never swept (driven by the delivery webhook).
- payment_methods table: `is_active` controls active options; `PAYMENT_GATEWAY` env is fully unused (strategy chosen per-request from `paymentMethod`).
- Cloudinary: client uploads direct; server signs via `POST /api/upload/signature`; folders `trybuy/products/`, `trybuy/posts/`.
- Deploy: `pm2 start ecosystem.config.js --env production` → `pm2 save && pm2 startup`; set the real domain in `nginx/trybuy.conf`.
- Applied migrations (P1-03, social DB, `synchronize:false`): `database/add_product_id_to_posts.sql` (`posts.product_id INT NULL`) and `database/create_post_reports_table.sql` (`post_reports` table) — both applied to Aiven on 2026-06-25. Re-run on any fresh DB before the post-edit / report endpoints work.

## History

Finished milestones, completed tasks, and the resolved 2026-06-19 audit live in
`CHANGELOG.md` (same folder, not auto-loaded). Read it only when you need the
history or rationale behind a past change.
