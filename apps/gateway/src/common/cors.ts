import { CorsOptions } from "@nestjs/common/interfaces/external/cors-options.interface";

/**
 * Single source of truth for the gateway CORS allow-list, shared by the HTTP
 * server (`app.enableCors`) and every Socket.IO `@WebSocketGateway`
 * (`/chat`, `/notifications`). Keeping one delegate avoids the previous drift
 * where each call site re-derived `FRONTEND_URL` with a slightly different
 * default operator.
 */

const DEFAULT_DEV_ORIGIN = "http://localhost:5173";

// Matches http(s)://localhost or http(s)://127.0.0.1 on any (or no) port.
const LOCALHOST_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * Explicit allow-list parsed from the comma-separated `FRONTEND_URL` env.
 * This is the only set honoured in production.
 */
export function resolveAllowedOrigins(): string[] {
  return (process.env.FRONTEND_URL || DEFAULT_DEV_ORIGIN)
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

type CorsOriginCallback = (err: Error | null, allow?: boolean) => void;

/**
 * Origin delegate compatible with both the Express `cors` middleware and
 * Socket.IO (both use the same `cors` package). Allows:
 *  - requests with no Origin header (curl, server-to-server, same-origin),
 *  - any origin in the explicit `FRONTEND_URL` allow-list,
 *  - and, ONLY outside production, any localhost / 127.0.0.1 origin on any port
 *    so a developer serving Vite on 127.0.0.1 or an alternate port (e.g. 5174)
 *    is not blocked. Production stays strict — only `FRONTEND_URL` passes.
 */
export function corsOriginDelegate(
  requestOrigin: string | undefined,
  callback: CorsOriginCallback,
): void {
  if (!requestOrigin) {
    callback(null, true);
    return;
  }
  if (resolveAllowedOrigins().includes(requestOrigin)) {
    callback(null, true);
    return;
  }
  if (
    process.env.NODE_ENV !== "production" &&
    LOCALHOST_ORIGIN_PATTERN.test(requestOrigin)
  ) {
    callback(null, true);
    return;
  }
  // Reject without throwing so a stray origin does not spam error logs; the
  // browser simply receives no Access-Control-Allow-Origin header.
  callback(null, false);
}

export const gatewayCorsOptions: CorsOptions = {
  origin: corsOriginDelegate,
  credentials: true,
};
