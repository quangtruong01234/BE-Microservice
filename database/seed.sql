-- Seed: default resources and roles for TryBuy
-- Run after: add_resources_roles_tables.sql
-- Safe to re-run: INSERT IGNORE skips duplicates on res_slug / rol_slug

-- ============================================================
-- RESOURCES
-- ============================================================
INSERT IGNORE INTO `resources` (`res_name`, `res_slug`, `res_description`, `res_created_by`) VALUES
  ('product',   'product',   'Product management',   'system'),
  ('order',     'order',     'Order management',     'system'),
  ('user',      'user',      'User management',      'system'),
  ('inventory', 'inventory', 'Inventory management', 'system'),
  ('payment',   'payment',   'Payment management',   'system'),
  ('rewards',   'rewards',   'Rewards management',   'system');

-- ============================================================
-- ROLES  (resourceId: product=1, order=2, user=3, inventory=4, payment=5, rewards=6)
-- ============================================================
INSERT IGNORE INTO `roles` (`rol_name`, `rol_slug`, `rol_status`, `rol_description`, `rol_created_by`, `rol_updated_by`, `rol_grants`) VALUES
('admin', 'admin-001', 'active', 'Full access to all resources', 'system', 'system', '[{"resourceId":1,"actions":["create:any","read:any","update:any","delete:any"],"attributes":"*","conditions":""},{"resourceId":2,"actions":["create:any","read:any","update:any","delete:any"],"attributes":"*","conditions":""},{"resourceId":3,"actions":["read:any","update:any","delete:any"],"attributes":"*","conditions":""},{"resourceId":4,"actions":["read:any","update:any"],"attributes":"*","conditions":""},{"resourceId":5,"actions":["read:any"],"attributes":"*","conditions":""},{"resourceId":6,"actions":["read:any"],"attributes":"*","conditions":""}]'),
('shop',  'shop-001',  'active', 'Shop owner: product + order + inventory access', 'system', 'system', '[{"resourceId":1,"actions":["create:own","read:any","update:own","delete:own"],"attributes":"*","conditions":""},{"resourceId":2,"actions":["read:any","update:own"],"attributes":"*","conditions":""},{"resourceId":3,"actions":["read:own","update:own"],"attributes":"*, !password","conditions":""},{"resourceId":4,"actions":["read:own","update:own"],"attributes":"*","conditions":""}]'),
('user',  'user-001',  'active', 'Regular buyer: order + payment + rewards access', 'system', 'system', '[{"resourceId":2,"actions":["create:own","read:own","update:own"],"attributes":"*","conditions":""},{"resourceId":3,"actions":["read:own","update:own"],"attributes":"*, !password","conditions":""},{"resourceId":5,"actions":["read:own"],"attributes":"*","conditions":""},{"resourceId":6,"actions":["read:own"],"attributes":"*","conditions":""}]');
