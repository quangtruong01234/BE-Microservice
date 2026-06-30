import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { PaginatedResponse } from "@app/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Cron } from "@nestjs/schedule";
import { Conversation } from "./entity/conversation.entity";
import { Message } from "./entity/message.entity";
import { SendMessageDto } from "./dto/send-message.dto";

interface LastMessageMeta {
  id: number;
  content: string;
  senderId: number;
  createdAt: Date;
}

export interface ConversationWithMeta extends Conversation {
  lastMessage: LastMessageMeta | null;
  unreadCount: number;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
  ) {}

  async checkMembership(
    userId: number,
    conversationId: number,
  ): Promise<boolean> {
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
      throw new BadRequestException("Cannot chat with yourself");
    }
    const user1Id = Math.min(userId, otherUserId);
    const user2Id = Math.max(userId, otherUserId);
    const existing = await this.conversationRepo.findOne({
      where: { user1Id, user2Id },
    });
    if (existing) return existing;
    const conversation = this.conversationRepo.create({ user1Id, user2Id });
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

  async markRead(userId: number, conversationId: number): Promise<null> {
    const conversation = await this.conversationRepo
      .createQueryBuilder("c")
      .where("c.id = :conversationId", { conversationId })
      .andWhere("(c.user1_id = :userId OR c.user2_id = :userId)", { userId })
      .getOne();
    if (!conversation) {
      throw new ForbiddenException("Access denied");
    }
    const column =
      conversation.user1Id === userId ? "user1LastReadAt" : "user2LastReadAt";
    await this.conversationRepo.update(conversationId, {
      [column]: new Date(),
    });
    return null;
  }

  async getMessages(
    userId: number,
    conversationId: number,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<Message>> {
    const conversation = await this.conversationRepo
      .createQueryBuilder("c")
      .where("c.id = :conversationId", { conversationId })
      .andWhere("(c.user1_id = :userId OR c.user2_id = :userId)", { userId })
      .getOne();
    if (!conversation) {
      throw new ForbiddenException("Access denied");
    }
    const [data, total] = await this.messageRepo.findAndCount({
      where: { conversationId },
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return PaginatedResponse.of(data, total, page, limit);
  }

  async sendMessage(userId: number, dto: SendMessageDto): Promise<Message> {
    const conversation = await this.conversationRepo
      .createQueryBuilder("c")
      .where("c.id = :conversationId", { conversationId: dto.conversationId })
      .andWhere("(c.user1_id = :userId OR c.user2_id = :userId)", { userId })
      .getOne();
    if (!conversation) {
      throw new ForbiddenException("Access denied");
    }
    const message = this.messageRepo.create({
      conversationId: dto.conversationId,
      senderId: userId,
      content: dto.content,
      parentMessageId: dto.parentMessageId ?? null,
    });
    return this.messageRepo.save(message);
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
