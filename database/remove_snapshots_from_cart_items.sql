-- Removes snapshot columns from cart_items.
-- The live Aiven DB was already created without these columns;
-- this migration is kept for local/dev parity.
ALTER TABLE cart_items
  DROP COLUMN IF EXISTS price,
  DROP COLUMN IF EXISTS product_name,
  DROP COLUMN IF EXISTS image_url;
