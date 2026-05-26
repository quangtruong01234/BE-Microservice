-- Rename zp_trans_token → transaction_id in payments table
-- Reason: column now stores both ZaloPay zp_trans_token and VNPay vnp_TransactionNo;
--         generic name avoids confusion when PAYMENT_GATEWAY=vnpay
ALTER TABLE payments RENAME COLUMN zp_trans_token TO transaction_id;
