import { NotFoundException } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ClientProxy } from "@nestjs/microservices";
import { Channel } from "amqplib";
import { FindOperator, Repository } from "typeorm";
import { CachedService } from "@app/cached";
import { PaymentMethod } from "@app/common";
import { createRepositoryMock, RepositoryMock } from "@app/testing";
import { Order, OrderStatus } from "./entity/order.entity";
import { OrderOutbox } from "./entity/order-outbox.entity";
import { OrderItem } from "./entity/order_item.entity";
import { OrderReturnRequest } from "./entity/order-return-request.entity";
import {
  ShippingHistory,
  ShippingHistoryType,
} from "./entity/shipping-history.entity";
import { OrderStatusHistory } from "./entity/order-status-history.entity";
import { Voucher } from "./entity/voucher.entity";
import { VoucherRedemption } from "./entity/voucher-redemption.entity";
import { GhnService } from "./ghn/ghn.service";
import { OrdersService } from "./orders.service";

interface ShippingFindArgs {
  where: {
    orderId: number;
    success: boolean;
    ghnStatus: FindOperator<unknown>;
    type: FindOperator<ShippingHistoryType[]>;
  };
}

const at = (iso: string): Date => new Date(iso);

describe("OrdersService order timeline (ORDER-TIMELINE-01)", () => {
  let orderRepository: RepositoryMock<Order>;
  let shippingHistoryRepository: RepositoryMock<ShippingHistory>;
  let statusHistoryRepository: RepositoryMock<OrderStatusHistory>;
  let service: OrdersService;

  beforeEach(() => {
    orderRepository = createRepositoryMock<Order>();
    shippingHistoryRepository = createRepositoryMock<ShippingHistory>();
    statusHistoryRepository = createRepositoryMock<OrderStatusHistory>();
    service = new OrdersService(
      { publish: jest.fn(), connection: {} } as unknown as Channel,
      {} as HttpService,
      {} as ClientProxy,
      {} as ClientProxy,
      {} as ClientProxy,
      orderRepository.asRepository(),
      {} as Repository<OrderItem>,
      {} as Repository<OrderOutbox>,
      shippingHistoryRepository.asRepository(),
      {} as Repository<OrderReturnRequest>,
      {} as Repository<Voucher>,
      {} as Repository<VoucherRedemption>,
      {} as GhnService,
      {} as CachedService,
      statusHistoryRepository.asRepository(),
    );
  });

  describe("recording a transition", () => {
    it("records from → to after the status write lands", async () => {
      await service.updateOrderStatus(
        7,
        OrderStatus.RETURN_REQUESTED,
        OrderStatus.COMPLETED,
      );

      expect(orderRepository.update).toHaveBeenCalledWith(
        { id: 7 },
        { status: OrderStatus.RETURN_REQUESTED },
      );
      expect(statusHistoryRepository.insert).toHaveBeenCalledWith({
        orderId: 7,
        fromStatus: OrderStatus.COMPLETED,
        toStatus: OrderStatus.RETURN_REQUESTED,
      });
      expect(orderRepository.update.mock.invocationCallOrder[0]).toBeLessThan(
        statusHistoryRepository.insert.mock.invocationCallOrder[0],
      );
    });

    it("never fails the transition when the history insert fails", async () => {
      statusHistoryRepository.insert.mockRejectedValue(
        new Error("table missing"),
      );

      await expect(
        service.updateOrderStatus(7, OrderStatus.CANCELED, OrderStatus.PENDING),
      ).resolves.toBeUndefined();
      expect(orderRepository.update).toHaveBeenCalled();
    });

    it("records nothing for a write that does not change the status", async () => {
      await service.updateOrderStatus(
        7,
        OrderStatus.COMPLETED,
        OrderStatus.COMPLETED,
      );

      expect(statusHistoryRepository.insert).not.toHaveBeenCalled();
    });

    it("records PENDING → CONFIRMED when a seller confirms", async () => {
      const order = {
        id: 7,
        status: OrderStatus.PENDING,
        paymentMethod: PaymentMethod.COD,
        paidAt: null,
        items: [],
      } as unknown as Order;
      const internals = service as unknown as Record<string, jest.Mock>;
      jest
        .spyOn(internals as never, "getSellerProductIds" as never)
        .mockResolvedValue([1] as never);
      jest
        .spyOn(internals as never, "verifySellerOwnsOrder" as never)
        .mockResolvedValue(true as never);
      jest
        .spyOn(internals as never, "publishOrderStatusChangedEvent" as never)
        .mockReturnValue(undefined as never);
      orderRepository.findOne.mockResolvedValue(order);

      await service.confirmOrder(7, 3);

      expect(statusHistoryRepository.insert).toHaveBeenCalledWith({
        orderId: 7,
        fromStatus: OrderStatus.PENDING,
        toStatus: OrderStatus.CONFIRMED,
      });
    });
  });

  describe("getOrderTimeline", () => {
    it("404s an unknown order", async () => {
      orderRepository.findOne.mockResolvedValue(null);

      await expect(service.getOrderTimeline(404)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("merges placed, paid, status and distinct GHN events oldest first", async () => {
      orderRepository.findOne.mockResolvedValue({
        id: 7,
        publicId: "ord_abc",
        status: OrderStatus.SHIPPED,
        createdAt: at("2026-10-01T01:00:00Z"),
        paidAt: at("2026-10-01T01:05:00Z"),
      });
      statusHistoryRepository.find.mockResolvedValue([
        {
          toStatus: OrderStatus.PROCESSING,
          createdAt: at("2026-10-01T01:05:01Z"),
        },
        {
          toStatus: OrderStatus.SHIPPED,
          createdAt: at("2026-10-01T05:00:00Z"),
        },
      ]);
      shippingHistoryRepository.find.mockResolvedValue([
        { ghnStatus: "ready_to_pick", createdAt: at("2026-10-01T02:00:00Z") },
        // a manual re-sync seeing the same carrier status again
        { ghnStatus: "ready_to_pick", createdAt: at("2026-10-01T03:00:00Z") },
        { ghnStatus: "picked", createdAt: at("2026-10-01T04:59:59Z") },
      ]);

      const timeline = await service.getOrderTimeline(7);

      expect(timeline).toEqual({
        orderId: "ord_abc",
        status: OrderStatus.SHIPPED,
        events: [
          {
            kind: "placed",
            status: OrderStatus.PENDING,
            ghnStatus: null,
            at: at("2026-10-01T01:00:00Z"),
          },
          {
            kind: "paid",
            status: null,
            ghnStatus: null,
            at: at("2026-10-01T01:05:00Z"),
          },
          {
            kind: "status",
            status: OrderStatus.PROCESSING,
            ghnStatus: null,
            at: at("2026-10-01T01:05:01Z"),
          },
          {
            kind: "shipping",
            status: null,
            ghnStatus: "ready_to_pick",
            at: at("2026-10-01T02:00:00Z"),
          },
          {
            kind: "shipping",
            status: null,
            ghnStatus: "picked",
            at: at("2026-10-01T04:59:59Z"),
          },
          {
            kind: "status",
            status: OrderStatus.SHIPPED,
            ghnStatus: null,
            at: at("2026-10-01T05:00:00Z"),
          },
        ],
      });
    });

    it("reads only successful webhook/sync GHN rows that carry a status", async () => {
      orderRepository.findOne.mockResolvedValue({
        id: 7,
        publicId: "ord_abc",
        status: OrderStatus.PENDING,
        createdAt: at("2026-10-01T01:00:00Z"),
        paidAt: null,
      });

      const timeline = await service.getOrderTimeline(7);

      const [shippingArgs] = shippingHistoryRepository.find.mock.calls[0] as [
        ShippingFindArgs,
      ];
      expect(shippingArgs.where.orderId).toBe(7);
      expect(shippingArgs.where.success).toBe(true);
      expect(shippingArgs.where.type.value).toEqual([
        ShippingHistoryType.WEBHOOK,
        ShippingHistoryType.MANUAL_SYNC,
      ]);
      // An order with no history still answers the collection — never null.
      expect(timeline.events).toEqual([
        {
          kind: "placed",
          status: OrderStatus.PENDING,
          ghnStatus: null,
          at: at("2026-10-01T01:00:00Z"),
        },
      ]);
    });
  });
});
