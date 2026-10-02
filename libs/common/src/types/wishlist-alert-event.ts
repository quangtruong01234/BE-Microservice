/**
 * WISHLIST-ALERT-01 — published by product on PRODUCT_EXCHANGE as
 * `EVENT.WISHLIST_ALERT_EVENT`, consumed by notification. One event per alert
 * carries every recipient, so notification saves the batch atomically.
 */
export const WISHLIST_ALERT_KINDS = ["back_in_stock", "price_drop"] as const;
export type WishlistAlertKind = (typeof WISHLIST_ALERT_KINDS)[number];

export interface WishlistAlertEvent {
  kind: WishlistAlertKind;
  productId: number;
  productPublicId: string;
  productName: string;
  userIds: number[];
  /** Set on `price_drop` only. */
  previousPrice: number | null;
  price: number | null;
}
