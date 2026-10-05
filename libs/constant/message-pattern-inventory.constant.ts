export const INVENTORY_MESSAGE_PATTERNS = {
  // Basic CRUD operations
  INVENTORY_CREATE: "inventory.create",
  INVENTORY_FIND_ONE: "inventory.find_one",
  INVENTORY_FIND_BY_PRODUCT_ID: "inventory.find_by_product_id",
  INVENTORY_GET_BY_PRODUCT_IDS: "inventory.get_by_product_ids",
  INVENTORY_UPDATE: "inventory.update",
  INVENTORY_REMOVE_BY_PRODUCT: "inventory.remove_by_product",

  // Stock operations
  INVENTORY_CHECK_STOCK: "inventory.check_stock",
  INVENTORY_RESERVE_STOCK: "inventory.reserve_stock",
  // SWEEP-1002-05: every line of one checkout in a single all-or-nothing PG transaction
  INVENTORY_RESERVE_STOCK_MANY: "inventory.reserve_stock_many",
  INVENTORY_RELEASE_STOCK: "inventory.release_stock",
  INVENTORY_CONSUME_RESERVED_STOCK: "inventory.consume_reserved_stock",
  // SWEEP-1005-02: every line of one order's reservation in a single PG transaction
  INVENTORY_RELEASE_STOCK_MANY: "inventory.release_stock_many",
  INVENTORY_CONSUME_RESERVED_STOCK_MANY:
    "inventory.consume_reserved_stock_many",
  INVENTORY_RESTOCK_RETURNED: "inventory.restock_returned",
  INVENTORY_GET_LOW_STOCK: "inventory.get_low_stock",
} as const;
