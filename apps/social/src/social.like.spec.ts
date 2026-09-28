import { Channel } from "amqplib";
import { DataSource } from "typeorm";
import { CachedService } from "@app/cached";
import { CloudinaryService } from "@app/common";
import { EVENT } from "@app/common/constants/event";
import { EXCHANGE } from "@app/common/constants/exchange";
import { createRepositoryMock, RepositoryMock } from "@app/testing";
import { Comment } from "./entities/comment.entity";
import { Follow } from "./entities/follow.entity";
import { Post } from "./entities/post.entity";
import { PostLike } from "./entities/post-like.entity";
import { PostReport } from "./entities/post-report.entity";
import { SocialService } from "./social.service";

describe("SocialService.likePost — like notification (SOCIAL-LIKE-NTF-01)", () => {
  let postRepo: RepositoryMock<Post>;
  let publish: jest.Mock;
  let service: SocialService;

  function buildService(channel: Channel | null): SocialService {
    const cachedService = {
      incr: jest.fn().mockResolvedValue(3),
      set: jest.fn().mockResolvedValue(undefined),
    } as unknown as CachedService;
    return new SocialService(
      postRepo.asRepository(),
      createRepositoryMock<PostLike>().asRepository(),
      createRepositoryMock<PostReport>().asRepository(),
      createRepositoryMock<Comment>().asRepository(),
      createRepositoryMock<Follow>().asRepository(),
      {} as DataSource,
      cachedService,
      {} as CloudinaryService,
      channel,
    );
  }

  beforeEach(() => {
    postRepo = createRepositoryMock<Post>();
    publish = jest.fn();
    service = buildService({ connection: {}, publish } as unknown as Channel);
  });

  it("publishes post_liked to the post owner", async () => {
    postRepo.findOne.mockResolvedValue({ id: 12, userId: 7 });

    await expect(service.likePost({ postId: 12, userId: 3 })).resolves.toEqual({
      liked: true,
      postId: 12,
      likeCount: 3,
    });

    expect(publish).toHaveBeenCalledTimes(1);
    const [exchange, routingKey, body] = publish.mock.calls[0] as [
      string,
      string,
      Buffer,
    ];
    expect(exchange).toBe(EXCHANGE.SOCIAL_EXCHANGE);
    expect(routingKey).toBe(EVENT.POST_LIKED_EVENT);
    expect(JSON.parse(body.toString())).toEqual({
      pattern: EVENT.POST_LIKED_EVENT,
      data: { postId: 12, postOwnerId: 7, likerId: 3 },
    });
  });

  it("notifies nobody on a self-like", async () => {
    postRepo.findOne.mockResolvedValue({ id: 12, userId: 3 });

    await service.likePost({ postId: 12, userId: 3 });

    expect(publish).not.toHaveBeenCalled();
  });

  it("still answers the like when the owner lookup fails", async () => {
    postRepo.findOne.mockRejectedValue(new Error("db down"));

    await expect(service.likePost({ postId: 12, userId: 3 })).resolves.toEqual({
      liked: true,
      postId: 12,
      likeCount: 3,
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it("still answers the like when the broker channel is unavailable", async () => {
    service = buildService(null);
    postRepo.findOne.mockResolvedValue({ id: 12, userId: 7 });

    await expect(service.likePost({ postId: 12, userId: 3 })).resolves.toEqual({
      liked: true,
      postId: 12,
      likeCount: 3,
    });
  });
});
