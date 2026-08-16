import { PaymentMethod } from "@app/common";

export interface OrderResponse {
  id: number;
  // PUBID-01: opaque external id (`ord_...`) carried alongside the numeric PK
  // over TCP; the gateway exposes it as `id` and never leaks the PK over HTTP.
  publicId?: string | null;
  userId: number;
  status: string;
  total: number;
  // Money breakdown persisted on the order (nullable for legacy orders / no
  // voucher). The gateway normalizes shippingFee to a number and adds an
  // explicit goods `subtotal` on read paths so the FE can render the price
  // breakdown without client-side derivation.
  shippingFee?: number | null;
  discountAmount?: number | null;
  paymentMethod?: PaymentMethod | null;
  // ORD-GUARD-01: when the money was actually collected. NULL on an online
  // order means the buyer never completed the checkout — the FE branches on it
  // to keep showing "THANH TOÁN NGAY" and to hide the seller's confirm action.
  paidAt?: string | null;
  subtotal?: number;
  items: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductPriceResponse {
  id: number;
  publicId?: string | null;
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
  productPublicId: string;
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
  // Numeric over TCP; exposed as the opaque `usr_...` public id (PUBID-02).
  id: number | string;
  publicId?: string | null;
  username: string;
  email: string;
  name: string | null;
  avatar?: string | null;
  isActive?: boolean;
}

export interface OrderItemDetail {
  id: number;
  productId: number;
  productPublicId?: string | null;
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
  publicId?: string | null;
  name: string;
  imageUrls: string[] | null;
  variations: { name: string; options: string[] }[] | null;
}

export interface UserSummary {
  // Numeric over TCP; exposed as the opaque `usr_...` public id (PUBID-02).
  id: number | string;
  publicId?: string | null;
  username: string;
  email: string;
  name: string | null;
  avatar?: string | null;
}

export interface AdminGhnOrderListItem {
  // PUBID-01: the orders service already maps this to the opaque public id.
  orderId: string;
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

/**
 * Analytics payload as the orders service returns it. Mirrored here because the
 * gateway must not import from another app; only the fields the gateway itself
 * reads (the monetary ones it may have to omit) are modelled precisely.
 */
export interface OrderAnalyticsResponse {
  scope: string;
  from: string;
  to: string;
  interval: string;
  summary: {
    totalRevenue: number;
    completedOrders: number;
    totalOrders: number;
    averageOrderValue: number;
  };
  revenueOverTime: { period: string; revenue: number; orderCount: number }[];
  statusDistribution: Record<string, number>;
  topProducts: {
    // Numeric from the orders service; exposed as the opaque `prod_...` public
    // id, or null when the product can no longer be resolved (PUBID).
    productId: number | string | null;
    productName: string;
    quantitySold: number;
    revenue: number;
  }[];
}
