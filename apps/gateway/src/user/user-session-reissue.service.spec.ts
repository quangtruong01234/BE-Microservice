import { CachedService } from "@app/cached";
import { ServiceUnavailableException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ClientProxy } from "@nestjs/microservices";
import {
  DEFAULT_AUTH_COOKIE_MAX_AGE_MS,
  REMEMBER_ME_AUTH_COOKIE_MAX_AGE_MS,
} from "../common/auth-cookie";
import { JwtPayload } from "../common/guards/auth-guard.types";
import { SessionRevocationService } from "../common/session/session-revocation.service";
import { UserService } from "./user.service";

describe("UserService session re-issue / logout-all (SESSION-REVOKE-01)", () => {
  const jwtService = new JwtService({ secret: "reissue-spec-secret" });
  const sessionRevocation = { revokeAllSessions: jest.fn() };
  const service = new UserService(
    {} as unknown as ClientProxy,
    jwtService,
    {} as unknown as ClientProxy,
    {} as unknown as CachedService,
    sessionRevocation as unknown as SessionRevocationService,
    {} as unknown as ClientProxy,
    {} as unknown as ClientProxy,
    {} as unknown as ClientProxy,
  );
  const claims = { userId: 42, email: "a@b.c", role: "shop", grants: [] };
  const DAY_MS = 24 * 60 * 60 * 1000;

  afterEach(() => jest.useRealTimers());

  it("re-signs the same claims with a fresh iat and the same exp", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-01T00:00:00Z"));
    const presented = jwtService.sign(claims, { expiresIn: "7d" });
    const original = jwtService.decode<JwtPayload>(presented);

    jest.setSystemTime(new Date("2026-10-02T00:00:00Z"));
    const reissued = service.reissueSessionToken(presented);

    expect(reissued).not.toBeNull();
    const decoded = jwtService.verify<JwtPayload>(reissued?.token ?? "");
    expect(decoded).toMatchObject(claims);
    expect(decoded.iat).toBe(Date.parse("2026-10-02T00:00:00Z") / 1000);
    expect(decoded.exp).toBe(original.exp);
    expect(reissued?.maxAgeMs).toBe(6 * DAY_MS);
  });

  it("caps a short-lived session's cookie at the default age", () => {
    const presented = jwtService.sign(claims, { expiresIn: "1d" });

    const reissued = service.reissueSessionToken(presented);

    expect(reissued?.maxAgeMs).toBe(DEFAULT_AUTH_COOKIE_MAX_AGE_MS);
    expect(DEFAULT_AUTH_COOKIE_MAX_AGE_MS).toBeLessThan(
      REMEMBER_ME_AUTH_COOKIE_MAX_AGE_MS,
    );
  });

  it("returns null without a token or without an exp", () => {
    expect(service.reissueSessionToken(null)).toBeNull();
    expect(service.reissueSessionToken(jwtService.sign(claims))).toBeNull();
  });

  it("turns a session-store failure on logout-all into a 503", async () => {
    sessionRevocation.revokeAllSessions.mockRejectedValue(new Error("down"));

    await expect(service.logoutAllSessions(42)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
