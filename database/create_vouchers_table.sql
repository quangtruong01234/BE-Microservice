-- F3: Voucher / coupon / discount codes.
-- A voucher is a marketing discount code applied at checkout. It can be a
-- percentage (optionally capped) or a fixed-amount discount, gated by a minimum
-- order subtotal, an overall usage cap, a per-user cap, and an active window.
-- The discount applies to the goods subtotal only (never shipping) and can never
-- drive the order total below zero.
--
-- Ownership: the Orders service owns vouchers (MySQL) so the discount is computed
-- and the redemption recorded in the SAME transaction that creates the order —
-- no cross-service race on the usage cap. The Rewards service stays points-only.
--
-- Run on any fresh DB before the voucher endpoints work. orders.module uses
-- synchronize:true, so a running instance auto-creates these; this script is the
-- authoritative record for fresh/synchronize:false provisioning.

-- 1. Voucher definitions.
CREATE TABLE IF NOT EXISTS vouchers (
  id INT NOT NULL AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL,
  description VARCHAR(255) NULL DEFAULT NULL,
  discount_type ENUM('percent', 'fixed') NOT NULL,
  -- percent: 1-100 (%); fixed: VND amount.
  discount_value DECIMAL(12, 2) NOT NULL,
  -- Minimum goods subtotal required to use the voucher.
  min_order_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  -- Optional cap on the discount produced by a percentage voucher (VND). NULL = uncapped.
  max_discount_amount DECIMAL(12, 2) NULL DEFAULT NULL,
  -- Total redemptions allowed across all users. NULL = unlimited.
  usage_limit INT NULL DEFAULT NULL,
  used_count INT NOT NULL DEFAULT 0,
  -- Redemptions allowed per user. NULL = unlimited.
  per_user_limit INT NULL DEFAULT NULL,
  starts_at DATETIME NULL DEFAULT NULL,
  expires_at DATETIME NULL DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_voucher_code (code)
);

-- 2. Redemption ledger — one row per successful application of a voucher to an
-- order. The unique (voucher_id, order_id) pair makes recording idempotent; the
-- (voucher_id, user_id) index backs the per-user-limit count.
CREATE TABLE IF NOT EXISTS voucher_redemptions (
  id INT NOT NULL AUTO_INCREMENT,
  voucher_id INT NOT NULL,
  user_id BIGINT NOT NULL,
  order_id INT NOT NULL,
  discount_amount DECIMAL(12, 2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_redemption_voucher_order (voucher_id, order_id),
  KEY idx_redemption_voucher_user (voucher_id, user_id)
);

-- 3. Persist the applied voucher + discount on the order for history/rendering.
ALTER TABLE orders
  ADD COLUMN voucher_code VARCHAR(64) NULL DEFAULT NULL,
  ADD COLUMN discount_amount DECIMAL(12, 2) NULL DEFAULT NULL;
