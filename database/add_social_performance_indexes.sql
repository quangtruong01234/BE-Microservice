-- PERF-05: add social read-path indexes.
-- Social runs with synchronize:false, so these indexes must be applied by SQL.

SET @schema_name = DATABASE();

SET @index_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'comments'
    AND INDEX_NAME = 'idx_comments_post_id_created_at'
);
SET @sql = IF(
  @index_exists = 0,
  'ALTER TABLE comments ADD INDEX idx_comments_post_id_created_at (post_id, created_at), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'posts'
    AND INDEX_NAME = 'idx_posts_visible_created_at'
);
SET @sql = IF(
  @index_exists = 0,
  'ALTER TABLE posts ADD INDEX idx_posts_visible_created_at (is_hidden, created_at), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'posts'
    AND INDEX_NAME = 'idx_posts_user_visible_created_at'
);
SET @sql = IF(
  @index_exists = 0,
  'ALTER TABLE posts ADD INDEX idx_posts_user_visible_created_at (user_id, is_hidden, created_at), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
