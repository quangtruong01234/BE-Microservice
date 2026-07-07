import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { RATE_LIMIT_OPTIONS_KEY } from "../common/decorators/rate-limit.decorator";
import { PaymentCallbackController } from "./payment-callback.controller";
import { PaymentCallbackService } from "./payment-callback.service";

describe("PaymentCallbackController", () => {
  function createController(): {
    controller: PaymentCallbackController;
    service: jest.Mocked<
      Pick<
        PaymentCallbackService,
        "handleZaloPayCallback" | "handleVNPayCallback"
      >
    >;
  } {
    const service = {
      handleZaloPayCallback: jest.fn(),
      handleVNPayCallback: jest.fn(),
    };
    return {
      controller: new PaymentCallbackController(
        service as unknown as PaymentCallbackService,
      ),
      service,
    };
  }

  it("returns the raw ZaloPay provider response shape", async () => {
    const { controller, service } = createController();
    service.handleZaloPayCallback.mockResolvedValue({
      return_code: 1,
      return_message: "success",
    });
    const body = { data: "signed-payload", mac: "signature" };

    await expect(controller.zaloPayCallback(body)).resolves.toEqual({
      return_code: 1,
      return_message: "success",
    });
    expect(service.handleZaloPayCallback).toHaveBeenCalledWith(body);
  });

  it("returns the raw VNPay provider response shape", async () => {
    const { controller, service } = createController();
    service.handleVNPayCallback.mockResolvedValue({
      RspCode: "00",
      Message: "Confirm Success",
    });
    const payload = {
      vnp_TxnRef: "txn-ref",
      vnp_TransactionNo: "gateway-transaction",
      vnp_SecureHash: "hash",
    };

    await expect(controller.vnpayCallback(payload)).resolves.toEqual({
      RspCode: "00",
      Message: "Confirm Success",
    });
    expect(service.handleVNPayCallback).toHaveBeenCalledWith(payload);
  });

  it("short-circuits invalid ZaloPay bodies with a provider failure response", async () => {
    const { controller, service } = createController();

    await expect(
      controller.zaloPayCallback({ data: "", mac: "signature" }),
    ).resolves.toEqual({
      return_code: -1,
      return_message: "invalid callback payload",
    });
    expect(service.handleZaloPayCallback).not.toHaveBeenCalled();
  });

  it("short-circuits invalid VNPay payloads with a provider failure response", async () => {
    const { controller, service } = createController();

    await expect(
      controller.vnpayCallback({
        vnp_TxnRef: "txn-ref",
        vnp_TransactionNo: "gateway-transaction",
      }),
    ).resolves.toEqual({
      RspCode: "99",
      Message: "Invalid callback payload",
    });
    expect(service.handleVNPayCallback).not.toHaveBeenCalled();
  });

  it("uses explicit HTTP 200 status and callback-specific rate limit metadata", () => {
    const methodNames = [
      "zaloPayCallback",
      "vnpayCallback",
      "vnpayIpnCallback",
    ] as const;

    for (const methodName of methodNames) {
      const descriptor = Object.getOwnPropertyDescriptor(
        PaymentCallbackController.prototype,
        methodName,
      );
      const method = descriptor?.value as object;
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, method)).toBe(
        HttpStatus.OK,
      );
      expect(Reflect.getMetadata(RATE_LIMIT_OPTIONS_KEY, method)).toEqual({
        limit: 300,
        ttl: 60,
      });
    }
  });
});
