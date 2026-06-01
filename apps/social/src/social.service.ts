import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, IsNull, QueryFailedError, Repository } from "typeorm";
import { Channel } from "amqplib";
import { CachedService } from "@app/cached";
import { PaginatedResponse } from "@app/common";
import { EXCHANGE } from "@app/common/constants/exchange";
import { EVENT } from "@app/common/constants/event";
import { Post } from "./entities/post.entity";
import { PostLike } from "./entities/post-like.entity";
import { Comment } from "./entities/comment.entity";

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
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly cachedService: CachedService,
    @Inject(EXCHANGE.RMQ_PUBLISHER_CHANNEL)
    private readonly fanoutChannel: Channel,
  ) {}

  private get treeRepo() {
    return this.dataSource.getTreeRepository(Comment);
  }

  async createPost(payload: {
    userId: number;
    content: string;
    imageUrls?: string[] | null;
    videoUrl?: string | null;
  }): Promise<Post> {
    const post = this.postRepository.create({
      user_id: payload.userId,
      content: payload.content,
      image_urls: payload.imageUrls ?? null,
      video_url: payload.videoUrl ?? null,
    });
    return this.postRepository.save(post);
  }

  async getPosts(payload: {
    page: number;
    limit: number;
  }): Promise<PaginatedResponse<Post & { likeCount: number }>> {
    const { page, limit } = payload;
    const [posts, total] = await this.postRepository.findAndCount({
      order: { created_at: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    const counts = await Promise.all(
      posts.map(async (post) => {
        const cached = await this.cachedService.get(
          `post:like_count:${post.id}`,
        );
        if (cached !== null) return parseInt(cached, 10);
        const count = await this.postLikeRepository.count({
          where: { post_id: post.id },
        });
        await this.cachedService.set(
          `post:like_count:${post.id}`,
          count.toString(),
        );
        return count;
      }),
    );
    return PaginatedResponse.of(
      posts.map((post, i) => ({ ...post, likeCount: counts[i] ?? 0 })),
      total,
      page,
      limit,
    );
  }

  async getPostsByUser(payload: {
    userId: number;
    page: number;
    limit: number;
  }): Promise<PaginatedResponse<Post & { likeCount: number }>> {
    const { userId, page, limit } = payload;
    const [posts, total] = await this.postRepository.findAndCount({
      where: { user_id: userId },
      order: { created_at: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    const counts = await Promise.all(
      posts.map(async (post) => {
        const cached = await this.cachedService.get(
          `post:like_count:${post.id}`,
        );
        if (cached !== null) return parseInt(cached, 10);
        const count = await this.postLikeRepository.count({
          where: { post_id: post.id },
        });
        await this.cachedService.set(
          `post:like_count:${post.id}`,
          count.toString(),
        );
        return count;
      }),
    );
    return PaginatedResponse.of(
      posts.map((post, i) => ({ ...post, likeCount: counts[i] ?? 0 })),
      total,
      page,
      limit,
    );
  }

  async getPostById(postId: number): Promise<Post & { likeCount: number }> {
    const post = await this.postRepository.findOne({ where: { id: postId } });
    if (!post) {
      throw new NotFoundException(`Post ${postId} not found`);
    }
    const cacheKey = `post:like_count:${postId}`;
    const cached = await this.cachedService.get(cacheKey);
    let likeCount: number;
    if (cached === null) {
      likeCount = await this.postLikeRepository.count({
        where: { post_id: postId },
      });
      await this.cachedService.set(cacheKey, likeCount.toString());
    } else {
      likeCount = parseInt(cached, 10);
    }
    return { ...post, likeCount };
  }

  async likePost(payload: {
    postId: number;
    userId: number;
  }): Promise<{ liked: boolean; postId: number; likeCount: number }> {
    const post = await this.postRepository.findOne({
      where: { id: payload.postId },
    });
    if (!post) {
      throw new NotFoundException(`Post ${payload.postId} not found`);
    }
    try {
      const like = this.postLikeRepository.create({
        post_id: payload.postId,
        user_id: payload.userId,
      });
      await this.postLikeRepository.save(like);
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
    const newCount = await this.cachedService.incr(
      `post:like_count:${payload.postId}`,
    );
    await this.cachedService.set(
      `post:liked:${payload.postId}:${payload.userId}`,
      "1",
    );
    return { liked: true, postId: payload.postId, likeCount: newCount };
  }

  async unlikePost(payload: {
    postId: number;
    userId: number;
  }): Promise<{ liked: boolean; postId: number; likeCount: number }> {
    const like = await this.postLikeRepository.findOne({
      where: { post_id: payload.postId, user_id: payload.userId },
    });
    if (!like) {
      throw new NotFoundException("Like not found");
    }
    await this.postLikeRepository.remove(like);
    const newCount = await this.cachedService.decr(
      `post:like_count:${payload.postId}`,
    );
    await this.cachedService.del(
      `post:liked:${payload.postId}:${payload.userId}`,
    );
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
    if (post.user_id !== payload.userId) {
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
      post_id: payload.postId,
      user_id: payload.userId,
      content: payload.content,
    });
    const saved = await this.commentRepository.save(comment);
    if (payload.userId !== post.user_id) {
      this.fanoutChannel.publish(
        EXCHANGE.SOCIAL_EXCHANGE,
        EVENT.COMMENT_CREATED_EVENT,
        Buffer.from(
          JSON.stringify({
            data: {
              postId: payload.postId,
              postOwnerId: post.user_id,
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
  }): Promise<PaginatedResponse<Comment & { reply_count: number }>> {
    const { postId, page, limit } = payload;
    const [comments, total] = await this.commentRepository.findAndCount({
      where: { post_id: postId, parent: IsNull() },
      order: { created_at: "ASC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    const replyCounts = await Promise.all(
      comments.map((c) => this.treeRepo.countDescendants(c)),
    );
    const data = comments.map((c, i) => ({
      ...c,
      reply_count: replyCounts[i] ?? 0,
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
    if (comment.user_id !== payload.userId) {
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
        post_id: payload.postId,
        user_id: payload.userId,
        content: payload.content,
        parent: parentComment,
      }),
    );
    if (payload.userId !== parentComment.user_id) {
      this.fanoutChannel.publish(
        EXCHANGE.SOCIAL_EXCHANGE,
        EVENT.REPLY_CREATED_EVENT,
        Buffer.from(
          JSON.stringify({
            data: {
              parentCommentId: payload.parentCommentId,
              commentOwnerId: parentComment.user_id,
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
}
