import { createHmac } from "crypto";
import { toVnCalendarDay } from "@app/common";

/**
 * ZaloPay requires `app_trans_id` to start with TODAY's date in **their**
 * timezone (GMT+7) — a prefix that is not the current VN day is rejected
 * outright, so this is not a formatting preference.
 *
 * EXPORT-TZ-01: this used to read the date with local-time getters. On a dev
 * machine (UTC+7) that is the VN day by accident; on prod (UTC) it is the VN
 * day only until 17:00 UTC, after which it lags by one — i.e. every ZaloPay
 * payment attempted between midnight and 07:00 Vietnam time would carry
 * yesterday's prefix. Deriving the day in VN explicitly makes the prefix right
 * whatever zone the process runs in.
 */
export function generateTransId(appId: number): string {
  const [yyyy, mm, dd] = toVnCalendarDay(new Date()).split("-");
  const timestamp = Date.now();
  return `${yyyy.slice(-2)}${mm}${dd}_${appId}_${timestamp}`;
}

export function generateMac(hmacInput: string, key: string): string {
  return createHmac("sha256", key).update(hmacInput).digest("hex");
}
