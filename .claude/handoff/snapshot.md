## System Overview

TryBuy — NestJS monorepo, 7 microservices + 4 shared libs.
Transport: TCP (sync) + RabbitMQ FANOUT (async).
DB: MySQL 8 (orders/user/product) + PostgreSQL (inventory/payments/rewards). Cache: Redis.
Node A: gateway:3000, orders:3001, user:3003, product:3006, social:3008, notification:3009
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
- PDF Invoice: product_name added to order_items; pdfkit installed; invoice generator + TCP handler + GET /api/order/:id/invoice implemented; TCP pattern mismatch fixed (controller had { cmd: ... } wrapper, gateway sends string) — verified HTTP 200, Content-Type: application/pdf, 1874 bytes, 1-page PDF for order 62
- GHN + COD schema: 4 new columns on orders table (payment_method ENUM zalopay|vnpay|cod, shipping_address VARCHAR 500, cod_amount DECIMAL nullable, ghn_order_code VARCHAR nullable); OrderStatus extended with SHIPPED + DELIVERING; PaymentMethod enum added; migration applied to Aiven DB (55 existing rows backfilled with DEFAULT then dropped)
- GHN + COD implementation: GhnService + GhnModule created (apps/orders/src/ghn/); orders.service.ts calls GHN immediately for COD orders — GHN failure is non-fatal (try/catch, order saved with ghn_order_code=null); payment_method added explicitly to order_created event payload; payments service skips COD orders via guard clause (payment_method === 'cod') before any DB/logging work
- Admin orders endpoint: GET /api/order/admin/orders — @CheckPermission('order','read:any'), TCP to orders (GET_ALL_ORDERS), batch TCP to user (GET_USERS_BY_IDS), merges buyer:{name,email} into each order
- GHN URL fix: GHN_API_URL corrected to https://dev-online-gateway.ghn.vn/shiip/public-api in local/nodeA/.env
- GHN COD E2E verified: order 61 ghn_order_code="LXD9YM" non-null in DB
- GHN cod_amount cast fix: Math.round(Number(order.cod_amount ?? 0)) in ghn.service.ts — TypeORM returns DECIMAL as string, GHN expects int
- GHN webhook handler (Task B): POST /ghn/webhook (gateway, @Public(), excluded from /api prefix); TCP handler GHN_WEBHOOK in orders maps picking/picked→SHIPPED, delivering→DELIVERING, delivered→COMPLETED; emits payment_completed for COD delivered orders; 8 files changed; verified 3 status transitions live
- ZaloPay/VNPay → GHN post-payment (Task C): handlePaymentCompleted() calls GHN (cod_amount=0, non-fatal) and sets status=PROCESSING instead of COMPLETED; COD orders short-circuit (already COMPLETED via GHN webhook → no-op); verified order 62 ghn_order_code="LXD6U9" non-null, status=processing
- GHN + COD shipping flow fully complete end-to-end
- PDF invoice verified: TCP pattern fix (removed { cmd: } wrapper from @MessagePattern in orders controller); GET /api/order/:id/invoice → 200, Content-Type: application/pdf, 1874 bytes, 1-page PDF for order 62
- MicroserviceErrorHandler fixed (2-layer): HttpToRpcExceptionFilter in libs/common catches HttpException → re-throws as RpcException({ statusCode, message }); gateway MicroserviceErrorHandler adds err?.error unwrap; @UseFilters(HttpToRpcExceptionFilter) on OrdersController; verified 403/404/200 correct for invoice endpoint
- Payment option selection: payment_methods table in payments PostgreSQL (id, key VARCHAR unique, name, description, is_active BOOLEAN default true); seeded zalopay/vnpay/cod rows via Node pg script; TCP GET_PAYMENT_OPTIONS handler in payments service; GET /api/payment/options (@Public()) returns active rows from DB via TCP; verified response correct
- Social service scaffolded: apps/social/, port 3008, Node A, MySQL TypeORM, TCP, SOCIAL_SERVICE client trong gateway
- Notification service fully implemented: entity (notifications table, 7 columns, MySQL), RabbitMQ consumers (payment_completed + order_canceled → save notification cho buyer), REST GET /api/notifications (paginated, JwtAuthGuard), PATCH /api/notifications/:id/read; end-to-end verified — event → DB → REST → mark-as-read all pass
- Admin orders endpoint: GET /api/order/admin/orders?page=1&limit=20 — parallel fetch orders + buyer info (batch TCP to user service), @CheckPermission('order','read:any') guard, 200/403 verified; note: role relation leak trong buyer object (tech debt)
- Social Post CRUD Phase 1: SOCIAL_MESSAGE_PATTERN added (4 patterns); social.service.ts (createPost/getPosts/getPostById/deletePost), social.controller.ts (@MessagePattern + @UseFilters(HttpToRpcExceptionFilter)), social.module.ts (TypeOrmModule.forFeature([Post])); gateway social/ module (SocialGatewayService + SocialController: POST/GET/GET:id/DELETE /api/social/posts); SocialGatewayModule imported into gateway.module.ts
- Social Like/Unlike: likePost/unlikePost + Redis caching (INCR/DECR like_count, SET/DEL liked flag); response trả likeCount mới nhất; getPosts + getPostsByUser đều kèm likeCount (cache-aside)
- Social Comment: createComment/getComments/deleteComment (top-level only, parent IS NULL)
- Social Reply tree: TypeORM materialized-path, createReply/getReplies (findDescendantsTree depth 5), infinite nesting verified
- Product multi-category: refactored ManyToOne → ManyToMany, junction table product_categories, categoryIds[] in DTO; createProduct/updateProduct/findAll/findById all use relations: ['categories']; E2E verified (5 steps pass)
- Production hardening: trust proxy via getHttpAdapter().getInstance() trong gateway main.ts; CORS đã dùng env var (no change); PM2 ecosystem.config.js cho nodeA + nodeB; nginx/trybuy.conf với Let's Encrypt + WebSocket headers

