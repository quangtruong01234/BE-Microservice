import { MonoTypeOperatorFunction, retry, throwError, timer } from "rxjs";

/**
 * Failures that mean "the TCP call never reached the microservice", as opposed
 * to the microservice answering with a business error. They are transient: the
 * ClientProxy drops its cached socket on close, so the NEXT call reconnects.
 */
const TRANSPORT_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "ERR_STREAM_DESTROYED",
]);

/** `ClientTCP.handleClose()` rejects every in-flight call with this message. */
const CONNECTION_CLOSED_MESSAGE = "Connection closed";

/** `ClientTCP.unwrap()` before the first successful connect. */
const NOT_INITIALIZED_MESSAGE =
  'Not initialized. Please call the "connect" method first.';

/**
 * True for the null-socket race in `ClientTCP.publish()`: `connect()` resolves
 * its cached `connectionPromise` in a microtask, but Node drains the nextTick
 * queue — where the socket's 'close' listener calls `handleClose()` and nulls
 * `this.socket` — first. `publish()` then dereferences a null socket. Observed
 * as an intermittent 502 on `GET /api/social/posts` (SOCIAL-502).
 */
function isNullSocketPublish(name: unknown, message: string): boolean {
  return name === "TypeError" && message.includes("sendMessage");
}

export function isTransportError(error: unknown): boolean {
  if (error == null || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    name?: unknown;
    message?: unknown;
  };

  if (
    typeof candidate.code === "string" &&
    TRANSPORT_ERROR_CODES.has(candidate.code)
  ) {
    return true;
  }

  const message =
    typeof candidate.message === "string" ? candidate.message : "";
  if (message === "") {
    return false;
  }

  return (
    message === CONNECTION_CLOSED_MESSAGE ||
    message === NOT_INITIALIZED_MESSAGE ||
    isNullSocketPublish(candidate.name, message)
  );
}

/** Long enough for the ClientProxy to have processed 'close', short enough to
 * stay invisible to the caller. A service that is genuinely down still fails. */
export const TRANSPORT_RETRY_DELAY_MS = 100;

/**
 * Retries a TCP call once when — and only when — it failed at the transport
 * level, so a dropped socket costs one reconnect instead of a user-visible 502.
 *
 * Resubscribes the whole `send()`, which forces `ClientProxy.connect()` to build
 * a fresh socket. Business errors and rxjs `TimeoutError` are rethrown
 * untouched, so this never masks a real fault or doubles a slow call.
 *
 * ONLY use on idempotent reads — a retried write can be applied twice.
 * Place it AFTER `timeout(...)` so each attempt gets its own timeout budget.
 */
export function retryOnTransportError<T>(): MonoTypeOperatorFunction<T> {
  return retry<T>({
    count: 1,
    delay: (error: unknown) =>
      isTransportError(error)
        ? timer(TRANSPORT_RETRY_DELAY_MS)
        : throwError(() => error),
  });
}
