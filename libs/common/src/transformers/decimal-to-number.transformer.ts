import { ValueTransformer } from "typeorm";

/**
 * TypeORM DECIMAL/NUMERIC columns are serialized as strings by the underlying
 * driver (mysql2 / pg) — e.g. `price` comes back as `"2000.00"` instead of
 * `2000`. That leaks decimal-string values into every read path and over TCP to
 * the gateway, breaking the FE contract that declares money fields as `number`.
 *
 * Apply this transformer on decimal/numeric columns that represent a numeric
 * value in the API contract so the entity (and therefore every read path and
 * TCP payload) always carries a real `number`. `null` is preserved as `null`.
 *
 * @example
 * @Column({ type: "decimal", precision: 12, scale: 2, transformer: decimalToNumber })
 * price!: number | null;
 */
export const decimalToNumber: ValueTransformer = {
  // Persisted as-is; the driver accepts a JS number for a decimal column.
  to: (value: number | null): number | null => value,
  // Hydrated from the driver: coerce the decimal string back to a number.
  from: (value: string | number | null): number | null => {
    if (value === null || value === undefined) {
      return null;
    }
    return typeof value === "number" ? value : Number(value);
  },
};
