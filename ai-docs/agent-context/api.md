# API Reference

Base URL: `http://localhost:3000`  
Swagger UI: `http://localhost:3000/doc`  
All routes prefixed with `/api/`

Auth: HttpOnly cookie set on login. Protected routes require the cookie (sent automatically via `credentials: 'include'`).

---

## Auth Zones

**Public (no auth):**
- POST /api/user/register, POST /api/user/login, POST /api/user/logout
- GET /api/products/ and all GET product endpoints
- GET /api/products/:id/skus
- GET /api/inventory/ (read-only)
- GET /api/gateway/health
- GET /api/gateway/payment-result
- GET /api/payment/options
- GET /api/social/posts, GET /api/social/posts/:id, GET /api/social/posts/user/:userId
- GET /api/social/posts/:id/comments, GET /api/social/comments/:id/replies
- GET /api/social/users/:id/followers, GET /api/social/users/:id/following, GET /api/social/users/:id/feed
- POST /api/ghn/webhook (GHN delivery callback, no /api prefix in gateway)

**Cookie required (authenticated user):**
- POST /api/products/, PATCH /api/products/:id, DELETE /api/products/:id
- POST /api/products/:id/skus, PATCH /api/products/:id/skus/:skuId, DELETE /api/products/:id/skus/:skuId
- POST /api/order/, POST /api/order/shipping-fee, GET /api/order/:id, GET /api/order/user/:id, PATCH /api/order/:id/cancel, GET /api/order/:id/invoice
- GET /api/order/:id/payment-url
- GET /api/order/seller, PATCH /api/order/:id/confirm, PATCH /api/order/:id/ready-to-ship
- POST /api/inventory/reserve-stock, POST /api/inventory/release-stock
- POST /api/inventory/, PUT /api/inventory/:id, DELETE /api/inventory/:id
- GET /api/notifications, PATCH /api/notifications/:id/read
- POST /api/cart, GET /api/cart, PATCH /api/cart/items/:id, DELETE /api/cart/items/:id, DELETE /api/cart
- POST /api/social/posts, DELETE /api/social/posts/:id
- POST /api/social/posts/:id/like, DELETE /api/social/posts/:id/like
- POST /api/social/posts/:id/comments, DELETE /api/social/comments/:id
- POST /api/social/comments/:id/replies
- POST /api/social/users/:id/follow, DELETE /api/social/users/:id/follow
- POST /api/chat/conversations, GET /api/chat/conversations, GET /api/chat/conversations/:id/messages
- POST /api/upload/signature, DELETE /api/upload/media
- GET /api/user/me, PATCH /api/user/:id

**Role: admin only:**
- GET /api/user/all
- GET /api/order/admin/orders
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
| GET | `/api/user/all` | Role: admin | Get all users |
| GET | `/api/user/me` | Cookie | Get current authenticated user |
| GET | `/api/user/:id` | Cookie | Get user by ID |
| PATCH | `/api/user/:id` | Cookie | Update user profile (own account only) |

### Register DTO
```typescript
{ username: string; password: string; email: string; name?: string }
```

### Login DTO
```typescript
{ username: string; password: string }
```

---

## Product Endpoints (`/api/products/`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/products/` | — | All products (filter/paginate) |
| POST | `/api/products/` | Cookie | Create product |
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
| PATCH | `/api/products/:id` | Cookie | Update product |
| DELETE | `/api/products/:id` | Cookie | Delete product |
| GET | `/api/products/:id/with-inventory` | — | Product + stock data |
| GET | `/api/products/:id/stock-check` | — | Stock availability check |
| GET | `/api/products/:id/skus` | — | Get SKUs for a product |
| POST | `/api/products/:id/skus` | Cookie | Add a SKU to a product |
| PATCH | `/api/products/:id/skus/:skuId` | Cookie | Update a SKU |
| DELETE | `/api/products/:id/skus/:skuId` | Cookie | Delete a SKU (204) |

