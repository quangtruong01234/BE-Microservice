/**
 * The order lifecycle statuses, as they appear on the wire (HTTP query params,
 * TCP payloads, `orders.status`).
 *
 * The enum itself lives with the entity (`apps/orders/src/entity/order.entity.ts`)
 * because TypeORM needs it there; this list is the copy the gateway validates
 * incoming filters against, since the gateway must not import from another app.
 * A compile-time guard in the entity file fails the build if a status is added
 * to the enum without being added here.
 */
export const ORDER_STATUS_VALUES = [
  "pending",
  "confirmed",
  "processing",
  "shipped",
  "delivering",
  "completed",
  "canceled",
  "return_requested",
  "refunded",
] as const;

export type OrderStatusValue = (typeof ORDER_STATUS_VALUES)[number];
