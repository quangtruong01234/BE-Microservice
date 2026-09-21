import { BadRequestException } from "@nestjs/common";
import { PaymentMethod } from "@app/common";
import { HttpService } from "@nestjs/axios";
import { ClientProxy } from "@nestjs/microservices";
import { Channel } from "amqplib";
import { Repository } from "typeorm";
import { CachedService } from "@app/cached";
import { Order, OrderStatus } from "../entity/order.entity";
import { OrderOutbox } from "../entity/order-outbox.entity";
import { OrderItem } from "../entity/order_item.entity";
import { OrderReturnRequest } from "../entity/order-return-request.entity";
import { Voucher } from "../entity/voucher.entity";
import { VoucherRedemption } from "../entity/voucher-redemption.entity";
import { ShippingHistory } from "../entity/shipping-history.entity";
import { GhnService } from "../ghn/ghn.service";
import { OrdersService } from "../orders.service";

/**
 * EXPORT-CSV-01 — the invariants of the seller export itself.
 *
 * `csv.util.spec.ts` already pins the rendering (BOM, escaping, injection
 * guards, `="…"` literals). What was unpinned until now is the layer above it:
 * the first-row-only rule for the four order-level money columns, the
 * reconciliation equation that rule exists to protect, and the two caps. All
 * three are documented in prose in `known-behaviors.md`, and prose does not
 * fail a build — an edit that "fills down" the blank cells used to pass tsc,
 * eslint, every test and `check:conventions`.
 */
