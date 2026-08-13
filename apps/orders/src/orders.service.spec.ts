import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PaymentMethod } from "@app/common";
import { HttpService } from "@nestjs/axios";
import { ClientProxy } from "@nestjs/microservices";
import { Channel } from "amqplib";
import { of } from "rxjs";
import { FindOperator, Repository } from "typeorm";
import { INVENTORY_MESSAGE_PATTERNS } from "libs/constant/message-pattern-inventory.constant";
import { Order, OrderStatus } from "./entity/order.entity";
import { OrderOutbox } from "./entity/order-outbox.entity";
import { OrderItem } from "./entity/order_item.entity";
import { OrderReturnRequest } from "./entity/order-return-request.entity";
import { Voucher } from "./entity/voucher.entity";
import { VoucherRedemption } from "./entity/voucher-redemption.entity";
import {
  ShippingHistory,
  ShippingHistoryType,
} from "./entity/shipping-history.entity";
import { GhnService } from "./ghn/ghn.service";
import { OrdersService } from "./orders.service";
import { EVENT } from "@app/common/constants/event";

// Names of the events published through the raw amqplib channel, in call
// order — publish(exchange, eventName, payload).
const publishedEventNames = (publish: jest.Mock): string[] =>
  publish.mock.calls.map((call: unknown[]) => String(call[1]));

// RESIL-02 outbox repository: only the post-commit bookkeeping (mark delivered
// / record the failure / discard on cancel) goes through it — the row itself is
// written with the transaction manager. The mocks are handed back separately so
// assertions never touch an unbound repository method.
interface OutboxRepositoryMock {
  repository: Repository<OrderOutbox>;
  update: jest.Mock;
  remove: jest.Mock;
  find: jest.Mock;
}

const createOutboxRepository = (): OutboxRepositoryMock => {
  const update = jest.fn().mockResolvedValue({ affected: 1 });
  const remove = jest.fn().mockResolvedValue({ affected: 1 });
  const find = jest.fn().mockResolvedValue([]);
  return {
    repository: {
      update,
      delete: remove,
      find,
    } as unknown as Repository<OrderOutbox>,
    update,
    remove,
    find,
  };
};

// The outbox row `placeOrder` hands to the publisher after the transaction.
const outboxRow = (orderId: number): OrderOutbox =>
  ({
    id: orderId * 10,
    eventName: EVENT.ORDER_CREATED_EVENT,
    exchange: "orders_exchange",
    orderId,
    payload: JSON.stringify({ pattern: EVENT.ORDER_CREATED_EVENT, data: {} }),
    attempts: 0,
  }) as unknown as OrderOutbox;

