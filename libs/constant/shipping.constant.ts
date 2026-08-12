/**
 * Shipping-console vocabulary shared by the gateway and the orders service.
 *
 * The gateway must not import from another app, so anything both sides need to
 * agree on (the action names surfaced in `availableActions`, the GHN status
 * values an admin filter may carry) lives here rather than in `apps/orders`.
 */

/**
 * Every action name `getAvailableShippingActions` can emit, in the order it
 * emits them.
 */
export const SHIPPING_ACTIONS = [
  "read",
  "history",
  "sync",
  "cancel",
  "return",
  "update_cod",
  "update_receiver",
] as const;

export type ShippingAction = (typeof SHIPPING_ACTIONS)[number];

/**
 * The subset reachable with `shipping read:any` alone. Everything else is
 * routed through an endpoint gated on `shipping update:any`, so advertising it
 * to a `logistics_operator` would promise a button that answers 403.
 */
export const READ_ONLY_SHIPPING_ACTIONS: readonly ShippingAction[] = [
  "read",
  "history",
];

/**
 * GHN waybill statuses, as GHN itself writes them on the webhook and the
 * order-detail response — this is what `shipping_history.ghn_status` stores and
 * therefore what the admin list filter may be given. Wider than
 * `DEMO_GHN_STATUSES` (the handful the demo endpoint may simulate) on purpose.
 */
export const GHN_STATUS_VALUES = [
  "ready_to_pick",
  "picking",
  "money_collect_picking",
  "picked",
  "storing",
  "transporting",
  "sorting",
  "delivering",
  "money_collect_delivering",
  "delivered",
  "delivery_fail",
  "waiting_to_return",
  "return",
  "return_transporting",
  "return_sorting",
  "returning",
  "return_fail",
  "returned",
  "cancel",
  // GHN's own docs use `cancel`; the demo endpoint and some payloads use the
  // past-tense spelling, so both are accepted as a filter value.
  "cancelled",
  "exception",
  "damage",
  "lost",
] as const;

export type GhnStatusValue = (typeof GHN_STATUS_VALUES)[number];
