export const INVENTORY_MESSAGE_PATTERNS = {
  // Basic CRUD operations
  INVENTORY_CREATE: 'inventory.create',
  INVENTORY_FIND_ALL: 'inventory.find_all',
  INVENTORY_FIND_ONE: 'inventory.find_one',
  INVENTORY_FIND_BY_PRODUCT_ID: 'inventory.find_by_product_id',
  INVENTORY_FIND_BY_SKU: 'inventory.find_by_sku',
  INVENTORY_GET_BY_PRODUCT_IDS: 'inventory.get_by_product_ids',
  INVENTORY_UPDATE: 'inventory.update',
  INVENTORY_REMOVE: 'inventory.remove',

  // Stock operations
  INVENTORY_CHECK_STOCK: 'inventory.check_stock',
  INVENTORY_RESERVE_STOCK: 'inventory.reserve_stock',
  INVENTORY_RELEASE_STOCK: 'inventory.release_stock',
  INVENTORY_CONSUME_RESERVED_STOCK: 'inventory.consume_reserved_stock',
  INVENTORY_GET_LOW_STOCK: 'inventory.get_low_stock',
} as const;