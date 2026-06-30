-- P2-02: purchase-time snapshot on order_items so historical orders render
-- correctly even if the product is later edited or deleted. product_name + sku_id
-- + sku_tier_idx already snapshot; add the product image and the human-readable
-- SKU label resolved from the authoritative product at order-creation time.
ALTER TABLE order_items
  ADD COLUMN product_image VARCHAR(2048) NULL DEFAULT NULL AFTER product_name,
  ADD COLUMN sku_label VARCHAR(512) NULL DEFAULT NULL AFTER sku_tier_idx;
