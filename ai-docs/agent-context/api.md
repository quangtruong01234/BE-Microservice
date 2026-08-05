# API Reference

Base URL: `http://localhost:3000`  
Swagger UI: `http://localhost:3000/doc`  
All routes prefixed with `/api/`

Auth: HttpOnly cookie set on login. Protected routes require the cookie (sent automatically via `credentials: 'include'`).

External identifier contract: converted resources expose and accept opaque ids
only: orders `ord_`, users `usr_`, conversations `conv_`, messages `msg_`, user
addresses `addr_`, notifications `ntf_`, return requests `rr_`, and products
`prod_`, posts `post_`, and comments `cmt_` (each prefix followed by 16
alphanumeric characters). Numeric ids remain internal DB/TCP references. Nested
references to converted domains (`userId`, `sellerId`, `productId`, `postId`,
`commentId`, `actorId`, and similar fields) also use opaque ids at HTTP and
WebSocket boundaries.

---

## Auth Zones

**Public (no auth):**
- POST /api/user/register, POST /api/user/login, POST /api/user/logout
- GET /api/products/ and all GET product endpoints
- GET /api/products/:id/skus
- GET /api/inventory/product/:productId
- GET /api/gateway/payment-result
- GET /api/payment/options
- POST /zalopay/callback (ZaloPay server callback, no `/api` prefix)
- POST /vnpay/callback, GET /vnpay/callback (VNPay server callback, no `/api` prefix)
- GET /api/social/posts, GET /api/social/posts/:id, GET /api/social/posts/user/:userId
- GET /api/social/posts/:id/comments, GET /api/social/comments/:id/replies
- GET /api/social/users/:id/followers, GET /api/social/users/:id/following, GET /api/social/users/:id/feed
- POST /ghn/webhook (GHN delivery callback, no `/api` prefix; requires `x-ghn-webhook-token` or `?token=` matching `GHN_WEBHOOK_SECRET`)

**Cookie required (authenticated user):**
- POST /api/products/, PATCH /api/products/:id, DELETE /api/products/:id
- GET /api/products/price-suggestion
- POST /api/products/risk/duplicate-check (seller `product create:own`, rate limited)
- GET /api/products/wishlist, POST /api/products/wishlist/:productId, DELETE /api/products/wishlist/:productId
- POST /api/order/, POST /api/order/shipping-fee, GET /api/order/:id, GET /api/order/user/:id, PATCH /api/order/:id/cancel, GET /api/order/:id/invoice
- GET /api/order/:id/payment-url
- GET /api/order/seller, PATCH /api/order/:id/confirm, PATCH /api/order/:id/ready-to-ship
- POST /api/inventory/, PUT /api/inventory/:id (product owner/admin)
- GET /api/inventory/low-stock (`@Roles("shop","admin")` — shop auto-scoped to own products)
- GET /api/notifications, PATCH /api/notifications/:id/read
- POST /api/cart, GET /api/cart, PATCH /api/cart/items/:id, DELETE /api/cart/items/:id, DELETE /api/cart
- POST /api/social/posts, PATCH /api/social/posts/:id, DELETE /api/social/posts/:id
- POST /api/social/posts/:id/report
- POST /api/social/posts/:id/like, DELETE /api/social/posts/:id/like
- POST /api/social/posts/:id/comments, DELETE /api/social/comments/:id
- POST /api/social/comments/:id/replies
- POST /api/social/users/:id/follow, DELETE /api/social/users/:id/follow
- POST /api/chat/conversations, GET /api/chat/conversations, GET /api/chat/conversations/:id/messages
- POST /api/upload/signature, DELETE /api/upload/media
- GET /api/user/me, PATCH /api/user/:id

