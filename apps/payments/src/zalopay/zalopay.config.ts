function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value.trim();
}

export function getZaloPayConfig() {
  return {
    appId: Number(requireEnv("ZALOPAY_APP_ID")),
    key1: requireEnv("ZALOPAY_KEY1"),
    key2: requireEnv("ZALOPAY_KEY2"),
    endpoint: requireEnv("ZALOPAY_ENDPOINT"),
    redirectUrl: requireEnv("ZALOPAY_REDIRECT_URL"),
  };
}
