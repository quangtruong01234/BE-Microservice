-- =========================================================================
-- PRODUCTS MODULE DDL - Simplified E-commerce System
-- =========================================================================
-- Author: Senior Developer
-- Date: December 3, 2025
-- Description: Simplified DDL for Product Management Module (Learning Purpose)
-- =========================================================================

-- Drop tables if exists (for development/reset purposes)
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS brands;

-- =========================================================================
-- 1. BRANDS TABLE - Simplified
-- =========================================================================
CREATE TABLE brands (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Product brands table';

-- =========================================================================
-- 2. CATEGORIES TABLE - Simplified
-- =========================================================================
CREATE TABLE categories (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Product categories table';

-- =========================================================================
-- 3. MAIN PRODUCTS TABLE - Enhanced for Social Commerce
-- =========================================================================
CREATE TABLE products (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    stock_quantity INT DEFAULT 0,
    sku VARCHAR(100) NOT NULL UNIQUE,
    brand_id BIGINT,
    category_id BIGINT NOT NULL,
    image_url VARCHAR(1000),
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Social engagement metrics
    likes_count INT DEFAULT 0 COMMENT 'Number of likes for the product',
    comments_count INT DEFAULT 0 COMMENT 'Number of comments for the product',
    shares_count INT DEFAULT 0 COMMENT 'Number of times product was shared',
    view_count INT DEFAULT 0 COMMENT 'Number of times product was viewed',
    
    -- Product status for timeline/feed
    is_featured BOOLEAN DEFAULT FALSE COMMENT 'Whether product is featured',
    is_trending BOOLEAN DEFAULT FALSE COMMENT 'Whether product is trending',
    
    -- Product condition and seller information
    `condition` VARCHAR(50) DEFAULT 'new' COMMENT 'Product condition: new, used, refurbished',
    seller_notes TEXT COMMENT 'Notes from the seller about the product',
    
    -- Rating system
    rating DECIMAL(3,2) DEFAULT 0.00 COMMENT 'Average rating (0.00 to 5.00)',
    rating_count INT DEFAULT 0 COMMENT 'Number of ratings received',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Foreign key constraints
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
    
    -- Indexes for performance
    INDEX idx_products_sku (sku),
    INDEX idx_products_brand (brand_id),
    INDEX idx_products_category (category_id),
    INDEX idx_products_active (is_active),
    INDEX idx_products_price (price),
    INDEX idx_products_likes_count (likes_count),
    INDEX idx_products_view_count (view_count),
    INDEX idx_products_is_featured (is_featured),
    INDEX idx_products_is_trending (is_trending),
    INDEX idx_products_rating (rating),
    INDEX idx_products_condition (`condition`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Products table - enhanced for social commerce';

-- =========================================================================
-- SAMPLE DATA INSERTS
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
 TRUE, 67, 23, 15, 1200, TRUE, FALSE, 'new', 'Điện thoại Samsung chính hãng, bảo hành 12 tháng. Miễn phí vệ sinh máy và thay kính cường lực trong suốt thời gian bảo hành.', 4.6, 156),

('MacBook Air M2', 'Laptop siêu mỏng với chip M2 mạnh mẽ', 32000000, 12, 'MACBOOK_AIR_M2', 1, 1, 'https://images.unsplash.com/photo-1541807084-5c52b6b3adef?auto=format&fit=crop&q=80&w=600', 
 TRUE, 89, 34, 21, 950, TRUE, TRUE, 'new', 'MacBook Air M2 chính hãng Apple Việt Nam. Bảo hành 12 tháng + AppleCare. Tặng túi đựng laptop cao cấp và chuột không dây.', 4.9, 203),

('AirPods Pro 2', 'Tai nghe không dây với chống ồn chủ động', 6500000, 45, 'AIRPODS_PRO2', 1, 1, 'https://images.unsplash.com/photo-1606841837239-c5a1a4a07af7?auto=format&fit=crop&q=80&w=600', 
 TRUE, 156, 67, 43, 2100, FALSE, TRUE, 'new', 'AirPods Pro thế hệ 2 với chip H2 mới. Thời lượng pin lên đến 30 giờ. Chống ồn tốt nhất trong phân khúc.', 4.7, 445),

('iPad Pro 12.9"', 'Máy tính bảng chuyên nghiệp với chip M2', 26000000, 8, 'IPAD_PRO_129', 1, 1, 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?auto=format&fit=crop&q=80&w=600', 
 TRUE, 78, 29, 18, 720, TRUE, FALSE, 'new', 'iPad Pro 12.9 inch với màn hình Liquid Retina XDR. Hỗ trợ Apple Pencil thế hệ 2 và Magic Keyboard. Lý tưởng cho design và video editing.', 4.8, 167);

-- =========================================================================
-- END OF SIMPLIFIED PRODUCTS MODULE DDL
-- =========================================================================