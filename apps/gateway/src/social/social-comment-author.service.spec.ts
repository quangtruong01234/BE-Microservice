import { ClientProxy } from "@nestjs/microservices";
import { of, throwError } from "rxjs";
import {
  SOCIAL_MESSAGE_PATTERN,
  USER_MESSAGE_PATTERN,
} from "libs/constant/message-pattern.constant";
import { SocialGatewayService } from "./social.service";

/**
 * SOCIAL-AUTHOR-01 — comments and replies must carry the same `author` embed
 * posts already return, on every shape (paginated list, nested reply tree, and
 * a freshly created comment/reply), and must resolve the whole payload in a
 * fixed number of user-service calls rather than one per comment.
 */
describe("SocialGatewayService comment authors", () => {
  const socialClient = { send: jest.fn() };
  const userClient = { send: jest.fn() };
  const productClient = { send: jest.fn() };
  let service: SocialGatewayService;

  const users = [
    { id: 7, publicId: "usr_alice", username: "alice", avatar: null },
    { id: 9, publicId: "usr_bob", username: "bob", avatar: null },
  ];

  /** Route the social client by message pattern; unknown patterns must fail. */
  const routeSocial = (payload: unknown) => {
    socialClient.send.mockImplementation((pattern: string) => {
      if (pattern === SOCIAL_MESSAGE_PATTERN.GET_POST_PUBLIC_IDS_BY_IDS) {
        return of([{ id: 5, publicId: "post_5" }]);
      }
      if (pattern === SOCIAL_MESSAGE_PATTERN.GET_COMMENT_PUBLIC_IDS_BY_IDS) {
        return of([
          { id: 1, publicId: "cmt_1" },
          { id: 2, publicId: "cmt_2" },
        ]);
      }
      return of(payload);
    });
  };

  const comment = (
    id: number,
    userId: number,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    id,
    publicId: `cmt_${id}`,
    postId: 5,
    userId,
    content: `comment ${id}`,
    ...extra,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    userClient.send.mockReturnValue(of(users));
    service = new SocialGatewayService(
      socialClient as unknown as ClientProxy,
      userClient as unknown as ClientProxy,
      productClient as unknown as ClientProxy,
    );
  });

  it("attaches the author to every item of the paginated comment list", async () => {
    routeSocial({
      data: [comment(1, 7), comment(2, 9)],
      total: 2,
      page: 1,
      limit: 10,
      totalPages: 1,
      hasNext: false,
    });

    const result = (await service.getComments("post_5", 1, 10)) as {
      data: Array<{ author: { id: string; username: string } }>;
      total: number;
    };

    expect(result.total).toBe(2);
    expect(result.data[0].author).toEqual({
      id: "usr_alice",
      username: "alice",
      avatar: null,
    });
    expect(result.data[1].author.username).toBe("bob");
  });

  it("attaches the author through the whole nested reply tree", async () => {
    routeSocial(
      comment(1, 7, {
        children: [comment(2, 9, { children: [comment(3, 7)] })],
      }),
    );

    const result = (await service.getReplies("cmt_1")) as {
      author: { username: string };
      children: Array<{
        author: { username: string };
        children: Array<{ author: { username: string } }>;
      }>;
    };

    expect(result.author.username).toBe("alice");
    expect(result.children[0].author.username).toBe("bob");
    expect(result.children[0].children[0].author.username).toBe("alice");
  });

  it("attaches the author to a created reply and to its embedded parent", async () => {
    routeSocial(comment(3, 9, { parent: comment(1, 7) }));

    const result = (await service.createReply("post_5", "cmt_1", 9, "hi")) as {
      author: { username: string };
      parent: { author: { username: string } };
    };

    expect(result.author.username).toBe("bob");
    expect(result.parent.author.username).toBe("alice");
  });

  it("resolves all authors in a fixed number of user-service calls", async () => {
    routeSocial({
      data: [
        comment(1, 7, { children: [comment(2, 9), comment(3, 7)] }),
        comment(2, 9),
      ],
      total: 2,
      page: 1,
      limit: 10,
      totalPages: 1,
      hasNext: false,
    });

    await service.getComments("post_5", 1, 10);

    // One batch for the author embed + one for the public-id exposure — never
    // one call per comment (the FE explicitly cannot afford an N+1 here).
    expect(userClient.send).toHaveBeenCalledTimes(2);
    expect(userClient.send).toHaveBeenCalledWith(
      { cmd: USER_MESSAGE_PATTERN.GET_USERS_BY_IDS },
      expect.arrayContaining([7, 9]),
    );
  });

  it("degrades to author:null when the user service is unreachable", async () => {
    routeSocial({
      data: [comment(1, 7)],
      total: 1,
      page: 1,
      limit: 10,
      totalPages: 1,
      hasNext: false,
    });
    userClient.send.mockReturnValue(
      throwError(() => new Error("user service down")),
    );

    const result = (await service.getComments("post_5", 1, 10)) as {
      data: Array<{ author: unknown; content: string }>;
    };

    expect(result.data[0].author).toBeNull();
    expect(result.data[0].content).toBe("comment 1");
  });
});
