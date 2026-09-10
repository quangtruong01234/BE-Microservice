function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value.trim();
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}

export function getZaloPayConfig(): {
  appId: number;
  key1: string;
  key2: string;
  endpoint: string;
  redirectUrl: string;
} {
  return {
    appId: Number(requireEnv("ZALOPAY_APP_ID")),
    key1: requireEnv("ZALOPAY_KEY1"),
    key2: requireEnv("ZALOPAY_KEY2"),
    endpoint: requireEnv("ZALOPAY_ENDPOINT"),
    redirectUrl: optionalEnv(
      "ZALOPAY_REDIRECT_URL",
      "http://localhost:5173/payment-result",
    ),
  };
}
