import { randomBytes } from "crypto";

import {
  PUBLIC_ID_RANDOM_LENGTH,
  PublicIdPrefix,
} from "libs/constant/public-id.constant";

const BASE62_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// Largest multiple of 62 below 256 — bytes above it are rejected so every
// alphabet character stays equally likely (no modulo bias).
const UNBIASED_BYTE_LIMIT = 248;

/**
 * Generates an opaque public id like `ord_8fK2mQ9xL3pT7vWb`:
 * `<prefix>_` + 16 crypto-random base62 characters (~95 bits of entropy).
 * Fits VARCHAR(32) for every prefix in PUBLIC_ID_PREFIXES.
 */
export function generatePublicId(prefix: PublicIdPrefix): string {
  let randomPart = "";
  while (randomPart.length < PUBLIC_ID_RANDOM_LENGTH) {
    const bytes = randomBytes(PUBLIC_ID_RANDOM_LENGTH * 2);
    for (const byte of bytes) {
      if (byte >= UNBIASED_BYTE_LIMIT) {
        continue;
      }
      randomPart += BASE62_ALPHABET[byte % BASE62_ALPHABET.length];
      if (randomPart.length === PUBLIC_ID_RANDOM_LENGTH) {
        break;
      }
    }
  }
  return `${prefix}_${randomPart}`;
}

/**
 * Type guard for a well-formed public id of the given prefix.
 * Use in DTO validators/pipes before resolving to the internal numeric id.
 */
export function isPublicId(
  prefix: PublicIdPrefix,
  value: unknown,
): value is string {
  if (typeof value !== "string") {
    return false;
  }
  if (!value.startsWith(`${prefix}_`)) {
    return false;
  }
  const randomPart = value.slice(prefix.length + 1);
  if (randomPart.length !== PUBLIC_ID_RANDOM_LENGTH) {
    return false;
  }
  return /^[0-9A-Za-z]+$/.test(randomPart);
}
