import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Roles } from "../common/decorators/roles.decorator";
import { DeadLetterService } from "./dead-letter.service";
import {
  DeadLetterPeekResponseDto,
  DeadLetterReplayResponseDto,
  PeekDeadLettersQueryDto,
  ReplayDeadLettersDto,
} from "./dead-letter.dto";

@ApiTags("Admin — dead letters")
@ApiBearerAuth("bearer")
@Roles("admin")
@Controller("admin/dead-letters")
export class DeadLetterController {
  constructor(private readonly deadLetterService: DeadLetterService) {}

  @Get()
  @ApiOperation({
    summary:
      "Peek at the RabbitMQ dead-letter queue (read-only, nothing is consumed)",
  })
  @ApiResponse({ status: 200, type: DeadLetterPeekResponseDto })
  @ApiResponse({ status: 403, description: "Admin only." })
  @ApiResponse({ status: 503, description: "Message broker unavailable." })
  async peek(
    @Query() query: PeekDeadLettersQueryDto,
  ): Promise<DeadLetterPeekResponseDto> {
    return this.deadLetterService.peek(query.limit ?? 20);
  }

  @Post("replay")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Republish the oldest dead letters to the queue that rejected them",
  })
  @ApiResponse({ status: 200, type: DeadLetterReplayResponseDto })
  @ApiResponse({ status: 403, description: "Admin only." })
  @ApiResponse({ status: 503, description: "Message broker unavailable." })
  async replay(
    @Body() body: ReplayDeadLettersDto,
  ): Promise<DeadLetterReplayResponseDto> {
    return this.deadLetterService.replay(body.count ?? 1);
  }
}
