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

export interface StockCheckResult {
  productId: number;
  sku: string;
  available: boolean;
  availableStock: number;
  requestedQuantity: number;
}
