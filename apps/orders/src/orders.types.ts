import { PaymentMethod } from "@app/common";
import { OrderStatus } from "./entity/order.entity";
import { OrderItem } from "./entity/order_item.entity";
import { OrderReturnRequest } from "./entity/order-return-request.entity";
import { GhnOrderDetail } from "./ghn/ghn.types";

export type StockReservationItem = {
  productId: number;
  quantity: number;
  skuId?: number | null;
};

export interface AdminGhnOrderListQuery {
  page: number;
  limit: number;
  status?: string;
  ghnStatus?: string;
  hasGhnCode?: boolean;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

// PUBID-01: `orderId` on all admin-GHN response shapes is the opaque public id
// (`ord_...`) — the numeric PK never leaves the orders service on these paths.
export interface AdminGhnOrderListItem {
  orderId: string;
  userId: number;
  sellerId: number;
  orderStatus: OrderStatus | undefined;
  ghnOrderCode: string | null;
  shippingFee: number | null;
  codAmount: number | null;
  paymentMethod: PaymentMethod;
  lastGhnStatus: string | null;
  lastSyncedAt: Date | null;
  updatedAt: Date;
  availableActions: string[];
}

export interface AdminGhnOrderDetail {
  localOrder: {
    orderId: string;
    userId: number;
    sellerId: number;
    orderStatus: OrderStatus | undefined;
    ghnOrderCode: string | null;
    shippingAddress: string;
    shippingFee: number | null;
    codAmount: number | null;
    paymentMethod: PaymentMethod;
    total: number;
    // PUBID-01: items are exposed without their numeric `orderId` FK.
    items: Omit<OrderItem, "orderId">[];
    createdAt: Date;
    updatedAt: Date;
  };
  ghnDetail: GhnOrderDetail | null;
  ghnDetailError: string | null;
  lastGhnStatus: string | null;
  lastSyncedAt: Date | null;
  availableActions: string[];
}

export interface AdminGhnSyncResult {
  orderId: string;
  previousStatus: OrderStatus | undefined;
  newStatus: OrderStatus | undefined;
  ghnStatus: string;
  syncedAt: Date;
}

// F4 — analytics dashboard aggregates.
export interface AnalyticsQuery {
  // null → global scope (admin / shipping console); a number → single seller.
  sellerId: number | null;
  from?: string;
  to?: string;
  interval?: "day" | "month";
  topN?: number;
}

export interface RevenuePoint {
  period: string;
  revenue: number;
  orderCount: number;
}

export interface TopProduct {
  productId: number;
  productName: string;
  quantitySold: number;
  revenue: number;
}

export interface OrderAnalytics {
  scope: "seller" | "global";
  from: string;
  to: string;
  interval: "day" | "month";
  summary: {
    totalRevenue: number;
    completedOrders: number;
    totalOrders: number;
    averageOrderValue: number;
  };
  revenueOverTime: RevenuePoint[];
  statusDistribution: Record<string, number>;
  topProducts: TopProduct[];
}

export type AdminGhnActionType = "cancel" | "return";

export interface AdminGhnActionResult {
  orderId: string;
  action: AdminGhnActionType;
  ghnOrderCode: string;
  previousStatus: OrderStatus | undefined;
  newStatus: OrderStatus | undefined;
  success: boolean;
  message: string;
  actionedAt: Date;
}

export interface AdminGhnUpdateCodResult {
  orderId: string;
  action: "update_cod";
  ghnOrderCode: string;
  previousCodAmount: number;
  newCodAmount: number;
  success: boolean;
  message: string;
  actionedAt: Date;
}

export interface AdminGhnReceiverUpdateInput {
  toName?: string;
  toPhone?: string;
  toAddress?: string;
}

export interface AdminGhnUpdateReceiverResult {
  orderId: string;
  action: "update_receiver";
  ghnOrderCode: string;
  shippingAddress: string;
  updatedFields: string[];
  success: boolean;
  message: string;
  actionedAt: Date;
}

// PUBID-01: return-request rows carry the parent order's public id so the FE
// can deep-link the order without the numeric id (request.id stays numeric
// until PUBID-04).
export type ReturnRequestView = OrderReturnRequest & {
  orderPublicId: string | null;
};

export interface GhnStatusApplyResult {
  previousStatus: OrderStatus | undefined;
  newStatus: OrderStatus | undefined;
  changed: boolean;
  message: string;
}
