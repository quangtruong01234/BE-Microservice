import { Inject, Injectable } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, Observable, timeout } from "rxjs";
import { SOCIAL_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";

@Injectable()
export class SocialGatewayService {
  constructor(
    @Inject(NAME_SERVICE_TCP.SOCIAL_SERVICE)
    private readonly socialClient: ClientProxy,
  ) {}

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

  async getPosts(page: number, limit: number): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.GET_POSTS, { page, limit })
          .pipe(timeout(10000)) as Observable<unknown>,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get posts",
        "Social Service",
      );
    }
  }

  async getPostsByUser(
    userId: number,
    page: number,
    limit: number,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.GET_POSTS_BY_USER, {
            userId,
            page,
            limit,
          })
          .pipe(timeout(10000)) as Observable<unknown>,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get posts by user",
        "Social Service",
      );
    }
  }

  async getPostById(postId: number): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.GET_POST_BY_ID, postId)
          .pipe(timeout(10000)) as Observable<unknown>,
      );
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
}
