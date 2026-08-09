import { Channel } from "amqplib";
import { Repository } from "typeorm";
import { PaymentGatewayFactory } from "./payment-gateway.factory";
import { PaymentMethod } from "./entity/payment-method.entity";
import { Payment, PaymentStatus } from "./entity/payment.entity";
import { PaymentsService } from "./payments.service";
import { PaymentMethod as PaymentMethodEnum } from "@app/common";

describe("PaymentsService callback idempotency", () => {
  const pendingPayment = {
    id: 1,
    orderId: 98,
    orderIds: null,
    amount: 199000,
    status: PaymentStatus.PENDING,
    appTransId: "callback-ref",
  } as Payment;

  function createService(): {
    service: PaymentsService;
    findOne: jest.Mock;
    update: jest.Mock;
    publish: jest.Mock;
  } {
    const findOne = jest.fn();
    const update = jest.fn();
    const publish = jest.fn();
    const service = new PaymentsService(
      { findOne, update } as unknown as Repository<Payment>,
      {} as Repository<PaymentMethod>,
      {} as PaymentGatewayFactory,
      { publish } as unknown as Channel,
    );
    return { service, findOne, update, publish };
  }

  it.each([
    ["ZaloPay", "completeZaloPayPayment"],
    ["VNPay", "completeVNPayPayment"],
  ] as const)(
    "emits payment_completed only once for duplicate %s callbacks",
    async (_gateway, method) => {
      const { service, findOne, update, publish } = createService();
      const completedPayment = {
        ...pendingPayment,
        status: PaymentStatus.COMPLETED,
        transactionId: "gateway-transaction",
      } as Payment;
      findOne
        .mockResolvedValueOnce(pendingPayment)
        .mockResolvedValueOnce(completedPayment)
        .mockResolvedValueOnce(completedPayment);
      update.mockResolvedValueOnce({ affected: 1 });

      await service[method]("callback-ref", "gateway-transaction");
      await service[method]("callback-ref", "gateway-transaction");

      expect(update).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledTimes(1);
    },
  );
});

describe("PaymentsService payment return URLs", () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;

  afterEach(() => {
    if (originalFrontendUrl === undefined) {
      delete process.env.FRONTEND_URL;
    } else {
      process.env.FRONTEND_URL = originalFrontendUrl;
    }
  });

  function createService(): {
    service: PaymentsService;
    createPayment: jest.Mock;
  } {
    const payment = {
      id: 7,
      orderId: 111,
      amount: 3900,
      status: PaymentStatus.PENDING,
    } as Payment;
    const createPayment = jest.fn().mockResolvedValue({
      paymentUrl: "https://gateway.example/pay",
      transactionId: "txn-1",
      appTransId: "app-1",
    });
    const service = new PaymentsService(
      {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockReturnValue(payment),
        save: jest.fn().mockResolvedValue(payment),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      } as unknown as Repository<Payment>,
      {} as Repository<PaymentMethod>,
      {
        getStrategy: jest.fn().mockReturnValue({
          createPayment,
          verifyCallback: jest.fn(),
        }),
      } as unknown as PaymentGatewayFactory,
      { publish: jest.fn() } as unknown as Channel,
    );
    return { service, createPayment };
  }

  it("deep-links the return URL with the public order id, not the PK", async () => {
    process.env.FRONTEND_URL = "https://shop.example.com";
    const { service, createPayment } = createService();

    await service.processPayment(
      "111",
      3900,
      "Payment for order 111",
      PaymentMethodEnum.VNPAY,
      "ord_abcdefghijklmnop",
    );

    expect(createPayment).toHaveBeenCalledWith({
      id: "111",
      total: 3900,
      returnUrl:
        "https://shop.example.com/payment-result?order=ord_abcdefghijklmnop&method=vnpay",
    });
  });

  it("omits order from the return URL when the order has no public id", async () => {
    process.env.FRONTEND_URL = "https://shop.example.com";
    const { service, createPayment } = createService();

    await service.processPayment(
      "111",
      3900,
      "Payment for order 111",
      PaymentMethodEnum.VNPAY,
      null,
    );

    expect(createPayment).toHaveBeenCalledWith({
      id: "111",
      total: 3900,
      returnUrl: "https://shop.example.com/payment-result?method=vnpay",
    });
  });

  it("omits order from multi-order ZaloPay return URLs", async () => {
    process.env.FRONTEND_URL = "https://shop.example.com";
    const { service, createPayment } = createService();

    await service.processMultiOrderPayment(
      [110, 111],
      7800,
      PaymentMethodEnum.ZALOPAY,
    );

    expect(createPayment).toHaveBeenCalledWith({
      id: "7",
      total: 7800,
      returnUrl: "https://shop.example.com/payment-result?method=zalopay",
    });
  });

  it.each([["" as const], ["shop.example.com" as const]])(
    "falls back to the default origin when FRONTEND_URL is %p instead of failing",
    async (frontendUrl) => {
      process.env.FRONTEND_URL = frontendUrl;
      const { service, createPayment } = createService();

      await service.processPayment(
        "111",
        3900,
        "Payment for order 111",
        PaymentMethodEnum.VNPAY,
        "ord_abcdefghijklmnop",
      );

      expect(createPayment).toHaveBeenCalledWith({
        id: "111",
        total: 3900,
        returnUrl:
          "http://localhost:5173/payment-result?order=ord_abcdefghijklmnop&method=vnpay",
      });
    },
  );
});

