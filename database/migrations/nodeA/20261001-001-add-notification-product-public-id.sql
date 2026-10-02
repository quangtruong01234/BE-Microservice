-- nodeA-20261001-001-add-notification-product-public-id
-- WISHLIST-ALERT-01. A wishlist alert (back in stock / price drop) has to deep
-- link to the product, and no existing notifications column can hold it.
-- Additive + idempotent (guarded by INFORMATION_SCHEMA). Safe to re-run.

SET @schema := DATABASE();

-- notifications.product_public_id VARCHAR(32) NULL — a snapshot of the
-- product's opaque `prod_...` id, exposed as `productId`. A snapshot instead of
-- a numeric FK so the notification list needs no product lookup per read
-- (product public ids never change). NULL on every non-product notification;
-- not backfilled — no existing row refers to a product.
SET @has_product_public_id := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'notifications'
    AND COLUMN_NAME = 'product_public_id'
);
SET @sql_product_public_id := IF(
  @has_product_public_id = 0,
  'ALTER TABLE `notifications` ADD COLUMN `product_public_id` VARCHAR(32) NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE stmt_product_public_id FROM @sql_product_public_id;
EXECUTE stmt_product_public_id;
DEALLOCATE PREPARE stmt_product_public_id;
