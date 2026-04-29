-- Init inventory schema and seed data
CREATE TABLE IF NOT EXISTS inventory (
  sku VARCHAR(100) PRIMARY KEY,
  qty INTEGER NOT NULL DEFAULT 0
);

INSERT INTO inventory (sku, qty) VALUES
('SKU-123', 10)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO inventory (sku, qty) VALUES
('SKU-456', 5)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO inventory (sku, qty) VALUES
('SKU-789', 0)
ON CONFLICT (sku) DO NOTHING;