**Role: admin only:**
- GET /api/products/admin/risk
- POST /api/products/admin/risk/:id/rescore
- POST /api/products/admin/risk/backfill
- POST /api/products/admin/risk/:id/feedback
- GET /api/user (paginated `?page=&limit=`)
- GET /api/order/admin/orders
- GET /api/order/admin/ghn/orders
- GET /api/order/admin/ghn/orders/:id
- POST /api/order/admin/ghn/orders/:id/sync
- GET /api/order/admin/ghn/orders/:id/history
- GET /api/products/brands/pending
- PATCH /api/products/brands/:id/review
- GET /api/products/categories/pending
- PATCH /api/products/categories/:id/review

> When adding a new endpoint: declare it in the correct zone here before implementing the guard.

---

## User Endpoints (`/api/user/`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/user/register` | Public | Register new user |
| POST | `/api/user/login` | Public | Login — sets HttpOnly JWT cookie |
| POST | `/api/user/logout` | Public | Clears auth cookie |
| GET | `/api/user` | Role: admin | Paginated users (`?page=&limit=`) |
| GET | `/api/user/me` | Cookie | Get current authenticated user |
| GET | `/api/user/:id` | Cookie | Get public user profile by ID (no email) |
| PATCH | `/api/user/:id` | Cookie | Update user profile (own account only) |

### Register DTO
```typescript
{ username: string; password: string; email: string; name?: string }
```

### Login DTO
```typescript
{ username: string; password: string }
```

### User response privacy
`GET /api/user/:id` is a public-profile projection:

```typescript
{ id: string /* "usr_..." */; username: string; name: string | null; avatar: string | null; isActive: boolean }
```

It does not return `email`. Email remains available only in private/admin
contexts such as `GET /api/user/me`, admin user pagination, order buyer/admin
views, and invoices.

---

## Product Endpoints (`/api/products/`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/products/` | — | All products (filter/paginate) |
| POST | `/api/products/` | Cookie | Create product |
| GET | `/api/products/price-suggestion` | Cookie | Suggest a catalog price range by category, brand, and condition |
| GET | `/api/products/admin/risk` | Role: admin | Paginated advisory product-risk queue |
| POST | `/api/products/admin/risk/:id/rescore` | Role: admin | Recompute one product's advisory risk score |
| POST | `/api/products/admin/risk/backfill` | Role: admin | Enqueue a resumable cursor batch for risk scoring (202) |
| POST | `/api/products/admin/risk/:id/feedback` | Role: admin | Record `confirmed_duplicate` or `dismissed` moderator feedback |
| POST | `/api/products/risk/duplicate-check` | Cookie (seller) | Rate-limited advisory check for an already-uploaded owned Cloudinary URL |
| GET | `/api/products/wishlist` | Cookie | Current user's wishlist products (paginated) |
| POST | `/api/products/wishlist/:productId` | Cookie | Add product to current user's wishlist |
| DELETE | `/api/products/wishlist/:productId` | Cookie | Remove product from current user's wishlist (204) |
| GET | `/api/products/search` | — | Search by keyword |
| GET | `/api/products/brands` | — | All active brands |
| POST | `/api/products/brands` | Cookie | Submit brand for review (status=pending, isActive=false) |
| GET | `/api/products/brands/pending` | Role: admin | Pending brands awaiting review |
| PATCH | `/api/products/brands/:id/review` | Role: admin | Approve or reject a brand |
| GET | `/api/products/brands/:id` | — | Brand by ID |
| GET | `/api/products/categories` | — | All active categories |
| POST | `/api/products/categories` | Cookie | Submit category for review (status=pending, isActive=false) |
| GET | `/api/products/categories/pending` | Role: admin | Pending categories awaiting review |
| PATCH | `/api/products/categories/:id/review` | Role: admin | Approve or reject a category |
| GET | `/api/products/categories/:id` | — | Category by ID |
| GET | `/api/products/category/:categoryId` | — | Products by category |
| GET | `/api/products/brand/:brandId` | — | Products by brand |
| GET | `/api/products/sku/:sku` | — | Product by SKU |
| GET | `/api/products/with-inventory/all` | — | All products with stock |
| POST | `/api/products/with-inventory/multiple` | — | Multiple products with stock |
| GET | `/api/products/:id` | — | Product by ID |
| PATCH | `/api/products/:id` | Owner/admin | Update product |
| DELETE | `/api/products/:id` | Owner/admin | Delete product |
| GET | `/api/products/:id/with-inventory` | — | Product + stock data |
| GET | `/api/products/:id/stock-check` | — | Stock availability check |
| GET | `/api/products/:id/skus` | — | Get SKUs for a product |

