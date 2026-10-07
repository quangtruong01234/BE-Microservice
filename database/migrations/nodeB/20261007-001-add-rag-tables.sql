-- nodeB-20261007-001-add-rag-tables
-- PRODUCT-QA-01. The assistant service keeps a per-product retrieval index in
-- the nodeB PostgreSQL: one rag_documents row per product (content hash, index
-- status, retry bookkeeping) and its rag_chunks (text + a 768-dim Gemini
-- embedding). Retrieval is always scoped to one product_id, so the exact `<=>`
-- scan over that product's <=100 chunks needs no ANN index.
-- product_id is the products.id of the nodeA MySQL; there is no FK across the
-- two databases. The assistant deletes a product's rows when the product
-- becomes inactive or disappears.
-- First extension in this database: if Aiven refuses CREATE EXTENSION, the
-- whole file rolls back (one implicit transaction) and nothing is recorded.
-- Additive + idempotent (IF NOT EXISTS everywhere). Safe to re-run.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rag_documents (
  product_id BIGINT PRIMARY KEY,
  content_hash CHAR(64) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('indexed', 'pending')),
  attempts INT NOT NULL DEFAULT 0,
  indexed_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rag_chunks (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL,
  source VARCHAR(16) NOT NULL CHECK (source IN ('PRODUCT', 'SKU', 'REVIEW')),
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(768) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_rag_chunks_product_chunk UNIQUE (product_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_rag_documents_status_updated
  ON rag_documents (status, updated_at);
