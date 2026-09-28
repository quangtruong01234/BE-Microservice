import { BadRequestException, ExecutionContext } from "@nestjs/common";
import { ERROR_CODE } from "libs/constant/error-code.constant";
import {
  CaptchaGuard,
  stripCaptchaToken,
  TURNSTILE_VERIFY_URL,
} from "./captcha.guard";

function createContext(body: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ body, ip: "203.0.113.7" }),
    }),
  } as unknown as ExecutionContext;
}

function turnstileReply(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function expectCaptchaRejection(
  pending: Promise<boolean>,
): Promise<void> {
  const error: unknown = await pending.catch((err: unknown) => err);
  expect(error).toBeInstanceOf(BadRequestException);
  const response = (error as BadRequestException).getResponse() as {
    errorCode?: string;
  };
  expect(response.errorCode).toBe(ERROR_CODE.CAPTCHA_REQUIRED);
}

describe("CaptchaGuard", () => {
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalEnforce = process.env.CAPTCHA_ENFORCE;
  let fetchSpy: jest.SpyInstance;
  let guard: CaptchaGuard;

  beforeEach(() => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    process.env.CAPTCHA_ENFORCE = "true";
    fetchSpy = jest.spyOn(global, "fetch");
    guard = new CaptchaGuard();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = originalSecret;
    if (originalEnforce === undefined) delete process.env.CAPTCHA_ENFORCE;
    else process.env.CAPTCHA_ENFORCE = originalEnforce;
  });

  it("is a no-op while TURNSTILE_SECRET_KEY is unset, even when enforced", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;

    await expect(guard.canActivate(createContext({}))).resolves.toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lets a request without a token through when not enforced", async () => {
    process.env.CAPTCHA_ENFORCE = "false";

    await expect(guard.canActivate(createContext({}))).resolves.toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a missing token with CAPTCHA_REQUIRED when enforced", async () => {
    await expectCaptchaRejection(
      guard.canActivate(createContext({ captchaToken: "   " })),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("verifies a present token against siteverify and allows a pass", async () => {
    fetchSpy.mockResolvedValue(turnstileReply({ success: true }));

    await expect(
      guard.canActivate(createContext({ captchaToken: "good-token" })),
    ).resolves.toBe(true);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TURNSTILE_VERIFY_URL);
    const sentForm = new URLSearchParams(init.body as string);
    expect(sentForm.get("secret")).toBe("test-secret");
    expect(sentForm.get("response")).toBe("good-token");
    expect(sentForm.get("remoteip")).toBe("203.0.113.7");
  });

  it("rejects a token Turnstile refuses when enforced", async () => {
    fetchSpy.mockResolvedValue(
      turnstileReply({
        success: false,
        "error-codes": ["invalid-input-response"],
      }),
    );

    await expectCaptchaRejection(
      guard.canActivate(createContext({ captchaToken: "bad-token" })),
    );
  });

  it("only logs a refused token in shadow mode (not enforced)", async () => {
    process.env.CAPTCHA_ENFORCE = "false";
    fetchSpy.mockResolvedValue(
      turnstileReply({
        success: false,
        "error-codes": ["timeout-or-duplicate"],
      }),
    );

    await expect(
      guard.canActivate(createContext({ captchaToken: "reused-token" })),
    ).resolves.toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("fails open when siteverify is unreachable", async () => {
    fetchSpy.mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      guard.canActivate(createContext({ captchaToken: "any-token" })),
    ).resolves.toBe(true);
  });

  it("fails open on a non-2xx siteverify answer", async () => {
    fetchSpy.mockResolvedValue(turnstileReply({}, 503));

    await expect(
      guard.canActivate(createContext({ captchaToken: "any-token" })),
    ).resolves.toBe(true);
  });

  it("fails open when Cloudflare blames our secret, not the user", async () => {
    fetchSpy.mockResolvedValue(
      turnstileReply({
        success: false,
        "error-codes": ["invalid-input-secret"],
      }),
    );

    await expect(
      guard.canActivate(createContext({ captchaToken: "any-token" })),
    ).resolves.toBe(true);
  });

  it("rejects an oversized token without calling siteverify", async () => {
    await expectCaptchaRejection(
      guard.canActivate(createContext({ captchaToken: "x".repeat(2049) })),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("stripCaptchaToken", () => {
  it("drops captchaToken and keeps every other field", () => {
    const registerDto = {
      username: "someone",
      email: "someone@example.com",
      password: "secret123",
      captchaToken: "token",
    };

    expect(stripCaptchaToken(registerDto)).toEqual({
      username: "someone",
      email: "someone@example.com",
      password: "secret123",
    });
    expect(registerDto.captchaToken).toBe("token");
  });
});
