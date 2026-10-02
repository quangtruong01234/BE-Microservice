import { ClientProxy } from "@nestjs/microservices";
import { JwtService } from "@nestjs/jwt";
import { CachedService } from "@app/cached";
import { of, throwError } from "rxjs";
import { UserService } from "./user.service";
import { SessionRevocationService } from "../common/session/session-revocation.service";

/**
 * RAIL-RANK-01 — `GET /api/user/featured-sellers` forwards the orders
 * service's units-sold ranking to the user service and tags each seller with
 * `soldCount`. The ranking leg fails OPEN to the old newest-shops answer.
 * AUD-0925-04 — the answer is cached 60s per `limit`, like the trending rail.
 */
describe("UserService getFeaturedSellers (RAIL-RANK-01)", () => {
  const userClient = { send: jest.fn() };
  const ordersClient = { send: jest.fn() };
  const cached = { get: jest.fn(), set: jest.fn() };
  let service: UserService;

  const seller = (id: number): Record<string, unknown> => ({
    id,
    publicId: `usr_${String(id).padStart(16, "0")}`,
    username: `shop${id}`,
    name: null,
    avatar: null,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UserService(
      userClient as unknown as ClientProxy,
      {} as unknown as JwtService,
      ordersClient as unknown as ClientProxy,
      cached as unknown as CachedService,
      {} as unknown as SessionRevocationService,
      {} as unknown as ClientProxy,
      {} as unknown as ClientProxy,
      {} as unknown as ClientProxy,
    );
    userClient.send.mockReturnValue(of([seller(20), seller(23)]));
    cached.get.mockResolvedValue(null);
    cached.set.mockResolvedValue("OK");
  });

  it("forwards the ranking and tags sellers with soldCount", async () => {
    ordersClient.send.mockReturnValue(of([{ sellerId: 20, soldCount: 4 }]));

    const sellers = (await service.getFeaturedSellers(5)) as Record<
      string,
      unknown
    >[];

    expect(userClient.send).toHaveBeenCalledWith(expect.anything(), {
      limit: 5,
      rankedSellerIds: [20],
    });
    expect(sellers).toEqual([
      expect.objectContaining({ id: "usr_0000000000000020", soldCount: 4 }),
      expect.objectContaining({ id: "usr_0000000000000023", soldCount: 0 }),
    ]);
  });

  it("falls back to newest shops when the orders ranking is down", async () => {
    ordersClient.send.mockReturnValue(
      throwError(() => new Error("orders service down")),
    );

    const sellers = (await service.getFeaturedSellers(5)) as Record<
      string,
      unknown
    >[];

    expect(userClient.send).toHaveBeenCalledWith(expect.anything(), {
      limit: 5,
      rankedSellerIds: [],
    });
    expect(sellers.map((row) => row.soldCount)).toEqual([0, 0]);
  });

  describe("60s cache (AUD-0925-04)", () => {
    it("serves a cache hit without touching the orders or user service", async () => {
      const cachedSellers = [
        { id: "usr_0000000000000020", username: "shop20", soldCount: 4 },
      ];
      cached.get.mockResolvedValue(JSON.stringify(cachedSellers));

      const sellers = await service.getFeaturedSellers(5);

      expect(cached.get).toHaveBeenCalledWith("gw:user:featured-sellers:5");
      expect(sellers).toEqual(cachedSellers);
      expect(ordersClient.send).not.toHaveBeenCalled();
      expect(userClient.send).not.toHaveBeenCalled();
    });

    it("writes the exposed answer for 60s under a per-limit key", async () => {
      ordersClient.send.mockReturnValue(of([{ sellerId: 20, soldCount: 4 }]));

      const sellers = await service.getFeaturedSellers(3);

      expect(cached.set).toHaveBeenCalledWith(
        "gw:user:featured-sellers:3",
        JSON.stringify(sellers),
        60,
      );
      // The cached copy is the boundary shape — no numeric id, no publicId.
      const [, cachedPayload] = cached.set.mock.calls[0] as [string, string];
      expect(cachedPayload).not.toContain('"publicId"');
      expect(cachedPayload).toContain('"id":"usr_0000000000000020"');
    });

    it("never caches a user-service failure", async () => {
      ordersClient.send.mockReturnValue(of([]));
      userClient.send.mockReturnValue(
        throwError(() => new Error("user service down")),
      );

      await expect(service.getFeaturedSellers(5)).rejects.toBeDefined();
      expect(cached.set).not.toHaveBeenCalled();
    });

    it("fails open when Redis is down on both read and write", async () => {
      ordersClient.send.mockReturnValue(of([{ sellerId: 23, soldCount: 2 }]));
      cached.get.mockRejectedValue(new Error("ECONNREFUSED"));
      cached.set.mockRejectedValue(new Error("ECONNREFUSED"));

      const sellers = (await service.getFeaturedSellers(5)) as Record<
        string,
        unknown
      >[];

      expect(sellers.map((row) => row.soldCount)).toEqual([0, 2]);
    });

    it("treats a corrupt cache entry as a miss", async () => {
      ordersClient.send.mockReturnValue(of([]));
      cached.get.mockResolvedValue('{"not":"an array"}');

      const sellers = (await service.getFeaturedSellers(5)) as unknown[];

      expect(userClient.send).toHaveBeenCalled();
      expect(sellers).toHaveLength(2);
    });
  });
});
