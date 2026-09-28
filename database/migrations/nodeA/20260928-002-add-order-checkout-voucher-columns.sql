-- nodeA-20260928-002-add-order-checkout-voucher-columns
-- VOUCHER-SHOP-01 phase 2 (voucher stacking across a multi-shop checkout).
--   orders.checkout_id           — one UUID shared by the sub-orders of ONE
--                                  multi-shop checkout. A platform voucher is
--                                  redeemed once per checkout, so its single
--                                  redemption row has to find the checkout's
--                                  other sub-orders when one of them is canceled.
--   orders.platform_voucher_code — the platform code when it is stacked on a
--                                  shop voucher on the same order (voucher_code
--                                  then holds the shop code).
-- Both NULL for every existing row, which is exactly what they mean for a
-- phase-1 order: single-seller, at most one code. Not backfilled.
-- Additive + idempotent (guarded by INFORMATION_SCHEMA). Safe to re-run.

SET @schema := DATABASE();

SET @has_checkout_id := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'checkout_id'
);
SET @sql_checkout_id := IF(
  @has_checkout_id = 0,
  'ALTER TABLE `orders` ADD COLUMN `checkout_id` VARCHAR(36) NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE stmt_checkout_id FROM @sql_checkout_id;
EXECUTE stmt_checkout_id;
DEALLOCATE PREPARE stmt_checkout_id;

-- Serves the sibling lookup on cancel. NULL-heavy by design (single-seller
-- orders), which a B-tree index stores cheaply.
SET @has_checkout_idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'orders'
    AND INDEX_NAME = 'idx_orders_checkout_id'
);
SET @sql_checkout_idx := IF(
  @has_checkout_idx = 0,
  'CREATE INDEX `idx_orders_checkout_id` ON `orders` (`checkout_id`)',
  'SELECT 1'
);
PREPARE stmt_checkout_idx FROM @sql_checkout_idx;
EXECUTE stmt_checkout_idx;
DEALLOCATE PREPARE stmt_checkout_idx;

SET @has_platform_code := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'platform_voucher_code'
);
SET @sql_platform_code := IF(
  @has_platform_code = 0,
  'ALTER TABLE `orders` ADD COLUMN `platform_voucher_code` VARCHAR(64) NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE stmt_platform_code FROM @sql_platform_code;
EXECUTE stmt_platform_code;
DEALLOCATE PREPARE stmt_platform_code;
