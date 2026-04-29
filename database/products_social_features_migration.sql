-- =========================================================================
-- PRODUCTS SOCIAL FEATURES MIGRATION
-- =========================================================================
-- Author: GitHub Copilot
-- Date: December 3, 2025
-- Description: Add social engagement and UI enhancement fields to products table
-- =========================================================================

-- Add social engagement metrics columns
ALTER TABLE products 
ADD COLUMN likes_count INT DEFAULT 0 COMMENT 'Number of likes for the product',
ADD COLUMN comments_count INT DEFAULT 0 COMMENT 'Number of comments for the product',
ADD COLUMN shares_count INT DEFAULT 0 COMMENT 'Number of times product was shared',
ADD COLUMN view_count INT DEFAULT 0 COMMENT 'Number of times product was viewed';

-- Add product status columns for timeline/feed
ALTER TABLE products 
ADD COLUMN is_featured BOOLEAN DEFAULT FALSE COMMENT 'Whether product is featured',
ADD COLUMN is_trending BOOLEAN DEFAULT FALSE COMMENT 'Whether product is trending';

-- Add product condition and seller information
ALTER TABLE products 
ADD COLUMN `condition` VARCHAR(50) COMMENT 'Product condition: new, used, refurbished',
ADD COLUMN seller_notes TEXT COMMENT 'Notes from the seller about the product';

-- Add rating system
ALTER TABLE products 
ADD COLUMN rating DECIMAL(3,2) DEFAULT 0.00 COMMENT 'Average rating (0.00 to 5.00)',
ADD COLUMN rating_count INT DEFAULT 0 COMMENT 'Number of ratings received';

-- Add indexes for better performance
CREATE INDEX idx_products_likes_count ON products (likes_count);
CREATE INDEX idx_products_view_count ON products (view_count);
CREATE INDEX idx_products_is_featured ON products (is_featured);
CREATE INDEX idx_products_is_trending ON products (is_trending);
CREATE INDEX idx_products_rating ON products (rating);
CREATE INDEX idx_products_condition ON products (`condition`);

-- Update sample data with social features
UPDATE products 
SET 
    likes_count = FLOOR(RAND() * 100) + 10,
    comments_count = FLOOR(RAND() * 50) + 5,
    shares_count = FLOOR(RAND() * 20) + 2,
    view_count = FLOOR(RAND() * 1000) + 100,
    rating = ROUND((RAND() * 2 + 3), 2), -- Random rating between 3.00 and 5.00
    rating_count = FLOOR(RAND() * 50) + 5,
    `condition` = 'new',
    is_featured = IF(RAND() > 0.7, TRUE, FALSE),
    is_trending = IF(RAND() > 0.8, TRUE, FALSE)
WHERE id IN (1, 2, 3, 4, 5);

-- Set some products as featured/trending for demo
UPDATE products SET is_featured = TRUE, is_trending = TRUE WHERE id = 1; -- iPhone
UPDATE products SET is_featured = TRUE WHERE id = 4; -- MacBook

-- Add seller notes for some products
UPDATE products 
SET seller_notes = 'Sản phẩm chính hãng, bảo hành 12 tháng. Free ship toàn quốc!'
WHERE id IN (1, 2);

UPDATE products 
SET seller_notes = 'Hàng authentic, size đủ từ 36-44. Giao hàng trong 2-3 ngày.'
WHERE id = 3;

-- =========================================================================
-- VERIFICATION QUERIES
-- =========================================================================
-- Check the updated structure
DESCRIBE products;

-- Check sample data with new fields
SELECT 
    id, name, price, likes_count, comments_count, shares_count, view_count,
    rating, rating_count, is_featured, is_trending, `condition`, seller_notes
FROM products 
WHERE is_active = TRUE
ORDER BY likes_count DESC;

-- =========================================================================
-- END OF MIGRATION
-- =========================================================================