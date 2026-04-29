-- =========================================================================
-- PRODUCTS MODULE DDL - Safe Version for TypeORM
-- =========================================================================
-- Author: GitHub Copilot
-- Date: December 3, 2025
-- Description: Safe DDL compatible with TypeORM synchronize
-- =========================================================================

-- Drop tables if exists (for development/reset purposes)
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS brands;

-- =========================================================================
-- 1. BRANDS TABLE
-- =========================================================================
CREATE TABLE brands (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================================
-- 2. CATEGORIES TABLE
-- =========================================================================
CREATE TABLE categories (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================================
-- 3. PRODUCTS TABLE - TypeORM Compatible
-- =========================================================================
CREATE TABLE products (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    stock_quantity INT NOT NULL DEFAULT 0,
    sku VARCHAR(100) NOT NULL UNIQUE,
    brand_id BIGINT NULL,
    category_id BIGINT NOT NULL,
    image_url VARCHAR(1000),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    
    -- Social engagement metrics  
    likes_count INT NOT NULL DEFAULT 0,
    comments_count INT NOT NULL DEFAULT 0,
    shares_count INT NOT NULL DEFAULT 0,
    view_count INT NOT NULL DEFAULT 0,
    
    -- Product status for timeline/feed
    is_featured BOOLEAN NOT NULL DEFAULT FALSE,
    is_trending BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Product condition and seller information
    `condition` VARCHAR(50) DEFAULT 'new',
    seller_notes TEXT,
    
    -- Rating system
    rating DECIMAL(3,2) NOT NULL DEFAULT 0.00,
    rating_count INT NOT NULL DEFAULT 0,
    
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Foreign key constraints
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================================
-- INDEXES
-- =========================================================================
CREATE INDEX idx_products_sku ON products (sku);
CREATE INDEX idx_products_brand ON products (brand_id);
CREATE INDEX idx_products_category ON products (category_id);
CREATE INDEX idx_products_active ON products (is_active);
CREATE INDEX idx_products_price ON products (price);
CREATE INDEX idx_products_likes_count ON products (likes_count);
CREATE INDEX idx_products_view_count ON products (view_count);
CREATE INDEX idx_products_is_featured ON products (is_featured);
CREATE INDEX idx_products_is_trending ON products (is_trending);
CREATE INDEX idx_products_rating ON products (rating);

-- =========================================================================
-- SAMPLE DATA
-- =========================================================================

-- Insert sample brands
INSERT INTO brands (name, description, is_active) VALUES
('Apple', 'Technology products from Apple Inc.', TRUE),
('Samsung', 'Electronics and mobile devices', TRUE),
('Nike', 'Sports apparel and footwear', TRUE);

-- Insert sample categories  
INSERT INTO categories (name, description, is_active) VALUES
('Electronics', 'Electronic devices and gadgets', TRUE),
('Fashion', 'Clothing and accessories', TRUE),
('Books', 'Books and educational materials', TRUE);

-- Insert sample products with enhanced data
INSERT INTO products (
    name, description, price, stock_quantity, sku, brand_id, category_id, image_url, 
    is_active, likes_count, comments_count, shares_count, view_count, 
    is_featured, is_trending, `condition`, seller_notes, rating, rating_count
) VALUES
('iPhone 14 Pro Max', 'Latest iPhone with A16 Bionic chip and ProRAW camera', 30000000, 25, 'IPHONE14PROMAX', 1, 1, 'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?auto=format&fit=crop&q=80&w=600', 
 TRUE, 45, 12, 8, 850, TRUE, TRUE, 'new', 'Sản phẩm chính hãng Apple, bảo hành 12 tháng tại các trung tâm bảo hành Apple Việt Nam. Tặng kèm ốp lưng và dán cường lực.', 4.8, 89),

('Samsung Galaxy Ultra', 'Flagship Samsung với S Pen và camera zoom 100x', 28000000, 18, 'GALAXY_ULTRA', 2, 1, 'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?auto=format&fit=crop&q=80&w=600', 
 TRUE, 67, 23, 15, 1200, TRUE, FALSE, 'new', 'Điện thoại Samsung chính hãng, bảo hành 12 tháng. Miễn phí vệ sinh máy và thay kính cường lực trong suốt thời gian bảo hành.', 4.6, 156);

-- =========================================================================
-- VERIFICATION
-- =========================================================================
SELECT 'Brands:' as info, COUNT(*) as count FROM brands;
SELECT 'Categories:' as info, COUNT(*) as count FROM categories;
SELECT 'Products:' as info, COUNT(*) as count FROM products;

-- Show sample products
SELECT 
    id, name, price, likes_count, comments_count, rating,
    is_featured, is_trending, `condition`
FROM products 
WHERE is_active = TRUE
LIMIT 5;