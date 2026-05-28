# Database

## Overview

- **MySQL 8** (:3306) -> orders, user, product
- **PostgreSQL** (:5432) -> inventory, payments, rewards
- **Adminer** (:8080) -> DB admin UI

Start: `docker-compose up -d`  
Manual migrations: `api/database/*.sql`

---

## ID Type Convention

- **Default**: `int` (`@PrimaryGeneratedColumn()`) for all PKs and FKs.
- **Exceptions** (high-volume transaction tables): `orders`, `order_items`, `payments` use `bigint` PK (`@PrimaryGeneratedColumn('increment', { type: 'bigint' })`).
- FK columns that reference a `bigint` PK must also be `bigint` — e.g., `order_id` in `order_items` and `payments`.
- All other FKs (brandId, categoryId, userId, productId, etc.) stay `int`.

---

## MySQL Entities

### User (`user` service)

File: `api/apps/user/src/entity/user.entity.ts`

- `id` (int, PK, auto)
- `username` (varchar, unique)
- `password` (varchar, bcrypt hashed)
- `email` (varchar)
- `name` (varchar, display name)
- `avatar` (varchar, URL)
- `isActive` (boolean, default true)
- `createdAt`, `updatedAt` (datetime, auto)

---

### Product (`product` service)

File: `api/apps/product/src/entity/product.entity.ts`
Relations: `ManyToOne` -> Brand, `ManyToOne` -> Category

- `id` (int, PK, auto)
- `name` (varchar), `description` (text), `price` (decimal), `stockQuantity` (int)
- `sku` (varchar, unique)
- `brandId` (int, FK -> Brand), `categoryId` (int, FK -> Category), `userId` (int, FK seller -> User)
- `imageUrl` (varchar), `isActive` (boolean)
- Metrics: `likesCount`, `commentsCount`, `sharesCount`, `viewCount` (int, social metric)
- Flags: `isFeatured`, `isTrending` (boolean)
- `condition` (varchar, e.g. new/used), `sellerNotes` (text)
- Rating: `rating` (decimal, avg), `ratingCount` (int)
- `createdAt`, `updatedAt` (datetime, auto)

---

### Brand (`product` service)

File: `api/apps/product/src/entity/brand.entity.ts`
Relations: `OneToMany` -> Product

- `id` (int, PK, auto)
- `name` (varchar), `description` (text), `isActive` (boolean)
- `createdAt`, `updatedAt` (datetime, auto)

---

### Category (`product` service)

File: `api/apps/product/src/entity/category.entity.ts`
Relations: `OneToMany` -> Product

- `id` (int, PK, auto)
- `name` (varchar), `description` (text), `isActive` (boolean)
- `createdAt`, `updatedAt` (datetime, auto)

---

### Order (`orders` service) — bigint PK

File: `api/apps/orders/src/entity/order.entity.ts`
Relations: `OneToMany` -> OrderItem

- `id` (int, PK, auto)
- `user_id` (int, FK to User)
- `status` (enum: PENDING, COMPLETED, CANCELED)
- `total` (decimal)
- `created_at`, `updated_at` (datetime, auto)

---

### OrderItem (`orders` service) — bigint PK

File: `api/apps/orders/src/entity/order_item.entity.ts`

- `id` (bigint, PK, auto)
- `order_id` (bigint, FK -> Order — bigint because Order.id is bigint)
- `product_id` (int)
- `quantity` (int), `price` (decimal)

---

## PostgreSQL Entities

### Inventory (`inventory` service)

File: `api/apps/inventory/src/inventory.entity.ts` | Table: `inventory_v2`
Getters: `totalStock` = availableStock + reservedStock, `isLowStock` = availableStock <= minimumStock

- `id` (int, PK, auto)
- `productId` (int, links to MySQL Product)
- `sku` (varchar, unique)
- `availableStock` (int), `reservedStock` (int), `minimumStock` (int, low-stock threshold)
- `location` (varchar, warehouse location), `isActive` (boolean)
- `createdAt`, `updatedAt` (datetime, auto)

---

### Payment (`payments` service) — bigint FK

File: `api/apps/payments/src/entity/payment.entity.ts`

- `id` (int, PK, auto)
- `order_id` (bigint — FK to orders.id which is bigint), `amount` (decimal 12,2)
- `status` (enum: PENDING, COMPLETED, FAILED)
- `order_url` (text, nullable)
- `transaction_id` (varchar 255, nullable — stores ZaloPay zp_trans_token or VNPay vnp_TransactionNo)
- `app_trans_id` (varchar 50, nullable — ZaloPay/VNPay transaction reference used for lookup)
- `created_at` (timestamp, auto)

---

### RewardPoint (`rewards` service)

File: `api/apps/rewards/src/entity/reward_point.entity.ts`

- `id` (int, PK, auto)
- `user_id` (int), `order_id` (int), `points` (int)
- `created_at` (datetime, auto)

---

## Migration Files

Run order: DDL files first -> migration files -> seed files.

- `order_module_ddl.sql` (MySQL) -> orders, order_items, order_status_history, order_payments tables
- `products_module_ddl.sql` (MySQL) -> products, categories, brands
- `products_typeorm_safe.sql` (MySQL) -> TypeORM-compatible product schema
- `products_social_features_migration.sql` (MySQL) -> adds likesCount, commentsCount, sharesCount, rating columns
- `inventory_migration.sql` (PostgreSQL) -> inventory_v2 table
- `add_name_avatar_to_users.sql` (MySQL) -> adds name, avatar to users
- `add_user_id_to_products.sql` (MySQL) -> adds userId (seller FK) to products
- `add_variants_to_products.sql` (MySQL) -> product variants support
- `create_sample_users.sql` (MySQL) -> seed data
- `payments_full_migration.sql` (PostgreSQL) -> payments table
