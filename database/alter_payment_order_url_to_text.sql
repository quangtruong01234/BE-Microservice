-- Alter order_url column from VARCHAR(500) to TEXT in payments table
-- Reason: VNPay payment URL exceeds 500 chars (includes all query params + SHA512 SecureHash)
ALTER TABLE payments ALTER COLUMN order_url TYPE TEXT;
