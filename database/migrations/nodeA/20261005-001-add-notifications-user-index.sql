-- nodeA-20261005-001-add-notifications-user-index
-- NOTIF-INBOX-01. `notifications` had no secondary index besides its PK and
-- public_id, yet every inbox read filters by user:
--   the paginated list (user_id [, is_read] ORDER BY created_at DESC),
--   the unread badge count (user_id, is_read),
--   PATCH /api/notifications/read-all (UPDATE ... WHERE user_id AND is_read = 0)
--     — without the index that UPDATE scans, and row-locks, the whole table,
--   the like aggregation lookup and ACCOUNT-DELETE-01's purge (user_id prefix).
-- Additive + idempotent (guarded by INFORMATION_SCHEMA.STATISTICS), online DDL
-- (ALGORITHM=INPLACE, LOCK=NONE). Safe to re-run.

SET @schema := DATABASE();

SET @has_ntf_user_idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'notifications'
    AND INDEX_NAME = 'idx_notifications_user_read_created'
);
SET @sql_ntf_user_idx := IF(
  @has_ntf_user_idx = 0,
  'ALTER TABLE `notifications` ADD INDEX `idx_notifications_user_read_created` (`user_id`, `is_read`, `created_at`), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT 1'
);
PREPARE stmt_ntf_user_idx FROM @sql_ntf_user_idx;
EXECUTE stmt_ntf_user_idx;
DEALLOCATE PREPARE stmt_ntf_user_idx;
