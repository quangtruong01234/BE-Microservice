function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value.trim();
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}

export function getVNPayConfig(): {
  tmnCode: string;
  hashSecret: string;
  url: string;
  returnUrl: string;
  ipnUrl: string;
} {
  return {
    tmnCode: requireEnv("VNP_TMN_CODE"),
    hashSecret: requireEnv("VNP_HASH_SECRET"),
    url: requireEnv("VNP_URL"),
    returnUrl: optionalEnv(
      "VNP_RETURN_URL",
      "http://localhost:5173/payment-result",
    ),
    ipnUrl: requireEnv("VNPAY_IPN_URL"),
  };
}
