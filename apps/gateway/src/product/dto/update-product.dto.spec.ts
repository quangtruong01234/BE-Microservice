import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { UpdateProductDto } from "./update-product.dto";

const validate = (payload: Record<string, unknown>): string[] =>
  validateSync(
    plainToInstance(UpdateProductDto, payload) as object,
    // Same options as the gateway ValidationPipe.
    { whitelist: true, forbidNonWhitelisted: true },
  ).map((error) => error.property);

describe("UpdateProductDto null handling", () => {
  it.each([
    "description",
    "sku",
    "brandId",
    "sellerNotes",
    "weight",
    "imageUrls",
  ])("accepts null on the clearable field %s", (field) => {
    expect(validate({ [field]: null })).toEqual([]);
  });

  it("keeps null as null instead of coercing it to 0/empty", () => {
    const dto = plainToInstance(UpdateProductDto, {
      brandId: null,
      weight: null,
      description: null,
    });

    expect(dto.brandId).toBeNull();
    expect(dto.weight).toBeNull();
    expect(dto.description).toBeNull();
  });

  it.each([
    "name",
    "price",
    "stockQuantity",
    "categoryIds",
    "isActive",
    "condition",
    "rating",
    "ratingCount",
    "version",
    "variations",
    "skuList",
  ])("rejects null on the non-clearable field %s", (field) => {
    // Without this the DB rejects the write instead and the seller gets a 500.
    expect(validate({ [field]: null })).toEqual([field]);
  });

  it("still treats an omitted field as leave-unchanged", () => {
    expect(validate({ name: "Bình giữ nhiệt" })).toEqual([]);
  });

  it("still validates the type of a non-null value", () => {
    expect(validate({ description: 42 })).toEqual(["description"]);
    expect(validate({ weight: -1 })).toEqual(["weight"]);
  });
});
