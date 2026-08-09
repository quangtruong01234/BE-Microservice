import { Test, TestingModule } from "@nestjs/testing";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { VNPayStrategy } from "./vnpay/vnpay.service";
import { PaymentMethod, RmqService } from "@app/common";
import { RmqContext } from "@nestjs/microservices";

describe("PaymentsController", () => {
  let paymentsController: PaymentsController;
  let processPayment: jest.Mock;
  let verifyZaloPayReturn: jest.Mock;
  let completeZaloPayReturn: jest.Mock;
  let completeVNPayPayment: jest.Mock;
  let verifyCallback: jest.Mock;
  let ack: jest.Mock;

  beforeEach(async () => {
    processPayment = jest.fn();
    verifyZaloPayReturn = jest.fn();
    completeZaloPayReturn = jest.fn();
    completeVNPayPayment = jest.fn();
    verifyCallback = jest.fn();
    ack = jest.fn();
    const app: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        {
          provide: PaymentsService,
          useValue: {
            processPayment,
            verifyZaloPayReturn,
            completeZaloPayReturn,
            completeVNPayPayment,
          },
        },
        { provide: VNPayStrategy, useValue: { verifyCallback } },
        { provide: RmqService, useValue: { ack } },
      ],
    }).compile();

    paymentsController = app.get<PaymentsController>(PaymentsController);
  });

  describe("root", () => {
    it("should be defined", () => {
      expect(paymentsController).toBeDefined();
    });
  });

  it("does not create child payments for multi-seller checkout events", async () => {
    await paymentsController.handleOrderCreated(
      {
        id: 101,
        total: 100,
        paymentMethod: PaymentMethod.VNPAY,
        isMultiSellerCheckout: true,
      },
      {} as RmqContext,
    );

    expect(processPayment).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it("still creates a payment for a single-seller checkout event", async () => {
    await paymentsController.handleOrderCreated(
      { id: 102, total: 100, paymentMethod: PaymentMethod.VNPAY },
      {} as RmqContext,
    );

    expect(processPayment).toHaveBeenCalledWith(
      "102",
      100,
      "Payment for order 102",
      PaymentMethod.VNPAY,
      undefined,
    );
    expect(ack).toHaveBeenCalledTimes(1);
  });

  // The return URL deep-links the FE back to the order, and PUBID-01 only
  // accepts the opaque id there — so the event's publicId has to reach the
  // service, not just the numeric PK.
  it("forwards the public order id from the order_created event", async () => {
    await paymentsController.handleOrderCreated(
      {
        id: 102,
        publicId: "ord_abcdefghijklmnop",
        total: 100,
        paymentMethod: PaymentMethod.VNPAY,
      },
      {} as RmqContext,
    );

    expect(processPayment).toHaveBeenCalledWith(
      "102",
      100,
      "Payment for order 102",
      PaymentMethod.VNPAY,
      "ord_abcdefghijklmnop",
    );
  });

  it("nacks and requeues when payment processing fails", async () => {
    const error = new Error("payment provider unavailable");
    const message = {};
    const nack = jest.fn();
    processPayment.mockRejectedValue(error);
    const context = {
      getChannelRef: () => ({ nack }),
      getMessage: () => message,
    } as unknown as RmqContext;

    await paymentsController.handleOrderCreated(
      { id: 103, total: 100, paymentMethod: PaymentMethod.VNPAY },
      context,
    );

    expect(ack).not.toHaveBeenCalled();
    expect(nack).toHaveBeenCalledWith(message, false, true);
  });

  it("completes a verified successful ZaloPay browser return", async () => {
    verifyZaloPayReturn.mockReturnValue(true);

    await expect(
      paymentsController.completeZaloPayReturn({
        appid: "2553",
        apptransid: "260626_2553_1782484597989",
        pmcid: "38",
        bankcode: "",
        amount: "6800",
        discountamount: "0",
        status: "1",
        checksum: "valid",
      }),
    ).resolves.toEqual({ status: "success" });

    expect(completeZaloPayReturn).toHaveBeenCalledWith(
      "260626_2553_1782484597989",
      "260626_2553_1782484597989",
    );
  });

  it("does not complete a ZaloPay browser return with an invalid checksum", async () => {
    verifyZaloPayReturn.mockReturnValue(false);

    await expect(
      paymentsController.completeZaloPayReturn({
        appid: "2553",
        apptransid: "260626_2553_1782484597989",
        pmcid: "38",
        bankcode: "",
        amount: "6800",
        discountamount: "0",
        status: "1",
        checksum: "invalid",
      }),
    ).resolves.toEqual({ status: "failed" });

    expect(completeZaloPayReturn).not.toHaveBeenCalled();
  });

  it("completes a verified successful VNPay browser return", async () => {
    verifyCallback.mockResolvedValue({ success: true, orderId: "txn-ref" });

    await expect(
      paymentsController.completeVNPayReturn({
        vnp_TxnRef: "txn-ref",
        vnp_TransactionNo: "gateway-txn",
        vnp_ResponseCode: "00",
        vnp_SecureHash: "valid",
      }),
    ).resolves.toEqual({ status: "success" });

    expect(completeVNPayPayment).toHaveBeenCalledWith("txn-ref", "gateway-txn");
  });

  it("does not complete a VNPay browser return that fails verification", async () => {
    verifyCallback.mockResolvedValue({ success: false, orderId: "txn-ref" });

    await expect(
      paymentsController.completeVNPayReturn({
        vnp_TxnRef: "txn-ref",
        vnp_TransactionNo: "gateway-txn",
        vnp_ResponseCode: "00",
        vnp_SecureHash: "invalid",
      }),
    ).resolves.toEqual({ status: "failed" });

    expect(completeVNPayPayment).not.toHaveBeenCalled();
  });
});
