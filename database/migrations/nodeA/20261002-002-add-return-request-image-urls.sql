-- nodeA-20261002-002-add-return-request-image-urls
-- RETURN-PHOTO-01. A buyer can attach up to five evidence photos to a return
-- request, and order_return_requests has no column that can hold them.
-- Additive + idempotent (guarded by INFORMATION_SCHEMA). Safe to re-run.

SET @schema := DATABASE();

-- order_return_requests.image_urls JSON NULL — the Cloudinary delivery URLs of
-- the evidence photos. NULL on a request without photos and on every row
-- written before this migration (not backfilled); the gateway exposes NULL as
-- an empty array.
SET @has_image_urls := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'order_return_requests'
    AND COLUMN_NAME = 'image_urls'
);
SET @sql_image_urls := IF(
  @has_image_urls = 0,
  'ALTER TABLE `order_return_requests` ADD COLUMN `image_urls` JSON NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE stmt_image_urls FROM @sql_image_urls;
EXECUTE stmt_image_urls;
DEALLOCATE PREPARE stmt_image_urls;
