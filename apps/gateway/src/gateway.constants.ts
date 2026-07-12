// VNPay signature verification hashes ALL vnp_* params, so the raw query
// record must reach the payments service intact — a whitelisted DTO would
// strip unknown fields and break the checksum. Bound the input manually.
export const PAYMENT_RESULT_MAX_QUERY_KEYS = 40;
export const PAYMENT_RESULT_MAX_VALUE_LENGTH = 512;
