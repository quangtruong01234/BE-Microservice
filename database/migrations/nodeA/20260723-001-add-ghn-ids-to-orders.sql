-- nodeA-20260723-001-add-ghn-ids-to-orders
-- Adds GHN numeric location ids captured at checkout so the waybill is created
-- from an exact district/ward instead of best-effort free-text resolution.
-- Additive + idempotent (guarded by INFORMATION_SCHEMA). Safe to re-run.

SET @schema := DATABASE();

-- orders.to_district_id INT NULL
SET @has_to_district_id := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'to_district_id'
);
SET @sql_to_district_id := IF(
  @has_to_district_id = 0,
  'ALTER TABLE `orders` ADD COLUMN `to_district_id` INT NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE stmt_to_district_id FROM @sql_to_district_id;
EXECUTE stmt_to_district_id;
DEALLOCATE PREPARE stmt_to_district_id;

-- orders.to_ward_code VARCHAR(20) NULL
SET @has_to_ward_code := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'to_ward_code'
);
SET @sql_to_ward_code := IF(
  @has_to_ward_code = 0,
  'ALTER TABLE `orders` ADD COLUMN `to_ward_code` VARCHAR(20) NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE stmt_to_ward_code FROM @sql_to_ward_code;
EXECUTE stmt_to_ward_code;
DEALLOCATE PREPARE stmt_to_ward_code;
