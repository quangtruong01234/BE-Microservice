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
import { DataSource, In, IsNull, QueryFailedError, Repository } from "typeorm";
import { Channel } from "amqplib";
import { CachedService } from "@app/cached";
import { PaginatedResponse } from "@app/common";
import { EXCHANGE } from "@app/common/constants/exchange";
import { EVENT } from "@app/common/constants/event";
import { Post } from "./entities/post.entity";
import { PostLike } from "./entities/post-like.entity";
import { Comment } from "./entities/comment.entity";
import { Follow } from "./entities/follow.entity";

@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);

  constructor(
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
    @InjectRepository(PostLike)
    private readonly postLikeRepository: Repository<PostLike>,
    @InjectRepository(Comment)
    private readonly commentRepository: Repository<Comment>,
    @InjectRepository(Follow)
    private readonly followRepository: Repository<Follow>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly cachedService: CachedService,
    @Inject(EXCHANGE.RMQ_PUBLISHER_CHANNEL)
    private readonly fanoutChannel: Channel,
  ) {}

  private get treeRepo() {
    return this.dataSource.getTreeRepository(Comment);
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

  async createPost(payload: {
    userId: number;
    content: string;
    imageUrls?: string[] | null;
    videoUrl?: string | null;
  }): Promise<Post> {
    const post = this.postRepository.create({
      userId: payload.userId,
      content: payload.content,
      imageUrls: payload.imageUrls ?? null,
      videoUrl: payload.videoUrl ?? null,
    });
    return this.postRepository.save(post);
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
    const [posts, total] = await this.postRepository.findAndCount({
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    const [counts, likedFlags, commentCounts] = await Promise.all([
      Promise.all(
        posts.map(async (post) => {
          const cached = await this.cachedService.get(
            `post:like_count:${post.id}`,
          );
          if (cached !== null) return parseInt(cached, 10);
          const count = await this.postLikeRepository.count({
            where: { postId: post.id },
          });
          await this.cachedService.set(
            `post:like_count:${post.id}`,
            count.toString(),
          );
          return count;
        }),
      ),
      Promise.all(
        posts.map((post) => this.resolveIsLiked(post.id, viewerUserId)),
      ),
      Promise.all(
        posts.map((post) =>
          this.commentRepository.count({ where: { postId: post.id } }),
        ),
      ),
    ]);
    return PaginatedResponse.of(
      posts.map((post, i) => ({
        ...post,
        likeCount: counts[i] ?? 0,
        isLiked: likedFlags[i] ?? false,
        commentCount: commentCounts[i] ?? 0,
      })),
      total,
      page,
      limit,
    );
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
      where: { userId },
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    const [counts, likedFlags, commentCounts] = await Promise.all([
      Promise.all(
        posts.map(async (post) => {
          const cached = await this.cachedService.get(
            `post:like_count:${post.id}`,
          );
          if (cached !== null) return parseInt(cached, 10);
          const count = await this.postLikeRepository.count({
            where: { postId: post.id },
          });
          await this.cachedService.set(
            `post:like_count:${post.id}`,
            count.toString(),
          );
          return count;
        }),
      ),
      Promise.all(
        posts.map((post) => this.resolveIsLiked(post.id, viewerUserId)),
      ),
      Promise.all(
        posts.map((post) =>
          this.commentRepository.count({ where: { postId: post.id } }),
        ),
      ),
    ]);
    return PaginatedResponse.of(
      posts.map((post, i) => ({
        ...post,
        likeCount: counts[i] ?? 0,
        isLiked: likedFlags[i] ?? false,
        commentCount: commentCounts[i] ?? 0,
      })),
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
    if (!post) {
      throw new NotFoundException(`Post ${postId} not found`);
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
    return { ...post, likeCount, isLiked, commentCount };
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
        throw new ConflictException("Already liked");
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
      throw new NotFoundException("Like not found");
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
      throw new NotFoundException(`Post ${payload.postId} not found`);
    }
    if (post.userId !== payload.userId) {
      throw new ForbiddenException("You can only delete your own posts");
    }
    await this.postRepository.remove(post);
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
      throw new NotFoundException(`Post ${payload.postId} not found`);
    }
    const comment = this.commentRepository.create({
      postId: payload.postId,
      userId: payload.userId,
      content: payload.content,
    });
    const saved = await this.commentRepository.save(comment);
    if (payload.userId !== post.userId) {
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
              preview: payload.content.slice(0, 20),
            },
            pattern: EVENT.COMMENT_CREATED_EVENT,
          }),
        ),
      );
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
      throw new NotFoundException(`Comment ${payload.commentId} not found`);
    }
    if (comment.userId !== payload.userId) {
      throw new ForbiddenException("You can only delete your own comments");
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
      throw new NotFoundException(
        `Comment ${payload.parentCommentId} not found`,
      );
    }
    const saved = await this.treeRepo.save(
      this.commentRepository.create({
        postId: payload.postId,
        userId: payload.userId,
        content: payload.content,
        parent: parentComment,
      }),
    );
    if (payload.userId !== parentComment.userId) {
      this.fanoutChannel.publish(
        EXCHANGE.SOCIAL_EXCHANGE,
        EVENT.REPLY_CREATED_EVENT,
        Buffer.from(
          JSON.stringify({
            data: {
              parentCommentId: payload.parentCommentId,
              commentOwnerId: parentComment.userId,
              replierId: payload.userId,
              replyId: saved.id,
              preview: payload.content.slice(0, 20),
            },
            pattern: EVENT.REPLY_CREATED_EVENT,
          }),
        ),
      );
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
      throw new NotFoundException(`Comment ${payload.commentId} not found`);
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
      throw new BadRequestException("Cannot follow yourself");
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
        throw new ConflictException("Already following");
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
      throw new NotFoundException("Follow relationship not found");
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
      where: { userId: In(followingIds) },
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    const [counts, likedFlags, commentCounts] = await Promise.all([
      Promise.all(
        posts.map(async (post) => {
          const cached = await this.cachedService.get(
            `post:like_count:${post.id}`,
          );
          if (cached !== null) return parseInt(cached, 10);
          const count = await this.postLikeRepository.count({
            where: { postId: post.id },
          });
          await this.cachedService.set(
            `post:like_count:${post.id}`,
            count.toString(),
          );
          return count;
        }),
      ),
      Promise.all(
        posts.map((post) => this.resolveIsLiked(post.id, viewerUserId)),
      ),
      Promise.all(
        posts.map((post) =>
          this.commentRepository.count({ where: { postId: post.id } }),
        ),
      ),
    ]);
    return PaginatedResponse.of(
      posts.map((post, i) => ({
        ...post,
        likeCount: counts[i] ?? 0,
        isLiked: likedFlags[i] ?? false,
        commentCount: commentCounts[i] ?? 0,
      })),
      total,
      page,
      limit,
    );
  }
}
