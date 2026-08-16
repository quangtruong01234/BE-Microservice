import { ForbiddenException } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { of, throwError } from "rxjs";
import {
  ORDER_MESSAGE_PATTERN,
  PAYMENT_MESSAGE_PATTERN,
} from "libs/constant/message-pattern.constant";
import { PRODUCT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-product.constant";
import { PaymentMethod } from "@app/common";
import { CachedService } from "@app/cached";
import { ConflictException } from "@nestjs/common";
import { OrderService } from "./order.service";

describe("OrderService access control", () => {
  const ordersClient = { send: jest.fn() };
  const paymentsClient = { send: jest.fn() };
  const userClient = { send: jest.fn() };
  const productClient = { send: jest.fn() };
  const cached = {
    setNx: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };
  let service: OrderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrderService(
      ordersClient as unknown as ClientProxy,
      paymentsClient as unknown as ClientProxy,
      userClient as unknown as ClientProxy,
      productClient as unknown as ClientProxy,
      cached as unknown as CachedService,
    );
  });

  it("rejects listing another user's orders", async () => {
    await expect(
      service.getOrderByUser(17, 1, 10, 18, "user"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ordersClient.send).not.toHaveBeenCalled();
  });

  it("allows an admin to list another user's orders", async () => {
    ordersClient.send.mockReturnValue(
      of({ data: [], total: 0, page: 1, limit: 10 }),
    );

    await expect(
      service.getOrderByUser(17, 1, 10, 21, "admin"),
    ).resolves.toEqual({ data: [], total: 0, page: 1, limit: 10 });
  });

  it("rejects payment URL access for another user's order", async () => {
    ordersClient.send.mockReturnValue(
      of({
        id: 97,
        userId: 17,
        status: "pending",
        total: 100,
        items: [],
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z",
      }),
    );

    await expect(
      service.getPaymentUrl("ord_test000000000097", 18, "user"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(paymentsClient.send).not.toHaveBeenCalled();
  });

  it("returns the payment URL for the order owner", async () => {
    ordersClient.send.mockReturnValue(
      of({
        id: 97,
        userId: 17,
        status: "pending",
        total: 100,
        items: [],
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z",
      }),
    );
    paymentsClient.send.mockReturnValue(
      of({ orderUrl: "https://payment.example/97", status: "pending" }),
    );

    await expect(
      service.getPaymentUrl("ord_test000000000097", 17, "user"),
    ).resolves.toEqual({
      orderUrl: "https://payment.example/97",
      status: "pending",
    });
  });

  it("keeps the snapshotted product public id when the product was deleted", async () => {
    ordersClient.send.mockReturnValue(
      of({
        id: 97,
        publicId: "ord_1111111111111111",
        userId: 17,
        sellerId: 20,
        status: "canceled",
        total: 100,
        items: [
          {
            id: 1,
            productId: 16,
            productPublicId: "prod_1111111111111111",
            sellerId: 20,
            productName: "Deleted product snapshot",
            quantity: 1,
            price: 100,
            skuId: null,
            skuTierIdx: null,
          },
        ],
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z",
      }),
    );
    productClient.send.mockReturnValue(of([]));
    userClient.send.mockReturnValue(
      of([
        { id: 17, publicId: "usr_1111111111111111" },
        { id: 20, publicId: "usr_2222222222222222" },
      ]),
    );

    const order = await service.getOrderById(
      "ord_1111111111111111",
      17,
      "user",
    );
    const items = order.items as Record<string, unknown>[];

    expect(items[0].productId).toBe("prod_1111111111111111");
    expect(items[0]).not.toHaveProperty("productPublicId");
  });

  it("projects the public order id onto GHN shipping history rows", async () => {
    ordersClient.send.mockReturnValue(
      of([
        {
          id: "30",
          orderId: "120",
          type: "manual_sync",
          action: "sync_detail",
          actorId: null,
        },
      ]),
    );

    await expect(
      service.getAdminGhnHistory("ord_1111111111111111"),
    ).resolves.toEqual([
      {
        id: "30",
        orderId: "ord_1111111111111111",
        type: "manual_sync",
        action: "sync_detail",
        actorId: null,
      },
    ]);
    expect(ordersClient.send).toHaveBeenCalledWith(
      ORDER_MESSAGE_PATTERN.ADMIN_GHN_HISTORY,
      { orderId: "ord_1111111111111111" },
    );
  });

  it("cancels multi-seller child orders when payment initialization fails", async () => {
    productClient.send.mockImplementation(
      (pattern: string, productId: string) => {
        if (pattern === PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_ID) {
          const internalProductId = productId.endsWith("2") ? 2 : 1;
          return of({
            id: internalProductId,
            userId: internalProductId === 1 ? 20 : 21,
            price: 100,
            isActive: true,
          });
        }
        return throwError(() => new Error(`Unexpected pattern: ${pattern}`));
      },
    );
    ordersClient.send.mockImplementation((pattern: string) => {
      if (pattern === ORDER_MESSAGE_PATTERN.CREATE_MULTI_SELLER_ORDER) {
        return of([
          {
            id: 101,
            userId: 18,
            status: "pending",
            total: 100,
            items: [],
            createdAt: "2026-06-20T00:00:00.000Z",
            updatedAt: "2026-06-20T00:00:00.000Z",
          },
          {
            id: 102,
            userId: 18,
            status: "pending",
            total: 100,
            items: [],
            createdAt: "2026-06-20T00:00:00.000Z",
            updatedAt: "2026-06-20T00:00:00.000Z",
          },
        ]);
      }
      if (pattern === ORDER_MESSAGE_PATTERN.CANCEL_ORDER) {
        return of({ id: 101, status: "canceled" });
      }
      return throwError(() => new Error(`Unexpected pattern: ${pattern}`));
    });
    paymentsClient.send.mockImplementation((pattern: string) => {
      if (pattern === PAYMENT_MESSAGE_PATTERN.INITIATE_MULTI_ORDER_PAYMENT) {
        return throwError(() => new Error("payment unavailable"));
      }
      return throwError(() => new Error(`Unexpected pattern: ${pattern}`));
    });

    await expect(
      service.createOrder(18, {
        paymentMethod: PaymentMethod.VNPAY,
        shippingAddress: "address",
        items: [
          {
            productId: "prod_1111111111111111",
            productName: "Product 1",
            quantity: 1,
          },
          {
            productId: "prod_2222222222222222",
            productName: "Product 2",
            quantity: 1,
          },
        ],
      }),
    ).rejects.toThrow();

    expect(ordersClient.send).toHaveBeenCalledWith(
      ORDER_MESSAGE_PATTERN.CANCEL_ORDER,
      { orderId: 101, callerId: 18, callerRole: "user" },
    );
    expect(ordersClient.send).toHaveBeenCalledWith(
      ORDER_MESSAGE_PATTERN.CANCEL_ORDER,
      { orderId: 102, callerId: 18, callerRole: "user" },
    );
  });

  describe("idempotent create-order", () => {
    const baseDto = {
      paymentMethod: PaymentMethod.COD,
      shippingAddress: "address",
      items: [
        {
          productId: "prod_1111111111111111",
          productName: "Product 1",
          quantity: 1,
        },
      ],
    };

    it("replays the cached response when the key was already completed", async () => {
      const cachedResponse = { orders: [{ id: 55 }], paymentUrl: null };
      cached.setNx.mockResolvedValue(false);
      cached.get.mockResolvedValue(JSON.stringify(cachedResponse));

      await expect(service.createOrder(18, baseDto, "key-1")).resolves.toEqual(
        cachedResponse,
      );
      // No order creation attempted on replay
      expect(ordersClient.send).not.toHaveBeenCalled();
    });

    it("rejects a concurrent double-submit with 409 while in flight", async () => {
      cached.setNx.mockResolvedValue(false);
      cached.get.mockResolvedValue("__in_progress__");

      await expect(
        service.createOrder(18, baseDto, "key-2"),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(ordersClient.send).not.toHaveBeenCalled();
    });

    it("releases the lock when the underlying create fails", async () => {
      cached.setNx.mockResolvedValue(true);
      cached.del.mockResolvedValue(1);
      productClient.send.mockReturnValue(
        of({ id: 1, userId: 20, price: 100, isActive: true }),
      );
      ordersClient.send.mockReturnValue(throwError(() => new Error("boom")));

      await expect(service.createOrder(18, baseDto, "key-3")).rejects.toThrow();
      expect(cached.del).toHaveBeenCalledWith("idem:order:18:key-3");
    });
  });

  describe("analytics product ids (PRODTEST-0806 #4)", () => {
    const analytics = {
      from: "2026-08-01",
      to: "2026-08-15",
      interval: "day",
      summary: {
        totalRevenue: 500,
        completedOrders: 2,
        totalOrders: 3,
        averageOrderValue: 250,
      },
      revenueOverTime: [],
      statusDistribution: { completed: 2 },
      topProducts: [
        { productId: 7, productName: "Áo", quantitySold: 4, revenue: 400 },
        { productId: 9, productName: "Quần", quantitySold: 1, revenue: 100 },
      ],
    };

    it("exposes topProducts productId as a public id", async () => {
      ordersClient.send.mockReturnValue(of(analytics));
      productClient.send.mockReturnValue(
        of([
          { id: 7, publicId: "prod_aaaaaaaaaaaaaaaa" },
          { id: 9, publicId: "prod_bbbbbbbbbbbbbbbb" },
        ]),
      );

      const result = (await service.getSellerAnalytics(20, {
        interval: "day",
      })) as { topProducts: { productId: unknown }[] };

      expect(productClient.send).toHaveBeenCalledWith(
        PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_IDS,
        [7, 9],
      );
      expect(result.topProducts.map((product) => product.productId)).toEqual([
        "prod_aaaaaaaaaaaaaaaa",
        "prod_bbbbbbbbbbbbbbbb",
      ]);
    });

    it("nulls a product id it cannot resolve instead of leaking the number", async () => {
      ordersClient.send.mockReturnValue(of(analytics));
      productClient.send.mockReturnValue(
        throwError(() => new Error("product service down")),
      );

      const result = (await service.getSellerAnalytics(20, {
        interval: "day",
      })) as { topProducts: { productId: unknown }[] };

      expect(result.topProducts.map((product) => product.productId)).toEqual([
        null,
        null,
      ]);
    });

    it("keeps the revenue-stripped payload on public ids too", async () => {
      ordersClient.send.mockReturnValue(of(analytics));
      productClient.send.mockReturnValue(
        of([{ id: 7, publicId: "prod_aaaaaaaaaaaaaaaa" }]),
      );

      const result = (await service.getShippingAnalytics(
        { interval: "day" },
        false,
      )) as {
        summary: Record<string, unknown>;
        topProducts: Record<string, unknown>[];
      };

      expect(result.summary).not.toHaveProperty("totalRevenue");
      expect(result.topProducts[0].productId).toBe("prod_aaaaaaaaaaaaaaaa");
      expect(result.topProducts[1].productId).toBeNull();
      expect(result.topProducts[0]).not.toHaveProperty("revenue");
    });
  });
});
