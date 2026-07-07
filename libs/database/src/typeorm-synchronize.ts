function parseBooleanEnv(value: string | undefined): boolean | null {
  if (value == null || value.trim() === "") {
    return null;
  }

  const normalizedValue = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalizedValue)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalizedValue)) {
    return false;
  }

  return null;
}

export function resolveTypeOrmSynchronize(
  defaultDevelopmentValue = true,
): boolean {
  const configuredValue = parseBooleanEnv(process.env.TYPEORM_SYNCHRONIZE);
  const isProduction = process.env.NODE_ENV === "production";

  if (configuredValue === null) {
    return isProduction ? false : defaultDevelopmentValue;
  }

  if (
    configuredValue &&
    isProduction &&
    parseBooleanEnv(process.env.TYPEORM_SYNCHRONIZE_ALLOW_PRODUCTION) !== true
  ) {
    return false;
  }

  return configuredValue;
}
