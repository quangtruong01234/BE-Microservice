import { PaymentMethod } from "@app/common";
import { OrderStatus } from "./entity/order.entity";
import { OrderItem } from "./entity/order_item.entity";
import { OrderReturnRequest } from "./entity/order-return-request.entity";
import { Voucher, VoucherDiscountType } from "./entity/voucher.entity";
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

/**
 * EXPORT-CSV-01 — one seller's order items over a bounded window, rendered as a
 * CSV file. Both bounds are REQUIRED (unlike analytics, which defaults to the
 * last 30 days): an export with an implicit range is how someone accidentally
 * downloads the whole history and then reports the endpoint as slow.
 */
export interface SellerOrdersExportQuery {
  sellerId: number;
  from: string;
  to: string;
  status?: string;
}

/**
 * EXPORT-CSV-01 T4 — the platform-wide export. `sellerId` is an optional
 * filter (already resolved from `usr_…` by the gateway); absent means every
 * seller.
 */
export interface AdminOrdersExportQuery {
  sellerId?: number;
  from: string;
  to: string;
  status?: string;
}

/**
 * The one scope every export path renders from: `sellerId: null` is the
 * platform-wide file. Kept separate from the two request shapes so the sync
 * routes and the async job (T5) cannot drift into two row builders.
 */
export interface OrderExportScope {
  sellerId: number | null;
  from: string;
  to: string;
  status?: string;
}

export interface OrderExportCaps {
  maxWindowDays: number;
  maxRows: number;
}

/**
 * RAIL-RANK-01 — storefront "Seller nổi bật" / "Đang hot" rankings: units sold
 * over a rolling window of committed orders. Ties break on distinct orders,
 * then on the lower id, so the rail is stable between refreshes.
 */
export interface TopSellingQuery {
  limit?: number;
}

export interface TopSellingSeller {
  sellerId: number;
  soldCount: number;
}

export interface TopSellingProduct {
  productId: number;
  productPublicId: string | null;
  soldCount: number;
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

/** One code applied to a checkout, priced (VOUCHER-SHOP-01 phase 2). */
export interface CheckoutVoucher {
  voucher: Voucher;
  discountAmount: number;
}

/**
 * Every code of one checkout, resolved: at most one shop voucher per seller
 * plus at most one platform voucher, whose discount is split across the
 * sellers pro rata to what each still charges after its shop voucher.
 */
export interface CheckoutVoucherPlan {
  /** In request order — the order the preview reports them back in. */
  vouchers: CheckoutVoucher[];
  shopVoucherBySellerId: Map<number, CheckoutVoucher>;
  platformVoucher: CheckoutVoucher | null;
  platformShareBySellerId: Map<number, number>;
  totalDiscount: number;
}

/** One line of a voucher preview. */
export interface VoucherPreviewLine {
  code: string;
  scope: "platform" | "shop";
  /** Owning shop (numeric here; the gateway swaps it for the `usr_` public id). */
  sellerId: number | null;
  discountType: VoucherDiscountType;
  discountAmount: number;
}

/**
 * What a voucher preview answers with. `code`/`discountType` describe the
 * FIRST code (the phase-1 single-code shape); `discountAmount` is the total
 * over every code, and `vouchers` itemises them.
 */
export interface VoucherPreview {
  code: string;
  discountType: VoucherDiscountType;
  discountAmount: number;
  itemsTotal: number;
  finalItemsTotal: number;
  vouchers: VoucherPreviewLine[];
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

/** T4 — the seller label appended to each admin export row. */
export interface ExportSellerLabel {
  publicId: string;
  username: string;
}

// EXPORT-CSV-01 T5 — async export jobs -----------------------------------------

/**
 * `requestedBy` is the caller's numeric id (from the JWT, never the body).
 * On a `seller` job `sellerId` is that same caller; on an `admin` job it is
 * the optional, already-resolved seller filter.
 */
export interface CreateExportJobPayload {
  requestedBy: number;
  scope: "seller" | "admin";
  sellerId: number | null;
  from: string;
  to: string;
  status?: string;
}

export interface ExportJobLookupPayload {
  requestedBy: number;
  /** The job's public `exp_…` id. */
  jobId: string;
}

/** What leaves the orders service for a job — no numeric id. */
export interface ExportJobView {
  id: string;
  scope: "seller" | "admin";
  from: string;
  to: string;
  statusFilter: string | null;
  state: "pending" | "running" | "done" | "failed" | "expired";
  rowCount: number | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  expiresAt: Date | null;
}

/**
 * The file travels as base64, not as a Buffer: a Buffer is JSON-serialized
 * over TCP as `{ type, data: number[] }`, ~4 bytes per byte on the wire.
 */
export interface ExportJobDownload {
  fileName: string;
  contentBase64: string;
}
