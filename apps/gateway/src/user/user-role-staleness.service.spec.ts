import { ClientProxy } from "@nestjs/microservices";
import { JwtService } from "@nestjs/jwt";
import { of } from "rxjs";
import { UserService } from "./user.service";

/**
 * ROLE-ADMIN-01 — `GET /api/user/me` reports the role twice on purpose: `role`
 * is the row in the DB, `tokenRole` is what the presented JWT carries, and
 * `isRoleStale` says they have drifted. The drift is invisible to the client
 * otherwise (httpOnly cookie), and it is what let a promoted seller into the
 * seller UI only to eat a 403 at submit time.
 */
describe("UserService getMe role staleness", () => {
  const userClient = { send: jest.fn() };
  const jwtService = { sign: jest.fn() };
  let service: UserService;

  /** The raw user-service payload: snake_case role relation, numeric id. */
  const rawUser = (roleName: string | null): Record<string, unknown> => ({
    id: 42,
    publicId: "usr_probe",
    username: "roleprobe",
    email: "roleprobe@example.com",
    role:
      roleName === null
        ? null
        : { rol_id: 2, rol_name: roleName, rol_grants: [] },
  });

  const getMe = async (
    databaseRole: string | null,
    tokenRole: string,
  ): Promise<Record<string, unknown>> => {
    userClient.send.mockReturnValue(of(rawUser(databaseRole)));
    return (await service.getMe(42, tokenRole)) as Record<string, unknown>;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UserService(
      userClient as unknown as ClientProxy,
      jwtService as unknown as JwtService,
    );
  });

  it("reports no drift when the token was issued with the current role", async () => {
    const me = await getMe("user", "user");

    expect(me.tokenRole).toBe("user");
    expect(me.isRoleStale).toBe(false);
    expect(me.role).toEqual({ id: 2, name: "user" });
  });

  it("flags a promotion the live token does not carry yet", async () => {
    const me = await getMe("shop", "user");

    // The DB already says `shop`, so a client gating on `role` would open the
    // seller UI — while every guard still enforces the `user` in the token.
    expect(me.role).toEqual({ id: 2, name: "shop" });
    expect(me.tokenRole).toBe("user");
    expect(me.isRoleStale).toBe(true);
  });

  it("flags a demotion whose session is still over-privileged", async () => {
    const me = await getMe("user", "shop");

    expect(me.tokenRole).toBe("shop");
    expect(me.isRoleStale).toBe(true);
  });

  it("does not claim drift when the DB role is unreadable", async () => {
    const me = await getMe(null, "user");

    // Absent role ⇒ nothing to compare. Reporting `true` here would log a user
    // out over a payload shape we simply did not recognise.
    expect(me.tokenRole).toBe("user");
    expect(me.isRoleStale).toBe(false);
  });

  it("keeps the existing exposed profile intact (PUBID-02)", async () => {
    const me = await getMe("user", "user");

    expect(me.id).toBe("usr_probe");
    expect(me.publicId).toBeUndefined();
    expect(me.username).toBe("roleprobe");
  });
});
