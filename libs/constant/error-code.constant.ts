/**
 * Stable, machine-readable error codes carried by the HTTP error envelope as
 * an OPTIONAL `errorCode` field, next to the human-readable `message`.
 *
 * Why this exists (CHG-PW-02, reported by the FE 2026-08-29): in production
 * `HttpExceptionFilter` flattens the `message` of EVERY 401 to `"Unauthorized"`
 * so an authentication failure cannot be used as an account-existence oracle.
 * That is right for the guard, but it also erased the one thing that told
 * `POST /api/user/change-password` apart from a dead session — the two answers
 * came back byte-identical and the FE had to probe `GET /user/me` to guess.
 * `errorCode` is the signal that survives the sanitizer: it is a closed set we
 * choose, so it leaks nothing, and it never changes wording.
 *
 * Rules:
 * - Only ever ADDITIVE on the wire. The field is emitted only where a code is
 *   explicitly set, so every response that has no code is byte-identical to
 *   before — adding one to a new endpoint stays release class B.
 * - A code is a contract the moment it ships. Renaming or re-purposing one is
 *   class C, exactly like renaming a response field.
 * - The code is the machine signal, `message` stays the human one. Never make
 *   the client parse `message`.
 *
 * Propagation for a code thrown inside a microservice: pass an object response
 * to the exception (`new UnauthorizedException({ message, errorCode })`), and
 * the service's `AllRpcExceptionFilter` → gateway `MicroserviceErrorHandler` →
 * `HttpExceptionFilter` chain carries it to the client. Only the USER service's
 * RPC filter forwards it today — wire the others when they first need one.
 */
export const ERROR_CODE = {
  /**
   * No usable session: the request carried no access token, or the token
   * failed verification (expired/tampered). The client should re-authenticate.
   */
  UNAUTHENTICATED: "UNAUTHENTICATED",
  /**
   * `POST /api/user/change-password`: the session is fine, the submitted
   * `currentPassword` is wrong. The client must keep the user where they are
   * and flag the current-password field.
   */
  INVALID_CURRENT_PASSWORD: "INVALID_CURRENT_PASSWORD",
  /**
   * `POST /api/user/reset-password`: the emailed code was destroyed because the
   * attempt limit was used up, so retrying THIS code can never succeed — the
   * user has to request a new one. Every other reason that endpoint rejects a
   * code (wrong digits, expired, never requested, unknown email) stays a plain
   * 400 with no code: they all lead to the same "type it again" action, and
   * telling them apart would turn the endpoint into an account oracle.
   */
  RESET_CODE_EXHAUSTED: "RESET_CODE_EXHAUSTED",
} as const;

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];
