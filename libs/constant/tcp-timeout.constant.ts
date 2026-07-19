/**
 * Gateway TCP call timeout budget (SCALE-05a).
 *
 * READ  — queries whose only downstream work is DB/cache lookups. Under
 *         saturation a 10s timeout parks sockets and cascades the pileup;
 *         5s sheds stuck reads faster while staying far above normal
 *         latency (p99 well under 1s).
 * WRITE — mutations and any call whose downstream leg hits an external
 *         API (GHN, ZaloPay/VNPay, Gemini): these can legitimately take
 *         several seconds, so they keep the original 10s budget.
 */
export const TCP_TIMEOUT_MS = {
  READ: 5000,
  WRITE: 10000,
} as const;
