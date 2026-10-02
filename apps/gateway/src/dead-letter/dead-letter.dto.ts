import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

export class PeekDeadLettersQueryDto {
  @ApiPropertyOptional({
    description: "How many messages to show from the head of the queue",
    default: 20,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit?: number = 20;
}

export class ReplayDeadLettersDto {
  @ApiPropertyOptional({
    description:
      "How many messages to replay from the head of the queue, oldest first",
    default: 1,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  count?: number = 1;
}

export class DeadLetterMessageDto {
  @ApiProperty({
    description: "Queue that rejected the message",
    nullable: true,
    example: "INVENTORY_PRODUCT_SERVICE",
  })
  declare sourceQueue: string | null;

  @ApiProperty({
    description: "Exchange the message was originally published to",
    nullable: true,
    example: "product.fanout",
  })
  declare sourceExchange: string | null;

  @ApiProperty({
    description: "Why the broker dead-lettered it (rejected, expired, ...)",
    nullable: true,
    example: "rejected",
  })
  declare reason: string | null;

  @ApiProperty({
    description: "How many times it has been dead-lettered from that queue",
    example: 1,
  })
  declare deathCount: number;

  @ApiProperty({
    description: "When it was first dead-lettered (ISO 8601)",
    nullable: true,
  })
  declare firstDeathAt: string | null;

  @ApiProperty({
    description:
      "How many times an admin has already replayed it — a high number marks a poison message",
    example: 0,
  })
  declare replayCount: number;

  @ApiProperty({
    description: "NestJS event pattern from the envelope, if parseable",
    nullable: true,
    example: "product_deleted",
  })
  declare pattern: string | null;

  @ApiProperty({
    description:
      "Envelope `data` when the body is JSON, otherwise the raw body as a string",
    nullable: true,
  })
  declare payload: unknown;
}

export class DeadLetterPeekResponseDto {
  @ApiProperty({ example: "trybuy.dead_letter" })
  declare queue: string;

  @ApiProperty({ description: "Messages currently in the dead-letter queue" })
  declare total: number;

  @ApiProperty({ type: [DeadLetterMessageDto] })
  declare messages: DeadLetterMessageDto[];
}

export class DeadLetterReplayResponseDto {
  @ApiProperty({ description: "Messages republished to their source queue" })
  declare replayed: number;

  @ApiProperty({
    description:
      "Messages left in the dead-letter queue because their source queue is unknown or gone",
  })
  declare skipped: number;

  @ApiProperty({ description: "Messages still in the dead-letter queue" })
  declare remaining: number;
}
