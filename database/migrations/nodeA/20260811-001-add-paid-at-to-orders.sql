-- nodeA-20260811-001-add-paid-at-to-orders
-- ORD-GUARD-01. Records WHEN an order's money was actually collected, so the
-- seller-facing transitions can refuse to move an unpaid online order (and so
-- the FE can hide "THANH TOÁN NGAY" / the confirm button without guessing).
-- Additive + idempotent (guarded by INFORMATION_SCHEMA). Safe to re-run.

SET @schema := DATABASE();

-- orders.paid_at DATETIME NULL — NULL means "not collected yet". For COD that
-- is the normal state until delivery; for vnpay/zalopay it means unpaid.
SET @has_paid_at := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'paid_at'
);
SET @sql_paid_at := IF(
  @has_paid_at = 0,
  'ALTER TABLE `orders` ADD COLUMN `paid_at` DATETIME NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE stmt_paid_at FROM @sql_paid_at;
EXECUTE stmt_paid_at;
DEALLOCATE PREPARE stmt_paid_at;

-- Backfill, so the new FE-facing field is not a lie about order history.
-- An online payment auto-advances the order past CONFIRMED (payments emits
-- payment_completed → orders claims the row into PROCESSING), so any non-COD
-- order at PROCESSING or beyond was paid; `updated_at` is the closest recorded
-- timestamp for it. Orders still at pending/confirmed are left NULL — those are
-- exactly the unpaid ones this migration exists to catch. Runs only on rows
-- that are still NULL, so re-running never rewrites a real payment timestamp.
-- Known imprecision: a row a seller had already walked forward by hand before
-- this guard existed is indistinguishable from a genuinely paid one at this
-- point, so it is treated as paid. That is deliberate — the alternative strands
-- real paid orders mid-fulfilment, which is the worse failure.
UPDATE `orders`
SET `paid_at` = `updated_at`
WHERE `paid_at` IS NULL
  AND `payment_method` <> 'cod'
  AND `status` IN ('processing', 'shipped', 'delivering', 'completed');

-- COD money is collected on delivery, so only a delivered/completed COD order
-- has been paid. Canceled/refunded rows stay NULL on purpose.
UPDATE `orders`
SET `paid_at` = `updated_at`
WHERE `paid_at` IS NULL
  AND `payment_method` = 'cod'
  AND `status` = 'completed';
