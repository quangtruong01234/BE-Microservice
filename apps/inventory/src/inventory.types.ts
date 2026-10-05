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

export interface StockCheckResult {
  productId: number;
  sku: string;
  available: boolean;
  availableStock: number;
  requestedQuantity: number;
}
