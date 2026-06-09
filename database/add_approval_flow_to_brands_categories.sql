-- Migration: Add approval flow columns to brands and categories tables
-- Target: MySQL (product service DB on Aiven)

ALTER TABLE brands
  ADD COLUMN status ENUM('pending', 'active', 'rejected') NOT NULL DEFAULT 'pending',
  ADD COLUMN submitted_by INT NULL,
  ADD COLUMN review_note VARCHAR(255) NULL;

ALTER TABLE categories
  ADD COLUMN status ENUM('pending', 'active', 'rejected') NOT NULL DEFAULT 'pending',
  ADD COLUMN submitted_by INT NULL,
  ADD COLUMN review_note VARCHAR(255) NULL;

-- Treat all existing rows as already approved
UPDATE brands SET status = 'active' WHERE status = 'pending';
UPDATE categories SET status = 'active' WHERE status = 'pending';
