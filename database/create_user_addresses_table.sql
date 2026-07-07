-- Per-user shipping address book with GHN codes (checkout auto-fill + reliable fee).
-- The user service runs TypeORM synchronize:true, so a normal restart auto-creates
-- this table from the UserAddress entity. This file is for fresh / synchronize:false DBs.
CREATE TABLE IF NOT EXISTS user_addresses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  recipient_name VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  address_line VARCHAR(500) NOT NULL,
  province_id INT NOT NULL,
  province_name VARCHAR(255) NOT NULL,
  district_id INT NOT NULL,
  district_name VARCHAR(255) NOT NULL,
  ward_code VARCHAR(50) NOT NULL,
  ward_name VARCHAR(255) NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
