# Security — Always-On Rules

These rules apply at all times, not only during a dedicated review command or skill.

## Payment Gateway Secrets

- **ZaloPay/VNPay keys (`key1`, `key2`, `app_secret_key`) must never appear in**:
  - `console.log()` or any logger call
  - Error response bodies returned to HTTP clients
  - Thrown `Error` message strings
- If logging payment context, log only non-sensitive fields (`app_trans_id`, `order_id`, `amount`).

## Payment Callback Integrity

- Every payment callback handler (`zalopay.callback.ts`, VNPay equivalent) must **verify MAC/checksum as the first operation** before calling any service method or writing to DB.
- If MAC verification fails: return the gateway-specified failure response immediately, do not process further.

## JWT Secret

- `JWT_SECRET` must not have a hardcoded fallback — never use `|| "any-string"` or `?? "any-string"`.
- If `JWT_SECRET` is missing from env, the service must throw at startup, not silently fall back.

## Gateway DTO Validation

- Every field on every DTO used in gateway HTTP endpoints must have at least one `class-validator` decorator (`@IsString()`, `@IsNumber()`, `@IsOptional()`, etc.).
- DTOs without validators allow untyped data into TCP microservice calls — treat missing decorators as a bug.

## Microservice Error Exposure

- TCP microservice exceptions must be caught by `MicroserviceErrorHandler` at the gateway layer.
- Stack traces, internal file paths, and TypeORM query errors must never reach the HTTP response body.
- Allowed in HTTP error response: `statusCode`, `message` (sanitized), `error` label only.

## Rate Limiting

- `POST /api/user/login` and `POST /api/user/register` must have rate limiting applied.
- Do not remove or bypass the `ThrottlerGuard` on these endpoints.
- If adding a new auth-adjacent endpoint (password reset, token refresh), apply rate limiting by default.
- Gateway rate limiting is Redis-backed. In production, Redis rate-limit failures fail closed with a 503; outside production they fail open to avoid breaking local development.

## Gateway Production Hardening

- Gateway Swagger is enabled by default outside production and disabled by default in production unless `SWAGGER_ENABLED=true`.
- Gateway CORS is controlled by `FRONTEND_URL`; production does not fall back to localhost and ignores wildcard origins because credentials are enabled.
- Auth cookies are HttpOnly. Production sets `secure=true`; `AUTH_COOKIE_SAME_SITE` controls same-site behavior and defaults to `lax`.
- Gateway request body limits are controlled by `JSON_BODY_LIMIT` and `URLENCODED_BODY_LIMIT`.
- `/live`, `/ready`, and `/health` remain public, unprefixed operational endpoints.

## Cookie and CSRF Posture

- TryBuy authenticates browser sessions with an HttpOnly `access_token` cookie.
- The default cookie posture is `sameSite:lax`; production also sets `secure=true`.
- There is no separate CSRF token today. `sameSite:lax` mitigates most cross-site POST-style attacks, so state-changing operations must stay on non-safe HTTP methods (`POST`, `PUT`, `PATCH`, or `DELETE`).
- Never implement a mutation behind `GET` or `HEAD`, including "quick action" endpoints that cancel, sync, approve, delete, mark-read, emit, resend, or otherwise change server state.
- Do not set `AUTH_COOKIE_SAME_SITE=none` unless a CSRF-token strategy is implemented and required by the frontend deployment model.
