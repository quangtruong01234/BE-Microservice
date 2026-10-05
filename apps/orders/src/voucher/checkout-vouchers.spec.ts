import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PaymentMethod } from "@app/common";
import { CachedService } from "@app/cached";
import { HttpService } from "@nestjs/axios";
import { ClientProxy } from "@nestjs/microservices";
import { Channel } from "amqplib";
import { of } from "rxjs";
import { EntityManager, FindOperator, Repository } from "typeorm";
import { INVENTORY_MESSAGE_PATTERNS } from "libs/constant/message-pattern-inventory.constant";
import { VOUCHER_MESSAGE } from "libs/constant/response-message.constant";
import { Order, OrderStatus } from "../entity/order.entity";
import { OrderItem } from "../entity/order_item.entity";
import { OrderOutbox } from "../entity/order-outbox.entity";
import { OrderReturnRequest } from "../entity/order-return-request.entity";
import { ShippingHistory } from "../entity/shipping-history.entity";
import { OrderStatusHistory } from "../entity/order-status-history.entity";
import { createRepositoryMock } from "@app/testing";
import { Voucher, VoucherDiscountType } from "../entity/voucher.entity";
import { VoucherRedemption } from "../entity/voucher-redemption.entity";
import { GhnService } from "../ghn/ghn.service";
import { OrdersService } from "../orders.service";

// VOUCHER-SHOP-01 phase 2 — stacking one shop voucher per seller with one
// platform voucher, the platform split, and the cancel-path re-anchoring.

const SHOP_SELLER_ID = 20;
const OTHER_SELLER_ID = 23;

const voucherRow = (overrides: Partial<Voucher>): Voucher =>
  ({
    id: 1,
    code: "CODE",
    description: null,
    discountType: VoucherDiscountType.FIXED,
    discountValue: "0.00",
    minOrderAmount: "0.00",
    maxDiscountAmount: null,
    usageLimit: null,
    usedCount: 0,
    perUserLimit: null,
    startsAt: null,
    expiresAt: null,
    isActive: true,
    sellerId: null,
    ...overrides,
  }) as Voucher;

// 20 off the SHOP_SELLER_ID slice.
const SHOP20 = voucherRow({
  id: 11,
  code: "SHOP20",
  discountValue: "20.00",
  sellerId: SHOP_SELLER_ID,
});
const SHOP5 = voucherRow({
  id: 12,
  code: "SHOP5",
  discountValue: "5.00",
  sellerId: SHOP_SELLER_ID,
});
// 10% of what the buyer still pays for goods after shop vouchers.
const PLAT10 = voucherRow({
  id: 21,
  code: "PLAT10",
  discountType: VoucherDiscountType.PERCENT,
  discountValue: "10.00",
  usageLimit: 100,
});
const PLAT_FIXED = voucherRow({
  id: 22,
  code: "PLATFIX",
  discountValue: "15.00",
});
const ALL_VOUCHERS = [SHOP20, SHOP5, PLAT10, PLAT_FIXED];

interface ServiceFixture {
  service: OrdersService;
  inventorySend: jest.Mock;
  transaction: jest.Mock;
  claim: jest.Mock;
  release: jest.Mock;
  previewShippingFee: jest.Mock;
}

const codesIn = (where: unknown): string[] => {
  const operator = (where as { code: FindOperator<string[]> }).code;
  return operator.value;
};

