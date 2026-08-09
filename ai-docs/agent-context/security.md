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
- The code default is `sameSite:lax`; production also sets `secure=true`.
- **Production runs `sameSite:none` (since 2026-08-08) and has no CSRF token.** The storefront is deployed to `*.workers.dev` and the GHN shipping console to `*.vercel.app`, while the API is on `<PROD_API_DOMAIN>` — all different sites, so a `lax` cookie is dropped on every credentialed XHR and neither frontend can authenticate at all. `none` is forced by the deployment topology, not chosen. Set in `ecosystem.config.js` (gateway app), not in `.env`.
- What still limits CSRF exposure with `none`: mutations are all on non-safe methods; the gateway only parses JSON bodies, so a classic no-preflight HTML form POST (`application/x-www-form-urlencoded`) arrives as an empty body and fails validation; every cross-origin JSON request is preflighted against a strict `FRONTEND_URL` allow-list with no wildcard. Residual risk: any mutating route that accepts an empty/urlencoded body.
- Never implement a mutation behind `GET` or `HEAD`, including "quick action" endpoints that cancel, sync, approve, delete, mark-read, emit, resend, or otherwise change server state. This rule is load-bearing now that `sameSite` is `none`.
- The clean fix is topological, not a token: put both frontends on subdomains of one registrable domain (e.g. `app.example.com` + `api.example.com`) and revert `AUTH_COOKIE_SAME_SITE` to `lax`. Add a CSRF-token strategy only if the split-domain deployment becomes permanent.
