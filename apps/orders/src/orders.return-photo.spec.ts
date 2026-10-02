import { HttpService } from "@nestjs/axios";
import { ClientProxy } from "@nestjs/microservices";
import { Channel } from "amqplib";
import { Repository } from "typeorm";
import { CachedService } from "@app/cached";
import { createRepositoryMock, RepositoryMock } from "@app/testing";
import { Order, OrderStatus } from "./entity/order.entity";
import { OrderOutbox } from "./entity/order-outbox.entity";
import { OrderItem } from "./entity/order_item.entity";
import { OrderReturnRequest } from "./entity/order-return-request.entity";
import { ShippingHistory } from "./entity/shipping-history.entity";
import { OrderStatusHistory } from "./entity/order-status-history.entity";
import { Voucher } from "./entity/voucher.entity";
import { VoucherRedemption } from "./entity/voucher-redemption.entity";
import { GhnService } from "./ghn/ghn.service";
import { OrdersService } from "./orders.service";

const photo = (leaf: string): string =>
  `https://res.cloudinary.com/cloud/image/upload/v1/trybuy/returns/${leaf}.jpg`;

describe("OrdersService.requestReturn photos (RETURN-PHOTO-01)", () => {
  let orderRepository: RepositoryMock<Order>;
  let returnRequestRepository: RepositoryMock<OrderReturnRequest>;
  let service: OrdersService;

  beforeEach(() => {
    orderRepository = createRepositoryMock<Order>();
    returnRequestRepository = createRepositoryMock<OrderReturnRequest>();
    service = new OrdersService(
      { publish: jest.fn(), connection: {} } as unknown as Channel,
      {} as HttpService,
      {} as ClientProxy,
      {} as ClientProxy,
      {} as ClientProxy,
      orderRepository.asRepository(),
      {} as Repository<OrderItem>,
      {} as Repository<OrderOutbox>,
      {} as Repository<ShippingHistory>,
      returnRequestRepository.asRepository(),
      {} as Repository<Voucher>,
      {} as Repository<VoucherRedemption>,
      {} as GhnService,
      {} as CachedService,
      createRepositoryMock<OrderStatusHistory>().asRepository(),
    );
    orderRepository.findOne.mockResolvedValue({
      id: 9,
      publicId: "ord_abc",
      userId: 7,
      status: OrderStatus.COMPLETED,
    });
    returnRequestRepository.findOne.mockResolvedValue(null);
    returnRequestRepository.create.mockImplementation(
      (row: Partial<OrderReturnRequest>) => row,
    );
    returnRequestRepository.save.mockImplementation(
      (row: Partial<OrderReturnRequest>) => Promise.resolve({ id: 4, ...row }),
    );
    jest.spyOn(service, "updateOrderStatus").mockResolvedValue(undefined);
    jest
      .spyOn(service as never, "publishOrderReturnEvent" as never)
      .mockReturnValue(undefined as never);
  });

  const createdRow = (): Partial<OrderReturnRequest> => {
    const [[row]] = returnRequestRepository.create.mock.calls as Array<
      [Partial<OrderReturnRequest>]
    >;
    return row;
  };

  it("stores the photos on the request and returns them", async () => {
    const imageUrls = [photo("7_a"), photo("7_b")];

    const view = await service.requestReturn(9, 7, "Broken", imageUrls);

    expect(createdRow().imageUrls).toEqual(imageUrls);
    expect(view.imageUrls).toEqual(imageUrls);
    expect(view.orderPublicId).toBe("ord_abc");
  });

  it.each([
    ["missing", undefined],
    ["empty", []],
  ])("stores NULL when the photo list is %s", async (_label, imageUrls) => {
    await service.requestReturn(9, 7, "Broken", imageUrls);

    expect(createdRow().imageUrls).toBeNull();
  });
});
