import { CachedService } from "@app/cached";
import { JwtService } from "@nestjs/jwt";
import { ClientProxy } from "@nestjs/microservices";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { Observable, of, throwError } from "rxjs";
import {
  CART_MESSAGE_PATTERN,
  NOTIFICATION_MESSAGE_PATTERN,
  ORDER_MESSAGE_PATTERN,
  SOCIAL_MESSAGE_PATTERN,
  USER_MESSAGE_PATTERN,
} from "libs/constant/message-pattern.constant";
import { PRODUCT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-product.constant";
import { SessionRevocationService } from "../common/session/session-revocation.service";
import { DeleteAccountDto } from "./dto/user.dto";
import { UserService } from "./user.service";

type Pattern = string | { cmd: string };

describe("UserService.deleteAccount (ACCOUNT-DELETE-01)", () => {
  let sentPatterns: Pattern[];
  let failingPattern: Pattern | null;

  const createClient = (): ClientProxy =>
    ({
      send: jest.fn((pattern: Pattern): Observable<unknown> => {
        sentPatterns.push(pattern);
        if (JSON.stringify(pattern) === JSON.stringify(failingPattern)) {
          return throwError(() => ({
            status: 401,
            message: "Current password is incorrect",
          }));
        }
        return of(
          pattern === ORDER_MESSAGE_PATTERN.CANCEL_OPEN_ORDERS_FOR_USER
            ? { canceledOrderCount: 2 }
            : { success: true },
        );
      }),
    }) as unknown as ClientProxy;

  const createService = (): UserService =>
    new UserService(
      createClient(),
      {} as unknown as JwtService,
      createClient(),
      {} as unknown as CachedService,
      {} as unknown as SessionRevocationService,
      createClient(),
      createClient(),
      createClient(),
    );

  beforeEach(() => {
    sentPatterns = [];
    failingPattern = null;
  });

  // TC-5
  it("verifies first, purges every service, and scrubs the user last", async () => {
    await expect(
      createService().deleteAccount(9, { currentPassword: "secret" }),
    ).resolves.toEqual({ success: true, canceledOrderCount: 2 });

    expect(sentPatterns).toEqual([
      { cmd: USER_MESSAGE_PATTERN.VERIFY_ACCOUNT_DELETION },
      ORDER_MESSAGE_PATTERN.CANCEL_OPEN_ORDERS_FOR_USER,
      CART_MESSAGE_PATTERN.CART_CLEAR,
      PRODUCT_MESSAGE_PATTERNS.PURGE_USER_DATA,
      SOCIAL_MESSAGE_PATTERN.PURGE_USER_DATA,
      NOTIFICATION_MESSAGE_PATTERN.PURGE_USER_DATA,
      { cmd: USER_MESSAGE_PATTERN.DELETE_ACCOUNT },
    ]);
  });

  it("touches nothing when the password check fails", async () => {
    failingPattern = { cmd: USER_MESSAGE_PATTERN.VERIFY_ACCOUNT_DELETION };

    await expect(
      createService().deleteAccount(9, { currentPassword: "wrong" }),
    ).rejects.toMatchObject({ status: 401 });
    expect(sentPatterns).toEqual([
      { cmd: USER_MESSAGE_PATTERN.VERIFY_ACCOUNT_DELETION },
    ]);
  });

  it("never reaches the irreversible scrub when a purge leg fails", async () => {
    failingPattern = SOCIAL_MESSAGE_PATTERN.PURGE_USER_DATA;

    await expect(
      createService().deleteAccount(9, { currentPassword: "secret" }),
    ).rejects.toBeDefined();
    expect(sentPatterns).not.toContainEqual({
      cmd: USER_MESSAGE_PATTERN.DELETE_ACCOUNT,
    });
    expect(sentPatterns).not.toContain(
      NOTIFICATION_MESSAGE_PATTERN.PURGE_USER_DATA,
    );
  });

  // TC-6
  it("rejects a body without currentPassword", async () => {
    const missing = await validate(plainToInstance(DeleteAccountDto, {}));
    const blank = await validate(
      plainToInstance(DeleteAccountDto, { currentPassword: "" }),
    );
    const valid = await validate(
      plainToInstance(DeleteAccountDto, { currentPassword: "secret" }),
    );

    expect(missing.map((error) => error.property)).toEqual(["currentPassword"]);
    expect(blank.map((error) => error.property)).toEqual(["currentPassword"]);
    expect(valid).toEqual([]);
  });
});
