import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { ERROR_CODE } from "libs/constant/error-code.constant";
import { SessionRevocationService } from "../session/session-revocation.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { OptionalJwtAuthGuard } from "./optional-jwt-auth.guard";

function createContext(request: Record<string, unknown>): ExecutionContext {
  return {
    getType: () => "http",
    getHandler: () => createContext,
    getClass: () => JwtAuthGuard,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("JwtAuthGuard session revocation (SESSION-REVOKE-01)", () => {
  const jwtService = new JwtService({ secret: "jwt-auth-guard-spec-secret" });
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
  } as unknown as Reflector;
  const sessionRevocation = { isRevoked: jest.fn() };
  const guard = new JwtAuthGuard(
    jwtService,
    reflector,
    sessionRevocation as unknown as SessionRevocationService,
  );
  const token = jwtService.sign({ userId: 42, email: "a@b.c", role: "user" });

  beforeEach(() => jest.clearAllMocks());

  it("rejects a revoked token with the dead-session 401", async () => {
    sessionRevocation.isRevoked.mockResolvedValue(true);
    const request = { cookies: { access_token: token }, headers: {} };

    const attempt = guard.canActivate(createContext(request));

    await expect(attempt).rejects.toThrow(UnauthorizedException);
    await expect(attempt).rejects.toMatchObject({
      response: { errorCode: ERROR_CODE.UNAUTHENTICATED },
    });
    expect(sessionRevocation.isRevoked).toHaveBeenCalledWith(
      42,
      expect.any(Number),
    );
    expect(request).not.toHaveProperty("user");
  });

  it("lets a live token through and sets request.user", async () => {
    sessionRevocation.isRevoked.mockResolvedValue(false);
    const request: Record<string, unknown> = {
      cookies: {},
      headers: { authorization: `Bearer ${token}` },
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(request.user).toMatchObject({ id: 42, role: "user" });
  });

  it("never consults Redis for a token with a bad signature", async () => {
    const forged = new JwtService({ secret: "other" }).sign({ userId: 42 });
    const request = { cookies: { access_token: forged }, headers: {} };

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(sessionRevocation.isRevoked).not.toHaveBeenCalled();
  });

  it("OptionalJwtAuthGuard treats a revoked token as anonymous", async () => {
    sessionRevocation.isRevoked.mockResolvedValue(true);
    const optionalGuard = new OptionalJwtAuthGuard(
      jwtService,
      sessionRevocation as unknown as SessionRevocationService,
    );
    const request = { cookies: { access_token: token }, headers: {} };

    await expect(
      optionalGuard.canActivate(createContext(request)),
    ).resolves.toBe(true);
    expect(request).not.toHaveProperty("user");
  });
});
