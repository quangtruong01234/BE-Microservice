export const NOTIFICATION_TEXT_MAX_LENGTH = 255;

/**
 * SOCIAL-LIKE-NTF-01 — likes on one post collapse into ONE unread `like` row
 * per (owner, post). The running count lives in the message text itself (no
 * column for it, by design: no migration), so the message format below is a
 * contract the storefront parses — change it and the FE count breaks.
 */
export const LIKE_NOTIFICATION_TYPE = "like";
export const LIKE_NOTIFICATION_SINGLE_MESSAGE = "Someone liked your post";
export const LIKE_NOTIFICATION_COUNT_PATTERN = /^(\d+) people liked your post$/;
/** Compare-and-swap retries when two likes race on the same unread row. */
export const LIKE_NOTIFICATION_CAS_MAX_ATTEMPTS = 3;

/** WISHLIST-ALERT-01 — the `type` each alert kind is stored and exposed as. */
export const WISHLIST_ALERT_NOTIFICATION_TYPES = {
  back_in_stock: "wishlist_back_in_stock",
  price_drop: "wishlist_price_drop",
} as const;
/** Keeps the longest price-drop message inside NOTIFICATION_TEXT_MAX_LENGTH. */
export const WISHLIST_ALERT_PRODUCT_NAME_MAX_LENGTH = 120;