describe("OrdersService.exportSellerOrdersCsv (EXPORT-CSV-01)", () => {
  // Column order IS the published shape of the file (SELLER_EXPORT_COLUMNS).
  // Naming the indices here makes a reordered column break loudly instead of
  // silently shifting a seller's pivot table.
  const COL = {
    orderId: 0,
    orderDate: 1,
    status: 2,
    paymentMethod: 3,
    paidAt: 4,
    buyerName: 5,
    buyerPhone: 6,
    productId: 7,
    productName: 8,
    skuLabel: 9,
    quantity: 10,
    unitPrice: 11,
    lineTotal: 12,
    shippingFee: 13,
    discountAmount: 14,
    voucherCode: 15,
    orderTotal: 16,
    trackingCode: 17,
    ghnStatus: 18,
  } as const;

  // Fixtures are deliberately comma-free so a naive split reads the cells
  // faithfully — RFC-4180 escaping is csv.util.spec's job, not this file's.
  const parseCsv = (csv: Buffer): string[][] =>
    csv
      .toString("utf8")
      // Escaped, not a literal BOM — eslint bans irregular whitespace in source.
      .replace(/^\uFEFF/, "")
      .split("\r\n")
      .filter((line) => line !== "")
      .map((line) => line.split(","));

  // `total` and `price` are DECIMAL columns: the entity types them `number`,
  // but TypeORM hands them back as strings at runtime (conventions.md, common
  // TCP bug #3) — which is exactly why the export wraps both in `Number()`.
  // The fixtures model the runtime truth, so the override types must allow it.
  type OrderOverrides = Partial<Omit<Order, "total">> & {
    total?: string | number;
  };
  type OrderItemOverrides = Partial<Omit<OrderItem, "price">> & {
    price?: string | number;
  };

  const exportOrder = (overrides: OrderOverrides = {}): Order =>
    ({
      id: 101,
      publicId: "ord_abc123",
      status: OrderStatus.COMPLETED,
      paymentMethod: PaymentMethod.COD,
      paidAt: null,
      // EXPORT-TZ-01: every instant in this file carries an explicit offset.
      // A bare "2026-08-01T10:00:00" is parsed in the RUNNER's zone, which made
      // the suite pass in Vietnam and prove nothing about prod (UTC). This is
      // 10:00 Vietnam time, stated as the absolute instant it actually is.
      createdAt: new Date("2026-08-01T03:00:00Z"),
      // name|phone|addr|ward|district|province — NOT NULL, so the split is safe.
      shippingAddress: "Nguyen Van A|0901234567|12 Le Loi|P1|Q1|HCM",
      shippingFee: 20000,
      discountAmount: null,
      voucherCode: null,
      total: "119000.00",
      ghnOrderCode: null,
      ...overrides,
    }) as unknown as Order;

  const exportItem = (
    order: Order,
    overrides: OrderItemOverrides = {},
  ): OrderItem =>
    ({
      id: 1,
      order,
      productId: 5,
      productPublicId: "prod_x1",
      productName: "Ao thun",
      skuLabel: "Den - size L",
      quantity: 2,
      price: "49500.00",
      ...overrides,
    }) as unknown as OrderItem;

  function createService(
    items: OrderItem[],
    histories: ShippingHistory[] = [],
    rowCount = items.length,
  ): {
    service: OrdersService;
    getCount: jest.Mock;
    getMany: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
  } {
    const getCount = jest.fn().mockResolvedValue(rowCount);
    const getMany = jest.fn().mockResolvedValue(items);
    const where = jest.fn();
    const andWhere = jest.fn();
    // `buildSellerExportQuery` runs twice (count, then fetch), so one shared
    // builder stands in for both — every chained call returns itself.
    const qb: Record<string, jest.Mock> = {
      innerJoinAndSelect: jest.fn(),
      where,
      andWhere,
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      getCount,
      getMany,
    };
    for (const key of [
      "innerJoinAndSelect",
      "where",
      "andWhere",
      "orderBy",
      "addOrderBy",
    ]) {
      qb[key].mockReturnValue(qb);
    }

    const service = new OrdersService(
      { publish: jest.fn(), connection: {} } as unknown as Channel,
      {} as HttpService,
      {} as ClientProxy,
      {} as ClientProxy,
      {} as ClientProxy,
      {} as Repository<Order>,
      {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      } as unknown as Repository<OrderItem>,
      {} as Repository<OrderOutbox>,
      {
        find: jest.fn().mockResolvedValue(histories),
      } as unknown as Repository<ShippingHistory>,
      {} as Repository<OrderReturnRequest>,
      {} as Repository<Voucher>,
      {} as Repository<VoucherRedemption>,
      {} as GhnService,
      {} as CachedService,
    );
    return { service, getCount, getMany, where, andWhere };
  }

  const exportQuery = { sellerId: 7, from: "2026-08-01", to: "2026-08-31" };

  it("writes the four order-level columns on the first row of an order only", async () => {
    // Three items on ONE order: repeating shippingFee/orderTotal would make a
    // seller's SUM(orderTotal) count this order three times.
    const order = exportOrder({
      discountAmount: 39,
      voucherCode: "CONC3530696",
    });
    const { service } = createService([
      exportItem(order, { id: 1 }),
      exportItem(order, { id: 2, productName: "Quan jean" }),
      exportItem(order, { id: 3, productName: "Non luoi trai" }),
    ]);

    const rows = parseCsv(await service.exportSellerOrdersCsv(exportQuery));

    const [, first, second, third] = rows;
    expect(first[COL.shippingFee]).toBe("20000");
    expect(first[COL.discountAmount]).toBe("39");
    expect(first[COL.voucherCode]).toBe("CONC3530696");
    expect(first[COL.orderTotal]).toBe("119000");
    for (const continuation of [second, third]) {
      expect(continuation[COL.shippingFee]).toBe("");
      expect(continuation[COL.discountAmount]).toBe("");
      // A non-empty voucherCode on a continuation row reads as a SECOND
      // discount — the exact double-count the first-row rule prevents.
      expect(continuation[COL.voucherCode]).toBe("");
      expect(continuation[COL.orderTotal]).toBe("");
    }
    // lineTotal is the one money column that is safe to sum on EVERY row.
    expect(rows.slice(1).map((row) => row[COL.lineTotal])).toEqual([
      "99000",
      "99000",
      "99000",
    ]);
  });

  it("stays reconcilable: SUM(lineTotal) + shippingFee - discountAmount = orderTotal", async () => {
    // The 2026-09-17 addendum: without the voucher pair a seller sees
    // `lineTotal 39` next to `orderTotal 0` and reports the money as wrong.
    const order = exportOrder({
      shippingFee: 15000,
      discountAmount: 39,
      voucherCode: "SALE39",
      total: "213961.00",
    });
    const { service } = createService([
      exportItem(order, { id: 1, price: "99000.00", quantity: 2 }),
      exportItem(order, { id: 2, price: "1000.00", quantity: 1 }),
    ]);

    const rows = parseCsv(await service.exportSellerOrdersCsv(exportQuery));

    const sumLineTotal = rows
      .slice(1)
      .reduce((sum, row) => sum + Number(row[COL.lineTotal]), 0);
    const first = rows[1];
    expect(
      sumLineTotal +
        Number(first[COL.shippingFee]) -
        Number(first[COL.discountAmount]),
    ).toBe(Number(first[COL.orderTotal]));
  });

  it("renders a real 0 for discountAmount with no voucher, leaving voucherCode empty", async () => {
    // A blank discountAmount on a FIRST row would be indistinguishable from the
    // deliberate blank of a continuation row.
    const { service } = createService([exportItem(exportOrder())]);

    const rows = parseCsv(await service.exportSellerOrdersCsv(exportQuery));

    expect(rows[1][COL.discountAmount]).toBe("0");
    expect(rows[1][COL.voucherCode]).toBe("");
  });

  it("splits buyer name and phone out of shippingAddress and guards the phone", async () => {
    const { service } = createService([exportItem(exportOrder())]);

    const rows = parseCsv(await service.exportSellerOrdersCsv(exportQuery));

    expect(rows[1][COL.buyerName]).toBe("Nguyen Van A");
    // `="…"` is the only form Excel honours — a bare 0901234567 loses its zero.
    expect(rows[1][COL.buyerPhone]).toBe('="0901234567"');
    // The street address is deliberately NOT exported.
    expect(rows[1]).not.toContain("12 Le Loi");
  });

  it("falls back to the numeric id on pre-PUBID rows", async () => {
    const order = exportOrder({ publicId: null });
    const { service } = createService([
      exportItem(order, { productPublicId: null }),
    ]);

    const rows = parseCsv(await service.exportSellerOrdersCsv(exportQuery));

    expect(rows[1][COL.orderId]).toBe("101");
    expect(rows[1][COL.productId]).toBe("5");
  });

  it("filters on the ITEM's seller_id, not the order's", async () => {
    // getOrdersBySeller() resolves product ids and then joins EVERY item of any
    // matching order — that is what would make lineTotal sum to someone else's
    // revenue if checkout ever stops splitting orders per seller.
    const { service, where } = createService([exportItem(exportOrder())]);

    await service.exportSellerOrdersCsv(exportQuery);

    expect(where).toHaveBeenCalledWith("item.sellerId = :sellerId", {
      sellerId: 7,
    });
  });

  it("refuses a window over 90 days before doing any query work", async () => {
    const { service, getCount } = createService([]);

    await expect(
      service.exportSellerOrdersCsv({
        sellerId: 7,
        from: "2026-01-01",
        to: "2026-12-31",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(getCount).not.toHaveBeenCalled();
  });

  it("allows a window of exactly 90 inclusive days", async () => {
    // Both bounds are inclusive (from 00:00:00.000, to 23:59:59.999), so the
    // 90th calendar day must still pass — this is the boundary the Swagger
    // example has to stay inside.
    const { service } = createService([exportItem(exportOrder())]);

    await expect(
      service.exportSellerOrdersCsv({
        sellerId: 7,
        from: "2026-06-01",
        to: "2026-08-29",
      }),
    ).resolves.toBeInstanceOf(Buffer);
  });

  it("refuses an oversized result with the REAL row count and fetches nothing", async () => {
    const { service, getMany } = createService([], [], 7421);

    await expect(service.exportSellerOrdersCsv(exportQuery)).rejects.toThrow(
      /7421/,
    );
    // "Narrow the range" without a number leaves the seller guessing.
    expect(getMany).not.toHaveBeenCalled();
  });

  it("answers an empty window with a header-only file instead of failing", async () => {
    // No items ⇒ no order ids ⇒ the shipping-history lookup must not build an
    // `IN ()` query.
    const { service } = createService([]);

    const rows = parseCsv(await service.exportSellerOrdersCsv(exportQuery));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(19);
    expect(rows[0][COL.voucherCode]).toBe("voucherCode");
    // EXPORT-TZ-01: the zone is part of the published header. A seller opening
    // a bare `orderDate` column assumes their own zone and is right only by
    // luck; naming it is the whole mitigation, so it is pinned here.
    expect(rows[0][COL.orderDate]).toBe("orderDate (GMT+7)");
    expect(rows[0][COL.paidAt]).toBe("paidAt (GMT+7)");
  });

  describe("EXPORT-TZ-01 — timestamps and window bounds are Vietnam time", () => {
    it("renders orderDate/paidAt in VN wall-clock whatever zone the server runs in", async () => {
      // 03:00Z is 10:00 in Vietnam. Before the fix this printed the server's
      // own clock, so the same order read 10:00 from a dev box and 03:00 from
      // prod — and nothing in the file said which.
      const order = exportOrder({
        paidAt: new Date("2026-08-01T03:05:30Z"),
      });
      const { service } = createService([exportItem(order)]);

      const rows = parseCsv(await service.exportSellerOrdersCsv(exportQuery));

      expect(rows[1][COL.orderDate]).toBe("2026-08-01 10:00:00");
      expect(rows[1][COL.paidAt]).toBe("2026-08-01 10:05:30");
    });

    it("rolls the printed DAY forward for an order placed late in the UTC day", async () => {
      // The failure a seller actually notices: 18:30Z on the 4th is already
      // 01:30 on the 5th in Vietnam, so a UTC server filed the order under the
      // wrong calendar day, not merely the wrong hour.
      const order = exportOrder({
        createdAt: new Date("2026-08-04T18:30:00Z"),
      });
      const { service } = createService([exportItem(order)]);

      const rows = parseCsv(await service.exportSellerOrdersCsv(exportQuery));

      expect(rows[1][COL.orderDate]).toBe("2026-08-05 01:30:00");
    });

    it("leaves paidAt blank on an unpaid order rather than printing an epoch", async () => {
      const { service } = createService([exportItem(exportOrder())]);

      const rows = parseCsv(await service.exportSellerOrdersCsv(exportQuery));

      expect(rows[1][COL.paidAt]).toBe("");
    });

    it("queries VN midnight-to-midnight, not UTC midnight-to-midnight", async () => {
      // The dropped-rows half of the bug: the old bounds resolved to VN 07:00
      // on the first day, so every order placed in the first seven hours of the
      // seller's day was missing from the file — and the file gave no hint that
      // a whole morning had been excluded.
      const { service, andWhere } = createService([exportItem(exportOrder())]);

      await service.exportSellerOrdersCsv(exportQuery);

      const [, params] = andWhere.mock.calls[0] as [
        string,
        { fromDate: Date; toDate: Date },
      ];
      expect(params.fromDate.toISOString()).toBe("2026-07-31T17:00:00.000Z");
      expect(params.toDate.toISOString()).toBe("2026-08-31T16:59:59.999Z");
    });
  });

  it("reads ghnStatus from the latest shipping_history row of that order", async () => {
    const order = exportOrder({ ghnOrderCode: "GHN123456789012" });
    const { service } = createService(
      [exportItem(order)],
      [
        // `order_id` is a bigint → mysql2 hands it back as a string, while the
        // lookup key is a number; a missed coercion shows up as a blank column.
        {
          orderId: "101",
          ghnStatus: "delivered",
          createdAt: new Date("2026-08-05T02:00:00Z"),
        } as unknown as ShippingHistory,
      ],
    );

    const rows = parseCsv(await service.exportSellerOrdersCsv(exportQuery));

    expect(rows[1][COL.ghnStatus]).toBe("delivered");
    expect(rows[1][COL.trackingCode]).toBe('="GHN123456789012"');
  });
});
