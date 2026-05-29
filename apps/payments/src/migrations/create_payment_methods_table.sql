-- Migration: create payment_methods table in PostgreSQL (payments DB)
-- Apply this SQL directly to the Aiven PostgreSQL instance

CREATE TABLE IF NOT EXISTS payment_methods (
  id SERIAL PRIMARY KEY,
  key VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Seed initial payment methods
INSERT INTO payment_methods (key, name, description, is_active) VALUES
  ('zalopay', 'ZaloPay', 'Thanh toán qua ZaloPay', true),
  ('vnpay', 'VNPay', 'Thanh toán qua VNPay', true),
  ('cod', 'COD', 'Thanh toán khi nhận hàng', true)
ON CONFLICT (key) DO NOTHING;
