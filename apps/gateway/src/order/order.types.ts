export interface OrderResponse {
  id: number;
  userId: number;
  status: string;
  total: number;
  items: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductPriceResponse {
  id: number;
  userId: number;
  price: number | null;
  isActive: boolean;
  imageUrls?: string[] | null;
  variations?: { name: string; options: string[] }[] | null;
}

export interface SkuPriceResponse {
  id: number;
  productId: number;
  price: number;
  stockQuantity: number;
  isActive: boolean;
  tierIdx?: number[];
}

export interface EnrichedOrderItem {
  productId: number;
  productName: string;
  quantity: number;
  weight?: number;
  price: number;
  skuId: number | null;
  tierIdx: number[] | undefined;
  sellerId: number;
  productImage: string | null;
  skuLabel: string | null;
}

export interface BuyerInfo {
  id: number;
  username: string;
  email: string;
  name: string | null;
  avatar?: string | null;
  isActive?: boolean;
}

export interface OrderItemDetail {
  id: number;
  productId: number;
  sellerId: number;
  productName: string;
  quantity: number;
  price: number;
  skuId: number | null;
  skuTierIdx: string | null;
  productImage?: string | null;
  skuLabel?: string | null;
}

export interface SellerOrderDetailRaw extends OrderResponse {
  items: OrderItemDetail[];
}

export interface ProductDetailResponse {
  id: number;
  name: string;
  imageUrls: string[] | null;
  variations: { name: string; options: string[] }[] | null;
}

export interface UserSummary {
  id: number;
  username: string;
  email: string;
  name: string | null;
  avatar?: string | null;
}

export interface AdminGhnOrderListItem {
  orderId: number;
  userId: number;
  sellerId: number;
  orderStatus: string;
  ghnOrderCode: string | null;
  shippingFee: number | null;
  codAmount: number | null;
  paymentMethod: string;
  lastGhnStatus: string | null;
  lastSyncedAt: string | Date | null;
  updatedAt: string | Date;
  availableActions: string[];
}

export interface AdminGhnOrderListResult {
  data: AdminGhnOrderListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages?: number;
  hasNext?: boolean;
}
