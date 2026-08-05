-- nodeA-20260804-001-widen-product-reviews-product-id
-- `products`.`id` is BIGINT and every other FK pointing at it is BIGINT
-- (`product_skus`.`product_id`, `wishlist_items`.`product_id`,
-- `product_risk_feedback`.`product_id`). `product_reviews`.`product_id` was
-- left INT, so once product ids pass the signed INT ceiling (2147483647) a
-- review insert for a valid product would fail or truncate.
-- Widening only (INT -> BIGINT), so every existing value is preserved and the
-- old code keeps working against the new column.
-- Idempotent: guarded by INFORMATION_SCHEMA, safe to re-run.

SET @schema := DATABASE();

-- product_reviews.product_id INT -> BIGINT NOT NULL
SET @is_narrow := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'product_reviews'
    AND COLUMN_NAME = 'product_id'
    AND DATA_TYPE <> 'bigint'
);
SET @sql_widen := IF(
  @is_narrow = 1,
  'ALTER TABLE `product_reviews` MODIFY COLUMN `product_id` BIGINT NOT NULL',
  'SELECT 1'
);
PREPARE stmt_widen FROM @sql_widen;
EXECUTE stmt_widen;
DEALLOCATE PREPARE stmt_widen;
