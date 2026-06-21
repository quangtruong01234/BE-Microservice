-- Phase 0: Seller order management schema changes
-- 1. Add 'confirmed' status between 'pending' and 'processing'
ALTER TABLE orders
  MODIFY COLUMN status ENUM(
    'pending',
    'confirmed',
    'processing',
    'shipped',
    'delivering',
    'completed',
    'canceled'
  ) NOT NULL DEFAULT 'pending';
