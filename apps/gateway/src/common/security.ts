import { RequestHandler } from "express";

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
  const configuredValue = process.env[name]?.trim().toLowerCase();
  if (configuredValue === undefined || configuredValue === "") {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(configuredValue);
}

export function resolvePositiveIntegerEnv(
  name: string,
  defaultValue: number,
): number {
  const configuredValue = Number(process.env[name]);
  if (!Number.isInteger(configuredValue) || configuredValue <= 0) {
    return defaultValue;
  }

  return configuredValue;
}

export function resolveBodyLimit(name: string, defaultValue: string): string {
  const configuredValue = process.env[name]?.trim();
  return configuredValue && configuredValue.length > 0
    ? configuredValue
    : defaultValue;
}

export function isSwaggerEnabled(): boolean {
  return parseBooleanEnv("SWAGGER_ENABLED", !isProduction());
}

export function securityHeadersMiddleware(): RequestHandler {
  return (_request, response, next): void => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-DNS-Prefetch-Control", "off");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Origin-Agent-Cluster", "?1");
    response.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );

    if (isProduction()) {
      response.setHeader(
        "Strict-Transport-Security",
        "max-age=15552000; includeSubDomains",
      );
    }

    next();
  };
}
