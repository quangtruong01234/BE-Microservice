-- Migration: create product_skus table
-- Run against MySQL (Aiven) after rename_variants_to_variations migration
-- product_id is BIGINT to match products.id (which is BIGINT in the actual DB)
-- tier_idx is VARCHAR(50) instead of JSON for UNIQUE index support

CREATE TABLE IF NOT EXISTS product_skus (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT NOT NULL,
  tier_idx VARCHAR(50) NOT NULL COMMENT 'Serialised index array e.g. "[0,0]", "[1,2]"',
  price DECIMAL(12,2) NOT NULL,
  stock_quantity INT NOT NULL DEFAULT 0,
  sku VARCHAR(100) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_skus_sku (sku),
  UNIQUE KEY uq_product_skus_product_tier (product_id, tier_idx),
  INDEX idx_product_skus_product_id (product_id),
  FOREIGN KEY fk_product_skus_product (product_id)
    REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
