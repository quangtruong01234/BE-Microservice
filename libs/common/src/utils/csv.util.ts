/**
 * CSV rendering for export endpoints (EXPORT-CSV-01).
 *
 * Built once here so every later export (seller orders, inventory, admin
 * revenue) is just "query + column list". Four things a hand-rolled
 * `rows.map((r) => r.join(","))` gets wrong, all of which have a real failure
 * mode in this project:
 *
 * 1. **BOM** — without it Excel VN reads the file as cp1252 and renders
 *    `Áo thun` as `Ão thun`. The most common Vietnamese CSV bug there is.
 * 2. **Escaping** — a `skuLabel` like `Đen, size L` silently shifts every
 *    column to its right.
 * 3. **CSV injection** — a cell starting `=`, `+`, `-`, `@` (or TAB/CR) is
 *    executed as a formula by Excel. `productName` is seller-supplied text, so
 *    this is a live hole, not a theoretical one.
 * 4. **Numeric mangling** — Excel coerces a long tracking code to `1.23E+11`
 *    and eats the leading zero of a phone number.
 */

/** Byte order mark — must be the first character for Excel to detect UTF-8. */
const CSV_BOM = "﻿";

/** Excel/Sheets treat a cell starting with any of these as a formula. */
const INJECTION_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/** Field characters that force the cell to be quoted. */
const NEEDS_QUOTING = /["\r\n,]/;

/** A plain (possibly negative) decimal number, e.g. `-500`, `12000.50`. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export interface CsvColumn<TRow> {
  /** Header cell text, written as-is on the first line. */
  header: string;
  /** Cell value for one row. `null`/`undefined` render as an empty cell. */
  value: (row: TRow) => string | number | null | undefined;
  /**
   * Emit as `="…"` so Excel keeps the literal text instead of coercing it to a
   * number. Use for tracking codes, phone numbers, and anything else where a
   * leading zero or the exact digits matter.
   *
   * Quotes, commas and newlines are stripped from the value rather than
   * escaped: the `="…"` form only survives in an UNQUOTED field, because Excel
   * does not evaluate a formula that arrives quoted. Every literal column in
   * practice holds codes/digits, so nothing legitimate is lost.
   */
  literal?: boolean;
}

/**
 * Guard a cell against formula execution — but leave a plain negative number
 * alone. Prefixing `-500` with `'` turns a value Excel should SUM into text,
 * which is a worse bug than the one being prevented; `-500` is not a formula.
 */
function needsInjectionGuard(raw: string): boolean {
  if (!INJECTION_PREFIXES.some((prefix) => raw.startsWith(prefix))) {
    return false;
  }
  return !PLAIN_NUMBER.test(raw);
}

function escapeCell(raw: string): string {
  const guarded = needsInjectionGuard(raw) ? `'${raw}` : raw;
  if (NEEDS_QUOTING.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

function literalCell(raw: string): string {
  return `="${raw.replace(/["\r\n,]/g, " ").trim()}"`;
}

/**
 * Render `rows` as an Excel-compatible CSV document (BOM + CRLF line endings).
 *
 * Returns a string; the caller decides the encoding
 * (`Buffer.from(toCsv(...), "utf8")` for a file response).
 */
export function toCsv<TRow>(
  rows: readonly TRow[],
  columns: readonly CsvColumn<TRow>[],
): string {
  const lines: string[] = [
    columns.map((column) => escapeCell(column.header)).join(","),
  ];

  for (const row of rows) {
    const cells = columns.map((column) => {
      const value = column.value(row);
      const raw = value === null || value === undefined ? "" : String(value);
      if (raw === "") {
        return "";
      }
      return column.literal ? literalCell(raw) : escapeCell(raw);
    });
    lines.push(cells.join(","));
  }

  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}
