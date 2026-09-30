import { DataSource, FindOperator } from "typeorm";
import { CachedService } from "@app/cached";
import { CloudinaryService } from "@app/common";
import { createRepositoryMock, RepositoryMock } from "@app/testing";
import { Comment } from "./entities/comment.entity";
import { Follow } from "./entities/follow.entity";
import { Post } from "./entities/post.entity";
import { PostLike } from "./entities/post-like.entity";
import { PostReport } from "./entities/post-report.entity";
import { SocialService } from "./social.service";

describe("SocialService list search (LIST-SEARCH-01)", () => {
  let postRepo: RepositoryMock<Post>;
  let reportRepo: RepositoryMock<PostReport>;
  let followRepo: RepositoryMock<Follow>;
  let service: SocialService;

  beforeEach(() => {
    postRepo = createRepositoryMock<Post>();
    reportRepo = createRepositoryMock<PostReport>();
    followRepo = createRepositoryMock<Follow>();
    service = new SocialService(
      postRepo.asRepository(),
      createRepositoryMock<PostLike>().asRepository(),
      reportRepo.asRepository(),
      createRepositoryMock<Comment>().asRepository(),
      followRepo.asRepository(),
      {} as DataSource,
      {} as CachedService,
      {} as CloudinaryService,
      null,
    );
  });

  const postWhere = (): { content?: FindOperator<string> } => {
    const [{ where }] = postRepo.findAndCount.mock.calls[0] as [
      { where: { content?: FindOperator<string> } },
    ];
    return where;
  };

  it("filters a user's posts by content, like GET /social/posts", async () => {
    await service.getPostsByUser({
      userId: 4,
      page: 1,
      limit: 20,
      search: "áo",
    });

    expect(postWhere().content?.value).toBe("%áo%");
  });

  it("filters the following feed by content", async () => {
    followRepo.find.mockResolvedValue([{ followingId: 9 }]);

    await service.getFollowingFeed({
      userId: 4,
      page: 1,
      limit: 20,
      search: "áo",
    });

    expect(postWhere().content?.value).toBe("%áo%");
  });

  it("leaves a user's posts unfiltered without a search", async () => {
    await service.getPostsByUser({ userId: 4, page: 1, limit: 20 });

    expect(postWhere()).not.toHaveProperty("content");
  });

  it("narrows both the report page and its total by post content", async () => {
    const qb = reportRepo.createQueryBuilder() as Record<string, jest.Mock>;
    qb.andWhere.mockClear();

    await service.listReportedPosts({
      status: "pending",
      page: 1,
      limit: 20,
      q: " scam ",
    });

    const contentCalls = qb.andWhere.mock.calls.filter(
      ([condition]) => condition === "post.content LIKE :contentPattern",
    );
    expect(contentCalls).toEqual([
      ["post.content LIKE :contentPattern", { contentPattern: "%scam%" }],
      ["post.content LIKE :contentPattern", { contentPattern: "%scam%" }],
    ]);
  });
});