> Standalone SKU mutation routes were removed (unused-API sweep 2026-07-06).
> SKUs are edited via `PATCH /api/products/:id` with `variations` + `skuList` —
> `skuList` is the FULL desired set, not a delta (see
> `ai-docs/agent-context/known-behaviors.md`).

### Query Params for GET `/api/products/`
```
page, limit, categoryId, brandId, minPrice, maxPrice, search
```

### Product read response — category shape
Every product read path (list, by-id, by-sku, by-category, by-brand, search,
with-inventory) returns BOTH the full hydrated `categories[]` (eager ManyToMany
objects) AND a flat `categoryIds: number[]` derived from it. The gateway
normalizes this uniformly (`attachCategoryIds` / `withCategoryIds`), so the FE
multi-category editor gets the same shape on list and detail.

Product seller enrichment uses the same public-profile projection as
`GET /api/user/:id`; `product.user` does not include `email`.

### Wishlist response

`GET /api/products/wishlist?page=&limit=` returns:

```typescript
{ data: Array<Product & { categoryIds: number[]; wishlistedAt: string }>, total: number, page: number, limit: number, totalPages: number, hasNext: boolean }
```

### Product risk response (admin only)

`GET /api/products/admin/risk?minScore=&page=&limit=` returns the standard
paginated product shape with additive `riskScore`, `riskFlags`,
`riskScoringStatus`, `riskScoredAt`, retry metadata, and last-error fields. Flag
types are `duplicate_image`, `price_anomaly`, and `similar_name`; internal image
hashes are never exposed. `POST /api/products/admin/risk/:id/rescore` returns
`{ productId, riskScore, riskFlags, riskScoringStatus: "ready", riskScoredAt }`.
Create/update enqueue durable scoring state; the product worker retries transient
failures with bounded exponential backoff. Backfill accepts `{cursor?,limit?}`
and returns `{enqueued,nextCursor,hasMore}`. Duplicate pre-check accepts an owned
`{imageUrl}` and returns only public match evidence; moderator feedback is an
audit record and never automatically deactivates a product.

### Create/Update SKU DTO (`CreateSkuGatewayDto`)
```typescript
{
  tierIdx: string;       // JSON array string e.g. "[0,1]"
  price: number;         // >= 0
  stockQuantity?: number;
  sku?: string;
  isActive?: boolean;
}
```

---

## Order Endpoints (`/api/order/`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/order/` | Cookie | Create order — triggers `order_created` event; `total = items + GHN shipping fee`, `shippingFee` persisted on order |
| POST | `/api/order/shipping-fee` | Cookie | Preview GHN shipping fee for an address — returns `{ shippingFee, expectedDeliveryTime }` |
| GET | `/api/order/admin/orders` | Role: admin | All orders with buyer info (paginated) |
| GET | `/api/order/admin/ghn/orders` | JWT + `shipping read:any` (currently granted to admin) | Paginated logistics order list with GHN code/status sync metadata and available actions |
| GET | `/api/order/admin/ghn/orders/:id` | JWT + `shipping read:any` (currently granted to admin) | Local order + server-fetched GHN detail for shipping admin |
| POST | `/api/order/admin/ghn/orders/:id/sync` | JWT + `shipping update:any` (currently granted to admin) | Manually fetch GHN detail and safely sync local status through the webhook mapping rules |
| GET | `/api/order/admin/ghn/orders/:id/history` | JWT + `shipping read:any` (currently granted to admin) | Shipping webhook/manual-sync/action timeline |
| GET | `/api/order/seller` | Cookie | Paginated orders containing the logged-in seller's products (`?page&limit&status`) |
| GET | `/api/order/user/:id` | Owner/admin | Get paginated orders by user ID |
| GET | `/api/order/:id` | Cookie | Get single order (owner or admin only) |
| PATCH | `/api/order/:id/cancel` | Cookie | Cancel order (owner or admin, PENDING/PROCESSING → CANCELED) |
| PATCH | `/api/order/:id/confirm` | Cookie | Confirm order — PENDING → CONFIRMED (seller only, ownership via order items) |
| PATCH | `/api/order/:id/ready-to-ship` | Cookie | Mark ready-to-ship — CONFIRMED → PROCESSING, retries GHN if missing (seller only) |
| GET | `/api/order/:id/invoice` | Cookie | Download PDF invoice |
| GET | `/api/order/:id/payment-url` | Owner/admin | Get payment URL and status |

