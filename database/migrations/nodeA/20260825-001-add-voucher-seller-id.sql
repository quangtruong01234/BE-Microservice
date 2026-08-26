-- nodeA-20260825-001-add-voucher-seller-id
-- VOUCHER-SHOP-01 phase 1. Vouchers shipped platform-wide: the table has no
-- owner column at all, so a shop cannot issue a code of its own and every
-- discount is priced against the whole goods subtotal.
--
-- `seller_id` NULL keeps the existing rows exactly as they behave today
-- (platform voucher, whole-basket subtotal); a set value scopes the voucher to
-- that shop and prices it against that seller's slice of the basket only.
--
-- The index backs the basket voucher list (`order.voucher_available`), which
-- asks for "platform vouchers + the vouchers of the sellers in this cart" on
-- every checkout page view — i.e. `WHERE is_active = 1 AND (seller_id IS NULL
-- OR seller_id IN (...))`.
--
-- INT, not BIGINT, to match `users.id`. No FK: `users` lives in the same MySQL
-- schema today, but the orders service owns this table and resolves sellers
-- over TCP, so a hard FK would couple two services' migrations together.
--
-- Additive + idempotent (guarded by INFORMATION_SCHEMA). Safe to re-run.

SET @schema := DATABASE();

-- 1. vouchers.seller_id — owning shop, NULL = platform voucher
SET @has_seller_column := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'vouchers'
    AND COLUMN_NAME = 'seller_id'
);
SET @sql_seller_column := IF(
  @has_seller_column = 0,
  'ALTER TABLE `vouchers` ADD COLUMN `seller_id` INT NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE stmt_seller_column FROM @sql_seller_column;
EXECUTE stmt_seller_column;
DEALLOCATE PREPARE stmt_seller_column;

-- 2. (seller_id, is_active) — serves the basket voucher list
SET @has_seller_index := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'vouchers'
    AND INDEX_NAME = 'idx_vouchers_seller_active'
);
SET @sql_seller_index := IF(
  @has_seller_index = 0,
  'CREATE INDEX `idx_vouchers_seller_active` ON `vouchers` (`seller_id`, `is_active`)',
  'SELECT 1'
);
PREPARE stmt_seller_index FROM @sql_seller_index;
EXECUTE stmt_seller_index;
DEALLOCATE PREPARE stmt_seller_index;
