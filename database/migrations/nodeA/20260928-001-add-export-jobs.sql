-- nodeA-20260928-001-add-export-jobs
-- EXPORT-CSV-01 T5. Async order-export jobs.
--
-- The sync export (`GET /api/order/seller/export`, `/admin/export`) is capped at
-- 90 days / 5.000 item rows because the file is built inside one HTTP request.
-- A job row lets a wider window (366 days / 50.000 rows) be rendered by a
-- background worker in the orders service, polled, then downloaded. The CSV is
-- kept IN the row (MEDIUMBLOB, 16 MB ceiling) for 24h and then NULLed by the
-- expiry cron, so there is no external storage to provision.
--
-- Additive + idempotent (guarded by INFORMATION_SCHEMA). Safe to re-run.
-- No backfill: the table only records jobs requested from now on.

SET @schema := DATABASE();

SET @has_table := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'export_jobs'
);
SET @sql_table := IF(
  @has_table = 0,
  'CREATE TABLE `export_jobs` (
     `id` INT NOT NULL AUTO_INCREMENT,
     `public_id` VARCHAR(32) NOT NULL,
     `requested_by` INT NOT NULL,
     `scope` VARCHAR(10) NOT NULL,
     `seller_id` INT NULL DEFAULT NULL,
     `range_from` VARCHAR(40) NOT NULL,
     `range_to` VARCHAR(40) NOT NULL,
     `status_filter` VARCHAR(30) NULL DEFAULT NULL,
     `state` VARCHAR(10) NOT NULL DEFAULT ''pending'',
     `row_count` INT NULL DEFAULT NULL,
     `file_name` VARCHAR(120) NULL DEFAULT NULL,
     `file_size` INT NULL DEFAULT NULL,
     `file` MEDIUMBLOB NULL DEFAULT NULL,
     `error_message` VARCHAR(500) NULL DEFAULT NULL,
     `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
     `started_at` DATETIME NULL DEFAULT NULL,
     `finished_at` DATETIME NULL DEFAULT NULL,
     `expires_at` DATETIME NULL DEFAULT NULL,
     PRIMARY KEY (`id`),
     UNIQUE KEY `uq_export_jobs_public_id` (`public_id`)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
  'SELECT 1'
);
PREPARE stmt_table FROM @sql_table;
EXECUTE stmt_table;
DEALLOCATE PREPARE stmt_table;

-- The worker reads `WHERE state = 'pending' ORDER BY id` on every tick, and the
-- expiry / stale sweeps filter on state too.
SET @has_state_index := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'export_jobs'
    AND INDEX_NAME = 'idx_export_jobs_state'
);
SET @sql_state_index := IF(
  @has_state_index = 0,
  'CREATE INDEX `idx_export_jobs_state` ON `export_jobs` (`state`, `id`)',
  'SELECT 1'
);
PREPARE stmt_state_index FROM @sql_state_index;
EXECUTE stmt_state_index;
DEALLOCATE PREPARE stmt_state_index;

-- "My jobs" list + the per-user active-job cap.
SET @has_owner_index := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'export_jobs'
    AND INDEX_NAME = 'idx_export_jobs_requested_by'
);
SET @sql_owner_index := IF(
  @has_owner_index = 0,
  'CREATE INDEX `idx_export_jobs_requested_by` ON `export_jobs` (`requested_by`, `id`)',
  'SELECT 1'
);
PREPARE stmt_owner_index FROM @sql_owner_index;
EXECUTE stmt_owner_index;
DEALLOCATE PREPARE stmt_owner_index;
