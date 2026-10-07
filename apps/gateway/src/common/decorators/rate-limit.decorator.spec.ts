import { GUARDS_METADATA } from "@nestjs/common/constants";
import { CustomRateLimitGuard } from "../guards/rate-limit.guard";
import { RATE_LIMIT_OPTIONS_KEY, RateLimit } from "./rate-limit.decorator";

class Probe {
  @RateLimit({ limit: 5, ttl: 60, per: "user" })
  perUser(): null {
    return null;
  }

  @RateLimit()
  bare(): null {
    return null;
  }

  @RateLimit({ limit: 10 })
  perIp(): null {
    return null;
  }
}

function metadataOf(key: string, methodName: keyof Probe): unknown {
  // Read the method off its descriptor: a bare Probe.prototype.x reference
  // trips @typescript-eslint/unbound-method.
  const method: unknown = Object.getOwnPropertyDescriptor(
    Probe.prototype,
    methodName,
  )?.value;
  return Reflect.getMetadata(key, method as object);
}

describe("[TC-24] RateLimit decorator", () => {
  it('[TC-24] RateLimit({per:"user"}) attaches CustomRateLimitGuard via __guards__ metadata', () => {
    expect(metadataOf(GUARDS_METADATA, "perUser")).toEqual([
      CustomRateLimitGuard,
    ]);
    expect(metadataOf(RATE_LIMIT_OPTIONS_KEY, "perUser")).toEqual({
      limit: 5,
      ttl: 60,
      per: "user",
    });
  });

  it("[TC-24] RateLimit() and RateLimit({limit}) attach no guard", () => {
    expect(metadataOf(GUARDS_METADATA, "bare")).toBeUndefined();
    expect(metadataOf(GUARDS_METADATA, "perIp")).toBeUndefined();
    expect(metadataOf(RATE_LIMIT_OPTIONS_KEY, "bare")).toEqual({});
  });
});
