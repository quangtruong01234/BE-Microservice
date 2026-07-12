import { PaymentMethod } from "@app/common";
import { OrderStatus } from "./entity/order.entity";
import { OrderItem } from "./entity/order_item.entity";
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

export interface AdminGhnOrderListItem {
  orderId: number;
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
    orderId: number;
    userId: number;
    sellerId: number;
    orderStatus: OrderStatus | undefined;
    ghnOrderCode: string | null;
    shippingAddress: string;
    shippingFee: number | null;
    codAmount: number | null;
    paymentMethod: PaymentMethod;
    total: number;
    items: OrderItem[];
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
  orderId: number;
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
  orderId: number;
  action: AdminGhnActionType;
  ghnOrderCode: string;
  previousStatus: OrderStatus | undefined;
  newStatus: OrderStatus | undefined;
  success: boolean;
  message: string;
  actionedAt: Date;
}

export interface AdminGhnUpdateCodResult {
  orderId: number;
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
  orderId: number;
  action: "update_receiver";
  ghnOrderCode: string;
  shippingAddress: string;
  updatedFields: string[];
  success: boolean;
  message: string;
  actionedAt: Date;
}

export interface GhnStatusApplyResult {
  previousStatus: OrderStatus | undefined;
  newStatus: OrderStatus | undefined;
  changed: boolean;
  message: string;
}
