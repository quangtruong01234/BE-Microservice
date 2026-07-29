import { VNPayStrategy } from "./vnpay.service";

/**
 * The provider callback must always answer VNPay with a response code. These
 * tests exercise the real SDK (no mock) so a future SDK upgrade that throws on
 * a new class of bad input still cannot turn a callback into a 5xx.
 */
describe("VNPayStrategy.verifyCallback", () => {
  const originalEnv = process.env;

  beforeAll(() => {
    process.env = {
      ...originalEnv,
      VNP_TMN_CODE: "TESTTMN",
      VNP_HASH_SECRET: "test-hash-secret",
      VNP_URL: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
      VNPAY_IPN_URL: "http://localhost:3007/vnpay/callback",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("reports a payload with no vnp_ fields as unverified instead of throwing", async () => {
    const strategy = new VNPayStrategy();

    await expect(
      strategy.verifyCallback({ garbage: "payload" }),
    ).resolves.toEqual({ orderId: "", success: false });
  });

  it("reports a missing payload as unverified instead of throwing", async () => {
    const strategy = new VNPayStrategy();

    await expect(strategy.verifyCallback(undefined)).resolves.toEqual({
      orderId: "",
      success: false,
    });
  });

  it("rejects a payload whose secure hash does not match", async () => {
    const strategy = new VNPayStrategy();

    const { success } = await strategy.verifyCallback({
      vnp_TmnCode: "TESTTMN",
      vnp_TxnRef: "1700000000123",
      vnp_TransactionNo: "14567890",
      vnp_Amount: "1000000",
      vnp_ResponseCode: "00",
      vnp_SecureHash: "0".repeat(64),
    });

    expect(success).toBe(false);
  });
});
