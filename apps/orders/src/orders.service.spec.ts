import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PaymentMethod } from "@app/common";
import { HttpService } from "@nestjs/axios";
import { ClientProxy } from "@nestjs/microservices";
import { Channel } from "amqplib";
import { of } from "rxjs";
import { Repository } from "typeorm";
import { INVENTORY_MESSAGE_PATTERNS } from "libs/constant/message-pattern-inventory.constant";
import { Order, OrderStatus } from "./entity/order.entity";
import { OrderItem } from "./entity/order_item.entity";
import { GhnService } from "./ghn/ghn.service";
import { OrdersService } from "./orders.service";

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
  ): {
    service: OrdersService;
    publish: jest.Mock;
    update: jest.Mock;
  } => {
    const publish = jest.fn();
    const update = jest.fn().mockResolvedValue({ affected });
    const orderRepository = {
      findOne: jest.fn().mockResolvedValue(order),
      update,
    };

    const service = new OrdersService(
      { publish } as unknown as Channel,
      {} as HttpService,
      {} as ClientProxy,
      {} as ClientProxy,
      {} as ClientProxy,
      orderRepository as unknown as Repository<Order>,
      {} as Repository<OrderItem>,
      {} as GhnService,
    );

    return { service, publish, update };
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
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("does not emit when another callback wins the atomic update", async () => {
    const { service, publish } = createService(
      createOrder(OrderStatus.DELIVERING),
      0,
    );

    await service.handleGhnWebhook("GHN-1", "delivered");

    expect(publish).not.toHaveBeenCalled();
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

  function createService(): {
    service: OrdersService;
    inventorySend: jest.Mock;
    transaction: jest.Mock;
    publish: jest.Mock;
    update: jest.Mock;
  } {
    const inventorySend = jest.fn();
    const transaction = jest.fn();
    const publish = jest.fn();
    const update = jest.fn();
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
      { publish } as unknown as Channel,
      {} as HttpService,
      { send: inventorySend } as unknown as ClientProxy,
      {} as ClientProxy,
      {} as ClientProxy,
      orderRepository as unknown as Repository<Order>,
      {} as Repository<OrderItem>,
      ghnService as unknown as GhnService,
    );

    return { service, inventorySend, transaction, publish, update };
  }

  function createServiceWithoutPublisher(): {
    service: OrdersService;
    inventorySend: jest.Mock;
    transaction: jest.Mock;
    update: jest.Mock;
  } {
    const inventorySend = jest.fn();
    const transaction = jest.fn();
    const update = jest.fn().mockResolvedValue({ affected: 1 });
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
      ghnService as unknown as GhnService,
    );

    return { service, inventorySend, transaction, update };
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
      id: 1,
      paymentMethod: PaymentMethod.VNPAY,
      items: [],
    });

    await service.placeOrder(18, PaymentMethod.VNPAY, "address", [item]);

    const reserveCall = inventorySend.mock.invocationCallOrder[1];
    expect(reserveCall).toBeLessThan(transaction.mock.invocationCallOrder[0]);
  });

  it("cancels the saved online-payment order and releases stock when payment event cannot publish", async () => {
    const { service, inventorySend, transaction, update } =
      createServiceWithoutPublisher();
    mockStock(inventorySend, [true]);
    transaction.mockResolvedValue({
      id: 1,
      paymentMethod: PaymentMethod.VNPAY,
      reservationKey: "reservation-1",
      items: [item],
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
      { publish } as unknown as Channel,
      {} as HttpService,
      { send: inventorySend } as unknown as ClientProxy,
      {} as ClientProxy,
      {} as ClientProxy,
      orderRepository as unknown as Repository<Order>,
      {} as Repository<OrderItem>,
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
      { publish } as unknown as Channel,
      {} as HttpService,
      { send: inventorySend } as unknown as ClientProxy,
      {} as ClientProxy,
      {} as ClientProxy,
      orderRepository as unknown as Repository<Order>,
      {} as Repository<OrderItem>,
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
    expect(publish).toHaveBeenCalledTimes(1);
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
    const update = jest
      .fn()
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 0 })
      .mockResolvedValue({ affected: 1 });
    const createShippingOrder = jest.fn().mockResolvedValue("GHN-98");
    const service = new OrdersService(
      null,
      {} as HttpService,
      {} as ClientProxy,
      {} as ClientProxy,
      {} as ClientProxy,
      { findOne, update } as unknown as Repository<Order>,
      {} as Repository<OrderItem>,
      { createShippingOrder } as unknown as GhnService,
    );

    await Promise.all([
      service.handlePaymentCompleted(98),
      service.handlePaymentCompleted(98),
    ]);

    expect(createShippingOrder).toHaveBeenCalledTimes(1);
  });
});
