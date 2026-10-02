import { DataSource } from "typeorm";
import { CachedService } from "@app/cached";
import { CloudinaryService } from "@app/common";
import { createRepositoryMock, RepositoryMock } from "@app/testing";
import { Comment } from "./entities/comment.entity";
import { Follow } from "./entities/follow.entity";
import { Post } from "./entities/post.entity";
import { PostLike } from "./entities/post-like.entity";
import { PostReport } from "./entities/post-report.entity";
import { SocialService } from "./social.service";

describe("SocialService.purgeUserData (ACCOUNT-DELETE-01)", () => {
  let postRepo: RepositoryMock<Post>;
  let commentRepo: RepositoryMock<Comment>;
  let followRepo: RepositoryMock<Follow>;
  let service: SocialService;

  beforeEach(() => {
    postRepo = createRepositoryMock<Post>();
    commentRepo = createRepositoryMock<Comment>();
    followRepo = createRepositoryMock<Follow>();
    service = new SocialService(
      postRepo.asRepository(),
      createRepositoryMock<PostLike>().asRepository(),
      createRepositoryMock<PostReport>().asRepository(),
      commentRepo.asRepository(),
      followRepo.asRepository(),
      {} as DataSource,
      {} as CachedService,
      {} as CloudinaryService,
      null,
    );
  });

  it("drops the follow edges in both directions and keeps authored content", async () => {
    followRepo.delete
      .mockResolvedValueOnce({ affected: 2, raw: [] })
      .mockResolvedValueOnce({ affected: 3, raw: [] });

    await expect(service.purgeUserData({ userId: 9 })).resolves.toEqual({
      deletedFollowCount: 5,
    });

    expect(followRepo.delete).toHaveBeenCalledWith({ followerId: 9 });
    expect(followRepo.delete).toHaveBeenCalledWith({ followingId: 9 });
    expect(postRepo.delete).not.toHaveBeenCalled();
    expect(commentRepo.delete).not.toHaveBeenCalled();
  });
});
