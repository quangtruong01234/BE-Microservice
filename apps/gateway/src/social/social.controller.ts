import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { OptionalJwtAuthGuard } from "../common/guards/optional-jwt-auth.guard";
import { Public } from "../common/decorators/public.decorator";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
import { SocialGatewayService } from "./social.service";
import { CreatePostDto } from "./dto/create-post.dto";
import { UpdatePostDto } from "./dto/update-post.dto";
import { ReportPostDto } from "./dto/report-post.dto";
import { CreateCommentDto } from "./dto/create-comment.dto";
import { GetPostsQueryDto } from "./dto/get-posts-query.dto";
import { ParsePublicIdPipe } from "../common/pipes/parse-public-id.pipe";
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";

@ApiTags("Social")
@Controller("social/posts")
export class SocialController {
  constructor(private readonly socialService: SocialGatewayService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("bearer")
  @ApiOperation({ summary: "Create a new post" })
  @ApiResponse({ status: 201, description: "Post created." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async createPost(
    @Req() req: Request,
    @Body() body: CreatePostDto,
  ): Promise<unknown> {
    const userId = req.user?.id ?? 0;
    return this.socialService.createPost(
      userId,
      body.content,
      body.imageUrls,
      body.videoUrl,
      body.productId,
    );
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("bearer")
  @ApiOperation({ summary: "Edit a post (owner only)" })
  @ApiResponse({ status: 200, description: "Post updated." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "Post not found." })
  async updatePost(
    @Param("id", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.POST)) id: string,
    @Req() req: Request,
    @Body() body: UpdatePostDto,
  ): Promise<unknown> {
    const userId = req.user?.id ?? 0;
    return this.socialService.updatePost(id, userId, body);
  }

  @Post(":id/report")
  @UseGuards(JwtAuthGuard)
  @RateLimit({ limit: 20 })
  @ApiBearerAuth("bearer")
  @ApiOperation({ summary: "Report a post" })
  @ApiResponse({ status: 201, description: "Post reported." })
  @ApiResponse({ status: 400, description: "Cannot report own post." })
  @ApiResponse({ status: 404, description: "Post not found." })
  @ApiResponse({ status: 409, description: "Already reported." })
  async reportPost(
    @Param("id", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.POST)) id: string,
    @Req() req: Request,
    @Body() body: ReportPostDto,
  ): Promise<unknown> {
    const userId = req.user?.id ?? 0;
    return this.socialService.reportPost(id, userId, body.reason);
  }

  @Get()
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: "Get paginated posts" })
  @ApiResponse({ status: 200, description: "Paginated post list." })
  async getPosts(
    @Req() req: Request,
    @Query(ValidationPipe) query: GetPostsQueryDto,
  ): Promise<unknown> {
    const viewerUserId = req.user?.id ?? null;
    return this.socialService.getPosts(
      query.page ?? 1,
      query.limit ?? 20,
      viewerUserId,
    );
  }

  @Get("user/:userId")
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: "Get paginated posts by user" })
  @ApiResponse({ status: 200, description: "Paginated post list for user." })
  async getPostsByUser(
    @Req() req: Request,
    @Param("userId", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.USER))
    userId: string,
    @Query(ValidationPipe) query: GetPostsQueryDto,
  ): Promise<unknown> {
    const viewerUserId = req.user?.id ?? null;
    return this.socialService.getPostsByUser(
      userId,
      query.page ?? 1,
      query.limit ?? 20,
      viewerUserId,
    );
  }

  @Get(":id")
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: "Get a post by ID" })
  @ApiResponse({ status: 200, description: "Post found." })
  @ApiResponse({ status: 404, description: "Post not found." })
  async getPostById(
    @Req() req: Request,
    @Param("id", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.POST)) id: string,
  ): Promise<unknown> {
    const viewerUserId = req.user?.id ?? null;
    return this.socialService.getPostById(id, viewerUserId);
  }

  @Post(":id/like")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("bearer")
  @ApiOperation({ summary: "Like a post" })
  @ApiResponse({ status: 201, description: "Post liked." })
  @ApiResponse({ status: 404, description: "Post not found." })
  @ApiResponse({ status: 409, description: "Already liked." })
  async likePost(
    @Param("id", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.POST)) id: string,
    @Req() req: Request,
  ): Promise<unknown> {
    const userId = req.user?.id ?? 0;
    return this.socialService.likePost(id, userId);
  }

  @Delete(":id/like")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("bearer")
  @ApiOperation({ summary: "Unlike a post" })
  @ApiResponse({ status: 200, description: "Post unliked." })
  @ApiResponse({ status: 404, description: "Like not found." })
  async unlikePost(
    @Param("id", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.POST)) id: string,
    @Req() req: Request,
  ): Promise<unknown> {
    const userId = req.user?.id ?? 0;
    return this.socialService.unlikePost(id, userId);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("bearer")
  @ApiOperation({ summary: "Delete a post" })
  @ApiResponse({ status: 200, description: "Post deleted." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "Post not found." })
  async deletePost(
    @Param("id", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.POST)) id: string,
    @Req() req: Request,
  ): Promise<unknown> {
    const userId = req.user?.id ?? 0;
    return this.socialService.deletePost(id, userId);
  }

  @Post(":id/comments")
  @UseGuards(JwtAuthGuard)
  @RateLimit({ limit: 50 })
  @ApiBearerAuth("bearer")
  @ApiOperation({ summary: "Create a comment on a post" })
  @ApiResponse({ status: 201, description: "Comment created." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 404, description: "Post not found." })
  async createComment(
    @Param("id", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.POST)) postId: string,
    @Req() req: Request,
    @Body() body: CreateCommentDto,
  ): Promise<unknown> {
    const userId = req.user?.id ?? 0;
    return this.socialService.createComment(postId, userId, body.content);
  }

  @Get(":id/comments")
  @Public()
  @ApiOperation({ summary: "Get paginated comments for a post" })
  @ApiResponse({ status: 200, description: "Paginated comment list." })
  async getComments(
    @Param("id", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.POST)) postId: string,
    @Query(ValidationPipe) query: GetPostsQueryDto,
  ): Promise<unknown> {
    return this.socialService.getComments(
      postId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }
}
