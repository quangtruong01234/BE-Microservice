import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { RegisterUserDto, UpdateUserGatewayDto } from "./user.dto";

const validateAs = <T extends object>(
  cls: new () => T,
  payload: Record<string, unknown>,
): string[] =>
  validateSync(
    plainToInstance(cls, payload) as object,
    // Same options as the gateway ValidationPipe.
    { whitelist: true, forbidNonWhitelisted: true },
  ).map((error) => error.property);

const validate = (payload: Record<string, unknown>): string[] =>
  validateAs(UpdateUserGatewayDto, payload);

describe("UpdateUserGatewayDto name trimming (NAME-TRIM-01)", () => {
  it.each(["   ", "\t", "\n  \t ", ""])(
    "rejects the whitespace-only name %j instead of storing it",
    (name) => {
      // `@MinLength(1)` alone passes "   " (length 3); the account then has a
      // stored name that renders blank in every label in the app.
      expect(validate({ name })).toEqual(["name"]);
    },
  );

  it("persists a padded name trimmed rather than verbatim", () => {
    const dto = plainToInstance(UpdateUserGatewayDto, { name: "  Quang  " });

    expect(validate({ name: "  Quang  " })).toEqual([]);
    expect(dto.name).toBe("Quang");
  });

  it("leaves an already-clean name untouched", () => {
    const dto = plainToInstance(UpdateUserGatewayDto, { name: "Quang Trường" });

    expect(validate({ name: "Quang Trường" })).toEqual([]);
    expect(dto.name).toBe("Quang Trường");
  });

  it("still treats an omitted name as leave-unchanged", () => {
    expect(validate({ email: "john@example.com" })).toEqual([]);
  });

  it("still accepts null as clear-the-name", () => {
    // `users.name` is nullable, so null stays the documented way to clear it
    // (SHAPE-01 rule 3) — trimming must not turn that into a 400.
    const dto = plainToInstance(UpdateUserGatewayDto, { name: null });

    expect(validate({ name: null })).toEqual([]);
    expect(dto.name).toBeNull();
  });

  it("still rejects a non-string name rather than trimming it", () => {
    expect(validate({ name: 42 })).toEqual(["name"]);
  });
});

describe("RegisterUserDto username trimming (NAME-TRIM-01)", () => {
  const registration = (username: unknown): Record<string, unknown> => ({
    username,
    email: "john@example.com",
    password: "Test@1234",
  });

  it.each(["   ", "", "\t\n "])(
    "refuses to create an account with the blank username %j",
    (username) => {
      // `username` is the fallback label when the display name is null, so a
      // blank one leaves the account with nothing renderable anywhere.
      expect(validateAs(RegisterUserDto, registration(username))).toEqual([
        "username",
      ]);
    },
  );

  it("stores a padded username trimmed, not as a look-alike of the clean one", () => {
    const dto = plainToInstance(RegisterUserDto, registration("  john  "));

    expect(validateAs(RegisterUserDto, registration("  john  "))).toEqual([]);
    expect(dto.username).toBe("john");
  });

  it("still accepts an ordinary username", () => {
    expect(validateAs(RegisterUserDto, registration("john_doe"))).toEqual([]);
  });
});
