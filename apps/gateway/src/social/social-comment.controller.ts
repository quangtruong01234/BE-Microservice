import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import { Request } from "express";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { Type } from "class-transformer";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { Public } from "../common/decorators/public.decorator";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
import { SocialGatewayService } from "./social.service";
import { CreateReplyDto } from "./dto/create-reply.dto";

class GetRepliesQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  @Type(() => Number)
  depth?: number;
}

@ApiTags("Social")
@Controller("social/comments")
export class SocialCommentController {
  constructor(private readonly socialService: SocialGatewayService) {}

  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("bearer")
  @ApiOperation({ summary: "Delete a comment" })
  @ApiResponse({ status: 200, description: "Comment deleted." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "Comment not found." })
  async deleteComment(
    @Param("id", ParseIntPipe) commentId: number,
    @Req() req: Request,
  ): Promise<unknown> {
    const userId = req.user?.id ?? 0;
    return this.socialService.deleteComment(commentId, userId);
  }

  @Post(":id/replies")
  @UseGuards(JwtAuthGuard)
  @RateLimit({ limit: 50 })
  @ApiBearerAuth("bearer")
  @ApiOperation({ summary: "Reply to a comment" })
  @ApiResponse({ status: 201, description: "Reply created." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 404, description: "Parent comment not found." })
  async createReply(
    @Param("id", ParseIntPipe) parentCommentId: number,
    @Req() req: Request,
    @Body() body: CreateReplyDto,
  ): Promise<unknown> {
    const userId = req.user?.id ?? 0;
    return this.socialService.createReply(
      body.postId,
      parentCommentId,
      userId,
      body.content,
    );
  }

  @Get(":id/replies")
  @Public()
  @ApiOperation({ summary: "Get reply tree for a comment" })
  @ApiQuery({ name: "depth", required: false, type: Number })
  @ApiResponse({ status: 200, description: "Descendant tree returned." })
  @ApiResponse({ status: 404, description: "Comment not found." })
  async getReplies(
    @Param("id", ParseIntPipe) commentId: number,
    @Query(ValidationPipe) query: GetRepliesQueryDto,
  ): Promise<unknown> {
    return this.socialService.getReplies(commentId, query.depth);
  }
}
