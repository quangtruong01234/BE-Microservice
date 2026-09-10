import { Logger } from "@nestjs/common";
import { MailerService } from "./mailer.service";

/**
 * The undeliverable-recipient guard. Every assertion here runs with SMTP
 * UNCONFIGURED on purpose: both the guard and the no-SMTP fallback return
 * `false`, so the return value alone cannot tell them apart — the warn message
 * is what proves which branch ran, and no test ever opens a socket.
 */
describe("MailerService — undeliverable recipients", () => {
  const SMTP_KEYS = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_FROM",
    "MAIL_UNDELIVERABLE_DOMAINS",
  ];
  const savedEnv: Record<string, string | undefined> = {};
  let mailer: MailerService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    for (const key of SMTP_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    mailer = new MailerService();
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const key of SMTP_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    warn.mockRestore();
  });

  const lastWarn = (): string => {
    // The mailer only ever passes a string message to Logger.warn.
    const calls = warn.mock.calls as unknown as string[][];
    return calls.at(-1)?.[0] ?? "";
  };
  const send = (to: string): Promise<boolean> =>
    mailer.sendMail(to, "subject", "body");

  it.each([
    ["the project fixture domain", "chgpw_test@trybuy.com"],
    ["an RFC 2606 reserved domain", "someone@example.com"],
    ["a dot-suffixed reserved TLD", "someone@foo.invalid"],
    ["localhost", "someone@my.localhost"],
    ["a mixed-case domain", "techstore_demo@TryBuy.COM"],
  ])("skips %s without touching SMTP", async (_label, to) => {
    await expect(send(to)).resolves.toBe(false);
    expect(lastWarn()).toContain("Undeliverable recipient domain");
  });

  it("leaves a deliverable domain to the normal SMTP path", async () => {
    await expect(send("real@gmail.com")).resolves.toBe(false);
    expect(lastWarn()).toContain("SMTP not configured");
  });

  it("passes an address with no domain through — @IsEmail owns that case", async () => {
    await expect(send("not-an-address")).resolves.toBe(false);
    expect(lastWarn()).toContain("SMTP not configured");
  });

  it('disables the guard when MAIL_UNDELIVERABLE_DOMAINS is ""', async () => {
    process.env.MAIL_UNDELIVERABLE_DOMAINS = "";
    await expect(send("chgpw_test@trybuy.com")).resolves.toBe(false);
    expect(lastWarn()).toContain("SMTP not configured");
  });

  it("replaces the defaults when MAIL_UNDELIVERABLE_DOMAINS is set", async () => {
    process.env.MAIL_UNDELIVERABLE_DOMAINS =
      " blocked.test-corp.net , dead.net ";

    await expect(send("a@blocked.test-corp.net")).resolves.toBe(false);
    expect(lastWarn()).toContain("Undeliverable recipient domain");

    await expect(send("a@trybuy.com")).resolves.toBe(false);
    expect(lastWarn()).toContain("SMTP not configured");
  });
});
