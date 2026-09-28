import { apportionByWeight } from "./apportion-discount";

describe("apportionByWeight (VOUCHER-SHOP-01 phase 2)", () => {
  it("splits pro rata and always sums to the amount", () => {
    const shares = apportionByWeight(
      100,
      new Map([
        [1, 50],
        [2, 50],
        [3, 50],
      ]),
    );
    expect([...shares.values()].reduce((a, b) => a + b, 0)).toBe(100);
    expect(shares).toEqual(
      new Map([
        [1, 34],
        [2, 33],
        [3, 33],
      ]),
    );
  });

  it("weights by each slice", () => {
    expect(
      apportionByWeight(
        30000,
        new Map([
          [7, 200000],
          [9, 100000],
        ]),
      ),
    ).toEqual(
      new Map([
        [7, 20000],
        [9, 10000],
      ]),
    );
  });

  it("never gives a key more than its own weight", () => {
    const weightByKey = new Map([
      [1, 1],
      [2, 999],
      [3, 2],
    ]);
    const shares = apportionByWeight(1001, weightByKey);
    for (const [key, share] of shares) {
      expect(share).toBeLessThanOrEqual(weightByKey.get(key) ?? 0);
    }
    expect([...shares.values()].reduce((a, b) => a + b, 0)).toBe(1001);
  });

  it("caps the amount at the weight total and gives a zero weight nothing", () => {
    expect(
      apportionByWeight(
        500,
        new Map([
          [1, 0],
          [2, 300],
        ]),
      ),
    ).toEqual(
      new Map([
        [1, 0],
        [2, 300],
      ]),
    );
  });
});
