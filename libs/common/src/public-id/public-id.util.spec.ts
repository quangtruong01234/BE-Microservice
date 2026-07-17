import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";

import { generatePublicId, isPublicId } from "./public-id.util";

describe("generatePublicId", () => {
  it("returns <prefix>_ followed by 16 base62 characters", () => {
    const publicId = generatePublicId(PUBLIC_ID_PREFIXES.ORDER);
    expect(publicId).toMatch(/^ord_[0-9A-Za-z]{16}$/);
  });

  it("fits VARCHAR(32) for the longest prefix", () => {
    const publicId = generatePublicId(PUBLIC_ID_PREFIXES.PRODUCT);
    expect(publicId.length).toBeLessThanOrEqual(32);
  });

  it("does not collide across many generations", () => {
    const generatedIds = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      generatedIds.add(generatePublicId(PUBLIC_ID_PREFIXES.USER));
    }
    expect(generatedIds.size).toBe(10_000);
  });
});

describe("isPublicId", () => {
  const validId = generatePublicId(PUBLIC_ID_PREFIXES.ORDER);

  it("accepts a freshly generated id of the same prefix", () => {
    expect(isPublicId(PUBLIC_ID_PREFIXES.ORDER, validId)).toBe(true);
  });

  it("rejects a different prefix", () => {
    expect(isPublicId(PUBLIC_ID_PREFIXES.USER, validId)).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isPublicId(PUBLIC_ID_PREFIXES.ORDER, 123)).toBe(false);
    expect(isPublicId(PUBLIC_ID_PREFIXES.ORDER, null)).toBe(false);
    expect(isPublicId(PUBLIC_ID_PREFIXES.ORDER, undefined)).toBe(false);
  });

  it("rejects wrong random-part length", () => {
    expect(isPublicId(PUBLIC_ID_PREFIXES.ORDER, "ord_short")).toBe(false);
    expect(isPublicId(PUBLIC_ID_PREFIXES.ORDER, `${validId}extra`)).toBe(false);
  });

  it("rejects non-base62 characters", () => {
    expect(isPublicId(PUBLIC_ID_PREFIXES.ORDER, "ord_abc-def_ghij#klm")).toBe(
      false,
    );
  });

  it("rejects a bare numeric id (legacy int)", () => {
    expect(isPublicId(PUBLIC_ID_PREFIXES.ORDER, "123")).toBe(false);
  });
});
