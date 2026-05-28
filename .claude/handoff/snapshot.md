## System Overview

TryBuy — NestJS monorepo, 7 microservices + 4 shared libs.
Transport: TCP (sync) + RabbitMQ FANOUT (async).
DB: MySQL 8 (orders/user/product) + PostgreSQL (inventory/payments/rewards). Cache: Redis.
Node A: gateway:3000, orders:3001, user:3003, product:3006
Node B: inventory:3002, payments:3005, rewards:3004
Base URL: http://localhost:3000 | Swagger: /doc

## Completed Milestones

- RBAC: accesscontrol library, Role/Resource entity, RoleAuthGuard, @CheckPermission decorator
- Auth: JWT_SECRET 64-byte, JWT_EXPIRES_IN, removed hardcoded fallback
- Payments: ZaloPay sandbox integrated (createOrder + callback + order_url polling)
- VNPay: strategy pattern added, selected via PAYMENT_GATEWAY env
- DB: app_trans_id column saved to payments table
- Task 7: ZaloPay callback fixed — payment status updated, payment_completed emitted
- Task 8: VNPay callback fully verified via ngrok — payment status updated to completed
- Task 9: ZaloPay config — hardcoded fallbacks removed, requireEnv() used
- Task 8 follow-up: orders handlePaymentCompleted — fixed data.data.orderId → data.orderId (NestJS strips envelope before @Payload delivery)
- Task 12: Renamed zp_trans_token → transaction_id in payments table (entity + service + migration SQL created)
- Task 10: Idempotency — UNIQUE constraint on order_id (uq_payments_order_id index), pre-insert check added to processPayment(); 9 duplicate rows cleaned from Aiven DB
- Task 11: payment-result endpoint fixed for ZaloPay + VNPay — verified via sandbox — ZaloPay uses status/amount, VNPay uses vnp_ResponseCode/vnp_Amount
- Task 13: GET /api/order/:id — gateway controller + service enforce owner-or-admin check (ForbiddenException) and 404 when order not found; JwtAuthGuard applied explicitly
- Task 14: Pagination for GET /api/order/user/:id — orders service uses findAndCount with skip/take, returns { data, total, page, limit }; gateway passes { userId, page, limit } via TCP; GetOrdersByUserQueryDto added; stale fixed-key Redis cache removed
- Task #4 (sync): Inventory → Product stock sync via RabbitMQ FANOUT — INVENTORY_STOCK_CHANGED_EVENT + INVENTORY_EVENTS queue + INVENTORY_EXCHANGE constants added; inventory emits after reserve/release/consume; product switched to hybrid mode (TCP + RabbitMQ consumer) with ack/nack logic (NotFoundException → no-requeue, DB error → requeue); fixed @Payload() handler to use data directly (not data.data) — verified reserve/release both sync stockQuantity correctly
- Task #3 (race condition fix): reserveStock() atomic via single UPDATE WHERE available_stock >= qty — PostgreSQL row lock prevents oversell
- Task #4 verified: reserve triggers stockQuantity 4→3, release triggers 3→4 confirmed live
- Cancel order: PATCH /api/order/:id/cancel — status transition PENDING/PROCESSING → CANCELED, ownership check, RabbitMQ emit ORDER_CANCELED_EVENT → inventory releases stock
- Inventory RabbitMQ fanout fix: main.ts switched to getOptionsTopic() with ORDERS_EXCHANGE binding; inventory.controller.ts removed spurious data.data unwrap in handleOrderCreated and handleOrderCanceled — order_created and order_canceled events now consumed correctly; verified reserve/release stock end-to-end
- PDF Invoice (partial): product_name added to order_items (entity + migration applied to Aiven DB); pdfkit + @types/pdfkit installed; invoice generator + get_order_invoice TCP handler + GET /api/order/:id/invoice gateway endpoint implemented (not yet tested)
- PDF Invoice — implemented and zero tsc/ESLint errors confirmed; curl test deferred (not blocking)
- GHN + COD schema: 4 new columns on orders table (payment_method ENUM zalopay|vnpay|cod, shipping_address VARCHAR 500, cod_amount DECIMAL nullable, ghn_order_code VARCHAR nullable); OrderStatus extended with SHIPPED + DELIVERING; PaymentMethod enum added; migration applied to Aiven DB (55 existing rows backfilled with DEFAULT then dropped)
- GHN + COD implementation: GhnService + GhnModule created (apps/orders/src/ghn/); orders.service.ts calls GHN immediately for COD orders — GHN failure is non-fatal (try/catch, order saved with ghn_order_code=null); payment_method added explicitly to order_created event payload; payments service skips COD orders via guard clause (payment_method === 'cod') before any DB/logging work
- GHN URL fix: GHN_API_URL corrected to https://dev-online-gateway.ghn.vn/shiip/public-api in local/nodeA/.env

## Active Tasks

- GHN + COD — re-verify COD order creation end-to-end after URL fix (expect ghn_order_code non-null in DB)
- GHN webhook handler — POST from GHN → update order status (SHIPPED/DELIVERING/COMPLETED) + emit payment_completed for COD when delivered
- ZaloPay/VNPay → GHN — call GHN after payment_completed event (currently order goes straight to COMPLETED; needs PROCESSING → GHN → SHIPPED)

## Known Issues

- MicroserviceErrorHandler 502: BadRequestException and ForbiddenException from microservices over TCP are not correctly mapped to HTTP status codes — falls back to 502 instead of 400/403. Pre-existing bug, needs a dedicated fix.

## Key Conventions

- Payment gateway: always use official npm package, never implement HMAC manually
- PAYMENT_GATEWAY env: zalopay | vnpay
- Constants: message patterns + queue names always in @app/constant, never hardcode
- RabbitMQ consumer: ack on success, nack+requeue on DB error, nack+no-requeue if order not found
- Each prompt: 1 task only, report files changed
- Archive reference: .claude/handoff/archive/2026-05-rbac-payment.md
- @Payload() in NestJS RabbitMQ @EventPattern handlers = packet.data already unwrapped — access data.productId directly, never data.data.productId
- COD payment handled via GHN cod_amount — not a separate payment service
- Nginx config routes /zalopay/callback + /vnpay/callback → port 3007, all else → port 3000
- GHN shipping_address format (pipe-delimited): "name|phone|address|ward|district|province"
- GHN env vars in local/nodeA/.env: GHN_API_URL=https://dev-online-gateway.ghn.vn/shiip/public-api, GHN_API_TOKEN, GHN_SHOP_ID=200481
- GHN failure is non-fatal: order persists with ghn_order_code=null, retry manually
- PaymentMethod enum re-declared locally in gateway DTO (tech debt — sync with orders entity later)
- payments service: guard clause (payment_method === 'cod') skips COD orders before any DB/logging work

## Backlog (priority order)

- [ ] PDF invoice — test + verify download endpoint (implementation done)
- [~] Shipping GHN + COD — schema + COD flow done; webhook handler + ZaloPay/VNPay→GHN pending
- [ ] Payment option selection — user selects ZaloPay / VNPay / COD at checkout
- [ ] Social feed — Post/Like/Comment/Chat/Notifications (new social service, port 3008, Node A)
- [ ] Nginx config — ready at nginx.conf, apply on production deploy only
