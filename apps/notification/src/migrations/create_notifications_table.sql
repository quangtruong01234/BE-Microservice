-- Migration: create notifications table in MySQL (orders DB / Node A MySQL)
-- Apply: node run-migration-mysql.js apps/notification/src/migrations/create_notifications_table.sql

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(50) NOT NULL,
  order_id BIGINT NULL,
  post_id INT NULL,
  actor_id INT NULL,
  preview VARCHAR(255) NULL,
  message VARCHAR(255) NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notifications_user_id (user_id),
  INDEX idx_notifications_order_id (order_id)
);
