import { createHmac } from "crypto";

export function generateTransId(appId: number): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const MM = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const timestamp = Date.now();
  return `${yy}${MM}${dd}_${appId}_${timestamp}`;
}

export function generateMac(hmacInput: string, key: string): string {
  return createHmac("sha256", key).update(hmacInput).digest("hex");
}