function createService(): ServiceFixture {
  const inventorySend = jest.fn((pattern: string) => {
    if (pattern === INVENTORY_MESSAGE_PATTERNS.INVENTORY_CHECK_STOCK) {
      return of({ available: true, availableStock: 10 });
    }
    if (pattern === INVENTORY_MESSAGE_PATTERNS.INVENTORY_RESERVE_STOCK_MANY) {
      return of({ isReserved: true, failedProductId: null });
    }
    return of(true);
  });
  const transaction = jest.fn();
  const claim = jest.fn().mockResolvedValue(50);
  const release = jest.fn().mockResolvedValue(51);
  const previewShippingFee = jest.fn().mockResolvedValue({
    shippingFee: 30,
    expectedDeliveryTime: null,
  });
  const voucherRepository = {
    find: jest.fn(({ where }: { where: unknown }) =>
      Promise.resolve(
        ALL_VOUCHERS.filter((voucher) => codesIn(where).includes(voucher.code)),
      ),
    ),
    findOne: jest.fn(({ where }: { where: { code: string } }) =>
      Promise.resolve(
        ALL_VOUCHERS.find((voucher) => voucher.code === where.code) ?? null,
      ),
    ),
  };
  const service = new OrdersService(
    { publish: jest.fn(), connection: {} } as unknown as Channel,
    {} as HttpService,
    { send: inventorySend } as unknown as ClientProxy,
    {} as ClientProxy,
    {} as ClientProxy,
    {
      manager: { transaction },
      update: jest.fn(),
    } as unknown as Repository<Order>,
    {} as Repository<OrderItem>,
    {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<OrderOutbox>,
    {} as Repository<ShippingHistory>,
    {} as Repository<OrderReturnRequest>,
    voucherRepository as unknown as Repository<Voucher>,
    {
      count: jest.fn().mockResolvedValue(0),
    } as unknown as Repository<VoucherRedemption>,
    { previewShippingFee } as unknown as GhnService,
    {
      claimFromSeededQuota: claim,
      releaseToSeededQuota: release,
    } as unknown as CachedService,
    createRepositoryMock<OrderStatusHistory>().asRepository(),
  );
  return {
    service,
    inventorySend,
    transaction,
    claim,
    release,
    previewShippingFee,
  };
}

// 200 from SHOP_SELLER_ID, 100 from OTHER_SELLER_ID.
const basket = [
  { price: 100, quantity: 2, sellerId: SHOP_SELLER_ID },
  { price: 100, quantity: 1, sellerId: OTHER_SELLER_ID },
];

describe("OrdersService voucher stacking — preview", () => {
  it("prices a shop voucher first, then the platform voucher on what is left", async () => {
    const { service } = createService();

    const preview = await service.previewVoucher(
      18,
      ["shop20", "PLAT10"],
      basket,
    );

    // Platform base = (200 - 20) + 100 = 280 → 10% = 28.
    expect(preview.vouchers).toEqual([
      expect.objectContaining({
        code: "SHOP20",
        scope: "shop",
        sellerId: SHOP_SELLER_ID,
        discountAmount: 20,
      }),
      expect.objectContaining({
        code: "PLAT10",
        scope: "platform",
        sellerId: null,
        discountAmount: 28,
      }),
    ]);
    expect(preview.discountAmount).toBe(48);
    expect(preview.itemsTotal).toBe(300);
    expect(preview.finalItemsTotal).toBe(252);
  });

  it("collapses a repeated code instead of counting it twice", async () => {
    const { service } = createService();

    const preview = await service.previewVoucher(
      18,
      ["PLATFIX", " platfix "],
      basket,
    );

    expect(preview.vouchers).toHaveLength(1);
    expect(preview.discountAmount).toBe(15);
  });

  it("rejects a second platform voucher", async () => {
    const { service } = createService();

    await expect(
      service.previewVoucher(18, ["PLAT10", "PLATFIX"], basket),
    ).rejects.toThrow(
      new BadRequestException(VOUCHER_MESSAGE.ONE_PLATFORM_VOUCHER),
    );
  });

  it("rejects a second shop voucher from the same seller", async () => {
    const { service } = createService();

    await expect(
      service.previewVoucher(18, ["SHOP20", "SHOP5"], basket),
    ).rejects.toThrow(
      new BadRequestException(
        VOUCHER_MESSAGE.ONE_SHOP_VOUCHER_PER_SELLER("SHOP5"),
      ),
    );
  });

  it("404s an unknown code before pricing anything", async () => {
    const { service } = createService();

    await expect(
      service.previewVoucher(18, ["PLAT10", "NOPE"], basket),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("400s when no code is sent", async () => {
    const { service } = createService();

    await expect(service.previewVoucher(18, [], basket)).rejects.toThrow(
      new BadRequestException(VOUCHER_MESSAGE.CODE_REQUIRED),
    );
  });
});

describe("OrdersService voucher stacking — multi-seller checkout", () => {
  type RedeemVoucher = (
    manager: EntityManager,
    voucher: Voucher,
    userId: number,
    orderId: number,
    discountAmount: number,
  ) => Promise<void>;

  function mockTransaction(transaction: jest.Mock): {
    savedOrders: Array<Record<string, unknown>>;
  } {
    const savedOrders: Array<Record<string, unknown>> = [];
    let nextOrderId = 100;
    const manager = {
      create: jest.fn(
        (_entity: unknown, data: Record<string, unknown>) => data,
      ),
      save: jest.fn((...args: unknown[]): Promise<unknown> => {
        const value = args.at(-1);
        if (Array.isArray(value)) {
          return Promise.resolve(value as unknown[]);
        }
        const row = value as Record<string, unknown>;
        if ("paymentMethod" in row) {
          const saved = { ...row, id: nextOrderId++ };
          savedOrders.push(saved);
          return Promise.resolve(saved);
        }
        return Promise.resolve({ ...row, id: 1 });
      }),
    };
    transaction.mockImplementation(
      (callback: (value: typeof manager) => Promise<unknown>) =>
        callback(manager),
    );
    return { savedOrders };
  }

  const items = [
    {
      productId: 1,
      productName: "P1",
      quantity: 2,
      price: 100,
      sellerId: SHOP_SELLER_ID,
    },
    {
      productId: 2,
      productName: "P2",
      quantity: 1,
      price: 100,
      sellerId: OTHER_SELLER_ID,
    },
  ];

  it("splits the platform discount, tags one checkout and redeems each code once", async () => {
    const { service, transaction, claim } = createService();
    const { savedOrders } = mockTransaction(transaction);
    const redeem = jest
      .spyOn(
        service as unknown as { redeemVoucher: RedeemVoucher },
        "redeemVoucher",
      )
      .mockResolvedValue(undefined);

    await service.placeMultiSellerOrder(
      18,
      PaymentMethod.COD,
      "address",
      items,
      ["SHOP20", "PLAT10"],
    );

    // 28 split by the post-shop-voucher weights 180 : 100 → 18 : 10.
    const [shopOrder, otherOrder] = savedOrders;
    expect(shopOrder).toEqual(
      expect.objectContaining({
        voucherCode: "SHOP20",
        platformVoucherCode: "PLAT10",
        discountAmount: 38,
        total: 200 - 38 + 30,
      }),
    );
    expect(otherOrder).toEqual(
      expect.objectContaining({
        voucherCode: "PLAT10",
        platformVoucherCode: null,
        discountAmount: 10,
        total: 100 - 10 + 30,
      }),
    );
    expect(shopOrder.checkoutId).toEqual(expect.any(String));
    expect(otherOrder.checkoutId).toBe(shopOrder.checkoutId);

    // One redemption per code: the shop one on its seller's order, the
    // platform one for its full amount on the lowest-id order sharing it.
    expect(redeem).toHaveBeenCalledTimes(2);
    expect(redeem).toHaveBeenCalledWith(
      expect.anything(),
      SHOP20,
      18,
      shopOrder.id,
      20,
    );
    expect(redeem).toHaveBeenCalledWith(
      expect.anything(),
      PLAT10,
      18,
      shopOrder.id,
      28,
    );
    // Only the capped platform voucher takes a Redis slot.
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("hands the quota slot back when a reservation fails", async () => {
    const { service, inventorySend, transaction, release } = createService();
    inventorySend.mockImplementation((pattern: string) => {
      if (pattern === INVENTORY_MESSAGE_PATTERNS.INVENTORY_CHECK_STOCK) {
        return of({ available: true, availableStock: 10 });
      }
      if (pattern === INVENTORY_MESSAGE_PATTERNS.INVENTORY_RESERVE_STOCK_MANY) {
        return of({ isReserved: false, failedProductId: 1 });
      }
      return of(true);
    });

    await expect(
      service.placeMultiSellerOrder(18, PaymentMethod.COD, "address", items, [
        "PLAT10",
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(transaction).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("hands the quota slot back when GHN refuses the address", async () => {
    const { service, inventorySend, transaction, release, previewShippingFee } =
      createService();
    previewShippingFee.mockRejectedValue(
      new BadRequestException("GHN cannot deliver to this ward"),
    );

    await expect(
      service.placeMultiSellerOrder(18, PaymentMethod.COD, "address", items, [
        "PLAT10",
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);

    // The slot was claimed before the GHN round trip, so it must come back.
    expect(release).toHaveBeenCalledTimes(1);
    expect(inventorySend).not.toHaveBeenCalledWith(
      INVENTORY_MESSAGE_PATTERNS.INVENTORY_RESERVE_STOCK_MANY,
      expect.anything(),
    );
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("OrdersService voucher stacking — cancel", () => {
  type ReleaseVoucherRedemption = (order: Order) => Promise<void>;

  const canceledOrder = {
    id: 100,
    status: OrderStatus.CANCELED,
    checkoutId: "checkout-1",
    voucherCode: "SHOP20",
    platformVoucherCode: "PLAT10",
  } as Order;

  function mockCancelTransaction(
    transaction: jest.Mock,
    siblings: Array<Partial<Order>>,
  ): { update: jest.Mock; remove: jest.Mock; execute: jest.Mock } {
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const remove = jest.fn().mockResolvedValue({ affected: 1 });
    const execute = jest.fn().mockResolvedValue({ affected: 1 });
    const queryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute,
    };
    const manager = {
      find: jest.fn((entity: unknown) => {
        if (entity === Order) {
          return Promise.resolve([canceledOrder, ...siblings]);
        }
        if (entity === VoucherRedemption) {
          return Promise.resolve([
            { id: 1, voucherId: SHOP20.id, orderId: 100 },
            { id: 2, voucherId: PLAT10.id, orderId: 100 },
          ]);
        }
        return Promise.resolve([SHOP20, PLAT10]);
      }),
      update,
      delete: remove,
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    transaction.mockImplementation(
      (callback: (value: typeof manager) => Promise<unknown>) =>
        callback(manager),
    );
    return { update, remove, execute };
  }

  const releaseOf = (service: OrdersService): ReleaseVoucherRedemption => {
    const target = service as unknown as {
      releaseVoucherRedemption: ReleaseVoucherRedemption;
    };
    return (order: Order) => target.releaseVoucherRedemption(order);
  };

  it("moves the platform redemption to a live sibling and returns the shop one", async () => {
    const { service, transaction, release } = createService();
    const { update, remove, execute } = mockCancelTransaction(transaction, [
      {
        id: 101,
        status: OrderStatus.PENDING,
        voucherCode: "PLAT10",
        platformVoucherCode: null,
      },
    ]);

    await releaseOf(service)(canceledOrder);

    expect(update).toHaveBeenCalledWith(
      VoucherRedemption,
      { id: 2, orderId: 100 },
      { orderId: 101 },
    );
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(VoucherRedemption, { id: 1 });
    expect(execute).toHaveBeenCalledTimes(1);
    // The platform slot stays used: only the returned shop voucher is handed
    // back to Redis (a no-op there for an uncapped code with no counter).
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(`voucher:quota:${SHOP20.id}`);
  });

  it("returns both redemptions once every sibling is canceled", async () => {
    const { service, transaction, release } = createService();
    const { update, remove, execute } = mockCancelTransaction(transaction, [
      {
        id: 101,
        status: OrderStatus.CANCELED,
        voucherCode: "PLAT10",
        platformVoucherCode: null,
      },
    ]);

    await releaseOf(service)(canceledOrder);

    expect(update).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
  });
});
