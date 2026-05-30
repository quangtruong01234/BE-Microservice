-- Step 1: create junction table
CREATE TABLE IF NOT EXISTS product_categories (
  product_id INT NOT NULL,
  category_id BIGINT NOT NULL,
  PRIMARY KEY (product_id, category_id),
  INDEX idx_product_id (product_id),
  INDEX idx_category_id (category_id)
);

-- Step 2: migrate existing data
INSERT IGNORE INTO product_categories (product_id, category_id)
SELECT id, category_id FROM products WHERE category_id IS NOT NULL;

-- Step 3: drop old column
SET FOREIGN_KEY_CHECKS = 0;
ALTER TABLE products DROP COLUMN category_id;
SET FOREIGN_KEY_CHECKS = 1;
