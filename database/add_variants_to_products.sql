-- Migration: add variants JSON column to products table
-- Run against MySQL after docker-compose up
-- Safe to run on existing data: column is nullable with NULL default

ALTER TABLE products
  ADD COLUMN variants JSON NULL DEFAULT NULL
  COMMENT 'Array of variant objects: [{id: string, name: string}]';
