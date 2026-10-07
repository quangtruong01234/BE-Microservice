export interface ProductResponse {
  id: number;
  price: number | null;
  isActive: boolean;
}

export interface ProductSkuResponse {
  productId: number;
  tierIdx: number[] | string;
  isActive: boolean;
}

/** The fields of an orders-service cart line the add-to-cart gate reads. */
export interface CartLineResponse {
  productId: number;
  skuId: number | null;
  quantity: number;
}

export interface CartResponse {
  items: CartLineResponse[];
}

/** `INVENTORY_CHECK_STOCK` answer — no inventory row reads as 0 available. */
export interface StockCheckResponse {
  available: boolean;
  availableStock: number;
}
