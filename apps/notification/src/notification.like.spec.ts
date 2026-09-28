import { Channel } from "amqplib";
import { ClientProxy } from "@nestjs/microservices";
import { MailerService } from "@app/common";
import { createRepositoryMock, RepositoryMock } from "@app/testing";
import { Notification } from "./entities/notification.entity";
import {
  buildLikeNotificationMessage,
  NotificationService,
  parseLikeNotificationCount,
} from "./notification.service";

interface PushedMessage {
  pattern: string;
  data: { userId: number; notification: Record<string, unknown> };
}

function unreadLikeRow(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 41,
    publicId: "ntf_existing",
    userId: 7,
    type: "like",
    orderId: null,
    postId: 12,
    actorId: 3,
    preview: null,
    message: "Someone liked your post",
    isRead: false,
    createdAt: new Date("2026-09-28T01:00:00Z"),
    ...overrides,
  };
}

describe("NotificationService.upsertLikeNotification (SOCIAL-LIKE-NTF-01)", () => {
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
    const fanoutChannel = { connection: {}, publish } as unknown as Channel;
    service = new NotificationService(
      notificationRepo.asRepository(),
      fanoutChannel,
      {} as ClientProxy,
      {} as ClientProxy,
      {} as MailerService,
    );
  });

  it("opens a new unread like row for the first like", async () => {
    await service.upsertLikeNotification(7, 12, 3);

    expect(notificationRepo.findOne).toHaveBeenCalledWith({
      where: { userId: 7, type: "like", postId: 12, isRead: false },
      order: { id: "DESC" },
    });
    expect(notificationRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        type: "like",
        postId: 12,
        actorId: 3,
        message: "Someone liked your post",
      }),
    );
    expect(notificationRepo.update).not.toHaveBeenCalled();
    expect(pushedMessages()).toHaveLength(1);
  });

  it("folds a second liker into the unread row and bumps it to the top", async () => {
    notificationRepo.findOne.mockResolvedValue(unreadLikeRow());
    notificationRepo.update.mockResolvedValue({ affected: 1 });

    await service.upsertLikeNotification(7, 12, 5);

    expect(notificationRepo.save).not.toHaveBeenCalled();
    const [criteria, changes] = notificationRepo.update.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(criteria).toEqual({
      id: 41,
      message: "Someone liked your post",
      isRead: false,
    });
    expect(changes).toEqual(
      expect.objectContaining({
        message: "2 people liked your post",
        actorId: 5,
      }),
    );
    expect(changes.createdAt).toBeInstanceOf(Date);

    const [pushed] = pushedMessages();
    expect(pushed.data.userId).toBe(7);
    expect(pushed.data.notification).toEqual(
      expect.objectContaining({
        id: "ntf_existing",
        message: "2 people liked your post",
        actorId: 5,
      }),
    );
  });

  it("does not count the latest liker twice (like → unlike → like)", async () => {
    notificationRepo.findOne.mockResolvedValue(
      unreadLikeRow({ message: "4 people liked your post", actorId: 5 }),
    );

    await service.upsertLikeNotification(7, 12, 5);

    expect(notificationRepo.update).not.toHaveBeenCalled();
    expect(notificationRepo.save).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("re-reads and retries when a concurrent like wins the compare-and-swap", async () => {
    notificationRepo.findOne
      .mockResolvedValueOnce(unreadLikeRow())
      .mockResolvedValueOnce(
        unreadLikeRow({ message: "2 people liked your post", actorId: 8 }),
      );
    notificationRepo.update
      .mockResolvedValueOnce({ affected: 0 })
      .mockResolvedValueOnce({ affected: 1 });

    await service.upsertLikeNotification(7, 12, 5);

    expect(notificationRepo.update).toHaveBeenCalledTimes(2);
    const [, secondChanges] = notificationRepo.update.mock.calls[1] as [
      unknown,
      { message: string },
    ];
    expect(secondChanges.message).toBe("3 people liked your post");
  });

  it("opens a fresh row when the unread one was read in between", async () => {
    notificationRepo.findOne
      .mockResolvedValueOnce(unreadLikeRow())
      .mockResolvedValueOnce(null);
    notificationRepo.update.mockResolvedValueOnce({ affected: 0 });

    await service.upsertLikeNotification(7, 12, 5);

    expect(notificationRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 5,
        message: "Someone liked your post",
      }),
    );
  });

  it("throws (so the consumer requeues) after losing every attempt", async () => {
    notificationRepo.findOne.mockResolvedValue(unreadLikeRow());
    notificationRepo.update.mockResolvedValue({ affected: 0 });

    await expect(service.upsertLikeNotification(7, 12, 5)).rejects.toThrow(
      "compare-and-swap",
    );
    expect(notificationRepo.update).toHaveBeenCalledTimes(3);
  });
});

describe("like notification message format", () => {
  it("round-trips the count through the message", () => {
    expect(buildLikeNotificationMessage(1)).toBe("Someone liked your post");
    expect(buildLikeNotificationMessage(12)).toBe("12 people liked your post");
    expect(parseLikeNotificationCount(buildLikeNotificationMessage(12))).toBe(
      12,
    );
    expect(parseLikeNotificationCount("Someone liked your post")).toBe(1);
    expect(parseLikeNotificationCount("unexpected text")).toBe(1);
  });
});
