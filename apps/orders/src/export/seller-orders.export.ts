import { CsvColumn, formatVnTimestamp } from "@app/common";

/**
 * EXPORT-CSV-01 — column layout for the seller order export.
 *
 * Kept out of `orders.service.ts` so the service holds the query and the caps,
 * and this file holds the contract the seller actually opens in Excel. Changing
 * a header here changes a file people have built pivot tables on, so treat the
 * list as a published shape.
 */

export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Window and size caps. Raise only with evidence — at 5.000 rows the buffered
 * document is ~1.2 MB, which is the point of buffering it whole.
 */
export const EXPORT_MAX_WINDOW_DAYS = 90;
export const EXPORT_MAX_ROWS = 5000;

/**
 * One row per ITEM, not per order. Item granularity pivots up to order level
 * trivially in Excel, while order granularity loses the SKU breakdown
 * permanently.
 */
export interface SellerExportRow {
  orderId: string;
  orderDate: string;
  status: string;
  paymentMethod: string;
  paidAt: string;
  buyerName: string;
  buyerPhone: string;
  productId: string;
  productName: string;
  skuLabel: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  /** Order-level — written on the FIRST row of each order only, else null. */
  shippingFee: number | null;
  /**
   * Order-level — written on the FIRST row of each order only, else null.
   *
   * Without the two voucher columns below, `orderTotal` is unreconcilable from
   * the file: a discounted order shows `lineTotal 39` next to `orderTotal 0`
   * and the seller has no way to see the 39 came off as a voucher. They report
   * that as "the app computes money wrong", which is the exact complaint the
   * first-row-only rule was added to prevent.
   */
  discountAmount: number | null;
  /** Order-level — the code that produced `discountAmount`, or null. */
  voucherCode: string | null;
  /** Order-level — written on the FIRST row of each order only, else null. */
  orderTotal: number | null;
  trackingCode: string | null;
  ghnStatus: string | null;
}

/**
 * EXPORT-TZ-01 — `YYYY-MM-DD HH:mm:ss` in VN wall-clock, never the server's.
 *
 * This used to read the instant with local-time getters, which made the file
 * correct on a dev machine (UTC+7) and 7 hours wrong on prod (UTC) — invisible
 * until a seller compared the file against the same order on screen, where the
 * browser had always rendered it in their own zone.
 */
export function formatExportTimestamp(value: Date | string | null): string {
  return formatVnTimestamp(value);
}

export const SELLER_EXPORT_COLUMNS: CsvColumn<SellerExportRow>[] = [
  { header: "orderId", value: (row) => row.orderId },
  // EXPORT-TZ-01: the zone is in the HEADER, not appended to every value —
  // a trailing `+07:00` in the cell would stop Excel recognising it as a date,
  // which is the whole reason the value is formatted this way. Naming it is
  // what stops a seller silently assuming their own zone.
  { header: "orderDate (GMT+7)", value: (row) => row.orderDate },
  { header: "status", value: (row) => row.status },
  { header: "paymentMethod", value: (row) => row.paymentMethod },
  { header: "paidAt (GMT+7)", value: (row) => row.paidAt },
  { header: "buyerName", value: (row) => row.buyerName },
  // Literal: a Vietnamese mobile number starts with 0, which Excel eats.
  { header: "buyerPhone", value: (row) => row.buyerPhone, literal: true },
  { header: "productId", value: (row) => row.productId },
  { header: "productName", value: (row) => row.productName },
  { header: "skuLabel", value: (row) => row.skuLabel },
  { header: "quantity", value: (row) => row.quantity },
  { header: "unitPrice", value: (row) => row.unitPrice },
  { header: "lineTotal", value: (row) => row.lineTotal },
  { header: "shippingFee", value: (row) => row.shippingFee },
  // Between shippingFee and orderTotal on purpose: the money columns then read
  // left to right as the arithmetic the seller is checking —
  // SUM(lineTotal) + shippingFee - discountAmount = orderTotal.
  { header: "discountAmount", value: (row) => row.discountAmount },
  { header: "voucherCode", value: (row) => row.voucherCode },
  { header: "orderTotal", value: (row) => row.orderTotal },
  // Literal: GHN codes are long digit strings that become 1.23E+11 otherwise.
  { header: "trackingCode", value: (row) => row.trackingCode, literal: true },
  { header: "ghnStatus", value: (row) => row.ghnStatus },
];
