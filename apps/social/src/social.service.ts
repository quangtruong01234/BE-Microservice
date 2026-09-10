import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import {
  DataSource,
  In,
  IsNull,
  QueryFailedError,
  Repository,
  TreeRepository,
} from "typeorm";
import { Channel } from "amqplib";
import { CachedService } from "@app/cached";
import {
  CloudinaryService,
  isRmqPublisherLive,
  PaginatedResponse,
} from "@app/common";
import { generatePublicId } from "@app/common";
import { EXCHANGE } from "@app/common/constants/exchange";
import { EVENT } from "@app/common/constants/event";
import { Post } from "./entities/post.entity";
import { PostLike } from "./entities/post-like.entity";
import { PostReport } from "./entities/post-report.entity";
import { Comment } from "./entities/comment.entity";
import { Follow } from "./entities/follow.entity";
import { SOCIAL_MESSAGE } from "libs/constant/response-message.constant";
import { NOTIFICATION_PREVIEW_MAX_LENGTH } from "./social.constants";
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";

@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);
  private readonly brokenLegacyImageUrlMarkers = [
    "/trybuy/posts/trybuy/posts/",
    "/undefined_",
  ];

  constructor(
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
    @InjectRepository(PostLike)
    private readonly postLikeRepository: Repository<PostLike>,
    @InjectRepository(PostReport)
    private readonly postReportRepository: Repository<PostReport>,
    @InjectRepository(Comment)
    private readonly commentRepository: Repository<Comment>,
    @InjectRepository(Follow)
    private readonly followRepository: Repository<Follow>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly cachedService: CachedService,
    private readonly cloudinaryService: CloudinaryService,
    @Inject(EXCHANGE.RMQ_PUBLISHER_CHANNEL)
    private readonly fanoutChannel: Channel | null,
  ) {}

  async resolvePostId(postId: number | string): Promise<number> {
    if (typeof postId === "number") return postId;
    const post = await this.postRepository.findOne({
      where: { publicId: postId },
      select: ["id"],
    });
    if (!post) {
      throw new NotFoundException(SOCIAL_MESSAGE.POST_NOT_FOUND);
    }
    return post.id;
  }

  async resolveCommentId(commentId: number | string): Promise<number> {
    if (typeof commentId === "number") return commentId;
    const comment = await this.commentRepository.findOne({
      where: { publicId: commentId },
      select: ["id"],
    });
    if (!comment) {
      throw new NotFoundException(SOCIAL_MESSAGE.COMMENT_NOT_FOUND);
    }
    return comment.id;
  }

  async getPostPublicIdsByIds(
    postIds: number[],
  ): Promise<Array<{ id: number; publicId: string }>> {
    if (postIds.length === 0) return [];
    return this.postRepository.find({
      where: { id: In(postIds) },
      select: ["id", "publicId"],
    });
  }

  async getCommentPublicIdsByIds(
    commentIds: number[],
  ): Promise<Array<{ id: number; publicId: string }>> {
    if (commentIds.length === 0) return [];
    return this.commentRepository.find({
      where: { id: In(commentIds) },
      select: ["id", "publicId"],
    });
  }

  private collectPostMediaUrls(post: Post): string[] {
    return [...(post.imageUrls ?? []), post.videoUrl].filter(
      (mediaUrl): mediaUrl is string => Boolean(mediaUrl),
    );
  }

  // Fire-and-forget post-commit cleanup — destroyAssets never throws, so a
  // Cloudinary failure can never fail the post mutation that triggered it.
  private destroyDroppedMedia(oldUrls: string[], keptUrls: string[]): void {
    const keptUrlSet = new Set(keptUrls);
    const droppedUrls = oldUrls.filter((mediaUrl) => !keptUrlSet.has(mediaUrl));
    if (droppedUrls.length === 0) return;
    void this.destroyUnreferencedMedia(droppedUrls);
  }

  /**
   * `imageUrls` is client-supplied, so the same uploaded URL can legitimately
   * sit on more than one post (a re-post, or the same photo attached twice).
   * Destroying on the first edit/delete would then 404 the image on every other
   * post still showing it — an asset is only orphaned once NO row references it.
   * Callers run this after their own commit, so the edited/deleted row can no
   * longer match itself.
   */
  private async destroyUnreferencedMedia(droppedUrls: string[]): Promise<void> {
    try {
      const stillReferenced = await Promise.all(
        droppedUrls.map((mediaUrl) =>
          this.postRepository
            .createQueryBuilder("post")
            .where("post.videoUrl = :mediaUrl", { mediaUrl })
            .orWhere("JSON_CONTAINS(post.image_urls, JSON_QUOTE(:mediaUrl))", {
              mediaUrl,
            })
            .limit(1)
            .getCount(),
        ),
      );
      const orphanedUrls = droppedUrls.filter(
        (_, index) => stillReferenced[index] === 0,
      );
      if (orphanedUrls.length === 0) return;
      await this.cloudinaryService.destroyAssets(orphanedUrls);
    } catch (err: unknown) {
      // Cleanup is best-effort: a failed reference check must never destroy
      // anything, and must never surface on the mutation that triggered it.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Skipped Cloudinary cleanup — ${message}`);
    }
  }

  private get treeRepo(): TreeRepository<Comment> {
    return this.dataSource.getTreeRepository(Comment);
  }

  private isBrokenLegacyPostImageUrl(imageUrl: string): boolean {
    return this.brokenLegacyImageUrlMarkers.some((marker) =>
      imageUrl.includes(marker),
    );
  }

  private sanitizePostImageUrls(post: Post): Post {
    if (!post.imageUrls || post.imageUrls.length === 0) return post;
    const validImageUrls = post.imageUrls.filter(
      (imageUrl) => !this.isBrokenLegacyPostImageUrl(imageUrl),
    );
    if (validImageUrls.length === post.imageUrls.length) return post;
    return { ...post, imageUrls: validImageUrls };
  }

  private async resolveIsLiked(
    postId: number,
    viewerUserId: number | null | undefined,
  ): Promise<boolean> {
    if (!viewerUserId) return false;
    const cached = await this.cachedService.get(
      `post:liked:${postId}:${viewerUserId}`,
    );
    if (cached !== null) return cached === "1";
    const exists = await this.postLikeRepository.findOne({
      where: { postId, userId: viewerUserId },
    });
    const isLiked = exists !== null;
    await this.cachedService.set(
      `post:liked:${postId}:${viewerUserId}`,
      isLiked ? "1" : "0",
    );
    return isLiked;
  }

  /**
   * Batch like-count lookup (PERF-03): one Redis MGET for the whole page;
   * cache misses fall back to a single GROUP BY count query and are written
   * back per-key so single-post reads keep hitting the same keys.
   */
  private async resolveLikeCounts(
    postIds: number[],
  ): Promise<Map<number, number>> {
    const likeCountByPostId = new Map<number, number>();
    if (postIds.length === 0) return likeCountByPostId;
    const cachedCounts = await this.cachedService.mget(
      postIds.map((postId) => `post:like_count:${postId}`),
    );
    const missedPostIds: number[] = [];
    postIds.forEach((postId, i) => {
      const cached = cachedCounts[i];
      if (cached !== null && cached !== undefined) {
        likeCountByPostId.set(postId, parseInt(cached, 10));
      } else {
        missedPostIds.push(postId);
      }
    });
    if (missedPostIds.length > 0) {
      const countRows = await this.postLikeRepository
        .createQueryBuilder("pl")
        .select("pl.postId", "postId")
        .addSelect("COUNT(*)", "count")
        .where("pl.postId IN (:...postIds)", { postIds: missedPostIds })
        .groupBy("pl.postId")
        .getRawMany<{ postId: number; count: string }>();
      const dbCountByPostId = new Map<number, number>(
        countRows.map((row) => [Number(row.postId), parseInt(row.count, 10)]),
      );
      await Promise.all(
        missedPostIds.map((postId) => {
          const count = dbCountByPostId.get(postId) ?? 0;
          likeCountByPostId.set(postId, count);
          return this.cachedService.set(
            `post:like_count:${postId}`,
            count.toString(),
          );
        }),
      );
    }
    return likeCountByPostId;
  }

  /**
   * Batch isLiked lookup (PERF-03): one MGET over the viewer's liked flags;
   * misses resolve with a single In(postIds) query and write back per-key
   * (same keys as resolveIsLiked, so single-post reads stay consistent).
   */
  private async resolveLikedPostIds(
    postIds: number[],
    viewerUserId: number | null | undefined,
  ): Promise<Set<number>> {
    const likedPostIds = new Set<number>();
    if (!viewerUserId || postIds.length === 0) return likedPostIds;
    const cachedFlags = await this.cachedService.mget(
      postIds.map((postId) => `post:liked:${postId}:${viewerUserId}`),
    );
    const missedPostIds: number[] = [];
    postIds.forEach((postId, i) => {
      const cached = cachedFlags[i];
      if (cached === "1") {
        likedPostIds.add(postId);
      } else if (cached === null || cached === undefined) {
        missedPostIds.push(postId);
      }
    });
    if (missedPostIds.length > 0) {
      const likeRows = await this.postLikeRepository.find({
        where: { postId: In(missedPostIds), userId: viewerUserId },
        select: ["postId"],
      });
      const likedMissSet = new Set(likeRows.map((row) => row.postId));
      await Promise.all(
        missedPostIds.map((postId) => {
          const isLiked = likedMissSet.has(postId);
          if (isLiked) likedPostIds.add(postId);
          return this.cachedService.set(
            `post:liked:${postId}:${viewerUserId}`,
            isLiked ? "1" : "0",
          );
        }),
      );
    }
    return likedPostIds;
  }

  /**
   * Batch comment counts (PERF-03): one GROUP BY query for the whole page
   * instead of N COUNT queries. Replies carry the same postId, so totals
   * match the previous per-post count() behavior.
   */
  private async resolveCommentCounts(
    postIds: number[],
  ): Promise<Map<number, number>> {
    if (postIds.length === 0) return new Map<number, number>();
    const countRows = await this.commentRepository
      .createQueryBuilder("c")
      .select("c.postId", "postId")
      .addSelect("COUNT(*)", "count")
      .where("c.postId IN (:...postIds)", { postIds })
      .groupBy("c.postId")
      .getRawMany<{ postId: number; count: string }>();
    return new Map<number, number>(
      countRows.map((row) => [Number(row.postId), parseInt(row.count, 10)]),
    );
  }

  /**
   * Decorate a page of posts with likeCount / isLiked / commentCount using
   * the batched lookups above. Shared by the three feed reads.
   */
  private async decoratePosts(
    posts: Post[],
    viewerUserId: number | null | undefined,
  ): Promise<
    (Post & { likeCount: number; isLiked: boolean; commentCount: number })[]
  > {
    if (posts.length === 0) return [];
    const postIds = posts.map((post) => post.id);
    const [likeCountByPostId, likedPostIds, commentCountByPostId] =
      await Promise.all([
        this.resolveLikeCounts(postIds),
        this.resolveLikedPostIds(postIds, viewerUserId),
        this.resolveCommentCounts(postIds),
      ]);
    return posts.map((post) => {
      const sanitizedPost = this.sanitizePostImageUrls(post);
      return {
        ...sanitizedPost,
        likeCount: likeCountByPostId.get(post.id) ?? 0,
        isLiked: likedPostIds.has(post.id),
        commentCount: commentCountByPostId.get(post.id) ?? 0,
      };
    });
  }

  async createPost(payload: {
    userId: number;
    content: string;
    imageUrls?: string[] | null;
    videoUrl?: string | null;
    productId?: number | null;
  }): Promise<Post> {
    const post = this.postRepository.create({
      publicId: generatePublicId(PUBLIC_ID_PREFIXES.POST),
      userId: payload.userId,
      content: payload.content,
      imageUrls: payload.imageUrls ?? null,
      videoUrl: payload.videoUrl ?? null,
      productId: payload.productId ?? null,
    });
    return this.postRepository.save(post);
  }

  async updatePost(payload: {
    postId: number;
    userId: number;
    content?: string;
    imageUrls?: string[] | null;
    videoUrl?: string | null;
    productId?: number | null;
  }): Promise<Post> {
    const post = await this.postRepository.findOne({
      where: { id: payload.postId },
    });
    if (!post) {
      throw new NotFoundException(SOCIAL_MESSAGE.POST_NOT_FOUND);
    }
    if (post.userId !== payload.userId) {
      throw new ForbiddenException(SOCIAL_MESSAGE.EDIT_OWN_POSTS_ONLY);
    }
    const previousMediaUrls = this.collectPostMediaUrls(post);
    // Only overwrite fields the caller actually sent — undefined means "leave as-is".
    if (payload.content !== undefined) post.content = payload.content;
    if (payload.imageUrls !== undefined) post.imageUrls = payload.imageUrls;
    if (payload.videoUrl !== undefined) post.videoUrl = payload.videoUrl;
    if (payload.productId !== undefined) post.productId = payload.productId;
    const savedPost = await this.postRepository.save(post);
    // SEC-M7: dropped media is orphaned on Cloudinary once the edit commits.
    this.destroyDroppedMedia(
      previousMediaUrls,
      this.collectPostMediaUrls(savedPost),
    );
    return savedPost;
  }

  async reportPost(payload: {
    postId: number;
    reporterId: number;
    reason: string;
  }): Promise<{ reported: boolean; postId: number }> {
    const post = await this.postRepository.findOne({
      where: { id: payload.postId },
    });
    if (!post) {
      throw new NotFoundException(SOCIAL_MESSAGE.POST_NOT_FOUND);
    }
    if (post.userId === payload.reporterId) {
      throw new BadRequestException(SOCIAL_MESSAGE.CANNOT_REPORT_OWN_POST);
    }
    try {
      await this.postReportRepository.save(
        this.postReportRepository.create({
          postId: payload.postId,
          reporterId: payload.reporterId,
          reason: payload.reason,
        }),
      );
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        ((err.driverError as { code?: string })?.code === "ER_DUP_ENTRY" ||
          (err.driverError as { code?: string })?.code === "23505")
      ) {
        throw new ConflictException(SOCIAL_MESSAGE.ALREADY_REPORTED_POST);
      }
      throw err;
    }
    return { reported: true, postId: payload.postId };
  }

  async getPosts(payload: {
    page: number;
    limit: number;
    viewerUserId?: number | null;
  }): Promise<
    PaginatedResponse<
      Post & { likeCount: number; isLiked: boolean; commentCount: number }
    >
  > {
    const { page, limit, viewerUserId } = payload;
    try {
      const [posts, total] = await this.postRepository.findAndCount({
        where: { isHidden: false },
        order: { createdAt: "DESC" },
        skip: (page - 1) * limit,
        take: limit,
      });
      return PaginatedResponse.of(
        await this.decoratePosts(posts, viewerUserId),
        total,
        page,
        limit,
      );
    } catch (err) {
      this.logger.error(
        `getPosts failed — page=${page} limit=${limit} viewerUserId=${viewerUserId ?? "null"}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    }
  }

  async getPostsByUser(payload: {
    userId: number;
    page: number;
    limit: number;
    viewerUserId?: number | null;
  }): Promise<
    PaginatedResponse<
      Post & { likeCount: number; isLiked: boolean; commentCount: number }
    >
  > {
    const { userId, page, limit, viewerUserId } = payload;
    const [posts, total] = await this.postRepository.findAndCount({
      where: { userId, isHidden: false },
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return PaginatedResponse.of(
      await this.decoratePosts(posts, viewerUserId),
      total,
      page,
      limit,
    );
  }

  async getPostById(
    postId: number,
    viewerUserId?: number | null,
  ): Promise<
    Post & { likeCount: number; isLiked: boolean; commentCount: number }
  > {
    const post = await this.postRepository.findOne({ where: { id: postId } });
    if (!post || post.isHidden) {
      throw new NotFoundException(SOCIAL_MESSAGE.POST_NOT_FOUND);
    }
    const cacheKey = `post:like_count:${postId}`;
    const cached = await this.cachedService.get(cacheKey);
    let likeCount: number;
    if (cached === null) {
      likeCount = await this.postLikeRepository.count({
        where: { postId },
      });
      await this.cachedService.set(cacheKey, likeCount.toString());
    } else {
      likeCount = parseInt(cached, 10);
    }
    const [isLiked, commentCount] = await Promise.all([
      this.resolveIsLiked(postId, viewerUserId),
      this.commentRepository.count({ where: { postId } }),
    ]);
    return {
      ...this.sanitizePostImageUrls(post),
      likeCount,
      isLiked,
      commentCount,
    };
  }

  async likePost(payload: {
    postId: number;
    userId: number;
  }): Promise<{ liked: boolean; postId: number; likeCount: number }> {
    try {
      await this.postLikeRepository.save(
        this.postLikeRepository.create({
          postId: payload.postId,
          userId: payload.userId,
        }),
      );
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        ((err.driverError as { code?: string })?.code === "ER_DUP_ENTRY" ||
          (err.driverError as { code?: string })?.code === "23505")
      ) {
        throw new ConflictException(SOCIAL_MESSAGE.ALREADY_LIKED);
      }
      throw err;
    }
    const [newCount] = await Promise.all([
      this.cachedService.incr(`post:like_count:${payload.postId}`),
      this.cachedService.set(
        `post:liked:${payload.postId}:${payload.userId}`,
        "1",
      ),
    ]);
    return { liked: true, postId: payload.postId, likeCount: newCount };
  }

  async unlikePost(payload: {
    postId: number;
    userId: number;
  }): Promise<{ liked: boolean; postId: number; likeCount: number }> {
    const result = await this.postLikeRepository.delete({
      postId: payload.postId,
      userId: payload.userId,
    });
    if (result.affected === 0) {
      throw new NotFoundException(SOCIAL_MESSAGE.LIKE_NOT_FOUND);
    }
    const [newCount] = await Promise.all([
      this.cachedService.decr(`post:like_count:${payload.postId}`),
      this.cachedService.del(`post:liked:${payload.postId}:${payload.userId}`),
    ]);
    return {
      liked: false,
      postId: payload.postId,
      likeCount: Math.max(0, newCount),
    };
  }

  async deletePost(payload: {
    postId: number;
    userId: number;
  }): Promise<{ success: boolean }> {
    const post = await this.postRepository.findOne({
      where: { id: payload.postId },
    });
    if (!post) {
      throw new NotFoundException(SOCIAL_MESSAGE.POST_NOT_FOUND);
    }
    if (post.userId !== payload.userId) {
      throw new ForbiddenException(SOCIAL_MESSAGE.DELETE_OWN_POSTS_ONLY);
    }
    const removedMediaUrls = this.collectPostMediaUrls(post);
    await this.postRepository.remove(post);
    this.destroyDroppedMedia(removedMediaUrls, []);
    return { success: true };
  }

  async createComment(payload: {
    postId: number;
    userId: number;
    content: string;
  }): Promise<Comment> {
    const post = await this.postRepository.findOne({
      where: { id: payload.postId },
    });
    if (!post) {
      throw new NotFoundException(SOCIAL_MESSAGE.POST_NOT_FOUND);
    }
    const comment = this.commentRepository.create({
      publicId: generatePublicId(PUBLIC_ID_PREFIXES.COMMENT),
      postId: payload.postId,
      userId: payload.userId,
      content: payload.content,
    });
    const saved = await this.commentRepository.save(comment);
    if (payload.userId !== post.userId) {
      if (this.fanoutChannel && isRmqPublisherLive(this.fanoutChannel)) {
        this.fanoutChannel.publish(
          EXCHANGE.SOCIAL_EXCHANGE,
          EVENT.COMMENT_CREATED_EVENT,
          Buffer.from(
            JSON.stringify({
              data: {
                postId: payload.postId,
                postOwnerId: post.userId,
                commenterId: payload.userId,
                commentId: saved.id,
                preview: payload.content.slice(
                  0,
                  NOTIFICATION_PREVIEW_MAX_LENGTH,
                ),
              },
              pattern: EVENT.COMMENT_CREATED_EVENT,
            }),
          ),
        );
      } else {
        this.logger.warn(
          "[SOCIAL] fanoutChannel unavailable — comment notification skipped",
        );
      }
    }
    return saved;
  }

  async getComments(payload: {
    postId: number;
    page: number;
    limit: number;
  }): Promise<PaginatedResponse<Comment & { replyCount: number }>> {
    const { postId, page, limit } = payload;
    const [comments, total] = await this.commentRepository.findAndCount({
      where: { postId, parent: IsNull() },
      order: { createdAt: "ASC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    const replyCounts = await Promise.all(
      comments.map((c) => this.treeRepo.countDescendants(c)),
    );
    const data = comments.map((c, i) => ({
      ...c,
      replyCount: Math.max(0, (replyCounts[i] ?? 1) - 1),
    }));
    return PaginatedResponse.of(data, total, page, limit);
  }

  async deleteComment(payload: {
    commentId: number;
    userId: number;
  }): Promise<{ deleted: boolean }> {
    const comment = await this.commentRepository.findOne({
      where: { id: payload.commentId },
    });
    if (!comment) {
      throw new NotFoundException(SOCIAL_MESSAGE.COMMENT_NOT_FOUND);
    }
    if (comment.userId !== payload.userId) {
      throw new ForbiddenException(SOCIAL_MESSAGE.DELETE_OWN_COMMENTS_ONLY);
    }
    await this.commentRepository.remove(comment);
    return { deleted: true };
  }

  async createReply(payload: {
    postId: number;
    parentCommentId: number;
    userId: number;
    content: string;
  }): Promise<Comment> {
    const parentComment = await this.commentRepository.findOne({
      where: { id: payload.parentCommentId },
    });
    if (!parentComment) {
      throw new NotFoundException(SOCIAL_MESSAGE.COMMENT_NOT_FOUND);
    }
    const saved = await this.treeRepo.save(
      this.commentRepository.create({
        publicId: generatePublicId(PUBLIC_ID_PREFIXES.COMMENT),
        postId: payload.postId,
        userId: payload.userId,
        content: payload.content,
        parent: parentComment,
      }),
    );
    if (payload.userId !== parentComment.userId) {
      if (this.fanoutChannel && isRmqPublisherLive(this.fanoutChannel)) {
        this.fanoutChannel.publish(
          EXCHANGE.SOCIAL_EXCHANGE,
          EVENT.REPLY_CREATED_EVENT,
          Buffer.from(
            JSON.stringify({
              data: {
                postId: payload.postId,
                parentCommentId: payload.parentCommentId,
                commentOwnerId: parentComment.userId,
                replierId: payload.userId,
                replyId: saved.id,
                preview: payload.content.slice(
                  0,
                  NOTIFICATION_PREVIEW_MAX_LENGTH,
                ),
              },
              pattern: EVENT.REPLY_CREATED_EVENT,
            }),
          ),
        );
      } else {
        this.logger.warn(
          "[SOCIAL] fanoutChannel unavailable — reply notification skipped",
        );
      }
    }
    return saved;
  }

  async getReplies(payload: {
    commentId: number;
    depth?: number;
  }): Promise<Comment> {
    const comment = await this.commentRepository.findOne({
      where: { id: payload.commentId },
    });
    if (!comment) {
      throw new NotFoundException(SOCIAL_MESSAGE.COMMENT_NOT_FOUND);
    }
    return this.treeRepo.findDescendantsTree(comment, {
      depth: payload.depth ?? 5,
    });
  }

  async followUser(payload: {
    followerId: number;
    followingId: number;
  }): Promise<{ followed: boolean; followingId: number }> {
    if (payload.followerId === payload.followingId) {
      throw new BadRequestException(SOCIAL_MESSAGE.CANNOT_FOLLOW_SELF);
    }
    try {
      await this.followRepository.save(
        this.followRepository.create({
          followerId: payload.followerId,
          followingId: payload.followingId,
        }),
      );
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        ((err.driverError as { code?: string })?.code === "ER_DUP_ENTRY" ||
          (err.driverError as { code?: string })?.code === "23505")
      ) {
        throw new ConflictException(SOCIAL_MESSAGE.ALREADY_FOLLOWING);
      }
      throw err;
    }
    return { followed: true, followingId: payload.followingId };
  }

  async unfollowUser(payload: {
    followerId: number;
    followingId: number;
  }): Promise<{ followed: boolean; followingId: number }> {
    const result = await this.followRepository.delete({
      followerId: payload.followerId,
      followingId: payload.followingId,
    });
    if (result.affected === 0) {
      throw new NotFoundException(SOCIAL_MESSAGE.FOLLOW_NOT_FOUND);
    }
    return { followed: false, followingId: payload.followingId };
  }

  async getFollowers(payload: {
    userId: number;
    page: number;
    limit: number;
  }): Promise<PaginatedResponse<{ followerId: number; createdAt: Date }>> {
    const { userId, page, limit } = payload;
    const [rows, total] = await this.followRepository.findAndCount({
      where: { followingId: userId },
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return PaginatedResponse.of(
      rows.map((r) => ({ followerId: r.followerId, createdAt: r.createdAt })),
      total,
      page,
      limit,
    );
  }

  async getFollowing(payload: {
    userId: number;
    page: number;
    limit: number;
  }): Promise<PaginatedResponse<{ followingId: number; createdAt: Date }>> {
    const { userId, page, limit } = payload;
    const [rows, total] = await this.followRepository.findAndCount({
      where: { followerId: userId },
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return PaginatedResponse.of(
      rows.map((r) => ({ followingId: r.followingId, createdAt: r.createdAt })),
      total,
      page,
      limit,
    );
  }

  async getFollowingFeed(payload: {
    userId: number;
    page: number;
    limit: number;
    viewerUserId?: number | null;
  }): Promise<
    PaginatedResponse<
      Post & { likeCount: number; isLiked: boolean; commentCount: number }
    >
  > {
    const { userId, page, limit, viewerUserId } = payload;
    const following = await this.followRepository.find({
      where: { followerId: userId },
      select: ["followingId"],
    });
    if (following.length === 0) {
      return PaginatedResponse.of([], 0, page, limit);
    }
    const followingIds = following.map((f) => f.followingId);
    const [posts, total] = await this.postRepository.findAndCount({
      where: { userId: In(followingIds), isHidden: false },
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return PaginatedResponse.of(
      await this.decoratePosts(posts, viewerUserId),
      total,
      page,
      limit,
    );
  }

  // ── Moderation (admin) ──────────────────────────────────────────────

  async listReportedPosts(payload: {
    status?: "pending" | "resolved" | "dismissed";
    page: number;
    limit: number;
  }): Promise<
    PaginatedResponse<{
      post: Post;
      reportCount: number;
      pendingCount: number;
      latestReportedAt: Date;
      reports: Array<{
        id: number;
        reporterId: number;
        reason: string;
        status: "pending" | "resolved" | "dismissed";
        createdAt: Date;
      }>;
    }>
  > {
    const { status, page, limit } = payload;

    // `deletePost` hard-removes the post but leaves its report rows behind, so
    // `post_reports` can hold rows pointing at a post that no longer exists.
    // Both queries inner-join `posts` to exclude those orphans: without the
    // join the count sees them but the page does not, so `total`/`totalPages`
    // overstate the real result set and an orphan silently eats a page slot.
    const groupedQb = this.postReportRepository
      .createQueryBuilder("report")
      .innerJoin(Post, "post", "post.id = report.postId")
      .select("report.postId", "postId")
      .addSelect("COUNT(report.id)", "reportCount")
      .addSelect("MAX(report.createdAt)", "latestReportedAt")
      .groupBy("report.postId")
      .orderBy("latestReportedAt", "DESC")
      .offset((page - 1) * limit)
      .limit(limit);
    if (status) groupedQb.where("report.status = :status", { status });

    const totalQb = this.postReportRepository
      .createQueryBuilder("report")
      .innerJoin(Post, "post", "post.id = report.postId")
      .select("COUNT(DISTINCT report.postId)", "cnt");
    if (status) totalQb.where("report.status = :status", { status });

    const [grouped, totalRaw] = await Promise.all([
      groupedQb.getRawMany<{
        postId: number;
        reportCount: string;
        latestReportedAt: Date;
      }>(),
      totalQb.getRawOne<{ cnt: string }>(),
    ]);
    const total = Number(totalRaw?.cnt ?? 0);

    const postIds = grouped.map((row) => Number(row.postId));
    if (postIds.length === 0) {
      return PaginatedResponse.of([], total, page, limit);
    }

    const [posts, reports] = await Promise.all([
      this.postRepository.find({ where: { id: In(postIds) } }),
      this.postReportRepository.find({
        where: { postId: In(postIds) },
        order: { createdAt: "DESC" },
      }),
    ]);
    const postById = new Map(posts.map((post) => [post.id, post]));
    const reportsByPostId = new Map<number, PostReport[]>();
    for (const report of reports) {
      const existing = reportsByPostId.get(report.postId);
      if (existing) existing.push(report);
      else reportsByPostId.set(report.postId, [report]);
    }

    const data = grouped
      .map((row) => {
        const postId = Number(row.postId);
        const post = postById.get(postId);
        // The inner join above already excluded orphaned reports; this stays as
        // a type guard for the map lookup and a defence against a post deleted
        // between the two queries.
        if (!post) return null;
        const postReports = reportsByPostId.get(postId) ?? [];
        return {
          post: this.sanitizePostImageUrls(post),
          reportCount: Number(row.reportCount),
          pendingCount: postReports.filter((r) => r.status === "pending")
            .length,
          latestReportedAt: row.latestReportedAt,
          reports: postReports.map((r) => ({
            id: r.id,
            reporterId: r.reporterId,
            reason: r.reason,
            status: r.status,
            createdAt: r.createdAt,
          })),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    return PaginatedResponse.of(data, total, page, limit);
  }

  async hidePost(payload: {
    postId: number;
    adminId: number;
  }): Promise<{ postId: number; isHidden: boolean }> {
    const post = await this.postRepository.findOne({
      where: { id: payload.postId },
    });
    if (!post) {
      throw new NotFoundException(SOCIAL_MESSAGE.POST_NOT_FOUND);
    }
    post.isHidden = true;
    post.hiddenAt = new Date();
    await this.postRepository.save(post);
    // Hiding resolves the outstanding reports that triggered the action.
    await this.postReportRepository.update(
      { postId: payload.postId, status: "pending" },
      {
        status: "resolved",
        resolvedBy: payload.adminId,
        resolvedAt: new Date(),
      },
    );
    return { postId: payload.postId, isHidden: true };
  }

  async unhidePost(payload: {
    postId: number;
  }): Promise<{ postId: number; isHidden: boolean }> {
    const post = await this.postRepository.findOne({
      where: { id: payload.postId },
    });
    if (!post) {
      throw new NotFoundException(SOCIAL_MESSAGE.POST_NOT_FOUND);
    }
    post.isHidden = false;
    post.hiddenAt = null;
    await this.postRepository.save(post);
    return { postId: payload.postId, isHidden: false };
  }

  async dismissReports(payload: {
    postId: number;
    adminId: number;
  }): Promise<{ postId: number; dismissed: number }> {
    const post = await this.postRepository.findOne({
      where: { id: payload.postId },
    });
    if (!post) {
      throw new NotFoundException(SOCIAL_MESSAGE.POST_NOT_FOUND);
    }
    const result = await this.postReportRepository.update(
      { postId: payload.postId, status: "pending" },
      {
        status: "dismissed",
        resolvedBy: payload.adminId,
        resolvedAt: new Date(),
      },
    );
    return { postId: payload.postId, dismissed: result.affected ?? 0 };
  }

  async adminDeletePost(payload: {
    postId: number;
  }): Promise<{ success: boolean }> {
    const post = await this.postRepository.findOne({
      where: { id: payload.postId },
    });
    if (!post) {
      throw new NotFoundException(SOCIAL_MESSAGE.POST_NOT_FOUND);
    }
    const removedMediaUrls = this.collectPostMediaUrls(post);
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(PostReport, { postId: payload.postId });
      await manager.remove(post);
    });
    // Cleanup only after the delete transaction has committed.
    this.destroyDroppedMedia(removedMediaUrls, []);
    return { success: true };
  }
}
