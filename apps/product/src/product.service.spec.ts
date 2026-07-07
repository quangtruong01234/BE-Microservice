import { of } from "rxjs";
import { ClientProxy } from "@nestjs/microservices";
import { DataSource, EntityManager, Repository } from "typeorm";
import { CachedService } from "@app/cached";
import { ProductService } from "./product.service";
import { Product } from "./entity/product.entity";
import { Brand } from "./entity/brand.entity";
import { Category } from "./entity/category.entity";
import { ProductReview } from "./entity/product-review.entity";
import { ProductSku } from "./entity/product-sku.entity";
import { WishlistItem } from "./entity/wishlist-item.entity";

type SkuRow = Pick<
  ProductSku,
  | "id"
  | "productId"
  | "tierIdx"
  | "price"
  | "stockQuantity"
  | "sku"
  | "isActive"
>;

describe("ProductService.upsertSkus diff (P0-05)", () => {
  const productRepository = { findOne: jest.fn() };
  const skuRepository = { find: jest.fn() };
  const ordersClient = { send: jest.fn(), connect: jest.fn() };

  // Captures whatever was handed to manager.save / manager.delete in the txn.
  let savedPayload: ProductSku[] = [];

  const createMock = jest.fn(
    (_entity: unknown, obj: Partial<ProductSku>) => obj,
  );
  const saveMock = jest.fn((_entity: unknown, rows: ProductSku[]) => {
    savedPayload = rows;
    return Promise.resolve(rows);
  });
  const deleteMock = jest.fn(() => Promise.resolve({ affected: 1 }));

  const manager = {
    create: createMock,
    save: saveMock,
    delete: deleteMock,
  } as unknown as EntityManager;

  const dataSource = {
    transaction: jest.fn((cb: (m: EntityManager) => Promise<unknown>) =>
      cb(manager),
    ),
  };

  // Single variation with two options → tierIdx [0] and [1] are both valid.
  const product = {
    id: 1,
    variations: [{ name: "Color", options: ["Red", "Blue"] }],
  } as unknown as Product;

  let service: ProductService;

  beforeEach(() => {
    jest.clearAllMocks();
    savedPayload = [];
    productRepository.findOne.mockResolvedValue(product);
    service = new ProductService(
      productRepository as unknown as Repository<Product>,
      {} as unknown as Repository<Brand>,
      {} as unknown as Repository<Category>,
      {} as unknown as Repository<ProductReview>,
      skuRepository as unknown as Repository<ProductSku>,
      {} as unknown as Repository<WishlistItem>,
      dataSource as unknown as DataSource,
      {} as unknown as CachedService,
      null,
      ordersClient as unknown as ClientProxy,
    );
  });

  const existingSku = (id: number, tier: number[]): SkuRow => ({
    id,
    productId: 1,
    tierIdx: tier,
    price: 100,
    stockQuantity: 5,
    sku: `SKU-${id}`,
    isActive: true,
  });

  it("updates a matched SKU in place, preserving its id", async () => {
    skuRepository.find.mockResolvedValue([existingSku(5, [0])]);

    const result = await service.upsertSkus(1, [
      { tierIdx: "[0]", price: 150, stockQuantity: 9, sku: "SKU-5" },
    ]);

    expect(ordersClient.send).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(result[0].id).toBe(5);
    expect(result[0].price).toBe(150);
    expect(result[0].stockQuantity).toBe(9);
  });

  it("hard-deletes a removed SKU that is not referenced", async () => {
    skuRepository.find.mockResolvedValue([
      existingSku(5, [0]),
      existingSku(6, [1]),
    ]);
    ordersClient.send.mockReturnValue(of([])); // none referenced

    await service.upsertSkus(1, [{ tierIdx: "[0]", price: 100 }]);

    expect(ordersClient.send).toHaveBeenCalled();
    expect(deleteMock).toHaveBeenCalledTimes(1);
    // The removed SKU id 6 must not be soft-kept in the persisted set.
    expect(savedPayload.some((s) => s.id === 6)).toBe(false);
  });

  it("soft-deactivates a removed SKU that is still referenced", async () => {
    skuRepository.find.mockResolvedValue([
      existingSku(5, [0]),
      existingSku(6, [1]),
    ]);
    ordersClient.send.mockReturnValue(of([6])); // SKU 6 referenced

    await service.upsertSkus(1, [{ tierIdx: "[0]", price: 100 }]);

    expect(deleteMock).not.toHaveBeenCalled();
    const kept = savedPayload.find((s) => s.id === 6);
    expect(kept).toBeDefined();
    expect(kept?.isActive).toBe(false);
  });
});
