import { Channel } from "amqplib";
import { ClientProxy } from "@nestjs/microservices";
import { MailerService } from "@app/common";
import { createRepositoryMock, RepositoryMock } from "@app/testing";
import { Notification } from "./entities/notification.entity";
import { NotificationService } from "./notification.service";

describe("NotificationService.purgeUserData (ACCOUNT-DELETE-01)", () => {
  let notificationRepo: RepositoryMock<Notification>;
  let service: NotificationService;

  beforeEach(() => {
    notificationRepo = createRepositoryMock<Notification>();
    service = new NotificationService(
      notificationRepo.asRepository(),
      { connection: {}, publish: jest.fn() } as unknown as Channel,
      {} as ClientProxy,
      {} as ClientProxy,
      {} as MailerService,
    );
  });

  it("deletes every notification addressed to the user", async () => {
    notificationRepo.delete.mockResolvedValue({ affected: 4, raw: [] });

    await expect(service.purgeUserData(9)).resolves.toEqual({
      deletedNotificationCount: 4,
    });
    expect(notificationRepo.delete).toHaveBeenCalledWith({ userId: 9 });
  });
});