### Create Order DTO
```typescript
{
  paymentMethod: 'zalopay' | 'vnpay' | 'cod';
  shippingAddress: string;   // max 500 chars, pipe-delimited for GHN: "name|phone|addr|ward|district|province"
  items: Array<{
    productId: string;      // prod_<16 alphanumeric characters>
    skuId?: number;          // omit for base-price products
    productName: string;
    quantity: number;        // >= 1
    weight?: number;         // grams
    // price is NOT sent — server fetches authoritative price
  }>;
}
```

Order responses keep `items[].productId` as the checkout-time `prod_...`
snapshot even if the product is later deleted. The internal
`productPublicId` snapshot column is never exposed over HTTP. Rows whose product
was already deleted before migration 007 may remain `null` because their public
id cannot be reconstructed.

### Shipping Fee DTO (`POST /api/order/shipping-fee`)
```typescript
{
  shippingAddress: string;   // pipe-delimited "name|phone|addr|ward|district|province", max 500
  items: Array<{
    productName?: string;
    quantity: number;        // >= 1
    price?: number;          // >= 0
    weight?: number;         // grams, default 500
  }>;
}
// Response: { shippingFee: number; expectedDeliveryTime: string | null }
// Backed by GHN /v2/shipping-order/preview; orders service defaults fee to 0 if GHN is down (non-fatal)
```

---

## Inventory Endpoints (`/api/inventory/`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/inventory/` | Owner/admin | Create inventory record |
| GET | `/api/inventory/low-stock` | `@Roles("shop","admin")` | Low-stock rows (max 100, `availableStock ASC`, active only). Admin → all; shop → auto-scoped server-side to own products. Each row carries best-effort `productName: string \| null`. Bigint ids serialize as strings. |
| GET | `/api/inventory/product/:productId` | Public | Inventory by product ID |
| PUT | `/api/inventory/:id` | Owner/admin | Update inventory |

> The former HTTP routes list / by-sku / by-id / delete / check-stock /
> reserve-stock / release-stock were REMOVED (unused-API sweep 2026-07-06).
> Stock check/reserve/release/consume remain as internal TCP patterns only
> (`INVENTORY_MESSAGE_PATTERNS`) — reserve/release payloads accept optional
> `skuId` for SKU-scoped inventory; omit it for base-product inventory.

---

## Cart Endpoints (`/api/cart/`)

All cart endpoints require a valid JWT cookie.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/cart` | Cookie | Add item to cart |
| GET | `/api/cart` | Cookie | Get current user's cart |
| PATCH | `/api/cart/items/:id` | Cookie | Update cart item quantity (0 = remove) |
| DELETE | `/api/cart/items/:id` | Cookie | Remove item from cart |
| DELETE | `/api/cart` | Cookie | Clear entire cart |

### Add to Cart DTO
```typescript
{ productId: string; skuId?: number; quantity: number /* >= 1 */ }
```

### Update Cart Item DTO
```typescript
{ quantity: number /* >= 0; 0 removes the item */ }
```

---

## Payment Endpoints (`/api/payment/`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/payment/options` | — | Active payment methods from DB |

---

## Notification Endpoints (`/api/notifications/`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/notifications` | Cookie | Paginated notifications for current user |
| PATCH | `/api/notifications/:id/read` | Cookie | Mark notification as read |

