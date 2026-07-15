-- AI-02: advisory catalog risk scoring fields.
-- Product syncs in development, but production requires this guarded migration.

SET @schema_name = DATABASE();

SET @column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'products'
    AND COLUMN_NAME = 'image_phashes'
);
SET @sql = IF(
  @column_exists = 0,
  'ALTER TABLE products ADD COLUMN image_phashes JSON NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'products'
    AND COLUMN_NAME = 'risk_score'
);
SET @sql = IF(
  @column_exists = 0,
  'ALTER TABLE products ADD COLUMN risk_score INT NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'products'
    AND COLUMN_NAME = 'risk_flags'
);
SET @sql = IF(
  @column_exists = 0,
  'ALTER TABLE products ADD COLUMN risk_flags JSON NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'products'
    AND INDEX_NAME = 'idx_products_risk_score'
);
SET @sql = IF(
  @index_exists = 0,
  'ALTER TABLE products ADD INDEX idx_products_risk_score (risk_score), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
