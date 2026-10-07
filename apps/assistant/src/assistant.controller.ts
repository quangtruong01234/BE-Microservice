import { Controller, Logger, UseFilters, ValidationPipe } from "@nestjs/common";
import {
  Ctx,
  EventPattern,
  MessagePattern,
  Payload,
  RmqContext,
} from "@nestjs/microservices";
import {
  HttpToRpcExceptionFilter,
  ProductAnswer,
  RmqService,
} from "@app/common";
import { EVENT } from "@app/common/constants/event";
import { ASSISTANT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-assistant.constant";
import { AssistantService } from "./assistant.service";
import { AskDto } from "./dto/ask.dto";
import { RagIndexer } from "./rag-indexer.service";

@UseFilters(HttpToRpcExceptionFilter)
@Controller()
export class AssistantController {
  private readonly logger = new Logger(AssistantController.name);

  constructor(
    private readonly assistantService: AssistantService,
    private readonly ragIndexer: RagIndexer,
    private readonly rmqService: RmqService,
  ) {}

  @MessagePattern(ASSISTANT_MESSAGE_PATTERNS.ASK)
  ask(
    @Payload(new ValidationPipe({ transform: true, whitelist: true }))
    dto: AskDto,
  ): Promise<ProductAnswer> {
    return this.assistantService.ask(dto);
  }

  /**
   * PRODUCT-QA-01 consumer matrix: a malformed event is dead-lettered; a
   * product-leg or Gemini failure is recorded as pending by the indexer and
   * acked (the retry cron owns it); only a PostgreSQL error requeues.
   */
  @EventPattern(EVENT.PRODUCT_INDEX_CHANGED_EVENT)
  async handleIndexChanged(
    @Payload() event: unknown,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const productId =
      typeof event === "object" && event !== null
        ? (event as { productId?: unknown }).productId
        : undefined;
    if (
      typeof productId !== "number" ||
      !Number.isSafeInteger(productId) ||
      productId < 1
    ) {
      this.logger.warn("[RAG] malformed index_changed event — dead-lettered");
      this.nack(context, false);
      return;
    }

    try {
      await this.ragIndexer.indexProduct(productId);
      this.rmqService.ack(context);
    } catch (err: unknown) {
      this.logger.error(
        `[RAG] index_changed for product ${productId} failed — requeued`,
        err instanceof Error ? err.stack : String(err),
      );
      this.nack(context, true);
    }
  }

  private nack(context: RmqContext, requeue: boolean): void {
    const channel = context.getChannelRef() as {
      nack: (message: unknown, allUpTo: boolean, requeue: boolean) => void;
    };
    channel.nack(context.getMessage(), false, requeue);
  }
}
