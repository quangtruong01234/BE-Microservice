-- Migration: rename variants -> variations, create product_skus, make price/sku/stock_quantity nullable
-- Run against MySQL (Aiven) after Phase 0 verify
-- Safe on existing data: MODIFY COLUMN keeps existing values; NULL default only applies to new rows

-- Step 1: Since 'variants' was never applied, just ADD 'variations' directly
ALTER TABLE products
  ADD COLUMN variations JSON NULL DEFAULT NULL
  COMMENT 'Variation axes: [{name:string, options:string[]}]';

-- Step 2: Make price, stock_quantity, sku nullable for SKU-based products
-- Existing rows keep their current non-null values (no data loss)
-- MySQL UNIQUE allows multiple NULLs, so uq_sku index stays valid
ALTER TABLE products
  MODIFY COLUMN price DECIMAL(12,2) NULL DEFAULT NULL,
  MODIFY COLUMN stock_quantity INT NULL DEFAULT NULL,
  MODIFY COLUMN sku VARCHAR(100) NULL DEFAULT NULL;
