import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Request } from "express";
import { ERROR_CODE } from "libs/constant/error-code.constant";
import { AUTH_MESSAGE } from "libs/constant/response-message.constant";

export const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_VERIFY_TIMEOUT_MS = 3000;
// Cloudflare documents Turnstile tokens as at most 2048 characters.
const TURNSTILE_TOKEN_MAX_LENGTH = 2048;
// Error codes that blame OUR configuration or Cloudflare, not the visitor —
// failing closed on these would lock every user out of register/reset.
const TURNSTILE_SERVER_SIDE_ERROR_CODES = new Set([
  "missing-input-secret",
  "invalid-input-secret",
  "internal-error",
]);

type TurnstileOutcome = "passed" | "rejected" | "unavailable";

interface TurnstileVerifyResponse {
  success?: unknown;
  "error-codes"?: unknown;
}

/**
 * CAPTCHA-01 — Cloudflare Turnstile check for the anonymous write routes that a
 * script rotating IPs can abuse (register, forgot-password). Runs after the
 * global rate-limit guard, before validation, so it reads `captchaToken` off
 * the raw body.
 *
 * Three postures, all driven by env so the rollout needs no deploy:
 * - `TURNSTILE_SECRET_KEY` unset → off: every request passes unverified.
 * - secret set, `CAPTCHA_ENFORCE` not `"true"` → shadow: a token that is sent
 *   is verified and the outcome logged, but nothing is ever rejected. This is
 *   the window while the storefront starts sending tokens.
 * - secret set, `CAPTCHA_ENFORCE=true` → a missing or refused token is a 400
 *   carrying `errorCode: CAPTCHA_REQUIRED`.
 *
 * A siteverify outage, a timeout, or an error that blames our secret fails
 * OPEN (logged) in every posture — same stance as the voucher quota gate; the
 * per-IP rate limit is still in front of it.
 */
@Injectable()
export class CaptchaGuard implements CanActivate {
  private readonly logger = new Logger(CaptchaGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const secretKey = process.env.TURNSTILE_SECRET_KEY?.trim() ?? "";
    const isEnforced = process.env.CAPTCHA_ENFORCE === "true";

    if (!secretKey) {
      if (isEnforced) {
        this.logger.error(
          "CAPTCHA_ENFORCE=true but TURNSTILE_SECRET_KEY is unset — captcha is OFF",
        );
      }
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const captchaToken = this.readCaptchaToken(request.body);

    if (captchaToken === null) {
      if (isEnforced) this.reject();
      return true;
    }

    const outcome =
      captchaToken.length > TURNSTILE_TOKEN_MAX_LENGTH
        ? "rejected"
        : await this.verifyToken(secretKey, captchaToken, request.ip);

    if (outcome === "rejected") {
      if (isEnforced) this.reject();
      this.logger.warn(
        `Turnstile refused a token on ${request.method} ${request.originalUrl} — allowed (CAPTCHA_ENFORCE is off)`,
      );
    }
    return true;
  }

  private readCaptchaToken(body: unknown): string | null {
    if (typeof body !== "object" || body === null) return null;
    const rawToken = (body as { captchaToken?: unknown }).captchaToken;
    if (typeof rawToken !== "string") return null;
    const captchaToken = rawToken.trim();
    return captchaToken.length > 0 ? captchaToken : null;
  }

  private async verifyToken(
    secretKey: string,
    captchaToken: string,
    remoteIp: string | undefined,
  ): Promise<TurnstileOutcome> {
    const verifyForm = new URLSearchParams({
      secret: secretKey,
      response: captchaToken,
    });
    if (remoteIp) verifyForm.set("remoteip", remoteIp);

    let verifyResponse: TurnstileVerifyResponse;
    try {
      const res = await fetch(TURNSTILE_VERIFY_URL, {
        method: "POST",
        body: verifyForm.toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(TURNSTILE_VERIFY_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(
          `Turnstile siteverify answered ${res.status} — failing open`,
        );
        return "unavailable";
      }
      verifyResponse = (await res.json()) as TurnstileVerifyResponse;
    } catch (err: unknown) {
      this.logger.warn(
        `Turnstile siteverify unreachable — failing open: ${err instanceof Error ? err.message : String(err)}`,
      );
      return "unavailable";
    }

    if (verifyResponse.success === true) return "passed";

    const errorCodes = Array.isArray(verifyResponse["error-codes"])
      ? verifyResponse["error-codes"].filter(
          (code): code is string => typeof code === "string",
        )
      : [];
    if (
      errorCodes.some((code) => TURNSTILE_SERVER_SIDE_ERROR_CODES.has(code))
    ) {
      this.logger.error(
        `Turnstile siteverify blamed the server side (${errorCodes.join(",")}) — failing open`,
      );
      return "unavailable";
    }
    return "rejected";
  }

  private reject(): never {
    throw new BadRequestException({
      message: AUTH_MESSAGE.CAPTCHA_REQUIRED,
      errorCode: ERROR_CODE.CAPTCHA_REQUIRED,
    });
  }
}

/**
 * `captchaToken` is a gateway-only field — drop it before a DTO is forwarded
 * over TCP, so the user service never receives (or persists) it.
 */
export function stripCaptchaToken<T extends { captchaToken?: string }>(
  dto: T,
): Omit<T, "captchaToken"> {
  const payload = { ...dto };
  delete payload.captchaToken;
  return payload;
}
