-- nodeA-20260802-001-add-version-to-products
-- Adds the optimistic-concurrency token used by the product entity's
-- @VersionColumn so a stale edit can be rejected with 409 instead of silently
-- overwriting a newer save.
-- Additive + idempotent (guarded by INFORMATION_SCHEMA). Safe to re-run.
-- MUST run BEFORE deploying the code: product runs synchronize:false in
-- production, so every product save would fail on the missing column.

SET @schema := DATABASE();

-- products.version INT NOT NULL DEFAULT 1
SET @has_version := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'products'
    AND COLUMN_NAME = 'version'
);
SET @sql_version := IF(
  @has_version = 0,
  'ALTER TABLE `products` ADD COLUMN `version` INT NOT NULL DEFAULT 1',
  'SELECT 1'
);
PREPARE stmt_version FROM @sql_version;
EXECUTE stmt_version;
DEALLOCATE PREPARE stmt_version;
