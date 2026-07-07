-- PERF-06: speed single-order payment lookups.
-- Keep this file to one CONCURRENTLY statement; PostgreSQL rejects CREATE INDEX
-- CONCURRENTLY inside multi-statement implicit transactions.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_order_id
  ON payments (order_id)
  WHERE order_id IS NOT NULL;
