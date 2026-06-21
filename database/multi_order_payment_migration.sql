-- Migration: support one payment record covering multiple order IDs
-- PostgreSQL (payments service)
--
-- 1. Drop UNIQUE constraint on order_id (app_trans_id is now the idempotency key)
-- 2. Make order_id nullable (multi-order payments have no single order_id)
-- 3. Add order_ids JSONB column for multi-order payments

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_order_id_key,
  ALTER COLUMN order_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS order_ids JSONB NULL;
