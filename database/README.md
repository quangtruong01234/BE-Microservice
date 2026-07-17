# TryBuy database flow

TryBuy uses two external Aiven databases:

- Node A: MySQL for orders, user, product, social, notification, and chat.
- Node B: PostgreSQL for inventory, payments, and rewards.

Production schema synchronization must remain disabled.

## Release cutoff

Migration history through 2026-07-17 was squashed into:

- `prod-baseline-20260717/nodeA-mysql-baseline.sql`
- `prod-baseline-20260717/nodeB-postgresql-baseline.sql`

Use these files only for empty databases. Read `prod-baseline-20260717/baseline-review.md` and verify `SHA256SUMS` before import.

Historical root and app-local SQL files were removed after their final schema was absorbed by the baseline. The manifest retains only baseline metadata and migration IDs needed to classify existing `schema_migrations` rows as `baseline-absorbed`.

## Incremental migrations after the cutoff

`migrations.manifest.json` starts with an empty `migrations` array at the cutoff. Every later production schema change must:

1. Add one additive, idempotent SQL file under `database/migrations/nodeA/` or `database/migrations/nodeB/`.
2. Add one enabled `schema` entry to `migrations.manifest.json` with the correct target and dialect.
3. Run `npm run db:migrate:dry-run` and review the checksum.
4. Apply only after the target database has the 2026-07-17 baseline or an equivalent schema.

Do not add reset, demo, cleanup, destructive, or seed scripts to the deploy manifest. Put operational one-offs outside the automated migration flow and require an explicit schema-specific review.

## Runner commands

```bash
npm run db:migrate:dry-run
npm run db:migrate:dry-run -- --target=nodeA
npm run db:migrate:dry-run -- --target=nodeB
npm run db:migrate:status -- --target=nodeA
npm run db:migrate:status -- --target=nodeB
npm run db:migrate:nodeA -- --confirm-production
npm run db:migrate:nodeB -- --confirm-production
```

Dry-run does not connect. Status and apply connect to Aiven; status creates `schema_migrations` if absent. The runner never bootstraps an empty database and never applies baseline files.

Existing databases may contain tracking rows for migrations absorbed by the cutoff. Status reports them as `baseline-absorbed`; unknown rows remain `orphaned`.
