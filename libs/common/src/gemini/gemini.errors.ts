/**
 * Gemini could not answer right now: no API key, quota (429), a 5xx, a timeout,
 * a network failure or a response of an unexpected shape. Transient — the
 * caller degrades (503 ASSISTANT_UNAVAILABLE, or the index stays pending).
 */
export class GeminiUnavailableError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "GeminiUnavailableError";
  }
}

/**
 * Gemini rejected the request itself (a 4xx other than 429): a wrong model id,
 * a malformed body. Retrying the same request cannot succeed.
 */
export class GeminiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GeminiRequestError";
  }
}
