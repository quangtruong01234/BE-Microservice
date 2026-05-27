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

## Active Tasks

_No active tasks._

## Known Issues

_No known issues._

## Key Conventions

- Payment gateway: always use official npm package, never implement HMAC manually
- PAYMENT_GATEWAY env: zalopay | vnpay
- Constants: message patterns + queue names always in @app/constant, never hardcode
- RabbitMQ consumer: ack on success, nack+requeue on DB error, nack+no-requeue if order not found
- Each prompt: 1 task only, report files changed
- Archive reference: .claude/handoff/archive/2026-05-rbac-payment.md
- @Payload() in NestJS RabbitMQ @EventPattern handlers = packet.data already unwrapped — access data.productId directly, never data.data.productId

## Upcoming — Social Feed (4-day plan)

- Day 1: social service (new) — Post/Like/Comment entities, TCP handlers, gateway endpoints, migration SQL
- Day 2: social FE — feed page, create post, tag product, like/comment UI
- Day 3: realtime noti (WebSocket) + product like (likesCount) + rating endpoint (verified buyer only)
- Day 4: chat realtime — Conversation/Message entities, WebSocket handler, FE chat UI
- Decision: social service on Node A, port TBD (next after 3006)
