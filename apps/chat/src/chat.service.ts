import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { generatePublicId, PaginatedResponse } from "@app/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { Cron } from "@nestjs/schedule";
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";
import { Conversation } from "./entity/conversation.entity";
import { Message } from "./entity/message.entity";
import { CHAT_MESSAGE } from "libs/constant/response-message.constant";
import {
  ConversationWithMeta,
  MessageWithParentMeta,
  SendMessagePayload,
  SentMessageWithParticipants,
} from "./chat.types";

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
  ) {}

  /**
   * Accepts the internal numeric id or the opaque public id (`conv_...`) and
   * returns the numeric PK, or null when a public id matches no row.
   */
  private async lookupConversationId(
    conversationId: number | string,
  ): Promise<number | null> {
    if (typeof conversationId === "number") return conversationId;
    const conversation = await this.conversationRepo.findOne({
      where: { publicId: conversationId },
      select: { id: true },
    });
    return conversation?.id ?? null;
  }

  private async resolveConversationId(
    conversationId: number | string,
  ): Promise<number> {
    const resolvedId = await this.lookupConversationId(conversationId);
    if (resolvedId === null) {
      throw new NotFoundException(CHAT_MESSAGE.ACCESS_DENIED);
    }
    return resolvedId;
  }

  async checkMembership(
    userId: number,
    conversationRef: number | string,
  ): Promise<boolean> {
    const conversationId = await this.lookupConversationId(conversationRef);
    if (conversationId === null) return false;
    const conversation = await this.conversationRepo
      .createQueryBuilder("c")
      .where("c.id = :conversationId", { conversationId })
      .andWhere("(c.user1_id = :userId OR c.user2_id = :userId)", { userId })
      .getOne();
    return conversation !== null;
  }

  async createOrGetConversation(
    userId: number,
    otherUserId: number,
  ): Promise<Conversation> {
    if (userId === otherUserId) {
      throw new BadRequestException(CHAT_MESSAGE.CANNOT_CHAT_WITH_SELF);
    }
    const user1Id = Math.min(userId, otherUserId);
    const user2Id = Math.max(userId, otherUserId);
    const existing = await this.conversationRepo.findOne({
      where: { user1Id, user2Id },
    });
    if (existing) return existing;
    const conversation = this.conversationRepo.create({
      user1Id,
      user2Id,
      publicId: generatePublicId(PUBLIC_ID_PREFIXES.CONVERSATION),
    });
    return this.conversationRepo.save(conversation);
  }

  async getConversations(userId: number): Promise<ConversationWithMeta[]> {
    const conversations = await this.conversationRepo
      .createQueryBuilder("c")
      .where("c.user1_id = :userId OR c.user2_id = :userId", { userId })
      .orderBy("c.created_at", "DESC")
      .getMany();

    if (conversations.length === 0) return [];

    const conversationIds = conversations.map((c) => c.id);

    // Latest message per conversation — MAX(id) is reliable because id is an
    // auto-increment bigint, so it avoids same-second created_at ties.
    const lastMessages = await this.messageRepo
      .createQueryBuilder("m")
      .innerJoin(
        (qb) =>
          qb
            .select("mm.conversation_id", "conversation_id")
            .addSelect("MAX(mm.id)", "max_id")
            .from(Message, "mm")
            .where("mm.conversation_id IN (:...conversationIds)", {
              conversationIds,
            })
            .groupBy("mm.conversation_id"),
        "last",
        "last.max_id = m.id",
      )
      .getMany();

    const lastByConversation = new Map<number, Message>();
    for (const message of lastMessages) {
      lastByConversation.set(message.conversationId, message);
    }

    // Unread = inbound messages newer than the viewer's last-read marker.
    // One grouped query covers every conversation regardless of which side the
    // viewer sits on.
    const unreadRows = await this.messageRepo
      .createQueryBuilder("m")
      .innerJoin(Conversation, "c", "c.id = m.conversation_id")
      .select("m.conversation_id", "conversationId")
      .addSelect("COUNT(*)", "count")
      .where("m.conversation_id IN (:...conversationIds)", { conversationIds })
      .andWhere("m.sender_id != :userId", { userId })
      .andWhere(
        `(
          (c.user1_id = :userId AND (c.user1_last_read_at IS NULL OR m.created_at > c.user1_last_read_at))
          OR
          (c.user2_id = :userId AND (c.user2_last_read_at IS NULL OR m.created_at > c.user2_last_read_at))
        )`,
        { userId },
      )
      .groupBy("m.conversation_id")
      .getRawMany<{ conversationId: number; count: string }>();

    const unreadByConversation = new Map<number, number>();
    for (const row of unreadRows) {
      unreadByConversation.set(Number(row.conversationId), Number(row.count));
    }

    const enriched = conversations.map((c): ConversationWithMeta => {
      const last = lastByConversation.get(c.id);
      return {
        ...c,
        lastMessage: last
          ? {
              id: last.id,
              publicId: last.publicId,
              content: last.content,
              senderId: last.senderId,
              createdAt: last.createdAt,
            }
          : null,
        unreadCount: unreadByConversation.get(c.id) ?? 0,
      };
    });

    // Surface the most recently active conversations first (fall back to the
    // conversation creation time when there are no messages yet).
    return enriched.sort((a, b) => {
      const aTime = (a.lastMessage?.createdAt ?? a.createdAt).getTime();
      const bTime = (b.lastMessage?.createdAt ?? b.createdAt).getTime();
      return bTime - aTime;
    });
  }

  async markRead(
    userId: number,
    conversationRef: number | string,
  ): Promise<null> {
    const conversationId = await this.resolveConversationId(conversationRef);
    const conversation = await this.conversationRepo
      .createQueryBuilder("c")
      .where("c.id = :conversationId", { conversationId })
      .andWhere("(c.user1_id = :userId OR c.user2_id = :userId)", { userId })
      .getOne();
    if (!conversation) {
      throw new ForbiddenException(CHAT_MESSAGE.ACCESS_DENIED);
    }
    const column =
      conversation.user1Id === userId ? "user1LastReadAt" : "user2LastReadAt";
    await this.conversationRepo.update(conversationId, {
      [column]: new Date(),
    });
    return null;
  }

  /**
   * Attaches each message's parent public id (`msg_...`) so the gateway can
   * expose reply threading without numeric ids. One batched lookup per page.
   */
  private async attachParentPublicIds(
    messages: Message[],
  ): Promise<MessageWithParentMeta[]> {
    const parentIds = messages
      .map((message) => message.parentMessageId)
      .filter((parentId): parentId is number => parentId !== null);
    const parentPublicIdById = new Map<number, string | null>();
    if (parentIds.length > 0) {
      const parents = await this.messageRepo.find({
        where: { id: In(parentIds) },
        select: { id: true, publicId: true },
      });
      for (const parent of parents) {
        parentPublicIdById.set(Number(parent.id), parent.publicId);
      }
    }
    return messages.map(
      (message): MessageWithParentMeta => ({
        ...message,
        parentMessagePublicId:
          message.parentMessageId !== null
            ? (parentPublicIdById.get(Number(message.parentMessageId)) ?? null)
            : null,
      }),
    );
  }

  async getMessages(
    userId: number,
    conversationRef: number | string,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<MessageWithParentMeta>> {
    const conversationId = await this.resolveConversationId(conversationRef);
    const conversation = await this.conversationRepo
      .createQueryBuilder("c")
      .where("c.id = :conversationId", { conversationId })
      .andWhere("(c.user1_id = :userId OR c.user2_id = :userId)", { userId })
      .getOne();
    if (!conversation) {
      throw new ForbiddenException(CHAT_MESSAGE.ACCESS_DENIED);
    }
    const [data, total] = await this.messageRepo.findAndCount({
      where: { conversationId },
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    const withParents = await this.attachParentPublicIds(data);
    return PaginatedResponse.of(withParents, total, page, limit);
  }

  async sendMessage(
    userId: number,
    payload: SendMessagePayload,
  ): Promise<SentMessageWithParticipants> {
    const conversationId = await this.resolveConversationId(
      payload.conversationId,
    );
    const conversation = await this.conversationRepo
      .createQueryBuilder("c")
      .where("c.id = :conversationId", { conversationId })
      .andWhere("(c.user1_id = :userId OR c.user2_id = :userId)", { userId })
      .getOne();
    if (!conversation) {
      throw new ForbiddenException(CHAT_MESSAGE.ACCESS_DENIED);
    }
    let parentMessageId: number | null = null;
    let parentMessagePublicId: string | null = null;
    if (payload.parentMessageId !== undefined) {
      const parent = await this.messageRepo.findOne({
        where:
          typeof payload.parentMessageId === "number"
            ? { id: payload.parentMessageId }
            : { publicId: payload.parentMessageId },
        select: { id: true, publicId: true, conversationId: true },
      });
      if (!parent || Number(parent.conversationId) !== conversationId) {
        throw new BadRequestException(CHAT_MESSAGE.INVALID_PARENT_MESSAGE);
      }
      parentMessageId = Number(parent.id);
      parentMessagePublicId = parent.publicId;
    }
    const message = this.messageRepo.create({
      conversationId,
      senderId: userId,
      content: payload.content,
      parentMessageId,
      publicId: generatePublicId(PUBLIC_ID_PREFIXES.MESSAGE),
    });
    const saved = await this.messageRepo.save(message);
    // CHAT-ROOM-01: hand the gateway both members so it can deliver the message
    // to each participant's user room. The conversation row is already loaded
    // for the membership check above, so this costs no extra query.
    return {
      ...saved,
      parentMessagePublicId,
      participantIds: [conversation.user1Id, conversation.user2Id],
    };
  }

  @Cron("0 2 * * *")
  async cleanupOldMessages(): Promise<void> {
    try {
      const result = await this.messageRepo
        .createQueryBuilder()
        .delete()
        .where("created_at < :cutoff", {
          cutoff: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        })
        .execute();
      this.logger.log(`Cleaned up ${result.affected} messages`);
    } catch (error) {
      this.logger.error("Message cleanup failed", error);
    }
  }
}
