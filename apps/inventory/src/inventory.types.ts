export interface CreateInventoryDto {
  productId: number;
  productSkuId?: number;
  sku: string;
  availableStock: number;
  minimumStock?: number;
  location?: string;
}

export interface UpdateInventoryDto {
  sku?: string;
  availableStock?: number;
  reservedStock?: number;
  minimumStock?: number;
  location?: string;
  isActive?: boolean;
}

export interface ReserveStockLine {
  productId: number;
  quantity: number;
  /** Absent or null ⇒ the product's base (non-SKU) stock row. */
  skuId?: number | null;
}

/**
 * Answer of INVENTORY_RESERVE_STOCK_MANY. All-or-nothing: when `isReserved` is
 * false NOTHING was held, and `failedProductId` names the first line (in
 * request order) that could not be reserved.
 */
export interface ReserveStockManyResult {
  isReserved: boolean;
  failedProductId: number | null;
}

/**
 * Answer of INVENTORY_RELEASE_STOCK_MANY / INVENTORY_CONSUME_RESERVED_STOCK_MANY.
 * NOT all-or-nothing: every line not named in `failedProductIds` reached the
 * target state (or already was in it), and a retry of the same batch is a
 * no-op for those lines.
 */
export interface TransitionStockManyResult {
  failedProductIds: number[];
}

export interface StockCheckResult {
  productId: number;
  sku: string;
  available: boolean;
  availableStock: number;
  requestedQuantity: number;
}
