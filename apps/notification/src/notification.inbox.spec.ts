import { NotFoundException } from "@nestjs/common";
import { Channel } from "amqplib";
import { ClientProxy } from "@nestjs/microservices";
import { MailerService } from "@app/common";
import { createRepositoryMock, RepositoryMock } from "@app/testing";
import { Notification } from "./entities/notification.entity";
import { NotificationService } from "./notification.service";

describe("NotificationService inbox management (NOTIF-INBOX-01)", () => {
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

  describe("getUserNotifications", () => {
    beforeEach(() => {
      notificationRepo.findAndCount.mockResolvedValue([[], 0]);
    });

    it("lists every notification of the user by default", async () => {
      await service.getUserNotifications(9, 1, 20);

      expect(notificationRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 9 } }),
      );
    });

    it("narrows to unread rows when isUnreadOnly is set", async () => {
      await service.getUserNotifications(9, 2, 10, true);

      expect(notificationRepo.findAndCount).toHaveBeenCalledWith({
        where: { userId: 9, isRead: false },
        order: { createdAt: "DESC" },
        skip: 10,
        take: 10,
      });
    });
  });

  describe("markAllNotificationsRead", () => {
    it("flips only the caller's unread rows and reports how many", async () => {
      notificationRepo.update.mockResolvedValue({
        affected: 3,
        raw: [],
        generatedMaps: [],
      });

      await expect(service.markAllNotificationsRead(9)).resolves.toEqual({
        updatedCount: 3,
      });
      expect(notificationRepo.update).toHaveBeenCalledWith(
        { userId: 9, isRead: false },
        { isRead: true },
      );
    });

    it("answers 0 when nothing was unread", async () => {
      notificationRepo.update.mockResolvedValue({
        affected: 0,
        raw: [],
        generatedMaps: [],
      });

      await expect(service.markAllNotificationsRead(9)).resolves.toEqual({
        updatedCount: 0,
      });
    });
  });

  describe("deleteNotification", () => {
    it("deletes the row only when it belongs to the caller", async () => {
      notificationRepo.delete.mockResolvedValue({ affected: 1, raw: [] });

      await expect(
        service.deleteNotification("ntf_abc", 9),
      ).resolves.toBeNull();
      expect(notificationRepo.delete).toHaveBeenCalledWith({
        publicId: "ntf_abc",
        userId: 9,
      });
    });

    it("is a 404 for an unknown, already deleted or foreign id", async () => {
      notificationRepo.delete.mockResolvedValue({ affected: 0, raw: [] });

      await expect(
        service.deleteNotification("ntf_abc", 9),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
