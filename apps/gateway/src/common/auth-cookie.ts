import { CookieOptions } from "express";
import { isProduction, parseBooleanEnv } from "./security";

export const AUTH_COOKIE_NAME = "access_token";

export const DEFAULT_AUTH_COOKIE_MAX_AGE_MS = 5 * 60 * 60 * 1000;
export const REMEMBER_ME_AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function resolveCookieSameSite(): CookieOptions["sameSite"] {
  const configuredValue =
    process.env.AUTH_COOKIE_SAME_SITE?.trim().toLowerCase();
  if (
    configuredValue === "strict" ||
    configuredValue === "lax" ||
    configuredValue === "none"
  ) {
    return configuredValue;
  }

  return "lax";
}

export function getAuthCookieOptions(
  maxAgeMs: number = DEFAULT_AUTH_COOKIE_MAX_AGE_MS,
): CookieOptions {
  const sameSite = resolveCookieSameSite();
  return {
    httpOnly: true,
    secure:
      isProduction() ||
      parseBooleanEnv("AUTH_COOKIE_SECURE", false) ||
      sameSite === "none",
    sameSite,
    maxAge: maxAgeMs,
    path: "/",
  };
}

export function getClearAuthCookieOptions(): CookieOptions {
  const options = getAuthCookieOptions();
  return {
    httpOnly: options.httpOnly,
    secure: options.secure,
    sameSite: options.sameSite,
    path: options.path,
  };
}
