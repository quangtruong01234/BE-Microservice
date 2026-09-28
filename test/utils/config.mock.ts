import { ConfigService } from "@nestjs/config";

export interface ConfigMock {
  /** Pass to `useValue` or a constructor where `ConfigService` is expected. */
  configService: ConfigService;
  get: jest.Mock<unknown, [string, unknown?]>;
  getOrThrow: jest.Mock<unknown, [string]>;
  /** Change or add a key after creation (e.g. flip a feature flag mid-suite). */
  setValue: (key: string, value: unknown) => void;
}

/**
 * A `ConfigService` backed by a plain object — never by `process.env` or a
 * `.env` file, so a spec cannot pick up a developer's real secrets and behaves
 * the same on every machine and in CI.
 *
 * `get(key, default)` returns the default for a missing key, like the real one.
 * `getOrThrow(key)` throws for a missing key, like the real one.
 */
export function createConfigMock(
  values: Record<string, unknown> = {},
): ConfigMock {
  const valueByKey = new Map<string, unknown>(Object.entries(values));

  const get = jest.fn<unknown, [string, unknown?]>(
    (key: string, defaultValue?: unknown) =>
      valueByKey.has(key) ? valueByKey.get(key) : defaultValue,
  );
  const getOrThrow = jest.fn<unknown, [string]>((key: string) => {
    if (!valueByKey.has(key)) {
      throw new TypeError(`Configuration key "${key}" does not exist`);
    }
    return valueByKey.get(key);
  });

  return {
    configService: { get, getOrThrow } as unknown as ConfigService,
    get,
    getOrThrow,
    setValue: (key: string, value: unknown): void => {
      valueByKey.set(key, value);
    },
  };
}
