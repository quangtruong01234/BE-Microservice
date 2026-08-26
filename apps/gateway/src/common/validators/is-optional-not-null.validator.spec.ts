import {
  IsBoolean,
  IsNumber,
  IsOptional,
  Min,
  validate,
} from "class-validator";
import { IsOptionalNotNull } from "./is-optional-not-null.validator";

class Subject {
  // The pair this decorator exists for: optional, but backed by a NOT NULL
  // column, so `null` is a client mistake rather than "clear it".
  @IsOptionalNotNull()
  @IsNumber()
  @Min(0)
  minOrderAmount?: number;

  @IsOptionalNotNull()
  @IsBoolean()
  isActive?: boolean;

  // Genuinely nullable — `null` means "clear it" and must stay accepted.
  @IsOptional()
  @IsNumber()
  maxDiscountAmount?: number | null;

  constructor(values: Partial<Subject>) {
    Object.assign(this, values);
  }
}

async function failingProperties(instance: object): Promise<string[]> {
  const errors = await validate(instance);
  return errors.map((error) => error.property);
}

describe("IsOptionalNotNull", () => {
  it("skips validation when the key is omitted", async () => {
    await expect(failingProperties(new Subject({}))).resolves.toEqual([]);
  });

  it("skips validation on an explicit undefined", async () => {
    await expect(
      failingProperties(new Subject({ minOrderAmount: undefined })),
    ).resolves.toEqual([]);
  });

  it("rejects an explicit null instead of letting it through", async () => {
    // This is the whole point: `@IsOptional()` would pass `null` down to the
    // service, where `.toFixed(2)` threw a TypeError and produced a 500.
    await expect(
      failingProperties(
        new Subject({ minOrderAmount: null as unknown as number }),
      ),
    ).resolves.toEqual(["minOrderAmount"]);

    await expect(
      failingProperties(new Subject({ isActive: null as unknown as boolean })),
    ).resolves.toEqual(["isActive"]);
  });

  it("still validates the underlying constraints when a value is present", async () => {
    await expect(
      failingProperties(new Subject({ minOrderAmount: -1 })),
    ).resolves.toEqual(["minOrderAmount"]);

    await expect(
      failingProperties(new Subject({ minOrderAmount: 0, isActive: true })),
    ).resolves.toEqual([]);
  });

  it("leaves `@IsOptional()` fields free to be cleared with null", async () => {
    await expect(
      failingProperties(new Subject({ maxDiscountAmount: null })),
    ).resolves.toEqual([]);
  });
});
