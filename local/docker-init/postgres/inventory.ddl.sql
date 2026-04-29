-- PostgreSQL DDL for Inventory Service
CREATE TABLE inventory (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL,
    quantity INT NOT NULL,
    location VARCHAR(128),
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_product FOREIGN KEY(product_id) REFERENCES products(id)
);

CREATE INDEX idx_inventory_product_id ON inventory(product_id);