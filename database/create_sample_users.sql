-- Insert sample user for testing user enrichment
-- This script should be run on user_db database

USE user_db;

-- Create sample user with ID = 1
INSERT IGNORE INTO users (id, username, email, password, name, avatar, isActive, createdAt, updatedAt) VALUES 
(1, 'tuananh', 'tuananh@example.com', 'password123', 'Nguyễn Tuấn Anh', 'https://ui-avatars.com/api/?name=Nguyen+Tuan+Anh&background=0D8ABC&color=fff&size=128', 1, NOW(), NOW());

-- Verify the user was created
SELECT id, username, name, email, avatar, isActive FROM users WHERE id = 1;

-- Also create other sample users for testing
INSERT IGNORE INTO users (id, username, email, password, name, avatar, isActive, createdAt, updatedAt) VALUES 
(2, 'minhhieu', 'minhhieu@example.com', 'password123', 'Trần Minh Hiếu', 'https://ui-avatars.com/api/?name=Tran+Minh+Hieu&background=F39C12&color=fff&size=128', 1, NOW(), NOW()),
(3, 'thimai', 'thimai@example.com', 'password123', 'Lê Thị Mai', 'https://ui-avatars.com/api/?name=Le+Thi+Mai&background=E74C3C&color=fff&size=128', 1, NOW(), NOW()),
(4, 'vanduc', 'vanduc@example.com', 'password123', 'Phạm Văn Đức', 'https://ui-avatars.com/api/?name=Pham+Van+Duc&background=8E44AD&color=fff&size=128', 1, NOW(), NOW()),
(5, 'shop', 'shop@example.com', 'password123', 'Shop Official', 'https://ui-avatars.com/api/?name=Shop+Official&background=27AE60&color=fff&size=128', 1, NOW(), NOW());

SELECT 'Sample users created successfully' as status;
SELECT id, username, name, avatar FROM users ORDER BY id;