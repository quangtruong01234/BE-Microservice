# /migrate — Database Migration Command

Use this command to create, verify, and apply a schema migration under the
post-cutoff policy (baseline frozen at `database/prod-baseline-20260717/`).

## How to invoke

```
/migrate <short description of the schema change>   # create + register + dry-run
/migrate status                                     # ledger status for both nodes
/migrate apply nodeA|nodeB                          # apply pending migrations to a target
```

## Ground rules (non-negotiable)

- **Never edit or replay `database/prod-baseline-20260717/`** — it is frozen.
  All new schema work is an incremental migration file + manifest entry.
- **Prod forces `synchronize:false` for ALL services.** Dev may auto-sync a
  column into existence, but prod will NOT — every schema change the code
  depends on MUST be applied on prod via the manifest runner BEFORE deploying
  that code. Additive/widening changes are safe to run early (old code
  tolerates them → zero downtime).
- Migrations must be **idempotent** — guard with `INFORMATION_SCHEMA` checks
  (MySQL) or `IF NOT EXISTS` / catalog checks (PostgreSQL) so a re-run is a
  no-op, and prefer non-locking DDL (`ALGORITHM=INPLACE, LOCK=NONE` on MySQL,
  `CREATE INDEX CONCURRENTLY` on PostgreSQL) where the dialect allows.
- Target routing: Node A = MySQL (orders, user, product, social, notification,
  chat); Node B = PostgreSQL (inventory, payments, rewards).

## Mode: create (default)

1. **Locate the entity + owning service** for the table being changed (check
   `apps/*/src/entity/`; load `ai-docs/agent-context/database.md` for column
   conventions — int/bigint, snake_case columns with camelCase properties).
2. **Write the SQL file** at
   `database/migrations/nodeA|nodeB/<YYYYMMDD>-<NNN>-<kebab-name>.sql`
   (NNN = next sequence number for that date; look at existing files).
   Idempotent + guarded, comment at the top saying what it does and why.
3. **Register it** in `database/migrations.manifest.json` under `migrations`:

   ```json
   {
     "id": "nodeA-<YYYYMMDD>-<NNN>-<kebab-name>",
     "target": "nodeA",
     "dialect": "mysql",
     "file": "database/migrations/nodeA/<YYYYMMDD>-<NNN>-<kebab-name>.sql",
     "category": "schema",
     "destructive": false,
     "manualOnly": false,
     "enabled": true
   }
   ```

   The `id` is a stable ledger key (written to `schema_migrations`) — never
   rename it after it has been applied anywhere.
4. **Verify**: `npm run db:migrate:dry-run` then `npm run db:migrate:status`.
5. **Update the entity** to match (if the code change is part of the task) and
   run `tsc --noEmit`.
6. **Record**: add an applied-migration note to
   `ai-docs/agent-context/ops-runtime.md` (Database migrations section) saying
   what it changes, whether prod still owes it, and any runtime effect (e.g.
   TypeORM maps `bigint` to a JS **string**). If prod has not run it yet, also
   add an "owed on PROD before next deploy" line to `snapshot.md` Active Tasks.

## Mode: status / apply

- `npm run db:migrate:status` — shows applied vs pending per target (note: a
  dev auto-synced column can show `[pending]` on dev while prod needs the real
  run — the ledger is per-database).
- `npm run db:migrate:nodeA` / `npm run db:migrate:nodeB` — applies pending
  enabled migrations to that target's configured database. For PROD, this runs
  on the EC2 box (see `ops-runtime.md` → CI/CD: deploy.yml runs both targets
  BEFORE `pm2 restart`).
- `destructive: true` or `manualOnly: true` entries are never auto-applied —
  surface them to the user instead of forcing.

## Checklist before marking done

- [ ] SQL file is idempotent (safe to re-run) and guarded
- [ ] Manifest entry added, `db:migrate:dry-run` green
- [ ] Entity matches the new schema; `tsc --noEmit` zero errors
- [ ] `ops-runtime.md` ledger note written; prod-owed flag in `snapshot.md` if applicable
- [ ] If the change is NOT additive (rename/drop/narrow): stop and confirm with
      the user — old deployed code must tolerate the schema during rollout
