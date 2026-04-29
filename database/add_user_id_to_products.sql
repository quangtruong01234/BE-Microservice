-- Add user_id column to products table for tracking product creators
-- Migration for adding user relationship to products

-- Add the user_id column to products table
ALTER TABLE products 
ADD COLUMN user_id BIGINT NULL AFTER category_id;

-- Add index for better query performance
CREATE INDEX idx_products_user_id ON products(user_id);

-- Add comment for documentation
ALTER TABLE products 
MODIFY COLUMN user_id BIGINT NULL COMMENT 'ID of the user who created this product';

-- Optional: If you have a users table, add foreign key constraint
-- ALTER TABLE products 
-- ADD CONSTRAINT fk_products_user_id 
-- FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Update existing products to have a default user_id (optional)
-- You can set all existing products to a default admin user
-- UPDATE products SET user_id = 1 WHERE user_id IS NULL;

COMMIT;