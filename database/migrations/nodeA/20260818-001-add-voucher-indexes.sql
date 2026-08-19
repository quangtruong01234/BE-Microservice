-- nodeA-20260818-001-add-voucher-indexes
-- VOUCHER-CONC-01. The voucher tables shipped with nothing but their primary
-- keys, which left three real defects under concurrency:
--
--   1. `vouchers.code` had no index at all, so every checkout and every
--      `POST /api/order/voucher/validate` full-scanned the table, and the
--      duplicate-code check in `createVoucher` was a check-then-act race that
--      could seat two rows with the same code.
--   2. `voucher_redemptions` had no unique `(voucher_id, order_id)` even though
--      the entity documents that pair as the thing that makes recording a
--      redemption idempotent — the guarantee existed only in a comment.
--   3. The per-user limit counts `WHERE voucher_id = ? AND user_id = ?` on
--      every validate with no index to serve it.
--
-- Additive + idempotent (guarded by INFORMATION_SCHEMA). Safe to re-run.
--
-- The two UNIQUE indexes refuse to apply over pre-existing duplicates: rather
-- than silently skipping (which would leave the code trusting a constraint that
-- is not there), the migration aborts with an unknown-column error naming what
-- must be deduplicated first. Verified clean on dev 2026-08-18 (0 duplicate
-- codes, 0 duplicate voucher/order pairs).

SET @schema := DATABASE();

-- 1. vouchers.code — unique lookup key
SET @dup_codes := (
  SELECT COUNT(*) FROM (
    SELECT `code` FROM `vouchers` GROUP BY `code` HAVING COUNT(*) > 1
  ) AS duplicates
);
SET @has_code_index := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'vouchers'
    AND INDEX_NAME = 'uq_vouchers_code'
);
SET @sql_code_index := IF(
  @has_code_index > 0,
  'SELECT 1',
  IF(
    @dup_codes = 0,
    'CREATE UNIQUE INDEX `uq_vouchers_code` ON `vouchers` (`code`)',
    'SELECT dedupe_vouchers_code_before_applying_this_migration FROM `vouchers`'
  )
);
PREPARE stmt_code_index FROM @sql_code_index;
EXECUTE stmt_code_index;
DEALLOCATE PREPARE stmt_code_index;

-- 2. voucher_redemptions (voucher_id, order_id) — one redemption row per order
SET @dup_pairs := (
  SELECT COUNT(*) FROM (
    SELECT `voucher_id`, `order_id` FROM `voucher_redemptions`
    GROUP BY `voucher_id`, `order_id` HAVING COUNT(*) > 1
  ) AS duplicates
);
SET @has_pair_index := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'voucher_redemptions'
    AND INDEX_NAME = 'uq_voucher_redemptions_voucher_order'
);
SET @sql_pair_index := IF(
  @has_pair_index > 0,
  'SELECT 1',
  IF(
    @dup_pairs = 0,
    'CREATE UNIQUE INDEX `uq_voucher_redemptions_voucher_order`
       ON `voucher_redemptions` (`voucher_id`, `order_id`)',
    'SELECT dedupe_voucher_redemptions_voucher_order_before_applying_this_migration FROM `voucher_redemptions`'
  )
);
PREPARE stmt_pair_index FROM @sql_pair_index;
EXECUTE stmt_pair_index;
DEALLOCATE PREPARE stmt_pair_index;

-- 3. voucher_redemptions (voucher_id, user_id) — backs the per-user-limit count.
-- Non-unique on purpose: `per_user_limit` is a configurable int, not always 1.
SET @has_user_index := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'voucher_redemptions'
    AND INDEX_NAME = 'idx_voucher_redemptions_voucher_user'
);
SET @sql_user_index := IF(
  @has_user_index = 0,
  'CREATE INDEX `idx_voucher_redemptions_voucher_user`
     ON `voucher_redemptions` (`voucher_id`, `user_id`)',
  'SELECT 1'
);
PREPARE stmt_user_index FROM @sql_user_index;
EXECUTE stmt_user_index;
DEALLOCATE PREPARE stmt_user_index;
