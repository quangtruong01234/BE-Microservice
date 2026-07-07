-- Add social-notification metadata for comment/reply deep links.
-- Notification service runs with synchronize:false, so apply this manually on existing DBs.

SET @schema_name = DATABASE();

ALTER TABLE notifications
  MODIFY COLUMN order_id BIGINT NULL;

SET @column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'notifications'
    AND COLUMN_NAME = 'post_id'
);
SET @sql = IF(
  @column_exists = 0,
  'ALTER TABLE notifications ADD COLUMN post_id INT NULL AFTER order_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'notifications'
    AND COLUMN_NAME = 'actor_id'
);
SET @sql = IF(
  @column_exists = 0,
  'ALTER TABLE notifications ADD COLUMN actor_id INT NULL AFTER post_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'notifications'
    AND COLUMN_NAME = 'preview'
);
SET @sql = IF(
  @column_exists = 0,
  'ALTER TABLE notifications ADD COLUMN preview VARCHAR(255) NULL AFTER actor_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
