export interface CheckStockRequest {
  productId: string;
  quantity: number;
}

export interface CheckStockResponse {
  isAvailable: boolean;
  availableQuantity: number;
  requestedQuantity: number;
  message: string;
}

export interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}
