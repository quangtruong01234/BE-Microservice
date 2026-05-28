ALTER TABLE orders MODIFY COLUMN status ENUM('pending', 'processing', 'completed', 'canceled') DEFAULT 'pending';
