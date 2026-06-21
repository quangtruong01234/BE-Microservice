ALTER TABLE orders
  ADD COLUMN reservation_key VARCHAR(36) NULL AFTER ghn_order_code;

UPDATE orders
SET reservation_key = UUID()
WHERE reservation_key IS NULL;

ALTER TABLE orders
  MODIFY reservation_key VARCHAR(36) NOT NULL;
