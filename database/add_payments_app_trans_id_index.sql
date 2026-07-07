-- PERF-06: speed payment callback lookup by gateway transaction id.
-- Keep this file to one CONCURRENTLY statement; PostgreSQL rejects CREATE INDEX
-- CONCURRENTLY inside multi-statement implicit transactions.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_app_trans_id
  ON payments (app_trans_id)
  WHERE app_trans_id IS NOT NULL;
