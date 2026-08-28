import { ClientProxy } from "@nestjs/microservices";
import { of, throwError } from "rxjs";
import { SocialGatewayService } from "./social.service";

/**
 * ENRICH-FAIL-01 — `fetchAuthorMap` used to end in a bare `catch { return new
 * Map(); }`. That is not a degraded embed: `exposeReferences` resolves EVERY
 * user reference through the same map, so an empty map nulls `userId` on every
 * row while the response still says 200. It must fail loudly instead, while a
 * user who genuinely no longer exists stays `author: null`.
 */
describe("SocialGatewayService author resolution failure modes", () => {
  const socialClient = { send: jest.fn() };
  const userClient = { send: jest.fn() };
  const productClient = { send: jest.fn() };
  let service: SocialGatewayService;

  const postsPage = {
    data: [{ id: 3, publicId: "post_aaaaaaaaaaaaaaaa", userId: 31, likes: 2 }],
    total: 1,
    page: 1,
    limit: 10,
    totalPages: 1,
    hasNext: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SocialGatewayService(
      socialClient as unknown as ClientProxy,
      userClient as unknown as ClientProxy,
      productClient as unknown as ClientProxy,
    );
    socialClient.send.mockReturnValue(of(postsPage));
  });

  it("throws instead of nulling every userId when the user service is down", async () => {
    userClient.send.mockReturnValue(
      throwError(() => new Error("user service down")),
    );

    await expect(service.getPosts(1, 10, 31)).rejects.toMatchObject({
      status: 502,
    });
  });

  it("still answers with author:null when the author no longer exists", async () => {
    userClient.send.mockReturnValue(of([]));

    const page = (await service.getPosts(1, 10, 31)) as {
      data: Array<{ author: unknown; userId: unknown }>;
    };

    expect(page.data).toHaveLength(1);
    expect(page.data[0].author).toBeNull();
    expect(page.data[0].userId).toBeNull();
  });

  it("embeds the author and exposes the public id when the user service answers", async () => {
    userClient.send.mockReturnValue(
      of([
        {
          id: 31,
          publicId: "usr_aaaaaaaaaaaaaaaa",
          username: "shopa",
          avatar: null,
        },
      ]),
    );

    const page = (await service.getPosts(1, 10, 31)) as {
      data: Array<{ author: { id: string }; userId: string }>;
    };

    expect(page.data[0].userId).toBe("usr_aaaaaaaaaaaaaaaa");
    expect(page.data[0].author).toMatchObject({
      id: "usr_aaaaaaaaaaaaaaaa",
      username: "shopa",
    });
  });

  it("does not call the user service when the page is empty", async () => {
    socialClient.send.mockReturnValue(of({ ...postsPage, data: [], total: 0 }));

    const page = (await service.getPosts(1, 10, null)) as { data: unknown[] };

    expect(page.data).toEqual([]);
    expect(userClient.send).not.toHaveBeenCalled();
  });
});
