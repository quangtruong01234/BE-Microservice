import { Inject, Injectable } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, Observable, timeout } from "rxjs";
import {
  SOCIAL_MESSAGE_PATTERN,
  USER_MESSAGE_PATTERN,
} from "libs/constant/message-pattern.constant";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";

interface UserInfo {
  id: number;
  username: string;
  avatar: string | null;
}

@Injectable()
export class SocialGatewayService {
  constructor(
    @Inject(NAME_SERVICE_TCP.SOCIAL_SERVICE)
    private readonly socialClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
  ) {}

  private async fetchAuthorMap(
    userIds: number[],
  ): Promise<Map<number, UserInfo>> {
    if (userIds.length === 0) return new Map();
    try {
      const users = await firstValueFrom(
        this.userClient
          .send({ cmd: USER_MESSAGE_PATTERN.GET_USERS_BY_IDS }, userIds)
          .pipe(timeout(10000)) as Observable<UserInfo[]>,
      );
      return new Map(
        users.map((u) => [
          u.id,
          { id: u.id, username: u.username, avatar: u.avatar },
        ]),
      );
    } catch {
      return new Map();
    }
  }

  async createPost(
    userId: number,
    content: string,
    imageUrls?: string[],
    videoUrl?: string,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.CREATE_POST, {
            userId,
            content,
            imageUrls: imageUrls ?? null,
            videoUrl: videoUrl ?? null,
          })
          .pipe(timeout(10000)) as Observable<unknown>,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "create post",
        "Social Service",
      );
    }
  }

  async getPosts(
    page: number,
    limit: number,
    viewerUserId?: number | null,
  ): Promise<unknown> {
    try {
      const result = (await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.GET_POSTS, {
            page,
            limit,
            viewerUserId: viewerUserId ?? null,
          })
          .pipe(timeout(10000)) as Observable<unknown>,
      )) as {
        data: Array<{ userId: number }>;
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        hasNext: boolean;
      };
      const authorMap = await this.fetchAuthorMap([
        ...new Set(result.data.map((p) => p.userId)),
      ]);
      return {
        ...result,
        data: result.data.map((p) => ({
          ...p,
          author: authorMap.get(p.userId) ?? null,
        })),
      };
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error ?? new Error("TCP call completed without emitting a value"),
        "get posts",
        "Social Service",
      );
    }
  }

  async getPostsByUser(
    userId: number,
    page: number,
    limit: number,
    viewerUserId?: number | null,
  ): Promise<unknown> {
    try {
      const result = (await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.GET_POSTS_BY_USER, {
            userId,
            page,
            limit,
            viewerUserId: viewerUserId ?? null,
          })
          .pipe(timeout(10000)) as Observable<unknown>,
      )) as {
        data: Array<{ userId: number }>;
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        hasNext: boolean;
      };
      const authorMap = await this.fetchAuthorMap([
        ...new Set(result.data.map((p) => p.userId)),
      ]);
      return {
        ...result,
        data: result.data.map((p) => ({
          ...p,
          author: authorMap.get(p.userId) ?? null,
        })),
      };
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get posts by user",
        "Social Service",
      );
    }
  }

  async getPostById(
    postId: number,
    viewerUserId?: number | null,
  ): Promise<unknown> {
    try {
      const post = (await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.GET_POST_BY_ID, {
            postId,
            viewerUserId: viewerUserId ?? null,
          })
          .pipe(timeout(10000)) as Observable<unknown>,
      )) as { userId: number };
      const authorMap = await this.fetchAuthorMap([post.userId]);
      return { ...post, author: authorMap.get(post.userId) ?? null };
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get post by id",
        "Social Service",
      );
    }
  }

  async deletePost(postId: number, userId: number): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.DELETE_POST, { postId, userId })
          .pipe(timeout(10000)) as Observable<unknown>,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "delete post",
        "Social Service",
      );
    }
  }

  async likePost(postId: number, userId: number): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.LIKE_POST, { postId, userId })
          .pipe(timeout(10000)) as Observable<unknown>,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "like post",
        "Social Service",
      );
    }
  }

  async unlikePost(postId: number, userId: number): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.UNLIKE_POST, { postId, userId })
          .pipe(timeout(10000)) as Observable<unknown>,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "unlike post",
        "Social Service",
      );
    }
  }

  async createComment(
    postId: number,
    userId: number,
    content: string,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.CREATE_COMMENT, {
            postId,
            userId,
            content,
          })
          .pipe(timeout(10000)) as Observable<unknown>,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "create comment",
        "Social Service",
      );
    }
  }

  async getComments(
    postId: number,
    page: number,
    limit: number,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.GET_COMMENTS, { postId, page, limit })
          .pipe(timeout(10000)) as Observable<unknown>,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get comments",
        "Social Service",
      );
    }
  }

  async deleteComment(commentId: number, userId: number): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.DELETE_COMMENT, { commentId, userId })
          .pipe(timeout(10000)) as Observable<unknown>,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "delete comment",
        "Social Service",
      );
    }
  }

  async createReply(
    postId: number,
    parentCommentId: number,
    userId: number,
    content: string,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.CREATE_REPLY, {
            postId,
            parentCommentId,
            userId,
            content,
          })
          .pipe(timeout(10000)) as Observable<unknown>,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "create reply",
        "Social Service",
      );
    }
  }

  async getReplies(commentId: number, depth?: number): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.GET_REPLIES, { commentId, depth })
          .pipe(timeout(10000)) as Observable<unknown>,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get replies",
        "Social Service",
      );
    }
  }

  async followUser(followerId: number, followingId: number): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.FOLLOW_USER, { followerId, followingId })
          .pipe(timeout(10000)) as Observable<unknown>,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "follow user",
        "Social Service",
      );
    }
  }

  async unfollowUser(
    followerId: number,
    followingId: number,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.UNFOLLOW_USER, {
            followerId,
            followingId,
          })
          .pipe(timeout(10000)) as Observable<unknown>,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "unfollow user",
        "Social Service",
      );
    }
  }

  async getFollowers(
    userId: number,
    page: number,
    limit: number,
  ): Promise<unknown> {
    try {
      const result = (await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.GET_FOLLOWERS, { userId, page, limit })
          .pipe(timeout(10000)) as Observable<unknown>,
      )) as {
        data: Array<{ followerId: number }>;
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        hasNext: boolean;
      };
      const authorMap = await this.fetchAuthorMap([
        ...new Set(result.data.map((r) => r.followerId)),
      ]);
      return {
        ...result,
        data: result.data.map((r) => ({
          ...r,
          user: authorMap.get(r.followerId) ?? null,
        })),
      };
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get followers",
        "Social Service",
      );
    }
  }

  async getFollowing(
    userId: number,
    page: number,
    limit: number,
  ): Promise<unknown> {
    try {
      const result = (await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.GET_FOLLOWING, { userId, page, limit })
          .pipe(timeout(10000)) as Observable<unknown>,
      )) as {
        data: Array<{ followingId: number }>;
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        hasNext: boolean;
      };
      const authorMap = await this.fetchAuthorMap([
        ...new Set(result.data.map((r) => r.followingId)),
      ]);
      return {
        ...result,
        data: result.data.map((r) => ({
          ...r,
          user: authorMap.get(r.followingId) ?? null,
        })),
      };
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get following",
        "Social Service",
      );
    }
  }

  async getFollowingFeed(
    userId: number,
    page: number,
    limit: number,
    viewerUserId?: number | null,
  ): Promise<unknown> {
    try {
      const result = (await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.GET_FOLLOWING_FEED, {
            userId,
            page,
            limit,
            viewerUserId: viewerUserId ?? null,
          })
          .pipe(timeout(10000)) as Observable<unknown>,
      )) as {
        data: Array<{ userId: number }>;
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        hasNext: boolean;
      };
      const authorMap = await this.fetchAuthorMap([
        ...new Set(result.data.map((p) => p.userId)),
      ]);
      return {
        ...result,
        data: result.data.map((p) => ({
          ...p,
          author: authorMap.get(p.userId) ?? null,
        })),
      };
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get following feed",
        "Social Service",
      );
    }
  }
}