describe("PaymentsService getPaymentUrl recovery", () => {
  function createService(existing: Partial<Payment>): {
    service: PaymentsService;
    createPayment: jest.Mock;
    update: jest.Mock;
  } {
    const createPayment = jest.fn().mockResolvedValue({
      paymentUrl: "https://gateway.example/pay",
      transactionId: "txn-2",
      appTransId: "app-2",
    });
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const service = new PaymentsService(
      {
        findOne: jest.fn().mockResolvedValue(existing),
        update,
      } as unknown as Repository<Payment>,
      {} as Repository<PaymentMethod>,
      {
        getStrategy: jest.fn().mockReturnValue({
          createPayment,
          verifyCallback: jest.fn(),
        }),
      } as unknown as PaymentGatewayFactory,
      { publish: jest.fn() } as unknown as Channel,
    );
    return { service, createPayment, update };
  }

  it("re-issues the gateway URL when a pending payment has none", async () => {
    const { service, createPayment, update } = createService({
      id: 9,
      orderId: 120,
      amount: 3900,
      status: PaymentStatus.PENDING,
      orderUrl: null,
    });

    process.env.FRONTEND_URL = "https://shop.example.com";
    const result = await service.getPaymentUrl(
      120,
      PaymentMethodEnum.VNPAY,
      "ord_abcdefghijklmnop",
    );

    // The recovery path must deep-link the same way the create path does.
    expect(createPayment).toHaveBeenCalledTimes(1);
    expect(createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        returnUrl:
          "https://shop.example.com/payment-result?order=ord_abcdefghijklmnop&method=vnpay",
      }),
    );
    expect(update).toHaveBeenCalledWith(
      { orderId: 120 },
      expect.objectContaining({ orderUrl: "https://gateway.example/pay" }),
    );
    expect(result).toEqual({
      orderUrl: "https://gateway.example/pay",
      status: PaymentStatus.PENDING,
    });
  });

  it("returns the stored URL without calling the gateway again", async () => {
    const { service, createPayment } = createService({
      id: 9,
      orderId: 120,
      amount: 3900,
      status: PaymentStatus.PENDING,
      orderUrl: "https://gateway.example/existing",
    });

    const result = await service.getPaymentUrl(120, PaymentMethodEnum.VNPAY);

    expect(createPayment).not.toHaveBeenCalled();
    expect(result.orderUrl).toBe("https://gateway.example/existing");
  });
});
