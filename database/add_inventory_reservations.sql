CREATE TABLE IF NOT EXISTS inventory_reservations (
  id BIGSERIAL PRIMARY KEY,
  reservation_key UUID NOT NULL,
  inventory_id BIGINT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'released', 'consumed')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_inventory_reservation_key_item
    UNIQUE (reservation_key, inventory_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_reservation_key
  ON inventory_reservations (reservation_key);
