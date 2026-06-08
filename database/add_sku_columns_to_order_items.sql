-- Migration: add sku_id and sku_tier_idx to order_items
-- Run against MySQL (Aiven)
-- No FK constraint: product_skus lives in product-service DB, order_items in orders-service DB
-- sku_id is INT to match product_skus.id (INT AUTO_INCREMENT)

ALTER TABLE order_items
  ADD COLUMN sku_id INT NULL COMMENT 'Reference to product_skus.id (no FK across service DBs)',
  ADD COLUMN sku_tier_idx VARCHAR(50) NULL COMMENT 'Copy of tier_idx for audit trail';