describe("OrdersService.handleGhnWebhook", () => {
  const createOrder = (status: OrderStatus): Order =>
    ({
      id: 1,
      status,
      ghnOrderCode: "GHN-1",
      paymentMethod: PaymentMethod.COD,
      total: 100,
      items: [],
    }) as unknown as Order;

  const createService = (
    order: Order,
    affected: number,
    options: { historySaveRejects?: boolean } = {},
  ): {
    service: OrdersService;
    publish: jest.Mock;
    update: jest.Mock;
    historySave: jest.Mock;
  } => {
    const publish = jest.fn();
    const update = jest.fn().mockResolvedValue({ affected });
    const orderRepository = {
      findOne: jest.fn().mockResolvedValue(order),
      update,
    };
    const historySave = options.historySaveRejects
      ? jest.fn().mockRejectedValue(new Error("history table unavailable"))
      : jest.fn((value: unknown) =>
          Promise.resolve({
            ...(value as object),
            id: 1,
            createdAt: new Date(),
          }),
        );
    const shippingHistoryRepository = {
      create: jest.fn((value: unknown) => value),
      save: historySave,
    };

    const service = new OrdersService(
      { publish, connection: {} } as unknown as Channel,
      {} as HttpService,
      {} as ClientProxy,
      {} as ClientProxy,
      {} as ClientProxy,
      orderRepository as unknown as Repository<Order>,
      {} as Repository<OrderItem>,
      createOutboxRepository().repository,
      shippingHistoryRepository as unknown as Repository<ShippingHistory>,
      {} as Repository<OrderReturnRequest>,
      {} as Repository<Voucher>,
      {} as Repository<VoucherRedemption>,
      {} as GhnService,
    );

    return { service, publish, update, historySave };
  };

  it("does not change a canceled order", async () => {
    const { service, publish, update } = createService(
      createOrder(OrderStatus.CANCELED),
      1,
    );

    await service.handleGhnWebhook("GHN-1", "delivered");

    expect(update).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("ignores a stale status", async () => {
    const { service, publish, update } = createService(
      createOrder(OrderStatus.DELIVERING),
      1,
    );

    await service.handleGhnWebhook("GHN-1", "picked");

    expect(update).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("emits COD completion only after winning the atomic update", async () => {
    const { service, publish, update } = createService(
      createOrder(OrderStatus.DELIVERING),
      1,
    );

    await service.handleGhnWebhook("GHN-1", "delivered");

    expect(update).toHaveBeenCalledWith(
      { id: 1, status: OrderStatus.DELIVERING },
      { status: OrderStatus.COMPLETED },
    );
    expect(publishedEventNames(publish)).toEqual([
      EVENT.PAYMENT_COMPLETED_EVENT,
      EVENT.ORDER_STATUS_CHANGED_EVENT,
    ]);
  });

  it("does not emit when another callback wins the atomic update", async () => {
    const { service, publish } = createService(
      createOrder(OrderStatus.DELIVERING),
      0,
    );

    await service.handleGhnWebhook("GHN-1", "delivered");

    expect(publish).not.toHaveBeenCalled();
  });

  it("cancels the order and announces it on a GHN cancel status", async () => {
    const { service, publish, update } = createService(
      createOrder(OrderStatus.PROCESSING),
      1,
    );

    await service.handleGhnWebhook("GHN-1", "cancel");

    expect(update).toHaveBeenCalledWith(
      { id: 1, status: OrderStatus.PROCESSING },
      { status: OrderStatus.CANCELED },
    );
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("cancels the order on any GHN return status", async () => {
    const { service, publish, update } = createService(
      createOrder(OrderStatus.DELIVERING),
      1,
    );

    await service.handleGhnWebhook("GHN-1", "return_transporting");

    expect(update).toHaveBeenCalledWith(
      { id: 1, status: OrderStatus.DELIVERING },
      { status: OrderStatus.CANCELED },
    );
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("does not fail webhook processing when history insert fails", async () => {
    const { service, publish, update, historySave } = createService(
      createOrder(OrderStatus.DELIVERING),
      1,
      { historySaveRejects: true },
    );

    await expect(
      service.handleGhnWebhook("GHN-1", "delivered"),
    ).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledWith(
      { id: 1, status: OrderStatus.DELIVERING },
      { status: OrderStatus.COMPLETED },
    );
    expect(publishedEventNames(publish)).toEqual([
      EVENT.PAYMENT_COMPLETED_EVENT,
      EVENT.ORDER_STATUS_CHANGED_EVENT,
    ]);
    expect(historySave).toHaveBeenCalledTimes(1);
  });
});

describe("OrdersService stock reservation", () => {
  const item = {
    productId: 1,
    productName: "Product 1",
    quantity: 1,
    price: 100,
    sellerId: 20,
  };

  function createService(options: { isBrokerLive?: boolean } = {}): {
    service: OrdersService;
    inventorySend: jest.Mock;
    transaction: jest.Mock;
    publish: jest.Mock;
    update: jest.Mock;
    ghnPreview: jest.Mock;
    outbox: OutboxRepositoryMock;
  } {
    const inventorySend = jest.fn();
    const transaction = jest.fn();
    const publish = jest.fn();
    const update = jest.fn();
    const outbox = createOutboxRepository();
    const orderRepository = {
      manager: { transaction },
      update,
    };
    const ghnService = {
      previewShippingFee: jest.fn().mockResolvedValue({
        shippingFee: 0,
        expectedDeliveryTime: null,
      }),
    };
    const service = new OrdersService(
      {
        publish,
        // The real handle is a proxy whose `connection` disappears while the
        // broker is down — that is how the service detects an outage.
        connection: options.isBrokerLive === false ? undefined : {},
      } as unknown as Channel,
      {} as HttpService,
      { send: inventorySend } as unknown as ClientProxy,
      {} as ClientProxy,
      {} as ClientProxy,
      orderRepository as unknown as Repository<Order>,
      {} as Repository<OrderItem>,
      outbox.repository,
      {} as Repository<ShippingHistory>,
      {} as Repository<OrderReturnRequest>,
      {} as Repository<Voucher>,
      {} as Repository<VoucherRedemption>,
      ghnService as unknown as GhnService,
    );

    return {
      service,
      inventorySend,
      transaction,
      publish,
      update,
      ghnPreview: ghnService.previewShippingFee,
      outbox,
    };
  }

  function createServiceWithoutPublisher(): {
    service: OrdersService;
    inventorySend: jest.Mock;
    transaction: jest.Mock;
    update: jest.Mock;
    outbox: OutboxRepositoryMock;
  } {
    const inventorySend = jest.fn();
    const transaction = jest.fn();
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const outbox = createOutboxRepository();
    const orderRepository = {
      manager: { transaction },
      update,
    };
    const ghnService = {
      previewShippingFee: jest.fn().mockResolvedValue({
        shippingFee: 0,
        expectedDeliveryTime: null,
      }),
    };
    const service = new OrdersService(
      null,
      {} as HttpService,
      { send: inventorySend } as unknown as ClientProxy,
      {} as ClientProxy,
      {} as ClientProxy,
      orderRepository as unknown as Repository<Order>,
      {} as Repository<OrderItem>,
      outbox.repository,
      {} as Repository<ShippingHistory>,
      {} as Repository<OrderReturnRequest>,
      {} as Repository<Voucher>,
      {} as Repository<VoucherRedemption>,
      ghnService as unknown as GhnService,
    );

    return { service, inventorySend, transaction, update, outbox };
  }

  function mockStock(
    inventorySend: jest.Mock,
    reserveResults: boolean[],
  ): void {
    let reserveIndex = 0;
    inventorySend.mockImplementation((pattern: string) => {
      if (pattern === INVENTORY_MESSAGE_PATTERNS.INVENTORY_CHECK_STOCK) {
        return of({ available: true, availableStock: 10 });
      }
      if (pattern === INVENTORY_MESSAGE_PATTERNS.INVENTORY_RESERVE_STOCK) {
        return of(reserveResults[reserveIndex++] ?? false);
      }
      if (pattern === INVENTORY_MESSAGE_PATTERNS.INVENTORY_RELEASE_STOCK) {
        return of(true);
      }
      throw new Error(`Unexpected pattern: ${pattern}`);
    });
  }

  it("does not start the DB transaction when reservation fails", async () => {
    const { service, inventorySend, transaction } = createService();
    mockStock(inventorySend, [false]);

    await expect(
      service.placeOrder(18, PaymentMethod.VNPAY, "address", [item]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("releases earlier reservations when a later item fails", async () => {
    const { service, inventorySend, transaction } = createService();
    mockStock(inventorySend, [true, false]);

    await expect(
      service.placeOrder(18, PaymentMethod.VNPAY, "address", [
        item,
        { ...item, productId: 2 },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(inventorySend).toHaveBeenCalledWith(
      INVENTORY_MESSAGE_PATTERNS.INVENTORY_RELEASE_STOCK,
      expect.objectContaining({
        productId: 1,
        quantity: 1,
        skuId: undefined,
      }),
    );
    const releasePayload = (
      inventorySend.mock.calls as unknown as Array<
        [string, { reservationKey?: unknown }]
      >
    ).find(
      ([pattern]) =>
        pattern === INVENTORY_MESSAGE_PATTERNS.INVENTORY_RELEASE_STOCK,
    )?.[1];
    expect(typeof releasePayload?.reservationKey).toBe("string");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("releases reservations when the DB transaction fails", async () => {
    const { service, inventorySend, transaction } = createService();
    mockStock(inventorySend, [true]);
    transaction.mockRejectedValue(new Error("DB unavailable"));

    await expect(
      service.placeOrder(18, PaymentMethod.VNPAY, "address", [item]),
    ).rejects.toThrow("DB unavailable");
    expect(inventorySend).toHaveBeenCalledWith(
      INVENTORY_MESSAGE_PATTERNS.INVENTORY_RELEASE_STOCK,
      expect.objectContaining({
        productId: 1,
        quantity: 1,
        skuId: undefined,
      }),
    );
    const releasePayload = (
      inventorySend.mock.calls as unknown as Array<
        [string, { reservationKey?: unknown }]
      >
    ).find(
      ([pattern]) =>
        pattern === INVENTORY_MESSAGE_PATTERNS.INVENTORY_RELEASE_STOCK,
    )?.[1];
    expect(typeof releasePayload?.reservationKey).toBe("string");
  });

  it("reserves stock before starting the DB transaction", async () => {
    const { service, inventorySend, transaction } = createService();
    mockStock(inventorySend, [true]);
    transaction.mockResolvedValue({
      savedOrder: {
        id: 1,
        paymentMethod: PaymentMethod.VNPAY,
        items: [],
      },
      outbox: outboxRow(1),
    });

    await service.placeOrder(18, PaymentMethod.VNPAY, "address", [item]);

    const reserveCall = inventorySend.mock.invocationCallOrder[1];
    expect(reserveCall).toBeLessThan(transaction.mock.invocationCallOrder[0]);
  });

  it("cancels the saved online-payment order and releases stock when payment event cannot publish", async () => {
    const { service, inventorySend, transaction, update, outbox } =
      createServiceWithoutPublisher();
    mockStock(inventorySend, [true]);
    transaction.mockResolvedValue({
      savedOrder: {
        id: 1,
        paymentMethod: PaymentMethod.VNPAY,
        reservationKey: "reservation-1",
        items: [item],
      },
      outbox: outboxRow(1),
    });

    await expect(
      service.placeOrder(18, PaymentMethod.VNPAY, "address", [item]),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(update).toHaveBeenCalledWith(1, {
      status: OrderStatus.CANCELED,
    });
    expect(inventorySend).toHaveBeenCalledWith(
      INVENTORY_MESSAGE_PATTERNS.INVENTORY_RELEASE_STOCK,
      expect.objectContaining({
        productId: 1,
        quantity: 1,
        reservationKey: "reservation-1",
      }),
    );
    // RESIL-02: the order is gone, so the owed event must go with it — the
    // poller must never resurrect `order_created` for a canceled order.
    expect(outbox.remove).toHaveBeenCalledWith(10);
  });

  // RESIL-02 — the defect this replaced: a COD order survived a broker outage
  // while inventory / rewards / notification never heard about it, because the
  // publish failure was only a `logger.warn`.
  it("keeps a COD order and leaves the event owed in the outbox when the broker is down", async () => {
    const { service, inventorySend, transaction, update, outbox } =
      createServiceWithoutPublisher();
    mockStock(inventorySend, [true]);
    transaction.mockResolvedValue({
      savedOrder: {
        id: 1,
        paymentMethod: PaymentMethod.COD,
        reservationKey: "reservation-1",
        items: [item],
      },
      outbox: outboxRow(1),
    });

    await expect(
      service.placeOrder(18, PaymentMethod.COD, "address", [item]),
    ).resolves.toEqual(expect.objectContaining({ id: 1 }));

    expect(update).not.toHaveBeenCalledWith(1, {
      status: OrderStatus.CANCELED,
    });
    expect(outbox.remove).not.toHaveBeenCalled();
    // Row stays unpublished, with the failure recorded for the poller.
    expect(outbox.update).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ attempts: 1 }),
    );
  });

  it("delivers the owed event on the next poller tick and marks it published", async () => {
    const { service, publish, outbox } = createService();
    const pending = outboxRow(1);
    pending.attempts = 2;
    outbox.find.mockResolvedValue([pending]);

    await service.drainOrderOutbox();

    expect(publishedEventNames(publish)).toEqual([EVENT.ORDER_CREATED_EVENT]);
    const [markedId, patch] = outbox.update.mock.calls[0] as [
      number,
      Partial<OrderOutbox>,
    ];
    expect(markedId).toBe(10);
    expect(patch.publishedAt).toBeInstanceOf(Date);
  });

  // The publisher handle is a self-healing proxy: while the broker is down it
  // still answers publish() with a no-op returning false instead of throwing.
  // Trusting that answer would mark the row published and lose the very event
  // the outbox exists to keep.
  it("leaves the event owed when the publisher proxy is disconnected", async () => {
    const { service, inventorySend, transaction, publish, update, outbox } =
      createService({ isBrokerLive: false });
    mockStock(inventorySend, [true]);
    transaction.mockResolvedValue({
      savedOrder: {
        id: 1,
        paymentMethod: PaymentMethod.COD,
        reservationKey: "reservation-1",
        items: [item],
      },
      outbox: outboxRow(1),
    });

    await expect(
      service.placeOrder(18, PaymentMethod.COD, "address", [item]),
    ).resolves.toEqual(expect.objectContaining({ id: 1 }));

    expect(publish).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalledWith(1, {
      status: OrderStatus.CANCELED,
    });
    expect(outbox.update).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ attempts: 1 }),
    );
  });

  it("skips the poller tick entirely while the publisher proxy is disconnected", async () => {
    const { service, outbox } = createService({ isBrokerLive: false });

    await service.drainOrderOutbox();

    expect(outbox.find).not.toHaveBeenCalled();
  });

  // PRODTEST-0806 #2 — a GHN refusal at fee preview is deterministic: the same
  // address can never be turned into a waybill, so the checkout must fail while
  // nothing is reserved rather than book an unshippable order at fee 0.
  it("rejects the checkout when GHN refuses the address, before reserving stock", async () => {
    const { service, inventorySend, transaction, ghnPreview } = createService();
    mockStock(inventorySend, [true]);
    ghnPreview.mockRejectedValue(
      new BadRequestException("GHN does not know district 999999"),
    );

    await expect(
      service.placeOrder(18, PaymentMethod.COD, "address", [item]),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(inventorySend).not.toHaveBeenCalledWith(
      INVENTORY_MESSAGE_PATTERNS.INVENTORY_RESERVE_STOCK,
      expect.anything(),
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  // The other half of the same branch: an outage is not the order's fault, so
  // the order is still placed at fee 0 and ready-to-ship retries the waybill.
  it("still places the order when GHN is unreachable at fee preview", async () => {
    const { service, inventorySend, transaction, ghnPreview } = createService();
    mockStock(inventorySend, [true]);
    ghnPreview.mockRejectedValue(
      new ServiceUnavailableException("GHN unavailable"),
    );
    transaction.mockResolvedValue({
      savedOrder: {
        id: 1,
        paymentMethod: PaymentMethod.VNPAY,
        items: [],
      },
      outbox: outboxRow(1),
    });

    await expect(
      service.placeOrder(18, PaymentMethod.VNPAY, "address", [item]),
    ).resolves.toEqual(expect.objectContaining({ id: 1 }));
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("rejects a multi-seller checkout when GHN refuses the address", async () => {
    const { service, inventorySend, transaction, ghnPreview } = createService();
    mockStock(inventorySend, [true, true]);
    ghnPreview.mockRejectedValue(
      new BadRequestException(
        "Ward 20308 does not belong to GHN district 1442",
      ),
    );

    await expect(
      service.placeMultiSellerOrder(18, PaymentMethod.COD, "address", [
        item,
        { ...item, productId: 2, sellerId: 21 },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(inventorySend).not.toHaveBeenCalledWith(
      INVENTORY_MESSAGE_PATTERNS.INVENTORY_RESERVE_STOCK,
      expect.anything(),
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("does not create multi-seller orders when reservation fails", async () => {
    const { service, inventorySend, transaction } = createService();
    mockStock(inventorySend, [true, false]);

    await expect(
      service.placeMultiSellerOrder(18, PaymentMethod.VNPAY, "address", [
        item,
        { ...item, productId: 2, sellerId: 21 },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("marks every multi-seller order event for payment deduplication", async () => {
    const { service, inventorySend, transaction, publish } = createService();
    mockStock(inventorySend, [true, true]);
    let nextOrderId = 99;
    const manager = {
      create: jest.fn(
        (_entity: unknown, data: Record<string, unknown>) => data,
      ),
      save: jest.fn((...args: unknown[]): Promise<unknown> => {
        const value = args.at(-1);
        if (Array.isArray(value)) {
          return Promise.resolve(value as unknown[]);
        }
        return Promise.resolve({ ...(value as object), id: nextOrderId++ });
      }),
    };
    type TransactionCallback = (value: typeof manager) => Promise<unknown>;
    transaction.mockImplementation(
      (callback: TransactionCallback): Promise<unknown> => callback(manager),
    );

    await service.placeMultiSellerOrder(18, PaymentMethod.VNPAY, "address", [
      item,
      { ...item, productId: 2, sellerId: 21 },
    ]);

    const publishCalls = publish.mock.calls as unknown as Array<
      [string, string, Buffer]
    >;
    const events = publishCalls.map(
      (call) =>
        JSON.parse(call[2].toString()) as {
          data: { isMultiSellerCheckout?: boolean };
        },
    );
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.data.isMultiSellerCheckout)).toBe(
      true,
    );
  });
});

describe("OrdersService.sweepStaleReservations", () => {
  const staleOrder = (overrides: Partial<Order> = {}): Order =>
    ({
      id: 1,
      status: OrderStatus.PENDING,
      ghnOrderCode: null,
      reservationKey: "reservation-1",
      items: [{ productId: 1, quantity: 2, skuId: undefined }],
      ...overrides,
    }) as unknown as Order;

  const createService = (
    orders: Order[],
  ): {
    service: OrdersService;
    find: jest.Mock;
    update: jest.Mock;
    inventorySend: jest.Mock;
    publish: jest.Mock;
    cancelShippingOrder: jest.Mock;
  } => {
    const find = jest.fn().mockResolvedValue(orders);
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const inventorySend = jest.fn().mockReturnValue(of(true));
    const publish = jest.fn();
    const cancelShippingOrder = jest.fn().mockResolvedValue(undefined);
    const orderRepository = { find, update };

    const service = new OrdersService(
      { publish, connection: {} } as unknown as Channel,
      {} as HttpService,
      { send: inventorySend } as unknown as ClientProxy,
      {} as ClientProxy,
      {} as ClientProxy,
      orderRepository as unknown as Repository<Order>,
      {} as Repository<OrderItem>,
      createOutboxRepository().repository,
      {} as Repository<ShippingHistory>,
      {} as Repository<OrderReturnRequest>,
      {} as Repository<Voucher>,
      {} as Repository<VoucherRedemption>,
      { cancelShippingOrder } as unknown as GhnService,
    );

    return {
      service,
      find,
      update,
      inventorySend,
      publish,
      cancelShippingOrder,
    };
  };

  it("cancels each stale order and releases its reservation", async () => {
    const { service, update, inventorySend, publish } = createService([
      staleOrder(),
    ]);

    await service.sweepStaleReservations();

    expect(update).toHaveBeenCalledWith(
      { id: 1 },
      { status: OrderStatus.CANCELED },
    );
    expect(inventorySend).toHaveBeenCalledWith(
      INVENTORY_MESSAGE_PATTERNS.INVENTORY_RELEASE_STOCK,
      expect.objectContaining({
        productId: 1,
        quantity: 2,
        reservationKey: "reservation-1",
      }),
    );
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("only queries orders with no GHN code, a non-terminal status, and an old createdAt", async () => {
    const { service, find } = createService([]);

    await service.sweepStaleReservations();

    const calls = find.mock.calls as unknown as Array<
      [{ where: Record<string, unknown> }]
    >;
    const where = calls[0][0].where;
    expect(where).toHaveProperty("ghnOrderCode");
    expect(where).toHaveProperty("status");
    expect(where).toHaveProperty("createdAt");
  });

  it("caps how many stale orders one tick cancels", async () => {
    const { service, find } = createService([]);

    await service.sweepStaleReservations();

    const calls = find.mock.calls as unknown as Array<
      [{ take?: number; order?: Record<string, string> }]
    >;
    expect(calls[0][0].take).toBe(25);
    expect(calls[0][0].order).toEqual({ id: "ASC" });
  });

  it("does nothing when no stale orders exist", async () => {
    const { service, update, inventorySend, publish } = createService([]);

    await service.sweepStaleReservations();

    expect(update).not.toHaveBeenCalled();
    expect(inventorySend).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("isolates a failing order so the rest of the batch still sweeps", async () => {
    const { service, update, publish } = createService([
      staleOrder({ id: 1 }),
      staleOrder({ id: 2, reservationKey: "reservation-2" }),
    ]);
    update.mockRejectedValueOnce(new Error("DB blip on order 1"));

    await service.sweepStaleReservations();

    // Order 1 fails at the status update; order 2 still completes and publishes.
    expect(publish).toHaveBeenCalledTimes(1);
    const publishedOrderIds = (
      publish.mock.calls as unknown as Array<[string, string, Buffer]>
    ).map(
      (call) =>
        (JSON.parse(call[2].toString()) as { data: { orderId: number } }).data
          .orderId,
    );
    expect(publishedOrderIds).toEqual([2]);
  });

  it("skips overlapping ticks while a sweep is in flight", async () => {
    const { service, find } = createService([]);
    let resolveFind: (value: Order[]) => void = () => {};
    find.mockImplementationOnce(
      () =>
        new Promise<Order[]>((resolve) => {
          resolveFind = resolve;
        }),
    );

    const first = service.sweepStaleReservations();
    const second = service.sweepStaleReservations();
    resolveFind([]);
    await Promise.all([first, second]);

    // The second (overlapping) tick bails out before issuing its own query.
    expect(find).toHaveBeenCalledTimes(1);
  });
});

describe("OrdersService.cancelOrder GHN detachment", () => {
  const buildOrder = (): Order =>
    ({
      id: 1,
      userId: 7,
      status: OrderStatus.PROCESSING,
      ghnOrderCode: "LAYGKP",
      reservationKey: "reservation-1",
      items: [{ productId: 1, quantity: 2, skuId: undefined }],
    }) as unknown as Order;

  const createService = (
    cancelShippingOrder: jest.Mock,
  ): { service: OrdersService; update: jest.Mock; publish: jest.Mock } => {
    const findOne = jest.fn().mockResolvedValue(buildOrder());
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const publish = jest.fn();
    const orderRepository = { findOne, update };

    const service = new OrdersService(
      { publish, connection: {} } as unknown as Channel,
      {} as HttpService,
      { send: jest.fn().mockReturnValue(of(true)) } as unknown as ClientProxy,
      {} as ClientProxy,
      {} as ClientProxy,
      orderRepository as unknown as Repository<Order>,
      {} as Repository<OrderItem>,
      createOutboxRepository().repository,
      {} as Repository<ShippingHistory>,
      {} as Repository<OrderReturnRequest>,
      {} as Repository<Voucher>,
      {} as Repository<VoucherRedemption>,
      { cancelShippingOrder } as unknown as GhnService,
    );

    return { service, update, publish };
  };

  it("answers the caller without waiting for the GHN cancel to settle", async () => {
    let releaseGhn: () => void = () => {};
    const cancelShippingOrder = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          releaseGhn = (): void => resolve(true);
        }),
    );
    const { service, update, publish } = createService(cancelShippingOrder);

    // Resolves even though the GHN promise is still pending — a slow GHN can no
    // longer burn the gateway's TCP budget for an already-committed cancel.
    const canceled = await service.cancelOrder(1, 7, "user");

    expect(canceled.status).toBe(OrderStatus.CANCELED);
    expect(update).toHaveBeenCalledWith(
      { id: 1 },
      { status: OrderStatus.CANCELED },
    );
    expect(publish).toHaveBeenCalledTimes(1);
    expect(cancelShippingOrder).toHaveBeenCalledWith("LAYGKP");

    releaseGhn();
  });

  it("retries the detached GHN cancel once before giving up", async () => {
    const cancelShippingOrder = jest
      .fn()
      .mockRejectedValueOnce(new Error("GHN timeout"))
      .mockResolvedValueOnce(true);
    const { service } = createService(cancelShippingOrder);

    const canceled = await service.cancelOrder(1, 7, "user");

    expect(canceled.status).toBe(OrderStatus.CANCELED);
    await new Promise((resolve) => setImmediate(resolve));
    expect(cancelShippingOrder).toHaveBeenCalledTimes(2);
  });

  it("swallows a rejected GHN cancel so the detached call cannot crash the process", async () => {
    const cancelShippingOrder = jest
      .fn()
      .mockRejectedValue(new Error("GHN unreachable"));
    const { service } = createService(cancelShippingOrder);

    const canceled = await service.cancelOrder(1, 7, "user");

    expect(canceled.status).toBe(OrderStatus.CANCELED);
    // Flush the microtask queue so the detached rejections are handled here; an
    // unhandled one would fail the run.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(cancelShippingOrder).toHaveBeenCalledTimes(2);
  });
});

describe("OrdersService.advanceOrderStatus", () => {
  const buildOrder = (status: OrderStatus): Order =>
    ({
      id: 7,
      status,
      paymentMethod: PaymentMethod.COD,
      total: 100,
      reservationKey: "reservation-7",
      items: [{ productId: 1, quantity: 2, skuId: null }],
    }) as unknown as Order;

  const createService = (
    order: Order,
    affected: number,
  ): {
    service: OrdersService;
    update: jest.Mock;
    inventorySend: jest.Mock;
    publish: jest.Mock;
  } => {
    const update = jest.fn().mockResolvedValue({ affected });
    const inventorySend = jest.fn().mockReturnValue(of(true));
    const publish = jest.fn();
    const orderRepository = {
      findOne: jest.fn().mockResolvedValue(order),
      update,
    };
    const service = new OrdersService(
      { publish, connection: {} } as unknown as Channel,
      {} as HttpService,
      { send: inventorySend } as unknown as ClientProxy,
      {} as ClientProxy,
      {} as ClientProxy,
      orderRepository as unknown as Repository<Order>,
      {} as Repository<OrderItem>,
      createOutboxRepository().repository,
      {} as Repository<ShippingHistory>,
      {} as Repository<OrderReturnRequest>,
      {} as Repository<Voucher>,
      {} as Repository<VoucherRedemption>,
      {} as GhnService,
    );
    return { service, update, inventorySend, publish };
  };

  it("advances processing → shipped via a guarded update", async () => {
    const { service, update } = createService(
      buildOrder(OrderStatus.PROCESSING),
      1,
    );

    const result = await service.advanceOrderStatus(
      7,
      0,
      true,
      OrderStatus.SHIPPED,
    );

    expect(update).toHaveBeenCalledWith(
      { id: 7, status: OrderStatus.PROCESSING },
      { status: OrderStatus.SHIPPED },
    );
    expect(result.status).toBe(OrderStatus.SHIPPED);
  });

  it("rejects a non-sequential transition", async () => {
    const { service, update } = createService(
      buildOrder(OrderStatus.PROCESSING),
      1,
    );

    await expect(
      service.advanceOrderStatus(7, 0, true, OrderStatus.COMPLETED),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it("throws Conflict when the guarded update loses a race", async () => {
    const { service } = createService(buildOrder(OrderStatus.DELIVERING), 0);

    await expect(
      service.advanceOrderStatus(7, 0, true, OrderStatus.COMPLETED),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // ORD-RBAC-01 — after ready-to-ship the carrier owns the status. A seller
  // hand-setting it would let the local order disagree with GHN, and a hand-set
  // terminal status makes the order deaf to the webhook that follows.
  it("forbids a seller from advancing, without touching the order", async () => {
    const { service, update } = createService(
      buildOrder(OrderStatus.PROCESSING),
      1,
    );

    await expect(
      service.advanceOrderStatus(7, 3, false, OrderStatus.SHIPPED),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it("finalizes COD completion exactly once on delivering → completed", async () => {
    const { service, inventorySend, publish } = createService(
      buildOrder(OrderStatus.DELIVERING),
      1,
    );

    await service.advanceOrderStatus(7, 0, true, OrderStatus.COMPLETED);

    expect(inventorySend).toHaveBeenCalledWith(
      INVENTORY_MESSAGE_PATTERNS.INVENTORY_CONSUME_RESERVED_STOCK,
      expect.objectContaining({ productId: 1, quantity: 2 }),
    );
    expect(publishedEventNames(publish)).toEqual([
      EVENT.PAYMENT_COMPLETED_EVENT,
      EVENT.ORDER_STATUS_CHANGED_EVENT,
    ]);
  });
});

describe("OrdersService payment completion idempotency", () => {
  it("creates at most one GHN order when payment events race", async () => {
    const order = {
      id: 98,
      status: OrderStatus.PENDING,
      paymentMethod: PaymentMethod.VNPAY,
      ghnOrderCode: null,
      items: [],
    } as unknown as Order;
    const findOne = jest.fn().mockResolvedValue(order);
    // Discriminate by the patch, not by call order: ORD-GUARD-01 added a
    // conditional paid_at stamp before the claim, and both racers may reach it.
    // Only the status claim decides who owns the waybill.
    let claims = 0;
    const update = jest
      .fn()
      .mockImplementation(
        (_criteria: unknown, patch: Record<string, unknown>) => {
          if ("status" in patch) {
            claims += 1;
            return Promise.resolve({ affected: claims === 1 ? 1 : 0 });
          }
          return Promise.resolve({ affected: 1 });
        },
      );
    const createShippingOrder = jest.fn().mockResolvedValue("GHN-98");
    const service = new OrdersService(
      null,
      {} as HttpService,
      {} as ClientProxy,
      {} as ClientProxy,
      {} as ClientProxy,
      { findOne, update } as unknown as Repository<Order>,
      {} as Repository<OrderItem>,
      createOutboxRepository().repository,
      {} as Repository<ShippingHistory>,
      {} as Repository<OrderReturnRequest>,
      {} as Repository<Voucher>,
      {} as Repository<VoucherRedemption>,
      { createShippingOrder } as unknown as GhnService,
    );

    await Promise.all([
      service.handlePaymentCompleted(98),
      service.handlePaymentCompleted(98),
    ]);

    expect(createShippingOrder).toHaveBeenCalledTimes(1);
  });
});

describe("OrdersService.readyToShip GHN waybill gating", () => {
  const buildService = (
    createShippingOrder: jest.Mock,
  ): {
    service: OrdersService;
    save: jest.Mock;
    update: jest.Mock;
  } => {
    const order = {
      id: 50,
      status: OrderStatus.CONFIRMED,
      // COD, so the ORD-GUARD-01 payment guard is not what is under test here.
      paymentMethod: PaymentMethod.COD,
      ghnOrderCode: null,
      items: [{ productId: 1, quantity: 1 }],
    } as unknown as Order;
    const findOne = jest.fn().mockResolvedValue(order);
    const count = jest.fn().mockResolvedValue(1);
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const save = jest.fn().mockImplementation((toSave: Order) => toSave);
    const productClient = {
      send: () => of([1]),
    } as unknown as ClientProxy;
    const service = new OrdersService(
      null,
      {} as HttpService,
      {} as ClientProxy,
      {} as ClientProxy,
      productClient,
      { findOne, update, save } as unknown as Repository<Order>,
      { count } as unknown as Repository<OrderItem>,
      createOutboxRepository().repository,
      {} as Repository<ShippingHistory>,
      {} as Repository<OrderReturnRequest>,
      {} as Repository<Voucher>,
      {} as Repository<VoucherRedemption>,
      { createShippingOrder } as unknown as GhnService,
    );
    return { service, save, update };
  };

  it("advances to processing and persists the GHN code on success", async () => {
    const createShippingOrder = jest.fn().mockResolvedValue("GHN-50");
    const { service, save, update } = buildService(createShippingOrder);

    const result = await service.readyToShip(50, 0);

    expect(createShippingOrder).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(50, { ghnOrderCode: "GHN-50" });
    expect(result.status).toBe(OrderStatus.PROCESSING);
    expect(result.ghnOrderCode).toBe("GHN-50");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps the order at confirmed and throws when GHN creation fails", async () => {
    const createShippingOrder = jest
      .fn()
      .mockRejectedValue(
        new BadRequestException(
          'Cannot resolve province "X" to a GHN province',
        ),
      );
    const { service, save } = buildService(createShippingOrder);

    await expect(service.readyToShip(50, 0)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // The order must NOT be advanced to PROCESSING without a waybill.
    expect(save).not.toHaveBeenCalled();
  });
});

describe("OrdersService admin GHN actions (cancel / return)", () => {
  const buildOrder = (overrides: Partial<Order> = {}): Order =>
    ({
      id: 90,
      status: OrderStatus.PROCESSING,
      ghnOrderCode: "LXEWKY",
      reservationKey: "reservation-90",
      items: [{ productId: 1, quantity: 2, skuId: null }],
      ...overrides,
    }) as unknown as Order;

  const createService = (
    order: Order | null,
    ghn: {
      cancelShippingOrder?: jest.Mock;
      returnShippingOrder?: jest.Mock;
      updateOrderCod?: jest.Mock;
      updateOrderReceiver?: jest.Mock;
    },
    affected = 1,
  ): {
    service: OrdersService;
    update: jest.Mock;
    save: jest.Mock;
    publish: jest.Mock;
    inventorySend: jest.Mock;
  } => {
    const update = jest.fn().mockResolvedValue({ affected });
    const inventorySend = jest.fn().mockReturnValue(of(true));
    const publish = jest.fn();
    const save = jest
      .fn()
      .mockImplementation((entity: ShippingHistory) =>
        Promise.resolve({ ...entity, id: 1, createdAt: new Date() }),
      );
    const orderRepository = {
      findOne: jest.fn().mockResolvedValue(order),
      update,
    };
    const shippingHistoryRepository = {
      create: jest.fn().mockImplementation((data: ShippingHistory) => data),
      save,
    };
    const service = new OrdersService(
      { publish, connection: {} } as unknown as Channel,
      {} as HttpService,
      { send: inventorySend } as unknown as ClientProxy,
      {} as ClientProxy,
      {} as ClientProxy,
      orderRepository as unknown as Repository<Order>,
      {} as Repository<OrderItem>,
      createOutboxRepository().repository,
      shippingHistoryRepository as unknown as Repository<ShippingHistory>,
      {} as Repository<OrderReturnRequest>,
      {} as Repository<Voucher>,
      {} as Repository<VoucherRedemption>,
      ghn as unknown as GhnService,
    );
    return { service, update, save, publish, inventorySend };
  };

  it("cancels via GHN, flips the order to CANCELED, and records an ACTION history row", async () => {
    const cancelShippingOrder = jest.fn().mockResolvedValue(true);
    const { service, update, save, publish, inventorySend } = createService(
      buildOrder(),
      { cancelShippingOrder },
    );

    const result = await service.cancelAdminGhnOrder(90, 42);

    expect(cancelShippingOrder).toHaveBeenCalledWith("LXEWKY");
    expect(update).toHaveBeenCalledWith(
      { id: 90, status: OrderStatus.PROCESSING },
      { status: OrderStatus.CANCELED },
    );
    // Reserved stock released + ORDER_CANCELED_EVENT published.
    expect(inventorySend).toHaveBeenCalled();
    expect(publish).toHaveBeenCalledTimes(1);
    const recorded = (save.mock.calls as ShippingHistory[][])[0][0];
    expect(recorded.type).toBe(ShippingHistoryType.ACTION);
    expect(recorded.action).toBe("cancel");
    expect(recorded.success).toBe(true);
    expect(result.newStatus).toBe(OrderStatus.CANCELED);
    expect(result.success).toBe(true);
  });

  it("returns via GHN (parcel back to shop) and cancels the local order", async () => {
    const returnShippingOrder = jest.fn().mockResolvedValue(true);
    const { service, update } = createService(
      buildOrder({ status: OrderStatus.SHIPPED }),
      { returnShippingOrder },
    );

    const result = await service.returnAdminGhnOrder(90, 42);

    expect(returnShippingOrder).toHaveBeenCalledWith("LXEWKY");
    expect(update).toHaveBeenCalledWith(
      { id: 90, status: OrderStatus.SHIPPED },
      { status: OrderStatus.CANCELED },
    );
    expect(result.action).toBe("return");
    expect(result.newStatus).toBe(OrderStatus.CANCELED);
  });

  it("records a failed ACTION row and leaves the order intact when GHN rejects the cancel", async () => {
    const cancelShippingOrder = jest
      .fn()
      .mockRejectedValue(
        new Error("GHN cancel error: order already delivered"),
      );
    const { service, update, save, publish } = createService(buildOrder(), {
      cancelShippingOrder,
    });

    await expect(service.cancelAdminGhnOrder(90, 42)).rejects.toThrow(
      "GHN cancel error",
    );

    // Local order must NOT change and no cancellation side-effects run.
    expect(update).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    const recorded = (save.mock.calls as ShippingHistory[][])[0][0];
    expect(recorded.type).toBe(ShippingHistoryType.ACTION);
    expect(recorded.success).toBe(false);
  });

  it("rejects a return when the order is not in a returnable status", async () => {
    const returnShippingOrder = jest.fn();
    const { service } = createService(
      buildOrder({ status: OrderStatus.CONFIRMED }),
      { returnShippingOrder },
    );

    await expect(service.returnAdminGhnOrder(90, 42)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(returnShippingOrder).not.toHaveBeenCalled();
  });

  it("404s when the order does not exist", async () => {
    const { service } = createService(null, {
      cancelShippingOrder: jest.fn(),
    });

    await expect(service.cancelAdminGhnOrder(999, 42)).rejects.toThrow(
      /not found/i,
    );
  });

  it("400s when the order has no GHN order code", async () => {
    const { service } = createService(buildOrder({ ghnOrderCode: null }), {
      cancelShippingOrder: jest.fn(),
    });

    await expect(service.cancelAdminGhnOrder(90, 42)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("updates GHN COD, mirrors it to the local order, and records an ACTION row", async () => {
    const updateOrderCod = jest.fn().mockResolvedValue(undefined);
    const { service, update, save } = createService(
      buildOrder({ codAmount: 100000 }),
      { updateOrderCod },
    );

    const result = await service.updateAdminGhnCod(90, 42, 250000);

    expect(updateOrderCod).toHaveBeenCalledWith("LXEWKY", 250000);
    expect(update).toHaveBeenCalledWith({ id: 90 }, { codAmount: 250000 });
    const recorded = (save.mock.calls as ShippingHistory[][])[0][0];
    expect(recorded.action).toBe("update_cod");
    expect(recorded.success).toBe(true);
    expect(result.previousCodAmount).toBe(100000);
    expect(result.newCodAmount).toBe(250000);
    expect(result.success).toBe(true);
  });

  it("records a failed ACTION row and leaves the order intact when GHN rejects the COD update", async () => {
    const updateOrderCod = jest
      .fn()
      .mockRejectedValue(new Error("GHN update COD error: order in transit"));
    const { service, update, save } = createService(
      buildOrder({ codAmount: 100000 }),
      { updateOrderCod },
    );

    await expect(service.updateAdminGhnCod(90, 42, 250000)).rejects.toThrow(
      "GHN update COD error",
    );
    expect(update).not.toHaveBeenCalled();
    const recorded = (save.mock.calls as ShippingHistory[][])[0][0];
    expect(recorded.action).toBe("update_cod");
    expect(recorded.success).toBe(false);
  });

  it("400s the COD update when the order is past the editable window", async () => {
    const updateOrderCod = jest.fn();
    const { service } = createService(
      buildOrder({ status: OrderStatus.SHIPPED }),
      { updateOrderCod },
    );

    await expect(
      service.updateAdminGhnCod(90, 42, 250000),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateOrderCod).not.toHaveBeenCalled();
  });

  it("updates GHN receiver and rewrites only the name/phone parts of shippingAddress", async () => {
    const updateOrderReceiver = jest.fn().mockResolvedValue(undefined);
    const { service, update, save } = createService(
      buildOrder({
        shippingAddress: "Old Name|0900000000|1 Old St|Ward|District|Province",
      }),
      { updateOrderReceiver },
    );

    const result = await service.updateAdminGhnReceiver(90, 42, {
      toName: "  New Name  ",
      toPhone: "0911111111",
    });

    expect(updateOrderReceiver).toHaveBeenCalledWith("LXEWKY", {
      toName: "New Name",
      toPhone: "0911111111",
    });
    expect(update).toHaveBeenCalledWith(
      { id: 90 },
      {
        shippingAddress: "New Name|0911111111|1 Old St|Ward|District|Province",
      },
    );
    const recorded = (save.mock.calls as ShippingHistory[][])[0][0];
    expect(recorded.action).toBe("update_receiver");
    expect(recorded.success).toBe(true);
    expect(result.updatedFields).toEqual(["toName", "toPhone"]);
  });

  it("400s the receiver update when no fields are provided", async () => {
    const updateOrderReceiver = jest.fn();
    const { service } = createService(buildOrder(), { updateOrderReceiver });

    await expect(
      service.updateAdminGhnReceiver(90, 42, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateOrderReceiver).not.toHaveBeenCalled();
  });
});

describe("OrdersService.getAdminGhnOrderDetail (demo-mode GHN status)", () => {
  const buildOrder = (): Order =>
    ({
      id: 62,
      status: OrderStatus.PROCESSING,
      ghnOrderCode: "LXD6YV",
      paymentMethod: PaymentMethod.COD,
      total: 100,
      items: [],
    }) as unknown as Order;

  const buildHistory = (action: string, ghnStatus: string): ShippingHistory =>
    ({
      id: 1,
      orderId: "62", // bigint → string at runtime, as mysql2 returns it
      type: ShippingHistoryType.MANUAL_SYNC,
      action,
      ghnStatus,
      createdAt: new Date("2026-06-29T00:00:00.000Z"),
    }) as unknown as ShippingHistory;

  const createService = (
    history: ShippingHistory[],
    liveGhnStatus: string,
  ): { service: OrdersService; getOrderDetail: jest.Mock } => {
    const orderRepository = {
      findOne: jest.fn().mockResolvedValue(buildOrder()),
    };
    const shippingHistoryRepository = {
      find: jest.fn().mockResolvedValue(history),
    };
    const getOrderDetail = jest.fn().mockResolvedValue({
      orderCode: "LXD6YV",
      status: liveGhnStatus,
      codAmount: 100,
      totalFee: null,
      expectedDeliveryTime: null,
      leadtime: null,
      toName: "Buyer",
      toPhone: "0900000000",
      toAddress: "1 Some St",
      fromName: null,
      fromPhone: null,
      raw: {},
    });
    const service = new OrdersService(
      { publish: jest.fn(), connection: {} } as unknown as Channel,
      {} as HttpService,
      {} as ClientProxy,
      {} as ClientProxy,
      {} as ClientProxy,
      orderRepository as unknown as Repository<Order>,
      {} as Repository<OrderItem>,
      createOutboxRepository().repository,
      shippingHistoryRepository as unknown as Repository<ShippingHistory>,
      {} as Repository<OrderReturnRequest>,
      {} as Repository<Voucher>,
      {} as Repository<VoucherRedemption>,
      { getOrderDetail } as unknown as GhnService,
    );
    return { service, getOrderDetail };
  };

  const previousFlag = process.env.GHN_DEMO_ENDPOINTS_ENABLED;
  afterEach(() => {
    if (previousFlag === undefined) {
      delete process.env.GHN_DEMO_ENDPOINTS_ENABLED;
    } else {
      process.env.GHN_DEMO_ENDPOINTS_ENABLED = previousFlag;
    }
  });

  it("overrides the stuck live GHN status with the demo status when demo mode is on", async () => {
    process.env.GHN_DEMO_ENDPOINTS_ENABLED = "true";
    const { service } = createService(
      [buildHistory("demo_status", "delivering")],
      "ready_to_pick", // GHN sandbox never advances the waybill
    );

    const detail = await service.getAdminGhnOrderDetail(62);

    // GHN-side status reflects the demo-driven state, not the stuck sandbox value.
    expect(detail.ghnDetail?.status).toBe("delivering");
    // Real receiver/COD fields from the live detail are preserved.
    expect(detail.ghnDetail?.toName).toBe("Buyer");
    expect(detail.lastGhnStatus).toBe("delivering");
  });

  it("keeps the live GHN status when demo mode is off", async () => {
    delete process.env.GHN_DEMO_ENDPOINTS_ENABLED;
    const { service } = createService(
      [buildHistory("demo_status", "delivering")],
      "ready_to_pick",
    );

    const detail = await service.getAdminGhnOrderDetail(62);

    expect(detail.ghnDetail?.status).toBe("ready_to_pick");
  });

  it("does not override when the latest history is a real sync, even in demo mode", async () => {
    process.env.GHN_DEMO_ENDPOINTS_ENABLED = "true";
    const { service } = createService(
      [buildHistory("sync", "picking")],
      "ready_to_pick",
    );

    const detail = await service.getAdminGhnOrderDetail(62);

    expect(detail.ghnDetail?.status).toBe("ready_to_pick");
  });
});

describe("OrdersService ORD-GUARD-01 — unpaid online orders cannot be fulfilled", () => {
  const buildOrder = (overrides: Partial<Order> = {}): Order =>
    ({
      id: 77,
      status: OrderStatus.PENDING,
      paymentMethod: PaymentMethod.VNPAY,
      paidAt: null,
      total: 90000,
      reservationKey: "reservation-77",
      items: [{ productId: 1, quantity: 1, skuId: null }],
      ...overrides,
    }) as unknown as Order;

  const createService = (
    order: Order,
  ): {
    service: OrdersService;
    save: jest.Mock;
    update: jest.Mock;
    createShippingOrder: jest.Mock;
  } => {
    const save = jest.fn().mockImplementation((toSave: Order) => toSave);
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const createShippingOrder = jest.fn().mockResolvedValue("GHN-77");
    // The seller owns the order in every case here — the guard, not ownership,
    // is what must reject.
    const productClient = { send: () => of([1]) } as unknown as ClientProxy;
    const service = new OrdersService(
      null,
      {} as HttpService,
      { send: () => of(true) } as unknown as ClientProxy,
      {} as ClientProxy,
      productClient,
      {
        findOne: jest.fn().mockResolvedValue(order),
        save,
        update,
      } as unknown as Repository<Order>,
      {
        count: jest.fn().mockResolvedValue(1),
      } as unknown as Repository<OrderItem>,
      createOutboxRepository().repository,
      {} as Repository<ShippingHistory>,
      {} as Repository<OrderReturnRequest>,
      {} as Repository<Voucher>,
      {} as Repository<VoucherRedemption>,
      { createShippingOrder } as unknown as GhnService,
    );
    return { service, save, update, createShippingOrder };
  };

  it("refuses to confirm a vnpay order whose payment never completed", async () => {
    const { service, save } = createService(buildOrder());

    await expect(service.confirmOrder(77, 3)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(save).not.toHaveBeenCalled();
  });

  it("refuses ready-to-ship on an unpaid online order, so no waybill is bought", async () => {
    const { service, createShippingOrder } = createService(
      buildOrder({ status: OrderStatus.CONFIRMED }),
    );

    await expect(service.readyToShip(77, 3)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(createShippingOrder).not.toHaveBeenCalled();
  });

  it("refuses to advance an unpaid online order down the fulfilment path", async () => {
    const { service, update } = createService(
      buildOrder({ status: OrderStatus.PROCESSING }),
    );

    await expect(
      service.advanceOrderStatus(77, 3, true, OrderStatus.SHIPPED),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it("lets a paid online order through", async () => {
    const { service, update } = createService(
      buildOrder({ status: OrderStatus.PROCESSING, paidAt: new Date() }),
    );

    const result = await service.advanceOrderStatus(
      77,
      3,
      true,
      OrderStatus.SHIPPED,
    );

    expect(result.status).toBe(OrderStatus.SHIPPED);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("never blocks COD, which is collected at delivery", async () => {
    const { service, save } = createService(
      buildOrder({ paymentMethod: PaymentMethod.COD }),
    );

    const confirmed = await service.confirmOrder(77, 3);

    expect(confirmed.status).toBe(OrderStatus.CONFIRMED);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("returns the fresh paidAt on the response that completes a COD order", async () => {
    const { service } = createService(
      buildOrder({
        status: OrderStatus.DELIVERING,
        paymentMethod: PaymentMethod.COD,
      }),
    );

    const completed = await service.advanceOrderStatus(
      77,
      3,
      true,
      OrderStatus.COMPLETED,
    );

    // The entity was loaded before the stamp; without the in-memory mirror the
    // seller would get paidAt:null and a refetch would disagree with it.
    expect(completed.paidAt).toBeInstanceOf(Date);
  });

  it("stamps paid_at once, conditionally, when payment_completed arrives", async () => {
    const order = buildOrder({ status: OrderStatus.PENDING });
    const { service, update } = createService(order);

    await service.handlePaymentCompleted(77);

    const [criteria, patch] = update.mock.calls[0] as [
      { id: number; paidAt: unknown },
      { paidAt: unknown },
    ];
    expect(criteria.id).toBe(77);
    // IsNull() — the stamp only lands on a row that has none, so a replayed
    // payment_completed cannot rewrite the original timestamp.
    expect(criteria.paidAt).toBeInstanceOf(FindOperator);
    expect(patch.paidAt).toBeInstanceOf(Date);
  });
});
