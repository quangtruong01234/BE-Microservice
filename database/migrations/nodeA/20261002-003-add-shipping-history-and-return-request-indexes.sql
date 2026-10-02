-- nodeA-20261002-003-add-shipping-history-and-return-request-indexes
-- SWEEP-1002-02. Both tables had no secondary index besides their PK
-- (and order_return_requests.public_id), yet every read filters by order:
--   shipping_history (order_id, created_at)
--     — GHN-FAIL-NTF-01 delivery_fail dedupe on each webhook, the buyer
--       timeline (ORDER-TIMELINE-01), the admin GHN history and
--       findLatestShippingHistory per admin GHN list row / CSV-export chunk.
--       created_at is the sort key of every one of those reads.
--   order_return_requests (order_id) — requestReturn's existing-request check.
--   order_return_requests (user_id)  — the buyer's "my return requests" list.
-- Additive + idempotent (guarded by INFORMATION_SCHEMA.STATISTICS), online DDL
-- (ALGORITHM=INPLACE, LOCK=NONE). Safe to re-run.

SET @schema := DATABASE();

SET @has_sh_order_idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'shipping_history'
    AND INDEX_NAME = 'idx_shipping_history_order'
);
SET @sql_sh_order_idx := IF(
  @has_sh_order_idx = 0,
  'ALTER TABLE `shipping_history` ADD INDEX `idx_shipping_history_order` (`order_id`, `created_at`), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT 1'
);
PREPARE stmt_sh_order_idx FROM @sql_sh_order_idx;
EXECUTE stmt_sh_order_idx;
DEALLOCATE PREPARE stmt_sh_order_idx;

SET @has_orr_order_idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'order_return_requests'
    AND INDEX_NAME = 'idx_order_return_requests_order'
);
SET @sql_orr_order_idx := IF(
  @has_orr_order_idx = 0,
  'ALTER TABLE `order_return_requests` ADD INDEX `idx_order_return_requests_order` (`order_id`), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT 1'
);
PREPARE stmt_orr_order_idx FROM @sql_orr_order_idx;
EXECUTE stmt_orr_order_idx;
DEALLOCATE PREPARE stmt_orr_order_idx;

SET @has_orr_user_idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'order_return_requests'
    AND INDEX_NAME = 'idx_order_return_requests_user'
);
SET @sql_orr_user_idx := IF(
  @has_orr_user_idx = 0,
  'ALTER TABLE `order_return_requests` ADD INDEX `idx_order_return_requests_user` (`user_id`), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT 1'
);
PREPARE stmt_orr_user_idx FROM @sql_orr_user_idx;
EXECUTE stmt_orr_user_idx;
DEALLOCATE PREPARE stmt_orr_user_idx;