Comment/reply notification items include social metadata for deep links:
`postId: "post_..."`, `actorId: "usr_..."`, and `preview`; `orderId` is `null`
for these social notifications. Order-related notifications use
`orderId: "ord_..."`.

---

## Social Endpoints (`/api/social/`)

### Posts
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/social/posts` | Cookie | Create a post (optional `productId` to attach a product) |
| GET | `/api/social/posts` | — | Paginated posts (isLiked populated if cookie present) |
| GET | `/api/social/posts/user/:userId` | — | Paginated posts by user |
| GET | `/api/social/posts/:id` | — | Get post by ID |
| PATCH | `/api/social/posts/:id` | Cookie | Edit a post (owner only; partial: content/imageUrls/videoUrl/productId) |
| DELETE | `/api/social/posts/:id` | Cookie | Delete a post |
| POST | `/api/social/posts/:id/report` | Cookie | Report a post (`reason`; one report per user per post) |
| POST | `/api/social/posts/:id/like` | Cookie | Like a post |
| DELETE | `/api/social/posts/:id/like` | Cookie | Unlike a post |

### Comments
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/social/posts/:id/comments` | Cookie | Create top-level comment (rate limited) |
| GET | `/api/social/posts/:id/comments` | — | Paginated comments for a post |
| DELETE | `/api/social/comments/:id` | Cookie | Delete a comment |
| POST | `/api/social/comments/:id/replies` | Cookie | Reply to a comment (rate limited) |
| GET | `/api/social/comments/:id/replies` | — | Reply tree (depth 5) |

### Follow / Feed
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/social/users/:id/follow` | Cookie | Follow a user |
| DELETE | `/api/social/users/:id/follow` | Cookie | Unfollow a user |
| GET | `/api/social/users/:id/followers` | — | Get followers of a user |
| GET | `/api/social/users/:id/following` | — | Get users a user follows |
| GET | `/api/social/users/:id/feed` | — | Posts from users the user follows |

Social author/user decoration uses public profiles only; `author` objects do not
include `email`. Post route params and response ids use `post_...`; comment and
reply route params/ids use `cmt_...`; user route params and all user references
use `usr_...`; attached products use `prod_...`. Numeric forms for converted
domains return `400` at the gateway boundary.

---

## Chat Endpoints (`/api/chat/`)

All chat endpoints require a valid JWT cookie. WebSocket on `gateway:3000/chat` namespace.
Conversation participants, `otherUserId`, and message `senderId` use `usr_...`
at HTTP/WS boundaries; internal chat TCP payloads remain numeric.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/chat/conversations` | Cookie | Create or get 1-1 conversation |
| GET | `/api/chat/conversations` | Cookie | List conversations for current user |
| GET | `/api/chat/conversations/:id/messages` | Cookie | Paginated messages (rate limited) |

---

## Upload Endpoints (`/api/upload/`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/upload/signature` | Cookie | Get Cloudinary signed upload params |
| DELETE | `/api/upload/media` | Cookie | Delete media from Cloudinary |

Cloudinary allowed folders: `trybuy/products`, `trybuy/posts`, `avatars`.
Upload `publicId` is optional; when provided it must be a basename owned by the
caller (`${userId}_...`, no `/`). Delete `public_id` must include the allowed
folder and an owned basename (`trybuy/posts/${userId}_...`,
`trybuy/products/${userId}_...`, or `avatars/${userId}_...`) unless the caller is
admin.

### Create product with uploaded images

Product images use a signed direct-upload flow; the API server does not proxy
the image bytes.

1. Log in as a shop account so Postman keeps the `access_token` cookie.
2. Request upload parameters:

```http
POST /api/upload/signature?folder=trybuy/products
```

```json
{
  "statusCode": 201,
  "data": {
    "signature": "...",
    "timestamp": 1710000000,
    "api_key": "...",
    "cloud_name": "...",
    "folder": "trybuy/products",
    "public_id": "20_generated-id"
  }
}
```

3. Send the image and all returned parameters to Cloudinary:

