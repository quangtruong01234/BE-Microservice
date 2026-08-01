import { handleVNPayCallback } from "./vnpay.callback";
import { VNPayStrategy } from "./vnpay.service";
import { PaymentsService } from "../payments.service";

/**
 * VNPay treats any RspCode other than "00" as "the merchant did not accept the
 * notification" and keeps retrying. Only a secure-hash mismatch may answer
 * "97 Checksum failed" — a correctly signed callback for a declined
 * transaction has to be acknowledged.
 */
describe("handleVNPayCallback", () => {
  const body = {
    vnp_TxnRef: "1700000000123",
    vnp_TransactionNo: "14567890",
    vnp_ResponseCode: "00",
  };

  const buildStrategy = (
    result: Partial<{
      orderId: string;
      success: boolean;
      isVerified: boolean;
      isSuccess: boolean;
    }>,
  ): VNPayStrategy =>
    ({
      verifyCallback: jest.fn().mockResolvedValue({
        orderId: body.vnp_TxnRef,
        success: false,
        isVerified: false,
        isSuccess: false,
        ...result,
      }),
    }) as unknown as VNPayStrategy;

  const buildPaymentsService = (
    completeVNPayPayment: jest.Mock,
  ): PaymentsService =>
    ({ completeVNPayPayment }) as unknown as PaymentsService;

  it("answers 97 only when the secure hash does not match", async () => {
    const completeVNPayPayment = jest.fn();

    await expect(
      handleVNPayCallback(
        body,
        buildStrategy({ isVerified: false, isSuccess: false }),
        buildPaymentsService(completeVNPayPayment),
      ),
    ).resolves.toEqual({ RspCode: "97", Message: "Checksum failed" });

    expect(completeVNPayPayment).not.toHaveBeenCalled();
  });

  it("acknowledges a correctly signed callback for a declined transaction", async () => {
    const completeVNPayPayment = jest.fn();

    await expect(
      handleVNPayCallback(
        { ...body, vnp_ResponseCode: "24" },
        buildStrategy({ isVerified: true, isSuccess: false }),
        buildPaymentsService(completeVNPayPayment),
      ),
    ).resolves.toEqual({ RspCode: "00", Message: "Confirm Success" });

    expect(completeVNPayPayment).not.toHaveBeenCalled();
  });

  it("completes the payment when the callback is verified and successful", async () => {
    const completeVNPayPayment = jest.fn().mockResolvedValue(undefined);

    await expect(
      handleVNPayCallback(
        body,
        buildStrategy({ isVerified: true, isSuccess: true }),
        buildPaymentsService(completeVNPayPayment),
      ),
    ).resolves.toEqual({ RspCode: "00", Message: "Confirm Success" });

    expect(completeVNPayPayment).toHaveBeenCalledWith(
      body.vnp_TxnRef,
      body.vnp_TransactionNo,
    );
  });

  it("answers 01 when the order cannot be updated", async () => {
    const completeVNPayPayment = jest
      .fn()
      .mockRejectedValue(new Error("order not found"));

    await expect(
      handleVNPayCallback(
        body,
        buildStrategy({ isVerified: true, isSuccess: true }),
        buildPaymentsService(completeVNPayPayment),
      ),
    ).resolves.toEqual({
      RspCode: "01",
      Message: "Order not found or DB error",
    });
  });
});
