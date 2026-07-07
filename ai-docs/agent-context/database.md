# Database

## Current Architecture

TryBuy uses external managed databases on Aiven for application data.

- **Node A MySQL**: orders, user, product, social, notification, chat.
- **Node B PostgreSQL**: inventory, payments, rewards.
- **Gateway**: no database provider.
- **Redis/RabbitMQ**: Docker services from `docker-compose.yml`; they are not part of SQL migrations.

Node env files:

- Node A services load `local/nodeA/.env`.
- Node B services load `local/nodeB/.env`.

## TypeORM Synchronize Policy

Production must not rely on TypeORM schema sync.

- `libs/database/src/typeorm-synchronize.ts` defaults synchronize to `false` when `NODE_ENV=production`.
- `TYPEORM_SYNCHRONIZE_ALLOW_PRODUCTION=true` is required for an intentional one-off production sync.
- Local/dev may keep `TYPEORM_SYNCHRONIZE=true`.

Current synchronize ownership:

- `user` and `product` use `@app/database` MySQL (`DatabaseModule`).
- `orders` has its own MySQL `TypeOrmModule.forRoot`.
- `inventory`, `payments`, and `rewards` use `@app/database` PostgreSQL (`PostgresDatabaseModule`).
- `social`, `notification`, and `chat` use MySQL with `synchronize:false` and require SQL migrations for schema changes.

## Explicit SQL Migration Runner

Migration automation is manifest-driven:

- Manifest: `database/migrations.manifest.json`
- Runner: `scripts/migrate-database.mjs`
- Tracking table per database: `schema_migrations`

This runner is **incremental-only**. It is for reviewed deploy migrations on Aiven databases that already have their base schema. It cannot initialize an empty Aiven database.

Commands:

```bash
npm run db:migrate:dry-run
npm run db:migrate:dry-run -- --target=nodeA
npm run db:migrate:dry-run -- --target=nodeB
npm run db:migrate:status -- --target=nodeA
npm run db:migrate:status -- --target=nodeB
npm run db:migrate:nodeA
npm run db:migrate:nodeB
```

Production apply requires:

```bash
npm run db:migrate:nodeA -- --confirm-production
npm run db:migrate:nodeB -- --confirm-production
```

Dry-run does not connect to databases. Status/apply connect to the selected Aiven target and must only be run with explicit approval/credentials. Status creates `schema_migrations` if it is missing, so status mode is not fully read-only.

## Migration File Policy

Only conservative schema candidates are enabled in the manifest:

- Idempotent `CREATE TABLE IF NOT EXISTS`.
- Guarded additive ALTER scripts.
- No destructive/reset/demo/seed/cleanup files.
- No one-off ALTER/backfill/constraint-drop files without a schema-specific review.

`CREATE TABLE IF NOT EXISTS` does not validate an existing table's real shape. Before enabling historical create-table files, compare the live schema against the active TypeORM entities and service write paths.

Blocked categories are still listed in the manifest for visibility, but the runner refuses to execute them:

- `reset`
- `seed`
- `demo`
- `cleanup`
- `manual`

Never automate these deployment paths without explicit review:

- `database/order_module_ddl.sql`
- `database/products_module_ddl.sql`
- `database/products_typeorm_safe.sql`
- `database/inventory_migration.sql`
- `database/create_sample_users.sql`
- `database/seed.sql`
- `database/cleanup_broken_social_post_image_urls.sql`
- `database/create_cart_items_table.sql`
- `database/create_product_skus_table.sql`
- `database/create_shipping_history_table.sql`
- `database/add_social_notification_metadata.sql`
- app-local SQL files that drop columns/tables, seed data, or backfill live data.

## Practical Service Map

### Node A MySQL Entities

- Orders: `apps/orders/src/entity/*`
  - `orders`, `order_items`, `carts`, `cart_items`, `shipping_history`, `order_return_requests`, `vouchers`, `voucher_redemptions`
- User: `apps/user/src/entity/*`
  - `users`, `resources`, `roles`, `user_addresses`
- Product: `apps/product/src/entity/*`
  - `products`, `brands`, `categories`, `product_skus`, `product_reviews`
- Social: `apps/social/src/entities/*`
  - `posts`, `post_likes`, `post_reports`, `likes`, `comments`, `follows`
- Notification: `apps/notification/src/entities/notification.entity.ts`
  - `notifications`
- Chat: `apps/chat/src/entity/*`
  - `conversations`, `messages`

### Node B PostgreSQL Entities

- Inventory: `apps/inventory/src/*.entity.ts`
  - `inventory_v2`, `inventory_reservations`
- Payments: `apps/payments/src/entity/*`
  - `payments`, `payment_methods`
- Rewards: `apps/rewards/src/entity/reward_point.entity.ts`
  - `reward_points`

## ID Type Convention

- Default PK/FK type is `int`.
- High-volume transaction tables use `bigint` where already defined by entities, especially orders/order_items/payments paths.
- Cross-database references are logical only; do not add foreign keys across MySQL/PostgreSQL boundaries.

## Before Adding A Migration

1. Check the owning service and target database.
2. Prefer additive, idempotent SQL.
3. Add the SQL file without modifying existing data unless required.
4. Add a manifest entry with the correct target/dialect/category.
5. Keep destructive, seed, cleanup, and backfill files `manualOnly`.
6. Do not use the manifest as a fresh DB bootstrap plan; base schema must already exist.
7. Run dry-run and TypeScript validation.
