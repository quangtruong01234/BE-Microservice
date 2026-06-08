-- Migration: add product_sku_id to inventory_v2, replace UNIQUE(product_id) with partial indexes
-- Run against PostgreSQL (Aiven)
-- Pre-check: no duplicate product_id rows in inventory_v2 (verified before applying)

-- Step 1: Add nullable product_sku_id column
ALTER TABLE inventory_v2
  ADD COLUMN product_sku_id BIGINT NULL;

-- Step 2: Drop the UNIQUE CONSTRAINT (not the index) on product_id
-- In PostgreSQL, TypeORM-generated unique constraints must be dropped via ALTER TABLE DROP CONSTRAINT
ALTER TABLE inventory_v2
  DROP CONSTRAINT "UQ_5ec10f972b1fa4f1e60d66d28bc";

-- Step 3: Partial unique index for simple products (no SKU row)
-- Guarantees at most one inventory row per productId when product_sku_id IS NULL
CREATE UNIQUE INDEX uq_inventory_simple_product
  ON inventory_v2 (product_id)
  WHERE product_sku_id IS NULL;

-- Step 4: Partial unique index for SKU-based inventory rows
CREATE UNIQUE INDEX uq_inventory_product_sku
  ON inventory_v2 (product_sku_id)
  WHERE product_sku_id IS NOT NULL;

-- Step 5: Regular index for fast lookups by product_sku_id
CREATE INDEX idx_inventory_product_sku_id
  ON inventory_v2 (product_sku_id);
