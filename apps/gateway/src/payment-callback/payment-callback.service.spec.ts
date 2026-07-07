import { of } from "rxjs";
import { PAYMENT_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { PaymentCallbackService } from "./payment-callback.service";

describe("PaymentCallbackService", () => {
  it("forwards ZaloPay callback bodies to the payments TCP handler", async () => {
    const send = jest.fn().mockReturnValue(
      of({
        return_code: 1,
        return_message: "success",
      }),
    );
    const service = new PaymentCallbackService({ send } as never);
    const body = { data: "signed-payload", mac: "signature" };

    await expect(service.handleZaloPayCallback(body)).resolves.toEqual({
      return_code: 1,
      return_message: "success",
    });
    expect(send).toHaveBeenCalledWith(
      PAYMENT_MESSAGE_PATTERN.ZALOPAY_CALLBACK,
      body,
    );
  });

  it("forwards VNPay callback payloads to the payments TCP handler", async () => {
    const send = jest.fn().mockReturnValue(
      of({
        RspCode: "00",
        Message: "Confirm Success",
      }),
    );
    const service = new PaymentCallbackService({ send } as never);
    const payload = {
      vnp_TxnRef: "txn-ref",
      vnp_TransactionNo: "gateway-transaction",
      vnp_SecureHash: "hash",
    };

    await expect(service.handleVNPayCallback(payload)).resolves.toEqual({
      RspCode: "00",
      Message: "Confirm Success",
    });
    expect(send).toHaveBeenCalledWith(
      PAYMENT_MESSAGE_PATTERN.VNPAY_CALLBACK,
      payload,
    );
  });
});
