-- Migration: Add name and avatar fields to users table
-- Date: 2025-12-03
-- Purpose: Support user information display in products

USE user_db;

-- Add name column for display name
ALTER TABLE users 
ADD COLUMN name VARCHAR(255) NULL
COMMENT 'Display name for UI - can be different from username';

-- Add avatar column for profile picture
ALTER TABLE users 
ADD COLUMN avatar VARCHAR(500) NULL
COMMENT 'Avatar URL or file path for user profile picture';

-- Update existing users with default name (copy from username)
UPDATE users 
SET name = username 
WHERE name IS NULL;

-- Create index for faster name searches
CREATE INDEX idx_users_name ON users(name);

-- Sample data updates
-- Create sample users first if they don't exist
INSERT IGNORE INTO users (id, username, email, password, name, avatar, isActive) VALUES
(1, 'tuananh', 'tuananh@example.com', 'password123', 'Nguyễn Tuấn Anh', 'https://ui-avatars.com/api/?name=Nguyen+Tuan+Anh&background=0D8ABC&color=fff&size=128', 1),
(2, 'minhhieu', 'minhhieu@example.com', 'password123', 'Trần Minh Hiếu', 'https://ui-avatars.com/api/?name=Tran+Minh+Hieu&background=F39C12&color=fff&size=128', 1),
(3, 'thimai', 'thimai@example.com', 'password123', 'Lê Thị Mai', 'https://ui-avatars.com/api/?name=Le+Thi+Mai&background=E74C3C&color=fff&size=128', 1),
(4, 'vanduc', 'vanduc@example.com', 'password123', 'Phạm Văn Đức', 'https://ui-avatars.com/api/?name=Pham+Van+Duc&background=8E44AD&color=fff&size=128', 1),
(5, 'shop', 'shop@example.com', 'password123', 'Shop Official', 'https://ui-avatars.com/api/?name=Shop+Official&background=27AE60&color=fff&size=128', 1);

-- Update existing users with names and avatars
UPDATE users SET name = 'Nguyễn Tuấn Anh', avatar = 'https://ui-avatars.com/api/?name=Nguyen+Tuan+Anh&background=0D8ABC&color=fff&size=128' WHERE id = 1;
UPDATE users SET name = 'Trần Minh Hiếu', avatar = 'https://ui-avatars.com/api/?name=Tran+Minh+Hieu&background=F39C12&color=fff&size=128' WHERE id = 2;
UPDATE users SET name = 'Lê Thị Mai', avatar = 'https://ui-avatars.com/api/?name=Le+Thi+Mai&background=E74C3C&color=fff&size=128' WHERE id = 3;
UPDATE users SET name = 'Phạm Văn Đức', avatar = 'https://ui-avatars.com/api/?name=Pham+Van+Duc&background=8E44AD&color=fff&size=128' WHERE id = 4;
UPDATE users SET name = 'Shop Official', avatar = 'https://ui-avatars.com/api/?name=Shop+Official&background=27AE60&color=fff&size=128' WHERE id = 5;

SELECT 'Migration completed: Added name and avatar fields to users table' as status;