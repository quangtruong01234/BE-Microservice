import { CachedService } from "@app/cached";
import { Injectable, Logger } from "@nestjs/common";
import {
  SESSION_VALID_AFTER_KEY_PREFIX,
  SESSION_VALID_AFTER_TTL_SECONDS,
} from "libs/constant/session.constant";

/**
 * SESSION-REVOKE-01: a JWT is stateless, so "revoke every session of user X"
 * is a per-user `validAfter` epoch in Redis — any token issued strictly before
 * it is dead. The check runs on every authenticated request, so it is bounded
 * by a short timeout and FAILS OPEN: a Redis outage degrades to the old
 * signature-only behaviour instead of logging every user out.
 */
@Injectable()
export class SessionRevocationService {
  private static readonly REDIS_TIMEOUT_MS = 500;
  private readonly logger = new Logger(SessionRevocationService.name);

  constructor(private readonly cached: CachedService) {}

  async isRevoked(
    userId: number | undefined,
    issuedAtSeconds: number | undefined,
  ): Promise<boolean> {
    if (!userId) return false;

    let storedValidAfter: string | null;
    try {
      storedValidAfter = await this.withRedisTimeout(
        this.cached.get(`${SESSION_VALID_AFTER_KEY_PREFIX}${userId}`),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      this.logger.warn(
        `Session revocation check failed; allowing the token: ${message}`,
      );
      return false;
    }

    const validAfterSeconds = Number(storedValidAfter);
    if (!storedValidAfter || !Number.isFinite(validAfterSeconds)) return false;
    return (issuedAtSeconds ?? 0) < validAfterSeconds;
  }

  /**
   * Invalidates every token issued before now. Throws on a Redis failure — a
   * "log out all devices" that silently did nothing is worse than an error.
   */
  async revokeAllSessions(userId: number): Promise<void> {
    await this.withRedisTimeout(
      this.cached.set(
        `${SESSION_VALID_AFTER_KEY_PREFIX}${userId}`,
        String(Math.floor(Date.now() / 1000)),
        SESSION_VALID_AFTER_TTL_SECONDS,
      ),
    );
  }

  private async withRedisTimeout<T>(operation: Promise<T>): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error("Redis session operation timed out"));
      }, SessionRevocationService.REDIS_TIMEOUT_MS);
    });

    try {
      return await Promise.race([operation, timeoutPromise]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }
}
