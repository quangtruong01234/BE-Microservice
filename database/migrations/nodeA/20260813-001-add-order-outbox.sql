-- nodeA-20260813-001-add-order-outbox
-- RESIL-02. Transactional outbox for order domain events.
--
-- `order_created` was published AFTER the create transaction committed and
-- outside any transaction, so a broker outage silently dropped it: a COD order
-- existed while inventory, rewards and notification never heard about it. The
-- outbox row is now written inside the same transaction as the order, so the
-- two commit together; a background poller drains anything the immediate
-- publish could not deliver.
--
-- Additive + idempotent (guarded by INFORMATION_SCHEMA). Safe to re-run.
-- No backfill: this table only records events produced from now on. Orders
-- created during a past outage are not recoverable from here.

SET @schema := DATABASE();

SET @has_table := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'order_outbox'
);
SET @sql_table := IF(
  @has_table = 0,
  'CREATE TABLE `order_outbox` (
     `id` INT NOT NULL AUTO_INCREMENT,
     `event_name` VARCHAR(100) NOT NULL,
     `exchange` VARCHAR(100) NOT NULL,
     `order_id` INT NOT NULL,
     `payload` TEXT NOT NULL,
     `published_at` DATETIME NULL DEFAULT NULL,
     `attempts` INT NOT NULL DEFAULT 0,
     `last_error` VARCHAR(500) NULL DEFAULT NULL,
     `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
     PRIMARY KEY (`id`)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
  'SELECT 1'
);
PREPARE stmt_table FROM @sql_table;
EXECUTE stmt_table;
DEALLOCATE PREPARE stmt_table;

-- The poller reads `WHERE published_at IS NULL ORDER BY id` on every tick, so
-- the index keeps that scan off the published rows.
SET @has_index := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'order_outbox'
    AND INDEX_NAME = 'idx_order_outbox_pending'
);
SET @sql_index := IF(
  @has_index = 0,
  'CREATE INDEX `idx_order_outbox_pending` ON `order_outbox` (`published_at`, `id`)',
  'SELECT 1'
);
PREPARE stmt_index FROM @sql_index;
EXECUTE stmt_index;
DEALLOCATE PREPARE stmt_index;
