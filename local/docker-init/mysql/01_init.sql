USE orders_db;

-- 1. Tạo bảng orders_2024
CREATE TABLE IF NOT EXISTS orders_2024 (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'COMPLETED',
    INDEX idx_user (user_id)
);

-- 2. Tạo bảng orders_2025 (cấu trúc y hệt)
CREATE TABLE IF NOT EXISTS orders_2025 (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'COMPLETED',
    INDEX idx_user (user_id)
);

-- 3. Tạo Procedure để bơm dữ liệu siêu tốc
DELIMITER $$

CREATE PROCEDURE generate_large_data()
BEGIN
    DECLARE i INT DEFAULT 0;
    
    -- Tắt autocommit để tăng tốc độ insert
    SET autocommit = 0;

    -- STEP A: Bơm 3 triệu dòng cho orders_2024
    -- Chúng ta lặp 3.000 lần, mỗi lần chèn 1.000 dòng = 3.000.000 dòng
    SET i = 0;
    WHILE i < 3000 DO
        INSERT INTO orders_2024 (user_id, amount, order_date, status)
        WITH RECURSIVE cte (n) AS (
            SELECT 1 UNION ALL SELECT n + 1 FROM cte WHERE n < 1000
        )
        SELECT 
            FLOOR(RAND() * 100000), -- user_id ngẫu nhiên
            ROUND(RAND() * 1000, 2), -- amount ngẫu nhiên
            NOW() - INTERVAL FLOOR(RAND() * 365) DAY, -- ngày ngẫu nhiên trong năm qua
            'COMPLETED'
        FROM cte;
        
        SET i = i + 1;
    END WHILE;
    COMMIT; -- Commit dữ liệu 2024
    
    -- STEP B: Bơm 3 triệu dòng cho orders_2025
    SET i = 0;
    WHILE i < 3000 DO
        INSERT INTO orders_2025 (user_id, amount, order_date, status)
        WITH RECURSIVE cte (n) AS (
            SELECT 1 UNION ALL SELECT n + 1 FROM cte WHERE n < 1000
        )
        SELECT 
            FLOOR(RAND() * 100000), 
            ROUND(RAND() * 1000, 2), 
            NOW(), 
            'PENDING'
        FROM cte;
        
        SET i = i + 1;
    END WHILE;
    COMMIT; -- Commit dữ liệu 2025
    
    -- Bật lại autocommit
    SET autocommit = 1;
END$$

DELIMITER ;