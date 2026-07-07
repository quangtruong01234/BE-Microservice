import { CookieOptions } from "express";
import { isProduction, parseBooleanEnv } from "./security";

export const AUTH_COOKIE_NAME = "access_token";

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

export function getAuthCookieOptions(): CookieOptions {
  const sameSite = resolveCookieSameSite();
  return {
    httpOnly: true,
    secure:
      isProduction() ||
      parseBooleanEnv("AUTH_COOKIE_SECURE", false) ||
      sameSite === "none",
    sameSite,
    maxAge: 5 * 60 * 60 * 1000,
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
