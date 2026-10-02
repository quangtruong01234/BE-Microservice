export const SEARCH_CACHE_TTL = 5; // seconds
export const CATALOG_LOOKUP_CACHE_TTL = 300; // seconds
export const CATALOG_LOOKUP_STATUSES = [
  "active",
  "pending",
  "rejected",
] as const;
export const CATALOG_UNIQUE_STATUSES = ["active", "pending"] as const;

/**
 * WISHLIST-ALERT-01 — one alert of a kind per product per window, so a stock
 * level flapping around zero (reserve → cancel → reserve) or a seller nudging
 * the price down twice cannot spam the same wishlisters.
 */
export const WISHLIST_ALERT_COOLDOWN_SECONDS = {
  back_in_stock: 6 * 60 * 60,
  price_drop: 24 * 60 * 60,
} as const;
/** Most recent wishlisters notified per alert — bounds the event and the batch insert. */
export const WISHLIST_ALERT_MAX_RECIPIENTS = 1000;
