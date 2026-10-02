/**
 * Session revocation (SESSION-REVOKE-01).
 *
 * `<prefix><userId>` holds an epoch in SECONDS. A JWT whose `iat` is strictly
 * lower than it is rejected by the gateway. The user service writes it on a
 * password change/reset and on a role change; the gateway writes it on
 * "log out all devices".
 *
 * The TTL must outlive the longest JWT the gateway signs — remember-me is 7d
 * and `JWT_EXPIRES_IN` is 7d on the shipped env — or a revoked token comes back
 * to life when the key expires. 30d leaves headroom for a longer
 * `JWT_EXPIRES_IN`; the key is one short string per revoking user.
 */
export const SESSION_VALID_AFTER_KEY_PREFIX = "auth:session:valid-after:";

export const SESSION_VALID_AFTER_TTL_SECONDS = 30 * 24 * 60 * 60;
