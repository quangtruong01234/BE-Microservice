-- Migration: add_shipping_roles
-- Target DB: MySQL (defaultdb / user tables)
-- Adds GHN web shipping roles:
--   logistics_operator -> shipping read:any (read-only shipment ops)
--   shipping_manager   -> shipping read:any + update:any (manual sync / status ops)
-- Admin keeps full shipping access; these roles exist so the FE never hardcodes
-- admin as the production shipping role.
-- Safe to re-run: enum MODIFY is idempotent, INSERT IGNORE skips existing slugs.

-- 1. Extend the rol_name enum with the two new shipping roles.
ALTER TABLE `roles`
  MODIFY COLUMN `rol_name`
  ENUM('user','shop','admin','logistics_operator','shipping_manager')
  NOT NULL DEFAULT 'user';

-- 2. Register the shipping resource (idempotent on res_slug).
INSERT IGNORE INTO `resources` (`res_name`, `res_slug`, `res_description`, `res_created_by`) VALUES
  ('shipping', 'shipping', 'Shipping / GHN logistics management', 'system');

-- 3. Seed the two roles. rol_grants mirrors grants.ts for documentation/UI; the
--    runtime authorization check is driven by apps/user/src/rbac/grants.ts (ac),
--    so the resourceId below is resolved from the live resources table.
INSERT IGNORE INTO `roles`
  (`rol_name`, `rol_slug`, `rol_status`, `rol_description`, `rol_created_by`, `rol_updated_by`, `rol_grants`)
SELECT
  'logistics_operator', 'logistics-operator-001', 'active',
  'Logistics operator: read-only GHN shipping access', 'system', 'system',
  JSON_ARRAY(JSON_OBJECT(
    'resourceId', r.res_id,
    'actions', JSON_ARRAY('read:any'),
    'attributes', '*',
    'conditions', ''
  ))
FROM `resources` r WHERE r.res_slug = 'shipping';

INSERT IGNORE INTO `roles`
  (`rol_name`, `rol_slug`, `rol_status`, `rol_description`, `rol_created_by`, `rol_updated_by`, `rol_grants`)
SELECT
  'shipping_manager', 'shipping-manager-001', 'active',
  'Shipping manager: read + update GHN shipping', 'system', 'system',
  JSON_ARRAY(JSON_OBJECT(
    'resourceId', r.res_id,
    'actions', JSON_ARRAY('read:any', 'update:any'),
    'attributes', '*',
    'conditions', ''
  ))
FROM `resources` r WHERE r.res_slug = 'shipping';
