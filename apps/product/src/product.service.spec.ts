import { of } from "rxjs";
import { ConflictException } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { DataSource, EntityManager, Repository } from "typeorm";
import { CachedService } from "@app/cached";
import { CloudinaryService } from "@app/common";
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
      {} as unknown as CloudinaryService,
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

describe("ProductService catalog lookup cache", () => {
  const productRepository = {};
  const brandRepository = {
    create: jest.fn((dto: Partial<Brand>) => dto),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  };
  const categoryRepository = {
    create: jest.fn((dto: Partial<Category>) => dto),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  };
  const skuRepository = {};
  const cachedService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };
  const ordersClient = { send: jest.fn(), connect: jest.fn() };

  let service: ProductService;

  beforeEach(() => {
    jest.clearAllMocks();
    cachedService.set.mockResolvedValue("OK");
    cachedService.del.mockResolvedValue(1);
    brandRepository.findOne.mockResolvedValue(null);
    categoryRepository.findOne.mockResolvedValue(null);
    service = new ProductService(
      productRepository as unknown as Repository<Product>,
      brandRepository as unknown as Repository<Brand>,
      categoryRepository as unknown as Repository<Category>,
      {} as unknown as Repository<ProductReview>,
      skuRepository as unknown as Repository<ProductSku>,
      {} as unknown as Repository<WishlistItem>,
      {} as unknown as DataSource,
      cachedService as unknown as CachedService,
      {} as unknown as CloudinaryService,
      null,
      ordersClient as unknown as ClientProxy,
    );
  });

  it("returns cached active brands without querying the repository", async () => {
    const cachedBrands = [{ id: 1, name: "Acme" }];
    cachedService.get.mockResolvedValue(JSON.stringify(cachedBrands));

    const result = await service.findAllBrands();

    expect(result).toEqual(cachedBrands);
    expect(cachedService.get).toHaveBeenCalledWith("products:brands:active");
    expect(brandRepository.find).not.toHaveBeenCalled();
  });

  it("caches category list misses by requested status", async () => {
    const pendingCategories = [{ id: 2, name: "Pending category" }];
    cachedService.get.mockResolvedValue(null);
    categoryRepository.find.mockResolvedValue(pendingCategories);

    const result = await service.findAllCategories("pending");

    expect(result).toEqual(pendingCategories);
    expect(categoryRepository.find).toHaveBeenCalledWith({
      where: { status: "pending" },
      order: { name: "ASC" },
    });
    expect(cachedService.set).toHaveBeenCalledWith(
      "products:categories:pending",
      JSON.stringify(pendingCategories),
      300,
    );
  });

  it("invalidates every brand list variant after creating a brand", async () => {
    const savedBrand = { id: 3, name: "Pending brand" };
    brandRepository.findOne.mockResolvedValue(null);
    brandRepository.save.mockResolvedValue(savedBrand);

    const result = await service.createBrand({ name: "Pending brand" }, 17);

    expect(result).toBe(savedBrand);
    expect(cachedService.del).toHaveBeenCalledWith("products:brands:active");
    expect(cachedService.del).toHaveBeenCalledWith("products:brands:pending");
    expect(cachedService.del).toHaveBeenCalledWith("products:brands:rejected");
  });

  it("rejects a brand proposal that duplicates an active or pending brand name", async () => {
    brandRepository.findOne.mockResolvedValue({
      id: 4,
      name: "Acme",
      status: "active",
    });

    await expect(
      service.createBrand({ name: " acme " }, 17),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(brandRepository.save).not.toHaveBeenCalled();
    expect(cachedService.del).not.toHaveBeenCalled();
  });

  it("rejects a category proposal that duplicates an active or pending category name", async () => {
    categoryRepository.findOne.mockResolvedValue({
      id: 5,
      name: "Phones",
      status: "pending",
    });

    await expect(
      service.createCategory({ name: "PHONES" }, 17),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(categoryRepository.save).not.toHaveBeenCalled();
    expect(cachedService.del).not.toHaveBeenCalled();
  });
});
