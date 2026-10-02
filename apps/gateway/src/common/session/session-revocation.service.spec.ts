import { CachedService } from "@app/cached";
import {
  SESSION_VALID_AFTER_KEY_PREFIX,
  SESSION_VALID_AFTER_TTL_SECONDS,
} from "libs/constant/session.constant";
import { SessionRevocationService } from "./session-revocation.service";

describe("SessionRevocationService", () => {
  const cached = { get: jest.fn(), set: jest.fn() };
  const service = new SessionRevocationService(
    cached as unknown as CachedService,
  );

  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.useRealTimers());

  it("revokes a token issued strictly before validAfter", async () => {
    cached.get.mockResolvedValue("1000");

    await expect(service.isRevoked(7, 999)).resolves.toBe(true);
    expect(cached.get).toHaveBeenCalledWith(
      `${SESSION_VALID_AFTER_KEY_PREFIX}7`,
    );
  });

  it("keeps a token issued in the same second or later", async () => {
    cached.get.mockResolvedValue("1000");

    await expect(service.isRevoked(7, 1000)).resolves.toBe(false);
    await expect(service.isRevoked(7, 1001)).resolves.toBe(false);
  });

  it("treats a token without iat as issued at 0", async () => {
    cached.get.mockResolvedValue("1000");

    await expect(service.isRevoked(7, undefined)).resolves.toBe(true);
  });

  it("keeps every token when the user never revoked", async () => {
    cached.get.mockResolvedValue(null);

    await expect(service.isRevoked(7, 1)).resolves.toBe(false);
  });

  it("fails open on a Redis error", async () => {
    cached.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(service.isRevoked(7, 1)).resolves.toBe(false);
  });

  it("fails open when Redis hangs past the timeout", async () => {
    jest.useFakeTimers();
    cached.get.mockReturnValue(new Promise(() => undefined));

    const pending = service.isRevoked(7, 1);
    jest.advanceTimersByTime(600);

    await expect(pending).resolves.toBe(false);
  });

  it("writes validAfter as epoch seconds with the long TTL", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-01T00:00:00.900Z"));
    cached.set.mockResolvedValue("OK");

    await service.revokeAllSessions(7);

    expect(cached.set).toHaveBeenCalledWith(
      `${SESSION_VALID_AFTER_KEY_PREFIX}7`,
      String(Date.parse("2026-10-01T00:00:00Z") / 1000),
      SESSION_VALID_AFTER_TTL_SECONDS,
    );
  });

  it("propagates a Redis error on revokeAllSessions", async () => {
    cached.set.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(service.revokeAllSessions(7)).rejects.toThrow("ECONNREFUSED");
  });
});
