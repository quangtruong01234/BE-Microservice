import { HttpService } from "@nestjs/axios";
import { ClientProxy } from "@nestjs/microservices";
import { Channel } from "amqplib";
import { FindOperator, Repository } from "typeorm";
import { CachedService } from "@app/cached";
import { Order, OrderStatus } from "./entity/order.entity";
import { OrderOutbox } from "./entity/order-outbox.entity";
import { OrderItem } from "./entity/order_item.entity";
import { OrderReturnRequest } from "./entity/order-return-request.entity";
import { ShippingHistory } from "./entity/shipping-history.entity";
import { OrderStatusHistory } from "./entity/order-status-history.entity";
import { createRepositoryMock } from "@app/testing";
import { Voucher } from "./entity/voucher.entity";
import { VoucherRedemption } from "./entity/voucher-redemption.entity";
import { GhnService } from "./ghn/ghn.service";
import { OrdersService } from "./orders.service";

interface FindArgs {
  where: Array<{
    userId?: number;
    sellerId?: number;
    status: FindOperator<OrderStatus[]>;
  }>;
  relations: string[];
}

describe("OrdersService.cancelOpenOrdersForUser (ACCOUNT-DELETE-01)", () => {
  const orderRepository = { find: jest.fn() };
  let service: OrdersService;
  let finalizeCancellation: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrdersService(
      { publish: jest.fn(), connection: {} } as unknown as Channel,
      {} as HttpService,
      {} as ClientProxy,
      {} as ClientProxy,
      {} as ClientProxy,
      orderRepository as unknown as Repository<Order>,
      {} as Repository<OrderItem>,
      {} as Repository<OrderOutbox>,
      {} as Repository<ShippingHistory>,
      {} as Repository<OrderReturnRequest>,
      {} as Repository<Voucher>,
      {} as Repository<VoucherRedemption>,
      {} as GhnService,
      {} as CachedService,
      createRepositoryMock<OrderStatusHistory>().asRepository(),
    );
    finalizeCancellation = jest
      .spyOn(
        service as unknown as {
          finalizeCancellation: (order: Order) => Promise<void>;
        },
        "finalizeCancellation",
      )
      .mockResolvedValue(undefined);
  });

  it("cancels only pre-shipment orders where the user is buyer OR seller", async () => {
    const asBuyer = { id: 1, userId: 9, sellerId: 2 } as Order;
    const asSeller = { id: 2, userId: 3, sellerId: 9 } as Order;
    orderRepository.find.mockResolvedValue([asBuyer, asSeller]);

    await expect(service.cancelOpenOrdersForUser(9)).resolves.toEqual({
      canceledOrderCount: 2,
    });

    const [findArgs] = orderRepository.find.mock.calls[0] as [FindArgs];
    expect(findArgs.relations).toEqual(["items"]);
    expect(
      findArgs.where.map(({ userId, sellerId }) => ({ userId, sellerId })),
    ).toEqual([
      { userId: 9, sellerId: undefined },
      { userId: undefined, sellerId: 9 },
    ]);
    for (const clause of findArgs.where) {
      expect(clause.status.value).toEqual([
        OrderStatus.PENDING,
        OrderStatus.CONFIRMED,
        OrderStatus.PROCESSING,
      ]);
    }
    expect(finalizeCancellation).toHaveBeenNthCalledWith(1, asBuyer);
    expect(finalizeCancellation).toHaveBeenNthCalledWith(2, asSeller);
  });

  it("is a no-op for a user with no open order", async () => {
    orderRepository.find.mockResolvedValue([]);

    await expect(service.cancelOpenOrdersForUser(9)).resolves.toEqual({
      canceledOrderCount: 0,
    });
    expect(finalizeCancellation).not.toHaveBeenCalled();
  });

  it("fails fast so the gateway never reaches the irreversible scrub", async () => {
    orderRepository.find.mockResolvedValue([
      { id: 1, userId: 9 } as Order,
      { id: 2, userId: 9 } as Order,
    ]);
    finalizeCancellation.mockRejectedValueOnce(new Error("db down"));

    await expect(service.cancelOpenOrdersForUser(9)).rejects.toThrow("db down");
    expect(finalizeCancellation).toHaveBeenCalledTimes(1);
  });
});
