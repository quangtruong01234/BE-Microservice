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

(none)

## Known Issues

- Distributed order creation has no compensation: payment initialization or RMQ publication can fail after orders and reservations exist, leaving an unpaid/unreachable order and held stock.
- Semantically invalid/unresolvable GHN shipping addresses pass DTO validation but can surface as a sanitized 502 during order creation instead of a client-facing 400; the known-valid six-part GHN fixture succeeds.
- Gateway JWT config does not fail fast when `JWT_SECRET` is absent; the app can bootstrap with an undefined secret and fail later during authentication.
- Orders that never reach the GHN "delivered" webhook (e.g. ghn_order_code null because GHN creation failed) keep stock in reservedStock indefinitely — no expiry/sweeper for stale reservations.
- Stale REST requests can still send HTTP to Inventory TCP port `3002`: `rest/stock-check.rest.http` calls inventory directly; Inventory binds HTTP and TCP on the same numeric port on different interfaces, making `localhost:3002` ambiguous.
- Root `npm run build` references the removed app `apps/ecommerce-nestjs-zzzzz/tsconfig.app.json`; service-specific gateway/user builds pass.
- BuyerInfo interface in gateway order.service declares 4 fields (id/username/email/name) but user service returns 6 (+ avatar/isActive) — minor type mismatch, no runtime impact.

## Ops / Runtime Reference

- GHN env (local/nodeA/.env): `GHN_API_URL=https://dev-online-gateway.ghn.vn/shiip/public-api`, `GHN_API_TOKEN`, `GHN_SHOP_ID=200481`; `GHN_WEBHOOK_SECRET` required on the gateway webhook (`x-ghn-webhook-token` or `?token=`).
- GHN shipping_address: pipe-delimited `name|phone|addr|ward|district|province`; failure non-fatal (order saved with ghn_order_code=null).
- COD: handled via GHN cod_amount; payments service guard skips COD orders (no payment row).
- payment_methods table: `is_active` controls active options; `PAYMENT_GATEWAY` env is fully unused (strategy chosen per-request from `paymentMethod`).
- Cloudinary: client uploads direct; server signs via `POST /api/upload/signature`; folders `trybuy/products/`, `trybuy/posts/`.
- Deploy: `pm2 start ecosystem.config.js --env production` → `pm2 save && pm2 startup`; set the real domain in `nginx/trybuy.conf`.

## History

Finished milestones, completed tasks, and the resolved 2026-06-19 audit live in
`CHANGELOG.md` (same folder, not auto-loaded). Read it only when you need the
history or rationale behind a past change.
