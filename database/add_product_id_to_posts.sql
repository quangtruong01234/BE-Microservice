-- P1-03: allow a social post to attach a product (FE product-picker / ProductChip)
ALTER TABLE posts ADD COLUMN product_id INT NULL DEFAULT NULL AFTER user_id;
CREATE INDEX idx_posts_product_id ON posts (product_id);
