import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { createRepositoryMock, RepositoryMock } from "@app/testing";
import { LessThan } from "typeorm";
import { ChatService } from "./chat.service";
import { Conversation } from "./entity/conversation.entity";
import { Message } from "./entity/message.entity";

describe("ChatService.deleteMessage (CHAT-E2E-CLEANUP-01)", () => {
  let messageRepo: RepositoryMock<Message>;
  let transactionManager: { update: jest.Mock; delete: jest.Mock };
  let service: ChatService;

  beforeEach(() => {
    messageRepo = createRepositoryMock<Message>();
    transactionManager = {
      update: jest.fn().mockResolvedValue({ affected: 0 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const repository = messageRepo.asRepository();
    Object.assign(repository, {
      manager: {
        transaction: jest.fn(
          (work: (manager: typeof transactionManager) => Promise<void>) =>
            work(transactionManager),
        ),
      },
    });
    service = new ChatService(
      createRepositoryMock<Conversation>().asRepository(),
      repository,
    );
  });

  it("detaches replies and deletes the sender's own message", async () => {
    messageRepo.findOne.mockResolvedValue({ id: "42", senderId: 7 });

    await expect(service.deleteMessage(7, "msg_abc")).resolves.toBeNull();

    expect(messageRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { publicId: "msg_abc" } }),
    );
    expect(transactionManager.update).toHaveBeenCalledWith(
      Message,
      { parentMessageId: 42 },
      { parentMessageId: null },
    );
    expect(transactionManager.delete).toHaveBeenCalledWith(Message, {
      id: 42,
    });
  });

  it("is a 404 when the message does not exist", async () => {
    await expect(service.deleteMessage(7, "msg_gone")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(transactionManager.delete).not.toHaveBeenCalled();
  });

  it("is a 403 for anyone but the sender", async () => {
    messageRepo.findOne.mockResolvedValue({ id: 42, senderId: 8 });

    await expect(service.deleteMessage(7, "msg_abc")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(transactionManager.update).not.toHaveBeenCalled();
    expect(transactionManager.delete).not.toHaveBeenCalled();
  });
});

describe("ChatService conversation/parent refs (SWEEP-1002-06)", () => {
  let conversationRepo: RepositoryMock<Conversation>;
  let messageRepo: RepositoryMock<Message>;
  let service: ChatService;

  beforeEach(() => {
    conversationRepo = createRepositoryMock<Conversation>();
    messageRepo = createRepositoryMock<Message>();
    service = new ChatService(
      conversationRepo.asRepository(),
      messageRepo.asRepository(),
    );
  });

  const givenMember = (conversation: Partial<Conversation>): void => {
    const queryBuilder = conversationRepo.createQueryBuilder() as {
      getOne: jest.Mock;
    };
    queryBuilder.getOne.mockResolvedValue(conversation);
  };

  it("never looks up a conversation for a missing id", async () => {
    // findOne({ where: { publicId: undefined } }) matches the FIRST row.
    conversationRepo.findOne.mockResolvedValue({ id: 1 });

    await expect(
      service.checkMembership(7, undefined as unknown as string),
    ).resolves.toBe(false);
    await expect(
      service.sendMessage(7, {
        conversationId: undefined as unknown as string,
        content: "hi",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(conversationRepo.findOne).not.toHaveBeenCalled();
    expect(messageRepo.save).not.toHaveBeenCalled();
  });

  it("treats a null parentMessageId as no parent", async () => {
    conversationRepo.findOne.mockResolvedValue({ id: 5 });
    givenMember({ id: 5, user1Id: 7, user2Id: 8 });

    await service.sendMessage(7, {
      conversationId: "conv_abc",
      content: "hi",
      parentMessageId: null,
    });

    expect(messageRepo.findOne).not.toHaveBeenCalled();
    expect(messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ parentMessageId: null }),
    );
  });

  it("rejects a parentMessageId that is neither a string nor a number", async () => {
    conversationRepo.findOne.mockResolvedValue({ id: 5 });
    givenMember({ id: 5, user1Id: 7, user2Id: 8 });
    messageRepo.findOne.mockResolvedValue({ id: 1, conversationId: 5 });

    await expect(
      service.sendMessage(7, {
        conversationId: "conv_abc",
        content: "hi",
        parentMessageId: {} as unknown as string,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(messageRepo.findOne).not.toHaveBeenCalled();
    expect(messageRepo.save).not.toHaveBeenCalled();
  });
});

describe("ChatService.cleanupOldMessages (SWEEP-1002-07)", () => {
  let transactionManager: { query: jest.Mock; delete: jest.Mock };
  let service: ChatService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-03T02:00:00Z"));
    transactionManager = {
      query: jest.fn().mockResolvedValue({ affectedRows: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 3 }),
    };
    const repository = createRepositoryMock<Message>().asRepository();
    Object.assign(repository, {
      manager: {
        transaction: jest.fn(
          (work: (manager: typeof transactionManager) => Promise<void>) =>
            work(transactionManager),
        ),
      },
    });
    service = new ChatService(
      createRepositoryMock<Conversation>().asRepository(),
      repository,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("detaches replies to expiring messages before the bulk delete", async () => {
    const cutoff = new Date("2026-09-28T02:00:00Z");

    await service.cleanupOldMessages();

    expect(transactionManager.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /UPDATE messages .*SET .*parent_message_id = NULL/s,
      ),
      [cutoff],
    );
    expect(transactionManager.delete).toHaveBeenCalledWith(Message, {
      createdAt: LessThan(cutoff),
    });
    const detachOrder = transactionManager.query.mock.invocationCallOrder[0];
    const deleteOrder = transactionManager.delete.mock.invocationCallOrder[0];
    expect(detachOrder).toBeLessThan(deleteOrder);
  });

  it("swallows a failure so the cron never throws", async () => {
    transactionManager.delete.mockRejectedValue(
      new Error("ER_ROW_IS_REFERENCED_2"),
    );

    await expect(service.cleanupOldMessages()).resolves.toBeUndefined();
  });
});

describe("ChatService.getConversations (SWEEP-1005-04)", () => {
  let conversationRepo: RepositoryMock<Conversation>;
  let service: ChatService;

  beforeEach(() => {
    conversationRepo = createRepositoryMock<Conversation>();
    service = new ChatService(
      conversationRepo.asRepository(),
      createRepositoryMock<Message>().asRepository(),
    );
  });

  it("caps the list at the 100 most recently active conversations in SQL", async () => {
    const queryBuilder = conversationRepo.createQueryBuilder() as unknown as {
      orderBy: jest.Mock;
      limit: jest.Mock;
      take: jest.Mock;
    };

    await expect(service.getConversations(7)).resolves.toEqual([]);

    expect(queryBuilder.limit).toHaveBeenCalledWith(100);
    expect(queryBuilder.take).not.toHaveBeenCalled();
    const [[orderExpression, direction]] = queryBuilder.orderBy.mock
      .calls as Array<[string, string]>;
    expect(orderExpression).toContain("activity.last_at");
    expect(direction).toBe("DESC");
  });
});
