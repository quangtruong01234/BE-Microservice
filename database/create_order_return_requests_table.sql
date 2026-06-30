-- F2: Buyer-initiated return/refund request lifecycle.
-- A buyer can open a return request on an order they received (DELIVERING /
-- COMPLETED). A seller (order owner) or admin reviews it: approve → order moves
-- to REFUNDED and a refund is recorded (simulated for online, manual_pending for
-- COD); reject → order is restored to its previous status.
--
-- This is a DEMO project: no real VNPay/ZaloPay refund API is called. The refund
-- is recorded only.
--
-- Run on any fresh DB before the return-request endpoints work. orders.module
-- uses synchronize:true, so a running instance auto-creates this; the script is
-- the authoritative record for fresh provisioning.

-- 1. Extend the orders.status enum with the two new lifecycle states.
ALTER TABLE orders
  MODIFY COLUMN status ENUM(
    'pending',
    'confirmed',
    'processing',
    'shipped',
    'delivering',
    'completed',
    'canceled',
    'return_requested',
    'refunded'
  ) NOT NULL DEFAULT 'pending';

-- 2. Return request table.
CREATE TABLE IF NOT EXISTS order_return_requests (
  id INT NOT NULL AUTO_INCREMENT,
  order_id INT NOT NULL,
  user_id BIGINT NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  status ENUM('pending_review', 'approved', 'rejected') NOT NULL DEFAULT 'pending_review',
  reject_reason VARCHAR(1000) NULL DEFAULT NULL,
  previous_order_status VARCHAR(30) NULL DEFAULT NULL,
  refund_amount DECIMAL(12, 2) NULL DEFAULT NULL,
  refund_method VARCHAR(30) NULL DEFAULT NULL,
  refund_status VARCHAR(30) NULL DEFAULT NULL,
  reviewed_by BIGINT NULL DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_return_order_id (order_id),
  KEY idx_return_user_id (user_id),
  KEY idx_return_status (status)
);
