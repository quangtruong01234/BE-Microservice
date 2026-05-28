# API Reference

Base URL: `http://localhost:3000`  
Swagger UI: `http://localhost:3000/doc`  
All routes prefixed with `/api/`

Auth: HttpOnly cookie set on login. Protected routes require the cookie (sent automatically via `credentials: 'include'`).

---

## Auth Zones

**Public (no auth):**
- POST /api/user/register
- POST /api/user/login
- GET /api/products/ và các GET products không có Cookie tag
- GET /api/inventory/ (read-only)
- GET /api/gateway/health

**Cookie required (authenticated user):**
- POST /api/products/
- PATCH /api/products/:id
- DELETE /api/products/:id
- POST /api/order/
- GET /api/order/user/:id
- PATCH /api/order/:id/cancel
- POST /api/inventory/reserve-stock
- POST /api/inventory/release-stock

**Role: admin only:**
- GET /api/user/all

> Khi thêm endpoint mới: phải khai báo vào đúng zone ở đây trước khi implement Guard.

---

## User Endpoints (`/api/user/`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/user/register` | Public | Register new user |
| POST | `/api/user/login` | Public | Login — sets HttpOnly JWT cookie |
| POST | `/api/user/logout` | Public | Clears auth cookie |
| GET | `/api/user/all` | Role: admin | Get all users |
| GET | `/api/user/:id` | Cookie | Get user by ID |

> ⚠️ **NOT IMPLEMENTED**: `GET /api/user/me` does not exist yet.
> `useAuth` hook currently uses localStorage as a temporary store for display info (username, name) — JWT token is NOT stored here, only non-sensitive display data.
> When implementing: add `GET /user/me` to user service + gateway (no `@Public()` needed, uses cookie), then update `useAuth` to query this endpoint instead of reading from localStorage.

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
| GET | `/api/products/brands` | — | All brands |
| POST | `/api/products/brands` | Cookie | Create brand |
| GET | `/api/products/brands/:id` | — | Brand by ID |
| GET | `/api/products/categories` | — | All categories |
| POST | `/api/products/categories` | Cookie | Create category |
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

### Query Params for GET `/api/products/`
```
page, limit, categoryId, brandId, minPrice, maxPrice, search
```

---

## Order Endpoints (`/api/order/`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/order/` | Cookie | Create order (triggers `order_created` event) |
| GET | `/api/order/user/:id` | Cookie | Get orders by user ID |

### Create Order DTO
```typescript
{
  userId: number;
  items: Array<{ productId: number; quantity: number; price: number }>;
  total: number;
}
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

## Gateway Endpoints (`/api/gateway/`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/gateway/` | Cookie | Generic order creation |
| GET | `/api/gateway/health` | — | Health check — returns status of all services |

---

## TCP Message Patterns

All patterns defined in `api/libs/constant/`.

### User Patterns (`USER_MESSAGE_PATTERN`)
```
GET_USER_INFO, GET_ALL_USERS, REGISTER_USER, LOGIN_USER
```

### Product Patterns (`PRODUCT_MESSAGE_PATTERN` / `PRODUCT_MESSAGE_PATTERNS`)
```
product.create, product.findAll, product.findById, product.findBySku,
product.update, product.delete, product.findByCategory, product.findByBrand,
product.search,
brand.create, brand.findAll, brand.findById,
category.create, category.findAll, category.findById
```

### Order Patterns (`ORDER_MESSAGE_PATTERN`)
```
CMD.CREATE_ORDER, GET_ORDERS_BY_USER
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

### `order_created`
- **Emitted by**: Orders service after a successful order creation
- **Constant**: `EVENT.ORDER_CREATED_EVENT` (`api/libs/common/src/constants/event.ts`)
- **Listeners**:
  - Inventory service — reserves stock for ordered items
  - Payments service — initiates payment processing
  - Rewards service — awards loyalty points to the user

### Queue Names (`QUEUES` in `api/libs/common/src/constants/queues.ts`)
```
order_events_queue_nest
orders_rpc_queue
inventory_rpc_queue
payments_rpc_queue
rewards_rpc_queue
```
