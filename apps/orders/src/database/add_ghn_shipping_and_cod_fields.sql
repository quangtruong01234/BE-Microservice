-- Add GHN shipping + COD payment columns to orders table
-- Safe for non-empty tables: temporary DEFAULTs let the ALTER succeed,
-- then they are dropped so the columns remain NOT NULL without a default.

ALTER TABLE orders
  ADD COLUMN payment_method   ENUM('zalopay','vnpay','cod') NOT NULL DEFAULT 'zalopay' AFTER total,
  ADD COLUMN shipping_address VARCHAR(500)                  NOT NULL DEFAULT ''        AFTER payment_method,
  ADD COLUMN cod_amount       DECIMAL(12,2)                NULL                       AFTER shipping_address,
  ADD COLUMN ghn_order_code   VARCHAR(100)                 NULL                       AFTER cod_amount;

-- Extend OrderStatus enum to include shipping states
ALTER TABLE orders
  MODIFY COLUMN status
    ENUM('pending','processing','shipped','delivering','completed','canceled')
    NOT NULL DEFAULT 'pending';

-- Remove temporary defaults (columns remain NOT NULL; new inserts must supply values)
ALTER TABLE orders
  ALTER COLUMN payment_method   DROP DEFAULT,
  ALTER COLUMN shipping_address DROP DEFAULT;
