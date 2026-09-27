/**
 * Upper bound for one cart line — per request AND for the summed line
 * (AUD-0925-03). Far above any real basket (the storefront caps a single add at
 * 99) and far below MySQL INT max, so a runaway client gets a 400 instead of an
 * out-of-range 500.
 */
export const MAX_CART_LINE_QUANTITY = 999;
