-- nodeA-20260925-001-add-cart-unique-constraints
-- AUD-0925-02. `carts` and `cart_items` shipped with nothing but their primary
-- keys (plus the implicit FK index on `cart_items.cart_id`), and
-- `CartService.addItem` is a find-then-insert with no lock. Two defects:
--
--   1. A double-tapped first "add to cart" seats two `carts` rows for one user.
--      `getCart` then reads one of them arbitrarily, so items "vanish" and
--      reappear between reads. It is also a full scan of `carts` on every cart
--      read and write, because `user_id` had no index at all.
--   2. A concurrent add of the same product/SKU seats two lines instead of
--      summing the quantity.
--
-- Fix: UNIQUE(user_id) on `carts`, and a UNIQUE functional index on
-- `cart_items (cart_id, product_id, COALESCE(sku_id, 0))`. The COALESCE is
-- required — MySQL never treats two NULLs as equal in a UNIQUE index, so a plain
-- `(cart_id, product_id, sku_id)` would leave every SKU-less product (the
-- common case) unprotected. 0 is a safe sentinel: `product_skus.id` is
-- AUTO_INCREMENT from 1. The code maps the resulting ER_DUP_ENTRY to a re-read
-- (cart) or an atomic increment (line), so the race resolves to the right state
-- instead of a 500.
--
-- Existing duplicates are MERGED first, not refused (unlike
-- 20260818-001-add-voucher-indexes): a duplicate cart is user data with an
-- obvious lossless merge, while aborting would block the CD deploy on a state
-- only a user could have created. Merge rules:
--   - carts:      keep MIN(id) per user_id, move every item onto it, delete the rest.
--   - cart_items: keep MIN(id) per (cart_id, product_id, sku key), set its
--                 quantity to the group SUM (clamped to INT max), delete the rest.
-- Both merges are no-ops when there is nothing to merge, and every index step
-- is guarded by INFORMATION_SCHEMA, so the whole file is safe to re-run.
-- Measured on DEV 2026-09-25 before applying: 2 carts / 2 users, 0 duplicate
-- lines — the merge had nothing to do there.

SET @schema := DATABASE();

-- 1. Merge duplicate carts onto the oldest row per user.
UPDATE `cart_items` ci
  JOIN `carts` c ON c.`id` = ci.`cart_id`
  JOIN (
    SELECT `user_id`, MIN(`id`) AS keeper_id
    FROM `carts`
    GROUP BY `user_id`
    HAVING COUNT(*) > 1
  ) keepers ON keepers.`user_id` = c.`user_id`
SET ci.`cart_id` = keepers.keeper_id
WHERE ci.`cart_id` <> keepers.keeper_id;

DELETE c
FROM `carts` c
  JOIN (
    SELECT `user_id`, MIN(`id`) AS keeper_id
    FROM `carts`
    GROUP BY `user_id`
    HAVING COUNT(*) > 1
  ) keepers ON keepers.`user_id` = c.`user_id`
WHERE c.`id` <> keepers.keeper_id;

-- 2. Merge duplicate lines (including the ones step 1 just co-located).
UPDATE `cart_items` ci
  JOIN (
    SELECT MIN(`id`) AS keeper_id,
           LEAST(SUM(`quantity`), 2147483647) AS total_quantity
    FROM `cart_items`
    GROUP BY `cart_id`, `product_id`, COALESCE(`sku_id`, 0)
    HAVING COUNT(*) > 1
  ) dup ON dup.keeper_id = ci.`id`
SET ci.`quantity` = dup.total_quantity;

DELETE ci
FROM `cart_items` ci
  JOIN (
    SELECT `cart_id`, `product_id`, COALESCE(`sku_id`, 0) AS sku_key,
           MIN(`id`) AS keeper_id
    FROM `cart_items`
    GROUP BY `cart_id`, `product_id`, COALESCE(`sku_id`, 0)
    HAVING COUNT(*) > 1
  ) dup ON dup.`cart_id` = ci.`cart_id`
       AND dup.`product_id` = ci.`product_id`
       AND dup.sku_key = COALESCE(ci.`sku_id`, 0)
WHERE ci.`id` <> dup.keeper_id;

-- 3. carts.user_id — one cart per user; also the index every cart read needs.
SET @has_cart_user_index := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'carts'
    AND INDEX_NAME = 'uq_carts_user_id'
);
SET @sql_cart_user_index := IF(
  @has_cart_user_index = 0,
  'CREATE UNIQUE INDEX `uq_carts_user_id` ON `carts` (`user_id`)',
  'SELECT 1'
);
PREPARE stmt_cart_user_index FROM @sql_cart_user_index;
EXECUTE stmt_cart_user_index;
DEALLOCATE PREPARE stmt_cart_user_index;

-- 4. cart_items — one line per (cart, product, SKU-or-none). Functional key
-- part needs MySQL >= 8.0.13 (Aiven dev/prod run 8.0.x).
SET @has_cart_line_index := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME = 'cart_items'
    AND INDEX_NAME = 'uq_cart_items_cart_product_sku'
);
SET @sql_cart_line_index := IF(
  @has_cart_line_index = 0,
  'CREATE UNIQUE INDEX `uq_cart_items_cart_product_sku`
     ON `cart_items` (`cart_id`, `product_id`, (COALESCE(`sku_id`, 0)))',
  'SELECT 1'
);
PREPARE stmt_cart_line_index FROM @sql_cart_line_index;
EXECUTE stmt_cart_line_index;
DEALLOCATE PREPARE stmt_cart_line_index;