```http
POST https://api.cloudinary.com/v1_1/{cloud_name}/image/upload
Content-Type: application/x-www-form-urlencoded
```

Required fields: `file`, `api_key`, `timestamp`, `signature`, `folder`, and
`public_id` from the response's `data` object. Keep Cloudinary's returned
`secure_url`.

4. Create the product with one or more uploaded URLs:

```json
{
  "name": "Example product",
  "price": 100000,
  "stockQuantity": 1,
  "sku": "EXAMPLE-001",
  "categoryIds": [1],
  "imageUrls": [
    "https://res.cloudinary.com/example/image/upload/v1/trybuy/products/20_generated-id.png"
  ]
}
```

The Postman collection `TryBuy Product Image Upload Flow` automates this
sequence and verifies that the Cloudinary URL is persisted unchanged.

### Full e-commerce Postman flow

The personal collection `TryBuy Full E-commerce E2E` runs the deterministic
COD lifecycle without manual input when paired with the personal environment
`TryBuy Local Full E2E`:

1. Verify public payment options.
2. Log in as the shop account.
3. Select an active category, sign and upload a generated image, and create a
   uniquely named product.
4. Locate the product inventory; if product creation did not provision it,
   create the missing row, then set deterministic test stock.
5. Log in as the buyer, clear stale cart state, add the generated product, and
   verify the cart.
6. Preview GHN shipping, create a COD order, and verify stock reservation.
7. Cancel the order and verify stock release.
8. Clear the cart, then delete generated inventory, product, and Cloudinary
   media as the shop account.

The canceled order remains as the transaction audit record. ZaloPay and VNPay
redirect/callback flows are intentionally separate because they require an
external sandbox interaction.

### Successful e-commerce Postman flow

The personal collection `TryBuy Full E-commerce Success E2E` uses the same
`TryBuy Local Full E2E` environment and runs the successful COD lifecycle:

1. Create the product image, product, and deterministic inventory fixture.
2. Add the product to the buyer cart and create a COD order.
3. Log in as the shop, confirm the order, and mark it ready to ship.
4. Send an authenticated GHN `delivered` webhook using the environment's
   secret webhook token.
5. Verify the order is `completed` and reserved stock was consumed.
6. Log back in as the buyer, create and list a verified-purchase review.
7. Delete the generated review, cart, inventory, product, and Cloudinary
   media. The completed order remains as the transaction audit record.

---

## Gateway / Webhook Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/live` | Public | Gateway liveness probe; checks only that the HTTP process is alive. |
| GET | `/ready` | Public | Gateway readiness probe; checks only safe existing dependencies and returns 503 when a required checked dependency fails. |
| GET | `/health` | Public | Gateway health summary for ops tooling; reports service status, uptime, timestamp, and safe dependency statuses without secrets or host details. |
| GET | `/api/gateway/payment-result` | — | Payment result verification. VNPay verifies signed gateway params; ZaloPay verifies the `checksum` on browser-return params. Verified success completes the payment row and emits `payment_completed` before returning `success`. |
| POST | `/zalopay/callback` | Public provider callback | Gateway facade for ZaloPay server callback. Forwards the raw body to the payments service over TCP, where MAC validation and idempotent completion run. Returns ZaloPay's raw `{ return_code, return_message }` shape. |
| POST | `/vnpay/callback` | Public provider callback | Gateway facade for VNPay server callback body. Forwards the raw body to the payments service over TCP, where checksum validation and idempotent completion run. Returns VNPay's raw `{ RspCode, Message }` shape. |
| GET | `/vnpay/callback` | Public provider callback | Gateway facade for VNPay IPN query callback. Forwards the raw query to the payments service over TCP. Returns VNPay's raw `{ RspCode, Message }` shape. |
| POST | `/ghn/webhook` | Shared secret | GHN delivery status callback (no `/api` prefix); token via `x-ghn-webhook-token` or `?token=` |

---

## TCP Message Patterns

All patterns defined in `api/libs/constant/`.

