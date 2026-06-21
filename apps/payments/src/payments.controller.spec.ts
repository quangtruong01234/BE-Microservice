import { Test, TestingModule } from "@nestjs/testing";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { VNPayStrategy } from "./vnpay/vnpay.service";
import { PaymentMethod, RmqService } from "@app/common";
import { RmqContext } from "@nestjs/microservices";

describe("PaymentsController", () => {
  let paymentsController: PaymentsController;
  let processPayment: jest.Mock;
  let ack: jest.Mock;

  beforeEach(async () => {
    processPayment = jest.fn();
    ack = jest.fn();
    const app: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: { processPayment } },
        { provide: VNPayStrategy, useValue: {} },
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
    );
    expect(ack).toHaveBeenCalledTimes(1);
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
});
