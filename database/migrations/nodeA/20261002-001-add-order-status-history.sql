-- nodeA-20261002-001-add-order-status-history
-- ORDER-TIMELINE-01. The buyer order timeline (`GET /api/order/:id/history`)
-- needs WHEN each local status change happened. `orders` only keeps
-- created_at / paid_at / updated_at, and `shipping_history` records GHN events
-- only (and feeds lastGhnStatus / the GHN-FAIL-NTF-01 dedupe, so local
-- transitions must NOT be written there). One row per committed transition.
--
-- Additive + idempotent (guarded by INFORMATION_SCHEMA). Safe to re-run.
-- No backfill: past transitions were never recorded, so older orders show only
-- the placed / paid / GHN events the timeline can rebuild from other columns.

SET @schema := DATABASE();

SET @has_table := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'order_status_history'
);
SET @sql_table := IF(
  @has_table = 0,
  'CREATE TABLE `order_status_history` (
     `id` BIGINT NOT NULL AUTO_INCREMENT,
     `order_id` INT NOT NULL,
     `from_status` VARCHAR(30) NULL DEFAULT NULL,
     `to_status` VARCHAR(30) NOT NULL,
     `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
     PRIMARY KEY (`id`),
     KEY `idx_order_status_history_order` (`order_id`, `created_at`)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
  'SELECT 1'
);
PREPARE stmt_table FROM @sql_table;
EXECUTE stmt_table;
DEALLOCATE PREPARE stmt_table;
