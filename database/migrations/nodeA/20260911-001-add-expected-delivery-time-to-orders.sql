-- nodeA-20260911-001-add-expected-delivery-time-to-orders
-- GHN-ETA-01. Stores the delivery ETA GHN returns alongside the waybill code on
-- /v2/shipping-order/create, so the buyer can still see it after checkout — until
-- now it was quoted once on the fee preview and then thrown away.
-- Additive + idempotent (guarded by INFORMATION_SCHEMA). Safe to re-run.

SET @schema := DATABASE();

-- orders.expected_delivery_time DATETIME NULL — NULL means "no waybill yet, or
-- GHN quoted no ETA". Deliberately NOT backfilled: the ETA only exists in the
-- create/detail response, so recovering it for historical rows would mean one
-- GHN API call per order, and a past order's ETA has no reader anyway.
SET @has_eta := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'expected_delivery_time'
);
SET @sql_eta := IF(
  @has_eta = 0,
  'ALTER TABLE `orders` ADD COLUMN `expected_delivery_time` DATETIME NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE stmt_eta FROM @sql_eta;
EXECUTE stmt_eta;
DEALLOCATE PREPARE stmt_eta;
