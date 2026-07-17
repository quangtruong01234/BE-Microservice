/**
 * Prefixes for Stripe-style opaque public ids (`<prefix>_<16 base62 chars>`).
 * Only tables whose ids are exposed on HTTP route params/responses get one —
 * internal PKs/FKs stay numeric (see snapshot.md "Public-ID backlog").
 */
export const PUBLIC_ID_PREFIXES = {
  USER: "usr",
  ORDER: "ord",
  PRODUCT: "prod",
  POST: "post",
  COMMENT: "cmt",
  CONVERSATION: "conv",
  MESSAGE: "msg",
  ADDRESS: "addr",
  RETURN_REQUEST: "rr",
  NOTIFICATION: "ntf",
} as const;

export type PublicIdPrefix =
  (typeof PUBLIC_ID_PREFIXES)[keyof typeof PUBLIC_ID_PREFIXES];

/** Length of the random base62 part after `<prefix>_`. */
export const PUBLIC_ID_RANDOM_LENGTH = 16;
