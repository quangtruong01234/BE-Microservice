import { Channel } from "amqplib";
import { ClientProxy } from "@nestjs/microservices";
import { MailerService, WishlistAlertEvent } from "@app/common";
import { createRepositoryMock, RepositoryMock } from "@app/testing";
import { Notification } from "./entities/notification.entity";
import {
  buildWishlistAlertMessage,
  NotificationService,
} from "./notification.service";

interface PushedMessage {
  data: { userId: number; notification: Record<string, unknown> };
}

const backInStock: WishlistAlertEvent = {
  kind: "back_in_stock",
  productId: 9,
  productPublicId: "prod_abc",
  productName: "Shoe",
  userIds: [44, 45, 44],
  previousPrice: null,
  price: null,
};

describe("NotificationService.saveWishlistAlerts (WISHLIST-ALERT-01)", () => {
  let notificationRepo: RepositoryMock<Notification>;
  let publish: jest.Mock;
  let service: NotificationService;

  const pushedMessages = (): PushedMessage[] =>
    publish.mock.calls.map(
      ([, , body]: [string, string, Buffer]) =>
        JSON.parse(body.toString()) as PushedMessage,
    );

  beforeEach(() => {
    notificationRepo = createRepositoryMock<Notification>();
    publish = jest.fn();
    service = new NotificationService(
      notificationRepo.asRepository(),
      { connection: {}, publish } as unknown as Channel,
      {} as ClientProxy,
      {} as ClientProxy,
      {} as MailerService,
    );
  });

  it("saves one row per distinct wishlister in a single save and pushes each", async () => {
    await expect(service.saveWishlistAlerts(backInStock)).resolves.toBe(2);

    expect(notificationRepo.save).toHaveBeenCalledTimes(1);
    expect(notificationRepo.save).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 44,
        type: "wishlist_back_in_stock",
        orderId: null,
        preview: "Shoe",
        productPublicId: "prod_abc",
        message: "'Shoe' from your wishlist is back in stock.",
      }),
      expect.objectContaining({ userId: 45 }),
    ]);
    expect(pushedMessages().map((message) => message.data.userId)).toEqual([
      44, 45,
    ]);
  });

  it("exposes the product as productId and never leaks productPublicId", async () => {
    await service.saveWishlistAlerts(backInStock);

    const pushed = pushedMessages()[0]?.data.notification;
    expect(pushed).toMatchObject({ productId: "prod_abc", orderId: null });
    expect(pushed).not.toHaveProperty("productPublicId");
    expect(pushed).not.toHaveProperty("publicId");
  });

  it("writes a price-drop message with both prices", () => {
    expect(
      buildWishlistAlertMessage({
        ...backInStock,
        kind: "price_drop",
        previousPrice: 200000,
        price: 150000,
      }),
    ).toBe(
      "'Shoe' from your wishlist dropped from 200,000 VND to 150,000 VND.",
    );
  });

  it("propagates a DB error so the consumer can requeue", async () => {
    notificationRepo.save.mockRejectedValue(new Error("db down"));

    await expect(service.saveWishlistAlerts(backInStock)).rejects.toThrow(
      "db down",
    );
    expect(publish).not.toHaveBeenCalled();
  });
});
