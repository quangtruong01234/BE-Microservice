# TryBuy production database baseline review

## Release identity

- Generated: 2026-07-17 (Asia/Saigon)
- Source revision: `c5ce8d72fd8b`
- Source state at generation: dirty working tree; the baseline includes the then-current entity schema.
- Node A file: `nodeA-mysql-baseline.sql` for Aiven MySQL 8.
- Node B file: `nodeB-postgresql-baseline.sql` for Aiven PostgreSQL.

This package is for two empty production databases. It was not connected to or applied against either Aiven service during generation.

## Squash boundary

All schema and migration work through 2026-07-17 is absorbed by this package. All 74 historical standalone SQL files were removed after the baseline was created, including unused local Docker database initializers.

The manifest starts a new incremental history after this cutoff:

| Target              | Absorbed tracking IDs | Post-cutoff migrations |
| ------------------- | --------------------: | ---------------------: |
| Node A / MySQL      |                    18 |                      0 |
| Node B / PostgreSQL |                     3 |                      0 |

The baseline SQL preserves the absorbed rows in `schema_migrations`. The runner classifies them as `baseline-absorbed` through manifest baseline metadata; it does not need the retired SQL files.

## Baseline contents

| Target              | Application tables | Tracking rows | Required reference data  |
| ------------------- | -----------------: | ------------: | ------------------------ |
| Node A / MySQL      |                 29 |            18 | 10 resources and 5 roles |
| Node B / PostgreSQL |                  5 |             3 | 3 payment methods        |

No users, credentials, products, orders, inventory quantities, payments, rewards, demo records, or business transactions are seeded. The extra `schema_migrations` table makes the expected physical totals 30 tables on Node A and 6 on Node B.

## Import gate

Before import:

1. Verify the target database is empty.
2. Verify the engine assignment; never cross-import Node A and Node B files.
3. Set `NODE_ENV=production`, `TYPEORM_SYNCHRONIZE=false`, and `TYPEORM_SYNCHRONIZE_ALLOW_PRODUCTION=false`.
4. Verify all package hashes against `SHA256SUMS`.
5. Do not start application services until both imports and post-import checks pass.

Import each SQL file with the Aiven console importer or the matching TLS-enabled database client.

Post-import checks:

```sql
-- Node A / MySQL
SELECT COUNT(*) AS table_count
FROM information_schema.tables
WHERE table_schema = DATABASE();
-- Expected: 30

SELECT COUNT(*) AS migration_count FROM schema_migrations;
-- Expected: 18

SELECT COUNT(*) AS resource_count FROM resources;
-- Expected: 10

SELECT COUNT(*) AS role_count FROM roles;
-- Expected: 5
```

```sql
-- Node B / PostgreSQL
SELECT COUNT(*) AS table_count
FROM pg_catalog.pg_tables
WHERE schemaname = 'public';
-- Expected: 6

SELECT COUNT(*) AS migration_count FROM schema_migrations;
-- Expected: 3

SELECT COUNT(*) AS payment_method_count FROM payment_methods;
-- Expected: 3
```

After these checks, `npm run db:migrate:dry-run` should show both baselines and zero runnable post-cutoff migrations. Status should classify the 18/3 tracking rows as `baseline-absorbed`.

## Review notes

- Node A DDL is not fully atomic because MySQL DDL causes implicit commits. On partial failure, recreate the empty database and import again.
- Node B DDL is wrapped in a PostgreSQL transaction.
- The schema follows entities registered by active NestJS modules. Stale duplicate chat entities under `apps/social/src/entity/` are excluded.
- `product_reviews.product_id` remains `INT` while `products.id` is `BIGINT`; this known entity inconsistency is preserved without a foreign key.
- Public ID columns and unique indexes are included. New records receive public IDs through application create paths.
- `roles.rol_grants` starts as an empty JSON array because runtime authorization is defined in `apps/user/src/rbac/grants.ts`.
- Creating the first production admin is a separate credential-controlled operation.
- Never modify this baseline for future changes. Add a new incremental migration instead.
