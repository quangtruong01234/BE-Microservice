-- Phase 1 GHN Shipping Admin: active timeline for webhook/manual sync/action events.
-- Safe to run on existing databases; no destructive changes.

CREATE TABLE IF NOT EXISTS shipping_history (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_id BIGINT NOT NULL,
  type ENUM('webhook', 'manual_sync', 'action') NOT NULL,
  actor_id INT NULL,
  action VARCHAR(100) NOT NULL,
  previous_status VARCHAR(50) NULL,
  new_status VARCHAR(50) NULL,
  ghn_status VARCHAR(100) NULL,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  message VARCHAR(500) NULL,
  payload_summary JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_shipping_history_order
    FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE,

  INDEX idx_shipping_history_order_created (order_id, created_at),
  INDEX idx_shipping_history_type (type),
  INDEX idx_shipping_history_ghn_status (ghn_status),
  INDEX idx_shipping_history_actor (actor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
