-- Add app_trans_id column to MySQL/PostgreSQL payments table
-- Note: payments service dùng MySQL, nhưng file này đã chạy trên PostgreSQL instance thực tế
-- Purpose: store ZaloPay app_trans_id (format: yyMMdd_appId_timestamp)
-- needed to query ZaloPay transaction status via POST /v2/query API
ALTER TABLE payments ADD COLUMN app_trans_id VARCHAR(50) NULL AFTER zp_trans_token;
