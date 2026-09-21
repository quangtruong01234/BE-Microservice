/**
 * EXPORT-TZ-01 — Vietnam wall-clock helpers.
 *
 * **The problem these exist to remove.** `created_at` / `paid_at` are MySQL
 * `DATETIME` columns, which carry no zone, and nothing in this repo sets the
 * mysql2 `timezone` option — so the driver serializes and parses using the
 * TZ of the Node process. Two consequences, and only the first is obvious:
 *
 * 1. A `Date` handed back by TypeORM IS the correct instant (the same process
 *    wrote it and reads it, so the conversion cancels out). Anything derived
 *    from it with a LOCAL-time getter — `getHours()`, `setHours()` — silently
 *    renders in the server's zone. Dev runs UTC+7 and prod runs UTC, so the
 *    same code is right on a developer's machine and 7 hours wrong on prod.
 * 2. A calendar day is therefore not a server concept. "2026-09-01" from a
 *    Vietnamese seller means `2026-08-31T17:00:00Z`, on every machine.
 *
 * **Why not just set `TZ=Asia/Ho_Chi_Minh` on the prod process.** It looks like
 * the one-line fix and it is a data-corrupting one: the driver would start
 * reading every EXISTING prod row — written as UTC wall-clock — as if it were
 * VN wall-clock, moving every historical order 7 hours later. The same
 * objection kills pinning the connection `timezone` option. The stored bytes
 * are only meaningful next to the zone that wrote them, so the fix has to live
 * where the value is PRESENTED, not where it is stored.
 *
 * Everything below is therefore TZ-agnostic: correct whatever zone the process
 * runs in, which is also what makes it testable without stubbing the clock.
 */

/**
 * Vietnam is UTC+7 year-round — it has observed no DST since 1975, and unlike
 * a zone with a transition rule this offset can be treated as a constant. That
 * is what lets the formatter below be plain arithmetic instead of an `Intl`
 * call per cell, which matters at the 5.000-row export cap.
 */
export const VN_UTC_OFFSET_MINUTES = 7 * 60;

/** For the few places that want the IANA name (`Intl`, invoice rendering). */
export const VN_TIME_ZONE = "Asia/Ho_Chi_Minh";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * Shift an instant so that reading it with `getUTC*` yields VN wall-clock
 * parts. The returned `Date` is NOT a meaningful instant — it is a carrier for
 * the digits — so it never escapes this module.
 */
function toVnParts(instant: Date): Date {
  return new Date(instant.getTime() + VN_UTC_OFFSET_MINUTES * MINUTE_MS);
}

function pad(part: number): string {
  return String(part).padStart(2, "0");
}

/** The VN calendar day (`YYYY-MM-DD`) an instant falls on. */
export function toVnCalendarDay(instant: Date): string {
  const parts = toVnParts(instant);
  return (
    `${parts.getUTCFullYear()}-${pad(parts.getUTCMonth() + 1)}-` +
    `${pad(parts.getUTCDate())}`
  );
}

/**
 * `YYYY-MM-DD HH:mm:ss` in VN wall-clock. Sorts correctly as text and is read
 * as a date by Excel. Empty string for a null/invalid value, because a CSV
 * cell has nowhere to put an error.
 */
export function formatVnTimestamp(value: Date | string | null): string {
  if (!value) {
    return "";
  }
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    return "";
  }
  const parts = toVnParts(instant);
  return (
    `${parts.getUTCFullYear()}-${pad(parts.getUTCMonth() + 1)}-` +
    `${pad(parts.getUTCDate())} ${pad(parts.getUTCHours())}:` +
    `${pad(parts.getUTCMinutes())}:${pad(parts.getUTCSeconds())}`
  );
}

/** First instant of the VN calendar day that `instant` falls on. */
export function startOfVnDayAt(instant: Date): Date {
  return new Date(`${toVnCalendarDay(instant)}T00:00:00.000+07:00`);
}

/** Last instant (`.999`) of the VN calendar day that `instant` falls on. */
export function endOfVnDayAt(instant: Date): Date {
  return new Date(`${toVnCalendarDay(instant)}T23:59:59.999+07:00`);
}

/**
 * Parse a `from`/`to` query value and snap it to the VN day it denotes.
 * Returns `null` on an unparseable value so the caller owns the error message.
 *
 * A bare `YYYY-MM-DD` parses as UTC midnight per the ES spec, which is 07:00
 * VN on the same calendar day — so the day survives the round trip on any
 * machine. A full ISO string resolves to whichever VN day that instant lands
 * on, which is the only reading that does not depend on the server's zone.
 */
export function startOfVnDay(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : startOfVnDayAt(parsed);
}

/** End-of-day counterpart of {@link startOfVnDay} — inclusive bound. */
export function endOfVnDay(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : endOfVnDayAt(parsed);
}

/** Start of the VN day `days` days before the VN day of `instant`. */
export function startOfVnDayBefore(instant: Date, days: number): Date {
  return startOfVnDayAt(new Date(instant.getTime() - days * DAY_MS));
}

/**
 * Minutes to ADD to a stored wall-clock value to read it as VN wall-clock.
 *
 * Only for SQL that groups by a calendar day (`DATE_FORMAT`), where the
 * comparison happens inside MySQL against the raw column and JS cannot reach
 * it. Because the column holds whatever zone the writing process used, the
 * shift is the gap between that zone and VN: 420 on a UTC prod box, 0 on a
 * UTC+7 dev box. `CONVERT_TZ` would be the textbook answer and is not usable —
 * it returns NULL unless the server's timezone tables are populated, which is
 * not guaranteed on Aiven.
 */
export function vnWallClockShiftMinutes(reference: Date): number {
  // `getTimezoneOffset()` is minutes BEHIND UTC (UTC → 0, UTC+7 → -420), and
  // is read at `reference` so a server in a DST zone gets the offset that
  // actually applied in the window rather than today's.
  return VN_UTC_OFFSET_MINUTES + reference.getTimezoneOffset();
}