### Query Params for GET `/api/products/`
```
page, limit, categoryId, brandId, minPrice, maxPrice, search
```

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
| GET | `/api/order/seller` | Cookie | Paginated orders containing the logged-in seller's products (`?page&limit&status`) |
| GET | `/api/order/user/:id` | Cookie | Get paginated orders by user ID |
| GET | `/api/order/:id` | Cookie | Get single order (owner or admin only) |
| PATCH | `/api/order/:id/cancel` | Cookie | Cancel order (owner or admin, PENDING/PROCESSING → CANCELED) |
| PATCH | `/api/order/:id/confirm` | Cookie | Confirm order — PENDING → CONFIRMED (seller only, ownership via order items) |
| PATCH | `/api/order/:id/ready-to-ship` | Cookie | Mark ready-to-ship — CONFIRMED → PROCESSING, retries GHN if missing (seller only) |
| GET | `/api/order/:id/invoice` | Cookie | Download PDF invoice |
| GET | `/api/order/:id/payment-url` | Cookie | Get ZaloPay payment URL |

### Create Order DTO
```typescript
{
  paymentMethod: 'zalopay' | 'vnpay' | 'cod';
  shippingAddress: string;   // max 500 chars, pipe-delimited for GHN: "name|phone|addr|ward|district|province"
  items: Array<{
    productId: number;
    skuId?: number;          // omit for base-price products
    productName: string;
    quantity: number;        // >= 1
    weight?: number;         // grams
    // price is NOT sent — server fetches authoritative price
  }>;
}
```

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
| POST | `/api/inventory/` | Cookie | Create inventory record |
| GET | `/api/inventory/` | — | All inventory items |
| GET | `/api/inventory/low-stock` | — | Items below minimum stock |
| GET | `/api/inventory/product/:productId` | — | Inventory by product ID |
| GET | `/api/inventory/sku/:sku` | — | Inventory by SKU |
| GET | `/api/inventory/:id` | — | Inventory by ID |
| POST | `/api/inventory/check-stock` | — | Check if stock is sufficient |
| POST | `/api/inventory/reserve-stock` | Cookie | Reserve stock for an order |
| POST | `/api/inventory/release-stock` | Cookie | Release reserved stock |
| PUT | `/api/inventory/:id` | Cookie | Update inventory |
| DELETE | `/api/inventory/:id` | Cookie | Delete inventory record |

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
{ productId: number; skuId?: number; quantity: number /* >= 1 */ }
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

---

## Social Endpoints (`/api/social/`)

### Posts
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/social/posts` | Cookie | Create a post |
| GET | `/api/social/posts` | — | Paginated posts (isLiked populated if cookie present) |
| GET | `/api/social/posts/user/:userId` | — | Paginated posts by user |
| GET | `/api/social/posts/:id` | — | Get post by ID |
| DELETE | `/api/social/posts/:id` | Cookie | Delete a post |
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

---

## Chat Endpoints (`/api/chat/`)

All chat endpoints require a valid JWT cookie. WebSocket on `gateway:3000/chat` namespace.

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

Cloudinary folders: `trybuy/products/`, `trybuy/posts/`

---

## Gateway / Webhook Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/gateway/health` | — | Health check — status of all services |
| GET | `/api/gateway/payment-result` | — | Payment result redirect (ZaloPay/VNPay) |
| POST | `/api/gateway/` | Cookie | Generic order creation (legacy) |
| POST | `/ghn/webhook` | — | GHN delivery status callback (no /api prefix) |

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
sku.create, sku.findByProduct, sku.findById, sku.update, sku.delete
```

### Order Patterns (`ORDER_MESSAGE_PATTERN`)
```
create_order, get_orders_by_user, get_order_by_id, get_all_orders,
cancel_order, get_order_invoice, handle_ghn_webhook,
order.get_by_seller, order.confirm, order.ready_to_ship,
order.calculate_shipping_fee
```

### Payment Patterns (`PAYMENT_MESSAGE_PATTERN`)
```
get_payment_url, get_payment_options
```

### Notification Patterns (`NOTIFICATION_MESSAGE_PATTERN`)
```
get_user_notifications, mark_notification_read
```

### Social Patterns (`SOCIAL_MESSAGE_PATTERN`)
```
social_create_post, social_get_posts, social_get_posts_by_user, social_get_post_by_id,
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
