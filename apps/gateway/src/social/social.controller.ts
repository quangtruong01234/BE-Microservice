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
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { Public } from "../common/decorators/public.decorator";
import { SocialGatewayService } from "./social.service";
import { CreatePostDto } from "./dto/create-post.dto";
import { CreateCommentDto } from "./dto/create-comment.dto";
import { GetPostsQueryDto } from "./dto/get-posts-query.dto";

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
    );
  }

  @Get()
  @Public()
  @ApiOperation({ summary: "Get paginated posts" })
  @ApiResponse({ status: 200, description: "Paginated post list." })
  async getPosts(
    @Query(ValidationPipe) query: GetPostsQueryDto,
  ): Promise<unknown> {
    return this.socialService.getPosts(query.page ?? 1, query.limit ?? 20);
  }

  @Get("user/:userId")
  @Public()
  @ApiOperation({ summary: "Get paginated posts by user" })
  @ApiResponse({ status: 200, description: "Paginated post list for user." })
  async getPostsByUser(
    @Param("userId", ParseIntPipe) userId: number,
    @Query(ValidationPipe) query: GetPostsQueryDto,
  ): Promise<unknown> {
    return this.socialService.getPostsByUser(
      userId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Get(":id")
  @Public()
  @ApiOperation({ summary: "Get a post by ID" })
  @ApiResponse({ status: 200, description: "Post found." })
  @ApiResponse({ status: 404, description: "Post not found." })
  async getPostById(@Param("id", ParseIntPipe) id: number): Promise<unknown> {
    return this.socialService.getPostById(id);
  }

  @Post(":id/like")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("bearer")
  @ApiOperation({ summary: "Like a post" })
  @ApiResponse({ status: 201, description: "Post liked." })
  @ApiResponse({ status: 404, description: "Post not found." })
  @ApiResponse({ status: 409, description: "Already liked." })
  async likePost(
    @Param("id", ParseIntPipe) id: number,
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
    @Param("id", ParseIntPipe) id: number,
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
    @Param("id", ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<unknown> {
    const userId = req.user?.id ?? 0;
    return this.socialService.deletePost(id, userId);
  }

  @Post(":id/comments")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("bearer")
  @ApiOperation({ summary: "Create a comment on a post" })
  @ApiResponse({ status: 201, description: "Comment created." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 404, description: "Post not found." })
  async createComment(
    @Param("id", ParseIntPipe) postId: number,
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
    @Param("id", ParseIntPipe) postId: number,
    @Query(ValidationPipe) query: GetPostsQueryDto,
  ): Promise<unknown> {
    return this.socialService.getComments(
      postId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }
}
