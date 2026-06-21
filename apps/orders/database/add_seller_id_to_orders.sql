-- Phase 0: Add seller_id to orders and order_items (split-order-by-seller feature)
-- Run this file once against the MySQL database (defaultdb / orders_db).
-- Columns already added — skip Step 1 if re-running after partial failure.

-- Step 1: Add nullable columns
ALTER TABLE order_items ADD COLUMN seller_id INT NULL AFTER product_id;
ALTER TABLE order_items ADD INDEX idx_order_items_seller_id (seller_id);

ALTER TABLE orders ADD COLUMN seller_id INT NULL AFTER user_id;
ALTER TABLE orders ADD INDEX idx_orders_seller_id (seller_id);

-- Step 2: Backfill order_items.seller_id from products.user_id
UPDATE order_items oi
  JOIN products p ON oi.product_id = p.id
  SET oi.seller_id = p.user_id
  WHERE oi.seller_id IS NULL;

-- Step 3: Backfill orders.seller_id = MIN(seller_id) of its order_items
UPDATE orders o
  JOIN (
    SELECT order_id, MIN(seller_id) AS seller_id
    FROM order_items
    GROUP BY order_id
  ) s ON o.id = s.order_id
  SET o.seller_id = s.seller_id
  WHERE o.seller_id IS NULL;

-- Step 3b: Fallback for order_items whose product was deleted (no JOIN match)
UPDATE order_items oi
  JOIN orders o ON oi.order_id = o.id
  SET oi.seller_id = o.user_id
  WHERE oi.seller_id IS NULL;

-- Step 3c: Fallback for orders with no items or all-deleted-product items
UPDATE orders
  SET seller_id = user_id
  WHERE seller_id IS NULL;

-- Step 4: Enforce NOT NULL
ALTER TABLE order_items MODIFY COLUMN seller_id INT NOT NULL;
ALTER TABLE orders      MODIFY COLUMN seller_id INT NOT NULL;
