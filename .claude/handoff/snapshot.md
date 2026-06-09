## System Overview

TryBuy — NestJS monorepo, 7 microservices + 4 shared libs.
Transport: TCP (sync) + RabbitMQ FANOUT (async).
DB: MySQL 8 (orders/user/product) + PostgreSQL (inventory/payments/rewards). Cache: Redis.
Node A: gateway:3000, orders:3001, user:3003, product:3006, social:3008, notification:3009, chat:3012(TCP)/WS via gateway:3000
Node B: inventory:3002, payments:3005, rewards:3004
Base URL: http://localhost:3000 | Swagger: /doc

## Completed Milestones

- Auth + RBAC: JWT cookie, 64-byte secret, accesscontrol library, RoleAuthGuard, @CheckPermission decorator
- Payments: ZaloPay + VNPay strategy pattern; callback verified; idempotency (UNIQUE order_id); payment-result endpoint; payment_methods table; GET /api/payment/options
- Orders: create/cancel/paginate/admin-list; owner-or-admin guard; PDF invoice; PaginatedResponse
- GHN + COD: full shipping flow — COD order → GHN push → webhook status transitions → payment_completed emit; ZaloPay/VNPay post-payment → GHN; non-fatal failure
- Inventory: atomic reserveStock (UPDATE WHERE); stock sync via RabbitMQ FANOUT (INVENTORY_STOCK_CHANGED_EVENT); findByProductIdOrNull for internal callers
- Product: multi-category ManyToMany; search indexes (7); cache-aside 5s TTL + invalidation; imageUrls JSON column
- Product SKU matrix: product_skus table, variations JSON, upsertSkus transactional; gateway SKU CRUD (GET/POST/PATCH/DELETE /api/products/:id/skus); price/sku nullable on products
- Cart: Cart + CartItem entities (orders service); 5 TCP patterns; gateway fetches authoritative price before forwarding; snapshot columns removed; createOrder() price-injection fix
- User: GET /api/user/me + PATCH /api/user/:id; JWT claim fix (req.user.id); GET_ME + UPDATE_USER patterns
- Social: Post CRUD, Like/Unlike (Redis cache), Comment + Reply tree (materialized-path depth 5), Follow/Feed, isLiked (OptionalJwtAuthGuard)
- Notification: RabbitMQ consumers (payment_completed + order_canceled + comment/reply events) → DB → REST (paginated) + WS push
- Real-time Chat: TCP service (port 3012), WS via gateway:3000/chat, 1-1 + reply, 5-day cleanup cron
- WebSocket: NotificationWsGateway port 3010, JWT auth, rooms user:{userId}, fire-and-forget emit
- Cloudinary: signed upload/delete signature endpoint; image_urls JSON on products + posts; old image_url dropped
- Infrastructure: nginx (Let's Encrypt, WS headers, /zalopay+/vnpay → 3007, /socket.io → 3010), PM2 ecosystem.config.js, trust proxy
- MicroserviceErrorHandler 2-layer: HttpToRpcExceptionFilter on all microservice controllers; @UseFilters applied to payments/inventory/rewards/product
- PaginatedResponse.of() factory in @app/common; PaymentMethod enum in @app/common
- api.md fully updated: 14 controllers, all TCP patterns, RabbitMQ events table
- Product imageUrls fix: gateway CreateProductDto + UpdateProductDto added imageUrls; FE useProductForm + types/index.ts changed image_urls → imageUrls (camelCase)
- RewardPoint entity camelCase: user_id/order_id/created_at → userId/orderId/createdAt with @Column({ name }) aliases; service + controller updated
- Brand/Category approval flow: status ENUM(pending/active/rejected) + submittedBy + reviewNote columns on both tables; POST /api/products/brands|categories now sets status=pending, isActive=false; GET /api/products/brands/pending|categories/pending (admin:read:any); PATCH /api/products/brands/:id/review|categories/:id/review (admin:update:any); brand and category resources added to RBAC grants

## Active Tasks

(none)

## Known Issues

- BuyerInfo interface in gateway order.service declares 4 fields (id/username/email/name) but user service returns 6 (+ avatar/isActive) — minor type mismatch, no runtime impact
- CheckoutPage: item.productName và item.imageUrl null — cần fetch productMap như CartDrawer
- Phase 3 orders: skuId chưa wired vào inventory reservation (interim: gateway validates sku.stockQuantity, orders service skip inventory cho SKU items)
- Phase 4 inventory per-SKU: product_sku_id column + partial unique indexes chưa implement
- ProductDetail: nút "Thêm vào giỏ" chưa disable trước khi chọn đủ variant
- ShopPage: chưa có Edit/Delete product action

## Key Conventions

- Constants: message patterns + queue names always in @app/constant or @app/common/constants — never hardcode
- RabbitMQ consumer: ack on success, nack+requeue on DB error, nack+no-requeue if order not found
- @Payload() in @EventPattern: packet.data already unwrapped — access data.orderId directly, never data.data.orderId
- Gateway pattern: every TCP call needs timeout(10000) + MicroserviceErrorHandler; every DTO field needs @ApiProperty()
- @MessagePattern handlers: always return a value — never void (causes TCP "no elements in sequence" → 502)
- camelCase API contract: all HTTP response + request fields must be camelCase; entity properties use @Column({ name: 'snake_case' }) alias; snake_case only for DB column names, external API contracts (Cloudinary public_id, ZaloPay order_url), WS event name strings
- TypeORM entity: use ! (definite assignment) on all @Column properties; use @Column({ name }) alias for snake_case DB columns
- DECIMAL columns from TypeORM return string — always cast: Number(val ?? 0) or Math.round(Number(val ?? 0))
- tierIdx (ProductSku): @AfterLoad() parses JSON string → number[]; must JSON.stringify before saving to VARCHAR or forwarding via TCP
- HTTP controllers: req.user.id (JwtAuthGuard maps JWT payload.userId → req.user.id)
- WS gateways: payload.userId (JWT claims read directly on handshake)
- WS emit: fire-and-forget — never await, never throw on offline user
- PaginatedResponse: always use PaginatedResponse.of(data, total, page, limit) from @app/common
- PaymentMethod enum: import from @app/common — never re-declare locally
- COD: handled via GHN cod_amount; payments service guard clause skips COD orders
- GHN: shipping_address pipe-delimited "name|phone|addr|ward|district|province"; failure non-fatal (order saved with ghn_order_code=null)
- GHN env: GHN_API_URL=https://dev-online-gateway.ghn.vn/shiip/public-api, GHN_API_TOKEN, GHN_SHOP_ID=200481 in local/nodeA/.env
- Cloudinary: client uploads direct; server signs via POST /api/upload/signature; folders: trybuy/products/, trybuy/posts/
- payment_methods table: is_active column controls active options — PAYMENT_GATEWAY env no longer drives options endpoint
- Deploy: `pm2 start ecosystem.config.js --env production` → `pm2 save && pm2 startup`; update yourdomain.com in nginx/trybuy.conf
- Archive: .claude/handoff/archive/2026-05-rbac-payment.md

## Backlog (priority order)

- [ ] Phase 3 orders: full skuId integration với inventory reservation
- [ ] Phase 4: Inventory per-SKU — product_sku_id column + partial unique indexes
- [ ] CheckoutPage: fetch productMap cho name/image display
