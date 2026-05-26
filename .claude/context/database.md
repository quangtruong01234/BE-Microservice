# Database

## Overview

- **MySQL 8** (:3306) -> orders, user, product, payments, rewards
- **PostgreSQL** (:5432) -> inventory
- **Adminer** (:8080) -> DB admin UI

Start: `docker-compose up -d`  
Manual migrations: `api/database/*.sql`

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

### Order (`orders` service)

File: `api/apps/orders/src/entity/order.entity.ts`
Relations: `OneToMany` -> OrderItem

- `id` (int, PK, auto)
- `user_id` (int, FK to User)
- `status` (enum: PENDING, COMPLETED, CANCELED)
- `total` (decimal)
- `created_at`, `updated_at` (datetime, auto)

---

### OrderItem (`orders` service)

File: `api/apps/orders/src/entity/order_item.entity.ts`

- `id` (int, PK, auto)
- `order_id` (int, FK -> Order)
- `product_id` (int)
- `quantity` (int), `price` (decimal)

---

### Payment (`payments` service)

File: `api/apps/payments/src/entity/payment.entity.ts`

- `id` (int, PK, auto)
- `order_id` (int), `amount` (decimal)
- `status` (enum: PENDING, COMPLETED, FAILED)
- `created_at` (datetime, auto)

---

### RewardPoint (`rewards` service)

File: `api/apps/rewards/src/entity/reward_point.entity.ts`

- `id` (int, PK, auto)
- `user_id` (int), `order_id` (int), `points` (int)
- `created_at` (datetime, auto)

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
