# Database

## Current architecture

TryBuy uses external managed databases on Aiven:

- **Node A MySQL**: orders, user, product, social, notification, and chat.
- **Node B PostgreSQL**: inventory, payments, and rewards.
- **Gateway**: no database provider.
- **Redis/RabbitMQ**: Docker services, outside SQL migration scope.

Node A services load `local/nodeA/.env`; Node B services load `local/nodeB/.env`.

## Production schema policy

Production must not rely on TypeORM schema synchronization.

- `libs/database/src/typeorm-synchronize.ts` defaults synchronization to `false` when `NODE_ENV=production`.
- Keep `TYPEORM_SYNCHRONIZE=false` and `TYPEORM_SYNCHRONIZE_ALLOW_PRODUCTION=false` in production.
- User and product use the shared MySQL `DatabaseModule`; orders owns a MySQL root connection.
- Inventory, payments, and rewards use the shared PostgreSQL `PostgresDatabaseModule`.
- Social, notification, and chat explicitly use `synchronize:false`.

## Baseline cutoff and migration flow

All schema history through 2026-07-17 is squashed into `database/prod-baseline-20260717/`:

- `nodeA-mysql-baseline.sql`
- `nodeB-postgresql-baseline.sql`
- `baseline-review.md`
- `SHA256SUMS`

The baseline files are the only supported bootstrap path for empty production databases. Historical root and app-local SQL files were removed after their final state was absorbed.

The deploy runner remains incremental-only:

- Manifest: `database/migrations.manifest.json`
- Runner: `scripts/migrate-database.mjs`
- Tracking table: `schema_migrations`

The manifest has no pending migrations at the cutoff. Its `baselines` metadata validates baseline hashes and identifies historical tracking rows as `baseline-absorbed`. Existing databases may retain those rows; they do not need to be deleted.

Future migrations belong under `database/migrations/nodeA/` or `database/migrations/nodeB/` and must be added to the manifest. Never edit the frozen baseline to deliver a later schema change.

Commands:

```bash
npm run db:migrate:dry-run
npm run db:migrate:dry-run -- --target=nodeA
npm run db:migrate:dry-run -- --target=nodeB
npm run db:migrate:status -- --target=nodeA
npm run db:migrate:status -- --target=nodeB
npm run db:migrate:nodeA -- --confirm-production
npm run db:migrate:nodeB -- --confirm-production
```

Dry-run does not connect. Status/apply connect to the selected Aiven database; status creates `schema_migrations` if absent.

## Migration file policy

Every post-cutoff migration must:

1. Target the owning service database.
2. Be additive and idempotent whenever possible.
3. Avoid seed, demo, reset, cleanup, destructive, and unreviewed backfill behavior.
4. Use one SQL file and one manifest entry with a stable ID.
5. Pass dry-run before apply.
6. Be applied with schema synchronization disabled.

Do not use the incremental runner to bootstrap an empty database. Import the matching reviewed baseline first.

## Practical service map

### Node A MySQL entities

- Orders: `apps/orders/src/entity/*`
  - `orders`, `order_items`, `carts`, `cart_items`, `shipping_history`, `order_return_requests`, `vouchers`, `voucher_redemptions`
- User: `apps/user/src/entity/*`
  - `users`, `resources`, `roles`, `user_addresses`
- Product: `apps/product/src/entity/*`
  - `products`, `brands`, `categories`, `product_skus`, `product_reviews`, `wishlist_items`, `product_risk_feedback`
- Social: `apps/social/src/entities/*`
  - `posts`, `post_likes`, `post_reports`, `likes`, `comments`, `follows`
- Notification: `notifications`
- Chat: `conversations`, `messages`

### Node B PostgreSQL entities

- Inventory: `inventory_v2`, `inventory_reservations`
- Payments: `payments`, `payment_methods`
- Rewards: `reward_points`

## ID convention

- Default PK/FK type is `int`.
- Preserve existing `bigint` transaction identifiers where declared by entities.
- Cross-database references are logical only; never add MySQL-to-PostgreSQL foreign keys.