### User Patterns (`USER_MESSAGE_PATTERN`)
```
GET_USER_INFO, GET_ALL_USERS, GET_USERS_BY_IDS, REGISTER_USER, LOGIN_USER,
GET_ME (user.get_me), UPDATE_USER (user.update)
```

### Product Patterns (`PRODUCT_MESSAGE_PATTERNS`)
```
product.create, product.findAll, product.findById, product.findBySku,
product.update, product.delete, product.findByCategory, product.findByBrand,
product.search,
brand.create, brand.findAll, brand.findById, brand.review,
category.create, category.findAll, category.findById, category.review,
sku.create, sku.findByProduct, sku.findById, sku.update, sku.delete,
product.wishlist.add, product.wishlist.remove, product.wishlist.list
```

### Order Patterns (`ORDER_MESSAGE_PATTERN`)
```
create_order, get_orders_by_user, get_order_by_id, get_all_orders,
cancel_order, get_order_invoice, handle_ghn_webhook,
order.get_by_seller, order.confirm, order.ready_to_ship,
order.calculate_shipping_fee,
order.admin_ghn_orders, order.admin_ghn_order_detail,
order.admin_ghn_sync, order.admin_ghn_history
```

### Payment Patterns (`PAYMENT_MESSAGE_PATTERN`)
```
get_payment_url, get_payment_options, payment.initiate_multi_order,
payment.complete_zalopay_return, payment.complete_vnpay_return,
payment.zalopay_callback, payment.vnpay_callback
```

### Notification Patterns (`NOTIFICATION_MESSAGE_PATTERN`)
```
get_user_notifications, mark_notification_read
```

### Social Patterns (`SOCIAL_MESSAGE_PATTERN`)
```
social_create_post, social_update_post, social_report_post,
social_get_posts, social_get_posts_by_user, social_get_post_by_id,
social_delete_post, social_like_post, social_unlike_post,
social_create_comment, social_get_comments, social_delete_comment,
social_create_reply, social_get_replies,
social_follow_user, social_unfollow_user, social_get_followers,
social_get_following, social_get_following_feed
```

### Chat Patterns (`CHAT_MESSAGE_PATTERN`)
```
chat.create_or_get_conversation, chat.get_conversations, chat.get_messages,
chat.send_message, chat.check_membership
```

### Cart Patterns (`CART_MESSAGE_PATTERN`)
```
cart.addItem, cart.get, cart.updateItem, cart.removeItem, cart.clear
```

### Inventory Patterns (`INVENTORY_MESSAGE_PATTERNS`)
```
inventory.create, inventory.find_all, inventory.find_one,
inventory.find_by_product_id, inventory.find_by_sku,
inventory.get_by_product_ids, inventory.check_stock,
inventory.reserve_stock, inventory.release_stock,
inventory.consume_reserved_stock, inventory.get_low_stock,
inventory.update, inventory.remove
```

---

## RabbitMQ Events

All event constants in `api/libs/common/src/constants/event.ts`.

| Event | Constant | Emitted by | Listeners |
|---|---|---|---|
| `order_created` | `EVENT.ORDER_CREATED_EVENT` | Orders service | Inventory (reserve stock), Payments, Rewards |
| `order_canceled` | `EVENT.ORDER_CANCELED_EVENT` | Orders service | Inventory (release stock) |
| `payment_completed` | `EVENT.PAYMENT_COMPLETED_EVENT` | Payments service | Orders (set PROCESSING + trigger GHN) |
| `inventory.stock_changed` | `EVENT.INVENTORY_STOCK_CHANGED_EVENT` | Inventory service | Product service (sync stockQuantity) |
| `social.comment_created` | `EVENT.COMMENT_CREATED_EVENT` | Social service | Notification service |
| `social.reply_created` | `EVENT.REPLY_CREATED_EVENT` | Social service | Notification service |

### Queue Names (`QUEUES` in `api/libs/common/src/constants/queues.ts`)
```
order_events_queue_nest, orders_rpc_queue, inventory_rpc_queue,
inventory_events_queue, payments_rpc_queue, rewards_rpc_queue
```
