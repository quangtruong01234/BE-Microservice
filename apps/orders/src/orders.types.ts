import { PaymentMethod } from "@app/common";
import { OrderStatus } from "./entity/order.entity";
import { OrderItem } from "./entity/order_item.entity";
import { OrderReturnRequest } from "./entity/order-return-request.entity";
import { VoucherDiscountType } from "./entity/voucher.entity";
import { GhnOrderDetail } from "./ghn/ghn.types";
import { VoucherIneligibleReason } from "libs/constant/response-message.constant";

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

// VOUCHER-SHOP-01 -------------------------------------------------------------

/** Everything the voucher rules are evaluated against for one basket. */
export interface VoucherEvaluationContext {
  /** Goods subtotal of the whole basket — what a platform voucher prices against. */
  itemsTotal: number;
  /** Goods subtotal per seller — what a shop voucher prices against. */
  subtotalBySellerId: Map<number, number>;
  /** Redemptions this buyer already holds for this voucher. */
  userRedemptionCount: number;
  now: Date;
}

/** Verdict of the single shared voucher evaluator. Never throws. */
export interface VoucherEvaluation {
  isEligible: boolean;
  /** Stable enum-ish reason when `isEligible` is false, else null. */
  ineligibleReason: VoucherIneligibleReason | null;
  /** Discount this voucher gives right now — 0 when it is not applicable. */
  discountAmount: number;
  /** The slice of the basket this voucher prices against. */
  applicableSubtotal: number;
  /** How much more the buyer must spend to reach `minOrderAmount`; 0 when met. */
  amountToAdd: number;
}

/** What a single-seller voucher preview answers with. */
export interface VoucherPreview {
  code: string;
  discountType: VoucherDiscountType;
  discountAmount: number;
  itemsTotal: number;
  finalItemsTotal: number;
}

/** One row of the buyer-facing basket voucher list. */
export interface AvailableVoucher {
  code: string;
  description: string | null;
  discountType: VoucherDiscountType;
  discountValue: number;
  minOrderAmount: number;
  maxDiscountAmount: number | null;
  /** Owning shop (numeric here; the gateway swaps it for the `usr_` public id). */
  sellerId: number | null;
  scope: "platform" | "shop";
  isEligible: boolean;
  ineligibleReason: VoucherIneligibleReason | null;
  discountAmount: number;
  applicableSubtotal: number;
  amountToAdd: number;
}
