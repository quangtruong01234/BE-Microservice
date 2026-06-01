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

  async getConversations(userId: number): Promise<Conversation[]> {
    return this.conversationRepo
      .createQueryBuilder("c")
      .where("c.user1_id = :userId OR c.user2_id = :userId", { userId })
      .orderBy("c.created_at", "DESC")
      .getMany();
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
