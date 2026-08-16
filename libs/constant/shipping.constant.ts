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

/**
 * GHN statuses we know about and deliberately do NOT map to a local
 * `OrderStatus` — the parcel is still moving inside GHN and no local state
 * describes where it is, so the order keeps whatever status it already has.
 *
 * Kept apart from a genuinely unknown string on purpose: an unknown status is a
 * gap in our mapping and must stay loud (warn + "Unhandled GHN status"), while
 * these are answered questions and must read as such in the console timeline.
 *
 * Why each one has no local status:
 * - `ready_to_pick` — the initial state; there is nothing to advance to.
 * - `money_collect_picking`, `storing`, `transporting`, `sorting`,
 *   `money_collect_delivering` — in-transit legs between SHIPPED and
 *   DELIVERING; we do not model GHN's internal hops.
 * - `delivery_fail` — a failed delivery ATTEMPT, not a failed delivery. GHN
 *   retries on its own and only then moves to the return family (which maps to
 *   CANCELED). Canceling on the first miss would release stock for a parcel
 *   that is still out for redelivery.
 * - `exception`, `damage`, `lost` — need a human/compensation decision.
 *   Mapping them to CANCELED would restock goods that no longer physically
 *   exist, so they are surfaced and left to an operator.
 */
export const GHN_STATUSES_WITHOUT_LOCAL_STATUS = [
  "ready_to_pick",
  "money_collect_picking",
  "storing",
  "transporting",
  "sorting",
  "money_collect_delivering",
  "delivery_fail",
  "exception",
  "damage",
  "lost",
] as const;

const ghnStatusesWithoutLocalStatus = new Set<string>(
  GHN_STATUSES_WITHOUT_LOCAL_STATUS,
);

/**
 * True when GHN's status is one we recognise but have no local status for.
 * Case-insensitive: GHN sends lower snake_case, the demo endpoint echoes back
 * whatever the caller typed.
 */
export const isGhnStatusWithoutLocalStatus = (ghnStatus: string): boolean =>
  ghnStatusesWithoutLocalStatus.has(ghnStatus.toLowerCase());
