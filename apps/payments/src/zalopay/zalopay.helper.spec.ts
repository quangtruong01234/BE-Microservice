import { generateMac, generateTransId } from "./zalopay.helper";

describe("zalopay.helper", () => {
  describe("generateTransId (EXPORT-TZ-01)", () => {
    /** The VN calendar day, derived independently of the helper under test. */
    const vnDayPrefix = (at: number): string =>
      new Date(at + 7 * 60 * 60 * 1000)
        .toISOString()
        .slice(2, 10)
        .replace(/-/g, "");

    afterEach(() => {
      jest.useRealTimers();
    });

    it("prefixes with TODAY in GMT+7, which ZaloPay rejects if wrong", () => {
      const transId = generateTransId(2553);
      expect(transId.startsWith(`${vnDayPrefix(Date.now())}_2553_`)).toBe(true);
    });

    it("still reports the VN day for an instant where UTC is a day behind", () => {
      // 18:30Z on the 19th is 01:30 on the 20th in Vietnam. Reading the day
      // with local-time getters — which is what this did until 2026-09-20 —
      // sends `260919` from a UTC box and ZaloPay refuses the transaction.
      // Every payment between VN midnight and 07:00 hit this on prod.
      jest.useFakeTimers().setSystemTime(new Date("2026-09-19T18:30:00Z"));

      expect(generateTransId(2553)).toMatch(/^260920_2553_\d+$/);
    });

    it("keeps the day stable on the VN side of the boundary", () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-09-19T16:59:59Z"));

      expect(generateTransId(2553)).toMatch(/^260919_2553_\d+$/);
    });
  });

  describe("generateMac", () => {
    it("is a stable hex sha256 HMAC of the input", () => {
      expect(generateMac("a|b|c", "key")).toBe(generateMac("a|b|c", "key"));
      expect(generateMac("a|b|c", "key")).toMatch(/^[0-9a-f]{64}$/);
      expect(generateMac("a|b|c", "key")).not.toBe(generateMac("a|b|d", "key"));
    });
  });
});
