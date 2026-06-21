import { Channel } from "amqplib";
import { Repository } from "typeorm";
import { PaymentGatewayFactory } from "./payment-gateway.factory";
import { PaymentMethod } from "./entity/payment-method.entity";
import { Payment, PaymentStatus } from "./entity/payment.entity";
import { PaymentsService } from "./payments.service";

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
