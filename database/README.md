# TryBuy Database Migrations

TryBuy uses external managed databases on Aiven:

- Node A: MySQL, used by gateway-adjacent services on `local/nodeA/.env`
- Node B: PostgreSQL, used by inventory, payments, and rewards on `local/nodeB/.env`
- Redis and RabbitMQ are Docker services and are not managed by this migration runner.

The gateway has no database provider.

This runner is **incremental-only**. It is for reviewed deploy migrations on a database that already has the required base schema. It cannot initialize an empty Aiven database.

## Files

- `database/migrations.manifest.json` is the only deploy automation manifest.
- `scripts/migrate-database.mjs` is the manifest runner.
- Existing SQL files are not moved or rewritten. The manifest points to them.
- `schema_migrations` is created automatically in each target database when status/apply connects.

Because status creates `schema_migrations` if it is missing, status mode is not fully read-only. Use dry-run for a no-connection safety check.

## Commands

Dry-run does not connect to a database. It validates the manifest, checks files, computes checksums, and shows which entries are runnable or blocked.

```bash
npm run db:migrate:dry-run
npm run db:migrate:dry-run -- --target=nodeA
npm run db:migrate:dry-run -- --target=nodeB
```

Status connects to the selected database target, creates `schema_migrations` if missing, and compares applied checksums to the manifest.

```bash
npm run db:migrate:status -- --target=nodeA
npm run db:migrate:status -- --target=nodeB
```

Apply connects and runs only enabled, non-destructive, non-manual schema entries that have not been recorded in `schema_migrations`.

```bash
npm run db:migrate:nodeA
npm run db:migrate:nodeB
```

In production, apply refuses to run unless the command is explicit:

```bash
npm run db:migrate:nodeA -- --confirm-production
npm run db:migrate:nodeB -- --confirm-production
```

Always run dry-run first and review the candidate list before applying anything to Aiven.

## Incremental-Only Contract

The enabled manifest entries are not a complete base schema. Before applying these migrations, the target database must already have the service-owned base tables created by the historical setup path or a reviewed manual baseline.

An empty Aiven database will not be usable after running this manifest because required base tables such as `products`, `orders`, `users`, `posts`, `inventory_v2`, `payments`, and `reward_points` are intentionally not bootstrapped here.

`CREATE TABLE IF NOT EXISTS` only checks whether a table name exists. It does not validate that the existing table shape, indexes, constraints, enum values, or column types match the active entities. Review the schema before enabling old create-table files on Aiven.

## Enabled Automated Entries

The manifest enables only conservative schema candidates:

- Idempotent `CREATE TABLE IF NOT EXISTS` files.
- Guarded additive ALTER files.
- No seed/demo/reset/cleanup entries.
- No one-off ALTER/backfill files that can fail when replayed against an existing schema without historical migration records.

Enabled Node A entries currently cover carts, product reviews, post reports, user addresses, and notifications.

Enabled Node B entries currently cover inventory reservations.

## Intentionally Excluded From Automation

These categories are present in the manifest for visibility but are refused by the runner:

- `reset`: files with `DROP TABLE`, `DROP DATABASE`, or rebuild behavior.
- `seed`: demo/default data inserts, including payment methods and role/user seeds.
- `demo`: demo-only data or behavior.
- `cleanup`: data cleanup scripts that need explicit operator approval.
- `manual`: one-off ALTER, enum rewrite, backfill, constraint drop, type change, or migration-chain files that need a schema-specific review.

Examples of excluded files:

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
- `apps/product/src/migrations/add_product_categories.sql`
- `apps/social/src/migrations/create_social_tables.sql`
- `apps/payments/src/migrations/create_payment_methods_table.sql`

## Aiven Safety Notes

- Do not run reset or seed scripts against Aiven as part of deployment.
- Do not use TypeORM `synchronize:true` as a production migration strategy.
- Do not point this runner at a new empty Aiven database and expect it to bootstrap the project.
- Base schema must already exist before automated deploy migrations are applied.
- For an existing Aiven database that already has historical SQL applied, do not blindly enable old migration files. First compare schema, then either leave them manual-only or intentionally baseline `schema_migrations`.
- This runner does not print hostnames, usernames, passwords, URLs, or raw connection strings.
- SSL defaults to `auto`: enabled for `*.aivencloud.com`, disabled for local hosts. Override with `MYSQL_SSL`, `PG_SSL`, `MYSQL_SSL_REJECT_UNAUTHORIZED`, and `PG_SSL_REJECT_UNAUTHORIZED` when needed.
