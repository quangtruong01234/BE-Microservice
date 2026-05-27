-- Add UNIQUE constraint on payments.order_id to prevent duplicate payment records
-- Uses CREATE UNIQUE INDEX with IF NOT EXISTS (PostgreSQL 9.5+)
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_order_id ON payments(order_id);
