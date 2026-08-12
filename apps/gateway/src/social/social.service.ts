import { Inject, Injectable } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, Observable, timeout } from "rxjs";
import {
  SOCIAL_MESSAGE_PATTERN,
  USER_MESSAGE_PATTERN,
} from "libs/constant/message-pattern.constant";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";
import { retryOnTransportError } from "../common/exception/transport-error";
import { assertCloudinaryUrlsOwnedBy } from "../common/media/cloudinary-ownership";
import { CommentNode, UserInfo, UserInfoTcp } from "./social.types";
import { PRODUCT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-product.constant";
import { TCP_TIMEOUT_MS } from "libs/constant/tcp-timeout.constant";

@Injectable()
export class SocialGatewayService {
  constructor(
    @Inject(NAME_SERVICE_TCP.SOCIAL_SERVICE)
    private readonly socialClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.PRODUCT_SERVICE)
    private readonly productClient: ClientProxy,
  ) {}

  private async fetchAuthorMap(
    userIds: number[],
  ): Promise<Map<number, UserInfo>> {
    if (userIds.length === 0) return new Map();
    try {
      const users = await firstValueFrom(
        this.userClient
          .send({ cmd: USER_MESSAGE_PATTERN.GET_USERS_BY_IDS }, userIds)
          .pipe(
            timeout(TCP_TIMEOUT_MS.READ),
            retryOnTransportError(),
          ) as Observable<UserInfoTcp[]>,
      );
      // Map keys stay the internal numeric id (matches post.userId); the
      // embedded author `id` is the exposed opaque public id (PUBID-02).
      return new Map(
        users.map((u) => [
          u.id,
          {
            id: u.publicId ?? String(u.id),
            username: u.username,
            avatar: u.avatar,
          },
        ]),
      );
    } catch {
      return new Map();
    }
  }

  /**
   * SOCIAL-AUTHOR-01 — comments and replies carried only `userId`, so the FE
   * had nothing to render but the raw id ("Người dùng #usr_..."). Attach the
   * same `author` embed posts already return.
   *
   * Every author in the payload — including the whole reply tree — is resolved
   * in ONE user-service call, so this never becomes an N+1 over comments.
   * Handles all three comment shapes: the paginated list, the nested tree, and
   * a single freshly-created node.
   */
  private async attachCommentAuthors<T>(value: T): Promise<T> {
    if (!value || typeof value !== "object") return value;
    const container = value as { data?: unknown };
    const isPaginated = Array.isArray(container.data);
    const roots = isPaginated
      ? (container.data as CommentNode[])
      : [value as unknown as CommentNode];

    const userIds = new Set<number>();
    this.collectCommentAuthorIds(roots, userIds);
    const authorMap = await this.fetchAuthorMap([...userIds]);
    const decorated = this.decorateCommentNodes(roots, authorMap);

    return (
      isPaginated ? { ...container, data: decorated } : decorated[0]
    ) as T;
  }

  private collectCommentAuthorIds(
    nodes: CommentNode[],
    into: Set<number>,
  ): void {
    for (const node of nodes) {
      if (Number.isFinite(Number(node?.userId))) into.add(Number(node.userId));
      if (Array.isArray(node?.children)) {
        this.collectCommentAuthorIds(node.children, into);
      }
      // A freshly created reply embeds the comment it answers — same bug one
      // level up if it is left undecorated.
      if (node?.parent && typeof node.parent === "object") {
        this.collectCommentAuthorIds([node.parent], into);
      }
    }
  }

  private decorateCommentNodes(
    nodes: CommentNode[],
    authorMap: Map<number, UserInfo>,
  ): CommentNode[] {
    return nodes.map((node) => ({
      ...node,
      author: authorMap.get(Number(node?.userId)) ?? null,
      ...(Array.isArray(node?.children)
        ? { children: this.decorateCommentNodes(node.children, authorMap) }
        : {}),
      ...(node?.parent && typeof node.parent === "object"
        ? { parent: this.decorateCommentNodes([node.parent], authorMap)[0] }
        : {}),
    }));
  }

  private async resolveUserId(userId: string): Promise<number> {
    const user = await firstValueFrom(
      this.userClient
        .send<{
          id: number;
        }>({ cmd: USER_MESSAGE_PATTERN.GET_USER_INFO }, { userId })
        .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
    );
    return Number(user.id);
  }

  private async exposeReferences(value: unknown): Promise<unknown> {
    const productExposed = await this.exposeProductIds(value);
    const postIds = new Set<number>();
    const commentIds = new Set<number>();
    const userIds = new Set<number>();
    const postKeys = new Set(["postId"]);
    const commentKeys = new Set(["commentId", "parentCommentId", "replyId"]);
    const userKeys = new Set([
      "userId",
      "followerId",
      "followingId",
      "reporterId",
      "resolvedBy",
      "adminId",
      "actorId",
      "sellerId",
      "senderId",
      "otherUserId",
      "user1Id",
      "user2Id",
      "postOwnerId",
      "commenterId",
      "commentOwnerId",
      "replierId",
    ]);
    const collect = (nested: unknown): void => {
      if (Array.isArray(nested)) {
        nested.forEach(collect);
        return;
      }
      if (!nested || typeof nested !== "object") return;
      for (const [key, nestedValue] of Object.entries(
        nested as Record<string, unknown>,
      )) {
        if (nestedValue !== null && Number.isFinite(Number(nestedValue))) {
          const numericValue = Number(nestedValue);
          if (postKeys.has(key)) postIds.add(numericValue);
          if (commentKeys.has(key)) commentIds.add(numericValue);
          if (userKeys.has(key)) userIds.add(numericValue);
        }
        collect(nestedValue);
      }
    };
    collect(productExposed);
    const [posts, comments, users] = await Promise.all([
      postIds.size === 0
        ? Promise.resolve([])
        : firstValueFrom(
            this.socialClient
              .send<
                Array<{ id: number; publicId: string }>
              >(SOCIAL_MESSAGE_PATTERN.GET_POST_PUBLIC_IDS_BY_IDS, [...postIds])
              .pipe(timeout(TCP_TIMEOUT_MS.WRITE), retryOnTransportError()),
          ),
      commentIds.size === 0
        ? Promise.resolve([])
        : firstValueFrom(
            this.socialClient
              .send<
                Array<{ id: number; publicId: string }>
              >(SOCIAL_MESSAGE_PATTERN.GET_COMMENT_PUBLIC_IDS_BY_IDS, [...commentIds])
              .pipe(timeout(TCP_TIMEOUT_MS.WRITE), retryOnTransportError()),
          ),
      userIds.size === 0
        ? Promise.resolve(new Map<number, UserInfo>())
        : this.fetchAuthorMap([...userIds]),
    ]);
    const postPublicIdById = new Map(
      posts.map((post) => [Number(post.id), post.publicId]),
    );
    const commentPublicIdById = new Map(
      comments.map((comment) => [Number(comment.id), comment.publicId]),
    );
    const expose = (nested: unknown): unknown => {
      if (Array.isArray(nested)) return nested.map(expose);
      if (!nested || typeof nested !== "object") return nested;
      const raw = nested as Record<string, unknown>;
      const exposed: Record<string, unknown> = {};
      for (const [key, nestedValue] of Object.entries(raw)) {
        if (key === "publicId") continue;
        if (nestedValue !== null && postKeys.has(key)) {
          exposed[key] = postPublicIdById.get(Number(nestedValue)) ?? null;
        } else if (nestedValue !== null && commentKeys.has(key)) {
          exposed[key] = commentPublicIdById.get(Number(nestedValue)) ?? null;
        } else if (nestedValue !== null && userKeys.has(key)) {
          exposed[key] = users.get(Number(nestedValue))?.id ?? null;
        } else {
          exposed[key] = expose(nestedValue);
        }
      }
      if (typeof raw.publicId === "string" && raw.id !== undefined) {
        exposed.id = raw.publicId;
      }
      return exposed;
    };
    return expose(productExposed);
  }

  async createPost(
    userId: number,
    content: string,
    imageUrls?: string[],
    videoUrl?: string,
    productId?: string,
  ): Promise<unknown> {
    assertCloudinaryUrlsOwnedBy([...(imageUrls ?? []), videoUrl], userId);
    try {
      const internalProductId = productId
        ? await this.resolveProductId(productId)
        : null;
      return this.exposeReferences(
        await firstValueFrom(
          this.socialClient
            .send(SOCIAL_MESSAGE_PATTERN.CREATE_POST, {
              userId,
              content,
              imageUrls: imageUrls ?? null,
              videoUrl: videoUrl ?? null,
              productId: internalProductId,
            })
            .pipe(timeout(TCP_TIMEOUT_MS.WRITE)) as Observable<unknown>,
        ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "create post",
        "Social Service",
      );
    }
  }

  async updatePost(
    postId: string,
    userId: number,
    changes: {
      content?: string;
      imageUrls?: string[];
      videoUrl?: string;
      productId?: string;
    },
  ): Promise<unknown> {
    assertCloudinaryUrlsOwnedBy(
      [...(changes.imageUrls ?? []), changes.videoUrl],
      userId,
    );
    try {
      const internalProductId = changes.productId
        ? await this.resolveProductId(changes.productId)
        : changes.productId;
      return this.exposeReferences(
        await firstValueFrom(
          this.socialClient
            .send(SOCIAL_MESSAGE_PATTERN.UPDATE_POST, {
              postId,
              userId,
              ...changes,
              productId: internalProductId,
            })
            .pipe(timeout(TCP_TIMEOUT_MS.WRITE)) as Observable<unknown>,
        ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "update post",
        "Social Service",
      );
    }
  }

  private async resolveProductId(productId: string): Promise<number> {
    const product = await firstValueFrom(
      this.productClient
        .send<{
          id: number;
        }>(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_ID, productId)
        .pipe(timeout(TCP_TIMEOUT_MS.READ)),
    );
    return Number(product.id);
  }

  private async exposeProductIds(value: unknown): Promise<unknown> {
    const productIds = new Set<number>();
    const collect = (nested: unknown): void => {
      if (Array.isArray(nested)) {
        nested.forEach(collect);
        return;
      }
      if (!nested || typeof nested !== "object") return;
      for (const [key, nestedValue] of Object.entries(
        nested as Record<string, unknown>,
      )) {
        if (key === "productId" && nestedValue !== null) {
          productIds.add(Number(nestedValue));
        }
        collect(nestedValue);
      }
    };
    collect(value);
    if (productIds.size === 0) return value;
    const products = await firstValueFrom(
      this.productClient
        .send<
          { id: number; publicId: string | null }[]
        >(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_IDS, [...productIds])
        .pipe(timeout(TCP_TIMEOUT_MS.WRITE), retryOnTransportError()),
    );
    const publicIdById = new Map(
      products.map((product) => [Number(product.id), product.publicId]),
    );
    const expose = (nested: unknown): unknown => {
      if (Array.isArray(nested)) return nested.map(expose);
      if (!nested || typeof nested !== "object") return nested;
      return Object.fromEntries(
        Object.entries(nested as Record<string, unknown>).map(
          ([key, nestedValue]) => [
            key,
            key === "productId" && nestedValue !== null
              ? (publicIdById.get(Number(nestedValue)) ?? null)
              : expose(nestedValue),
          ],
        ),
      );
    };
    return expose(value);
  }

  async reportPost(
    postId: string,
    reporterId: number,
    reason: string,
  ): Promise<unknown> {
    try {
      return this.exposeReferences(
        await firstValueFrom(
          this.socialClient
            .send(SOCIAL_MESSAGE_PATTERN.REPORT_POST, {
              postId,
              reporterId,
              reason,
            })
            .pipe(timeout(TCP_TIMEOUT_MS.WRITE)) as Observable<unknown>,
        ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "report post",
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
          .pipe(
            timeout(TCP_TIMEOUT_MS.READ),
            retryOnTransportError(),
          ) as Observable<unknown>,
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
      return this.exposeReferences({
        ...result,
        data: result.data.map((p) => ({
          ...p,
          author: authorMap.get(p.userId) ?? null,
        })),
      });
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error ?? new Error("TCP call completed without emitting a value"),
        "get posts",
        "Social Service",
      );
    }
  }

  async getPostsByUser(
    userId: string,
    page: number,
    limit: number,
    viewerUserId?: number | null,
  ): Promise<unknown> {
    try {
      const internalUserId = await this.resolveUserId(userId);
      const result = (await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.GET_POSTS_BY_USER, {
            userId: internalUserId,
            page,
            limit,
            viewerUserId: viewerUserId ?? null,
          })
          .pipe(
            timeout(TCP_TIMEOUT_MS.READ),
            retryOnTransportError(),
          ) as Observable<unknown>,
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
      return this.exposeReferences({
        ...result,
        data: result.data.map((p) => ({
          ...p,
          author: authorMap.get(p.userId) ?? null,
        })),
      });
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get posts by user",
        "Social Service",
      );
    }
  }

  async getPostById(
    postId: string,
    viewerUserId?: number | null,
  ): Promise<unknown> {
    try {
      const post = (await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.GET_POST_BY_ID, {
            postId,
            viewerUserId: viewerUserId ?? null,
          })
          .pipe(
            timeout(TCP_TIMEOUT_MS.READ),
            retryOnTransportError(),
          ) as Observable<unknown>,
      )) as { userId: number };
      const authorMap = await this.fetchAuthorMap([post.userId]);
      return this.exposeReferences({
        ...post,
        author: authorMap.get(post.userId) ?? null,
      });
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get post by id",
        "Social Service",
      );
    }
  }

  async deletePost(postId: string, userId: number): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.DELETE_POST, { postId, userId })
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE)) as Observable<unknown>,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "delete post",
        "Social Service",
      );
    }
  }

  async likePost(postId: string, userId: number): Promise<unknown> {
    try {
      return this.exposeReferences(
        await firstValueFrom(
          this.socialClient
            .send(SOCIAL_MESSAGE_PATTERN.LIKE_POST, { postId, userId })
            .pipe(timeout(TCP_TIMEOUT_MS.WRITE)) as Observable<unknown>,
        ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "like post",
        "Social Service",
      );
    }
  }

  async unlikePost(postId: string, userId: number): Promise<unknown> {
    try {
      return this.exposeReferences(
        await firstValueFrom(
          this.socialClient
            .send(SOCIAL_MESSAGE_PATTERN.UNLIKE_POST, { postId, userId })
            .pipe(timeout(TCP_TIMEOUT_MS.WRITE)) as Observable<unknown>,
        ),
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
    postId: string,
    userId: number,
    content: string,
  ): Promise<unknown> {
    try {
      return this.exposeReferences(
        await this.attachCommentAuthors(
          await firstValueFrom(
            this.socialClient
              .send(SOCIAL_MESSAGE_PATTERN.CREATE_COMMENT, {
                postId,
                userId,
                content,
              })
              .pipe(timeout(TCP_TIMEOUT_MS.WRITE)) as Observable<unknown>,
          ),
        ),
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
    postId: string,
    page: number,
    limit: number,
  ): Promise<unknown> {
    try {
      return this.exposeReferences(
        await this.attachCommentAuthors(
          await firstValueFrom(
            this.socialClient
              .send(SOCIAL_MESSAGE_PATTERN.GET_COMMENTS, {
                postId,
                page,
                limit,
              })
              .pipe(timeout(TCP_TIMEOUT_MS.READ)) as Observable<unknown>,
          ),
        ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get comments",
        "Social Service",
      );
    }
  }

  async deleteComment(commentId: string, userId: number): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.DELETE_COMMENT, { commentId, userId })
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE)) as Observable<unknown>,
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
    postId: string,
    parentCommentId: string,
    userId: number,
    content: string,
  ): Promise<unknown> {
    try {
      return this.exposeReferences(
        await this.attachCommentAuthors(
          await firstValueFrom(
            this.socialClient
              .send(SOCIAL_MESSAGE_PATTERN.CREATE_REPLY, {
                postId,
                parentCommentId,
                userId,
                content,
              })
              .pipe(timeout(TCP_TIMEOUT_MS.WRITE)) as Observable<unknown>,
          ),
        ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "create reply",
        "Social Service",
      );
    }
  }

  async getReplies(commentId: string, depth?: number): Promise<unknown> {
    try {
      return this.exposeReferences(
        await this.attachCommentAuthors(
          await firstValueFrom(
            this.socialClient
              .send(SOCIAL_MESSAGE_PATTERN.GET_REPLIES, { commentId, depth })
              .pipe(timeout(TCP_TIMEOUT_MS.READ)) as Observable<unknown>,
          ),
        ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get replies",
        "Social Service",
      );
    }
  }

  async followUser(followerId: number, followingId: string): Promise<unknown> {
    try {
      const internalFollowingId = await this.resolveUserId(followingId);
      return this.exposeReferences(
        await firstValueFrom(
          this.socialClient
            .send(SOCIAL_MESSAGE_PATTERN.FOLLOW_USER, {
              followerId,
              followingId: internalFollowingId,
            })
            .pipe(timeout(TCP_TIMEOUT_MS.WRITE)) as Observable<unknown>,
        ),
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
    followingId: string,
  ): Promise<unknown> {
    try {
      const internalFollowingId = await this.resolveUserId(followingId);
      return this.exposeReferences(
        await firstValueFrom(
          this.socialClient
            .send(SOCIAL_MESSAGE_PATTERN.UNFOLLOW_USER, {
              followerId,
              followingId: internalFollowingId,
            })
            .pipe(timeout(TCP_TIMEOUT_MS.WRITE)) as Observable<unknown>,
        ),
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
    userId: string,
    page: number,
    limit: number,
  ): Promise<unknown> {
    try {
      const internalUserId = await this.resolveUserId(userId);
      const result = (await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.GET_FOLLOWERS, {
            userId: internalUserId,
            page,
            limit,
          })
          .pipe(timeout(TCP_TIMEOUT_MS.READ)) as Observable<unknown>,
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
      return this.exposeReferences({
        ...result,
        data: result.data.map((r) => ({
          ...r,
          user: authorMap.get(r.followerId) ?? null,
        })),
      });
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get followers",
        "Social Service",
      );
    }
  }

  async getFollowing(
    userId: string,
    page: number,
    limit: number,
  ): Promise<unknown> {
    try {
      const internalUserId = await this.resolveUserId(userId);
      const result = (await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.GET_FOLLOWING, {
            userId: internalUserId,
            page,
            limit,
          })
          .pipe(timeout(TCP_TIMEOUT_MS.READ)) as Observable<unknown>,
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
      return this.exposeReferences({
        ...result,
        data: result.data.map((r) => ({
          ...r,
          user: authorMap.get(r.followingId) ?? null,
        })),
      });
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get following",
        "Social Service",
      );
    }
  }

  async getFollowingFeed(
    userId: string,
    page: number,
    limit: number,
    viewerUserId?: number | null,
  ): Promise<unknown> {
    try {
      const internalUserId = await this.resolveUserId(userId);
      const result = (await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.GET_FOLLOWING_FEED, {
            userId: internalUserId,
            page,
            limit,
            viewerUserId: viewerUserId ?? null,
          })
          .pipe(
            timeout(TCP_TIMEOUT_MS.READ),
            retryOnTransportError(),
          ) as Observable<unknown>,
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
      return this.exposeReferences({
        ...result,
        data: result.data.map((p) => ({
          ...p,
          author: authorMap.get(p.userId) ?? null,
        })),
      });
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get following feed",
        "Social Service",
      );
    }
  }

  // ── Moderation (admin) ──────────────────────────────────────────────

  async listReportedPosts(
    status: "pending" | "resolved" | "dismissed" | undefined,
    page: number,
    limit: number,
  ): Promise<unknown> {
    try {
      const result = (await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.ADMIN_LIST_REPORTED_POSTS, {
            status,
            page,
            limit,
          })
          .pipe(timeout(TCP_TIMEOUT_MS.READ)) as Observable<unknown>,
      )) as {
        data: Array<{ post: { userId: number } }>;
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        hasNext: boolean;
      };
      const authorMap = await this.fetchAuthorMap([
        ...new Set(result.data.map((entry) => entry.post.userId)),
      ]);
      return this.exposeReferences({
        ...result,
        data: result.data.map((entry) => ({
          ...entry,
          post: {
            ...entry.post,
            author: authorMap.get(entry.post.userId) ?? null,
          },
        })),
      });
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "list reported posts",
        "Social Service",
      );
    }
  }

  async hidePost(postId: string, adminId: number): Promise<unknown> {
    try {
      return this.exposeReferences(
        await firstValueFrom(
          this.socialClient
            .send(SOCIAL_MESSAGE_PATTERN.ADMIN_HIDE_POST, { postId, adminId })
            .pipe(timeout(TCP_TIMEOUT_MS.WRITE)) as Observable<unknown>,
        ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "hide post",
        "Social Service",
      );
    }
  }

  async unhidePost(postId: string): Promise<unknown> {
    try {
      return this.exposeReferences(
        await firstValueFrom(
          this.socialClient
            .send(SOCIAL_MESSAGE_PATTERN.ADMIN_UNHIDE_POST, { postId })
            .pipe(timeout(TCP_TIMEOUT_MS.WRITE)) as Observable<unknown>,
        ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "unhide post",
        "Social Service",
      );
    }
  }

  async dismissReports(postId: string, adminId: number): Promise<unknown> {
    try {
      return this.exposeReferences(
        await firstValueFrom(
          this.socialClient
            .send(SOCIAL_MESSAGE_PATTERN.ADMIN_DISMISS_REPORTS, {
              postId,
              adminId,
            })
            .pipe(timeout(TCP_TIMEOUT_MS.WRITE)) as Observable<unknown>,
        ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "dismiss reports",
        "Social Service",
      );
    }
  }

  async adminDeletePost(postId: string): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.socialClient
          .send(SOCIAL_MESSAGE_PATTERN.ADMIN_DELETE_POST, { postId })
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE)) as Observable<unknown>,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "admin delete post",
        "Social Service",
      );
    }
  }
}
