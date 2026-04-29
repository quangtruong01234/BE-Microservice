-- Init orders DB schema (simple table for demonstration)
CREATE DATABASE IF NOT EXISTS orders_db;
USE orders_db;

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT PRIMARY KEY,
  customerId VARCHAR(200),
  items TEXT,
  total BIGINT,
  status VARCHAR(50),
  createdAt DATETIME
);


-- Tạo bảng 'inventory'
CREATE TABLE IF NOT EXISTS `inventory` (
  `sku` VARCHAR(100) PRIMARY KEY,
  `qty` INTEGER NOT NULL DEFAULT 0
);

-- Chèn dữ liệu vào bảng 'inventory', bỏ qua nếu SKU đã tồn tại
INSERT IGNORE INTO `inventory` (sku, qty) VALUES
('SKU-123', 10),
('SKU-456', 5),
('SKU-789', 0);

-- Create Users table with basic fields
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    fullName VARCHAR(255) NOT NULL,
    role ENUM('USER', 'ADMIN') DEFAULT 'USER',
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert 5 sample users (password is 'password123' for all users)
INSERT INTO users (id, email, password, fullName, role) VALUES
('user-001', 'john@example.com', '$2b$10$6HvjG5.ot/PfZUwqaK8Mzu0kZJ4p8vNYBA.HbR4TYQZhUEwfPBjn2', 'John Doe', 'USER'),
('user-002', 'jane@example.com', '$2b$10$6HvjG5.ot/PfZUwqaK8Mzu0kZJ4p8vNYBA.HbR4TYQZhUEwfPBjn2', 'Jane Smith', 'USER'),
('user-003', 'admin@example.com', '$2b$10$6HvjG5.ot/PfZUwqaK8Mzu0kZJ4p8vNYBA.HbR4TYQZhUEwfPBjn2', 'Admin User', 'ADMIN'),
('user-004', 'bob@example.com', '$2b$10$6HvjG5.ot/PfZUwqaK8Mzu0kZJ4p8vNYBA.HbR4TYQZhUEwfPBjn2', 'Bob Wilson', 'USER'),
('user-005', 'alice@example.com', '$2b$10$6HvjG5.ot/PfZUwqaK8Mzu0kZJ4p8vNYBA.HbR4TYQZhUEwfPBjn2', 'Alice Brown', 'USER');