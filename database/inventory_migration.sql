-- SQL Migration để xóa bảng inventory cũ và tạo mới
-- Chạy script này trong PostgreSQL

-- Drop existing table if exists
DROP TABLE IF EXISTS inventory CASCADE;

-- Create new inventory table with proper structure
CREATE TABLE inventory (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL UNIQUE,
    sku VARCHAR(100) NOT NULL UNIQUE,
    available_stock INTEGER NOT NULL DEFAULT 0,
    reserved_stock INTEGER NOT NULL DEFAULT 0,
    minimum_stock INTEGER NOT NULL DEFAULT 0,
    location VARCHAR(50),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_inventory_product_id ON inventory(product_id);
CREATE INDEX idx_inventory_sku ON inventory(sku);
CREATE INDEX idx_inventory_active ON inventory(is_active);

-- Insert sample data for testing
INSERT INTO inventory (product_id, sku, available_stock, reserved_stock, minimum_stock, location) VALUES
(1, 'IPHONE15-BK-128', 50, 0, 10, 'WAREHOUSE-A1'),
(2, 'GALAXY-S24-WH-256', 30, 5, 5, 'WAREHOUSE-A2'),
(3, 'MACBOOK-PRO-16-512', 15, 2, 3, 'WAREHOUSE-B1');

-- Verify data
SELECT * FROM inventory;