## Active Tasks

(none)

## Known Issues

- PAYMENTS_SERVICE + REWARDS_SERVICE queues: old payment_completed events bị nack+requeue loop — cần purge queue hoặc investigate rewards handler

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
- payment_methods table: active methods controlled by is_active column in DB — PAYMENT_GATEWAY env no longer drives the options endpoint
- Tech debt: payments/inventory/rewards/product controllers chưa có @UseFilters(HttpToRpcExceptionFilter) — apply khi gặp 502 bug tương tự
- Deploy checklist: `pm2 start ecosystem.config.js --env production` → `pm2 save && pm2 startup`; thay yourdomain.com trong nginx/trybuy.conf trước khi deploy

## Backlog (priority order)

- [x] PDF invoice — verified working: HTTP 200, application/pdf, 1-page PDF generated correctly
- [x] Shipping GHN + COD — fully complete: COD flow, webhook handler, ZaloPay/VNPay→GHN post-payment
- [x] Payment option selection — GET /api/payment/options returns active rows from payment_methods DB table
- [x] Notification service — fully complete
- [x] Social Post CRUD Phase 1 — POST/GET/GET:id/DELETE /api/social/posts fully wired
- [x] Social Like/Unlike Phase 2 — PostLike entity, likePost/unlikePost TCP handlers, POST/DELETE /api/social/posts/:id/like; ER_DUP_ENTRY → ConflictException
- [x] Social Comment CRUD Phase 3 — Comment entity (comments table already in migration SQL); createComment/getComments/deleteComment TCP handlers; POST/GET /api/social/posts/:id/comments + DELETE /api/social/comments/:id; SocialCommentController added to gateway; SOCIAL_MESSAGE_PATTERN extended with CREATE_COMMENT/GET_COMMENTS/DELETE_COMMENT
- [x] Social feed Phase 2 — Like ✓, Comment ✓, Reply tree ✓ | Chat defer WebSocket
- [ ] reply_count trên getComments response
- [ ] WebSocket real-time (Socket.io, cần WebSocket gateway riêng)
- [ ] Wire notification cho comment/reply events
- [x] Nginx config — nginx/trybuy.conf, Let's Encrypt + same-server
  setup, WebSocket upgrade headers included; thay yourdomain.com
  trước khi deploy
