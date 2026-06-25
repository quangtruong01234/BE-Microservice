import { Controller, UseFilters } from "@nestjs/common";
import { MessagePattern, Payload } from "@nestjs/microservices";
import { HttpToRpcExceptionFilter } from "@app/common/filters/http-to-rpc-exception.filter";
import { SocialService } from "./social.service";
import { SOCIAL_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { Post } from "./entities/post.entity";
import { Comment } from "./entities/comment.entity";

@UseFilters(new HttpToRpcExceptionFilter())
@Controller()
export class SocialController {
  constructor(private readonly socialService: SocialService) {}

  @MessagePattern(SOCIAL_MESSAGE_PATTERN.CREATE_POST)
  async createPost(
    @Payload()
    payload: {
      userId: number;
      content: string;
      imageUrls?: string[] | null;
      videoUrl?: string | null;
    },
  ): Promise<Post> {
    return this.socialService.createPost(payload);
  }

  @MessagePattern(SOCIAL_MESSAGE_PATTERN.UPDATE_POST)
  async updatePost(
    @Payload()
    payload: {
      postId: number;
      userId: number;
      content?: string;
      imageUrls?: string[] | null;
      videoUrl?: string | null;
      productId?: number | null;
    },
  ): Promise<Post> {
    return this.socialService.updatePost(payload);
  }

  @MessagePattern(SOCIAL_MESSAGE_PATTERN.REPORT_POST)
  async reportPost(
    @Payload()
    payload: {
      postId: number;
      reporterId: number;
      reason: string;
    },
  ): Promise<{ reported: boolean; postId: number }> {
    return this.socialService.reportPost(payload);
  }

  @MessagePattern(SOCIAL_MESSAGE_PATTERN.GET_POSTS)
  async getPosts(
    @Payload()
    payload: {
      page: number;
      limit: number;
      viewerUserId?: number | null;
    },
  ): Promise<unknown> {
    return this.socialService.getPosts(payload);
  }

  @MessagePattern(SOCIAL_MESSAGE_PATTERN.GET_POSTS_BY_USER)
  async getPostsByUser(
    @Payload()
    payload: {
      userId: number;
      page: number;
      limit: number;
      viewerUserId?: number | null;
    },
  ): Promise<unknown> {
    return this.socialService.getPostsByUser(payload);
  }

  @MessagePattern(SOCIAL_MESSAGE_PATTERN.GET_POST_BY_ID)
  async getPostById(
    @Payload() payload: { postId: number; viewerUserId?: number | null },
  ): Promise<unknown> {
    return this.socialService.getPostById(payload.postId, payload.viewerUserId);
  }

  @MessagePattern(SOCIAL_MESSAGE_PATTERN.DELETE_POST)
  async deletePost(
    @Payload() payload: { postId: number; userId: number },
  ): Promise<{ success: boolean }> {
    return this.socialService.deletePost(payload);
  }

  @MessagePattern(SOCIAL_MESSAGE_PATTERN.LIKE_POST)
  async likePost(
    @Payload() payload: { postId: number; userId: number },
  ): Promise<{ liked: boolean; postId: number }> {
    return this.socialService.likePost(payload);
  }

  @MessagePattern(SOCIAL_MESSAGE_PATTERN.UNLIKE_POST)
  async unlikePost(
    @Payload() payload: { postId: number; userId: number },
  ): Promise<{ liked: boolean; postId: number }> {
    return this.socialService.unlikePost(payload);
  }

  @MessagePattern(SOCIAL_MESSAGE_PATTERN.CREATE_COMMENT)
  async createComment(
    @Payload() payload: { postId: number; userId: number; content: string },
  ): Promise<Comment> {
    return this.socialService.createComment(payload);
  }

  @MessagePattern(SOCIAL_MESSAGE_PATTERN.GET_COMMENTS)
  async getComments(
    @Payload() payload: { postId: number; page: number; limit: number },
  ): Promise<unknown> {
    return this.socialService.getComments(payload);
  }

  @MessagePattern(SOCIAL_MESSAGE_PATTERN.DELETE_COMMENT)
  async deleteComment(
    @Payload() payload: { commentId: number; userId: number },
  ): Promise<{ deleted: boolean }> {
    return this.socialService.deleteComment(payload);
  }

  @MessagePattern(SOCIAL_MESSAGE_PATTERN.CREATE_REPLY)
  async createReply(
    @Payload()
    payload: {
      postId: number;
      parentCommentId: number;
      userId: number;
      content: string;
    },
  ): Promise<Comment> {
    return this.socialService.createReply(payload);
  }

  @MessagePattern(SOCIAL_MESSAGE_PATTERN.GET_REPLIES)
  async getReplies(
    @Payload() payload: { commentId: number; depth?: number },
  ): Promise<Comment> {
    return this.socialService.getReplies(payload);
  }

  @MessagePattern(SOCIAL_MESSAGE_PATTERN.FOLLOW_USER)
  async followUser(
    @Payload() payload: { followerId: number; followingId: number },
  ): Promise<{ followed: boolean; followingId: number }> {
    return this.socialService.followUser(payload);
  }

  @MessagePattern(SOCIAL_MESSAGE_PATTERN.UNFOLLOW_USER)
  async unfollowUser(
    @Payload() payload: { followerId: number; followingId: number },
  ): Promise<{ followed: boolean; followingId: number }> {
    return this.socialService.unfollowUser(payload);
  }

  @MessagePattern(SOCIAL_MESSAGE_PATTERN.GET_FOLLOWERS)
  async getFollowers(
    @Payload() payload: { userId: number; page: number; limit: number },
  ): Promise<unknown> {
    return this.socialService.getFollowers(payload);
  }

  @MessagePattern(SOCIAL_MESSAGE_PATTERN.GET_FOLLOWING)
  async getFollowing(
    @Payload() payload: { userId: number; page: number; limit: number },
  ): Promise<unknown> {
    return this.socialService.getFollowing(payload);
  }

  @MessagePattern(SOCIAL_MESSAGE_PATTERN.GET_FOLLOWING_FEED)
  async getFollowingFeed(
    @Payload()
    payload: {
      userId: number;
      page: number;
      limit: number;
      viewerUserId?: number | null;
    },
  ): Promise<unknown> {
    return this.socialService.getFollowingFeed(payload);
  }
}
