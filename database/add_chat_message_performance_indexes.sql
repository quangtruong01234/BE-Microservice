-- PERF-06: add chat message read-path indexes.
-- Chat runs with synchronize:false, so this index must be applied by SQL.

SET @schema_name = DATABASE();

SET @index_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'messages'
    AND INDEX_NAME = 'idx_messages_conversation_created_at'
);
SET @sql = IF(
  @index_exists = 0,
  'ALTER TABLE messages ADD INDEX idx_messages_conversation_created_at (conversation_id, created_at), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
