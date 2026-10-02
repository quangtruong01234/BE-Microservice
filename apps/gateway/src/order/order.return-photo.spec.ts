import { ForbiddenException } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { of } from "rxjs";
import { CachedService } from "@app/cached";
import { ORDER_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { OrderService } from "./order.service";

const photo = (leaf: string): string =>
  `https://res.cloudinary.com/cloud/image/upload/v1/trybuy/returns/${leaf}.jpg`;

describe("OrderService return-request photos (RETURN-PHOTO-01)", () => {
  const ordersClient = { send: jest.fn() };
  const userClient = { send: jest.fn() };
  let service: OrderService;

  const savedRequest = (
    imageUrls: string[] | null,
  ): Record<string, unknown> => ({
    id: 4,
    publicId: "rr_abc",
    orderId: 9,
    orderPublicId: "ord_abc",
    userId: 7,
    reason: "Broken",
    imageUrls,
    previousOrderStatus: "completed",
  });

  beforeEach(() => {
    jest.clearAllMocks();
    userClient.send.mockReturnValue(of([]));
    service = new OrderService(
      ordersClient as unknown as ClientProxy,
      {} as ClientProxy,
      userClient as unknown as ClientProxy,
      {} as ClientProxy,
      {} as CachedService,
    );
  });

  it("forwards the buyer's own photos and echoes them back", async () => {
    const imageUrls = [photo("7_a"), photo("7_b")];
    ordersClient.send.mockReturnValue(of(savedRequest(imageUrls)));

    const exposed = (await service.requestReturn(
      "ord_abc",
      7,
      "Broken",
      imageUrls,
    )) as Record<string, unknown>;

    expect(ordersClient.send).toHaveBeenCalledWith(
      ORDER_MESSAGE_PATTERN.RETURN_REQUEST_CREATE,
      { orderId: "ord_abc", userId: 7, reason: "Broken", imageUrls },
    );
    expect(exposed.imageUrls).toEqual(imageUrls);
    expect(exposed.id).toBe("rr_abc");
    expect(exposed).not.toHaveProperty("previousOrderStatus");
  });

  it("refuses a photo uploaded by someone else before calling orders", async () => {
    await expect(
      service.requestReturn("ord_abc", 7, "Broken", [
        photo("7_a"),
        photo("71_b"),
      ]),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ordersClient.send).not.toHaveBeenCalled();
  });

  it("exposes a request stored without photos as an empty array", async () => {
    ordersClient.send.mockReturnValue(of(savedRequest(null)));

    const exposed = (await service.requestReturn(
      "ord_abc",
      7,
      "Broken",
    )) as Record<string, unknown>;

    expect(ordersClient.send).toHaveBeenCalledWith(
      ORDER_MESSAGE_PATTERN.RETURN_REQUEST_CREATE,
      { orderId: "ord_abc", userId: 7, reason: "Broken", imageUrls: [] },
    );
    expect(exposed.imageUrls).toEqual([]);
  });

  it("exposes legacy rows on the list reads as an empty array", async () => {
    ordersClient.send.mockReturnValue(
      of({ data: [savedRequest(null)], total: 1, page: 1, limit: 20 }),
    );

    const page = (await service.getMyReturnRequests(7, 1, 20)) as {
      data: Array<Record<string, unknown>>;
    };

    expect(page.data[0].imageUrls).toEqual([]);
  });
});
