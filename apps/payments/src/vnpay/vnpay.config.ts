function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

export const vnpayConfig = {
  tmnCode: requireEnv("VNP_TMN_CODE"),
  hashSecret: requireEnv("VNP_HASH_SECRET"),
  url: requireEnv("VNP_URL"),
  returnUrl: requireEnv("VNP_RETURN_URL"),
};
