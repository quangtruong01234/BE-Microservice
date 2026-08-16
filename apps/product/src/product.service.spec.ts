import { defer, of, throwError } from "rxjs";
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
import { ProductImageHashService } from "./product-image-hash.service";

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
      {} as unknown as ProductImageHashService,
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

  it("retries the reference check once so a stale socket does not downgrade a delete", async () => {
    skuRepository.find.mockResolvedValue([
      existingSku(5, [0]),
      existingSku(6, [1]),
    ]);
    let attempts = 0;
    ordersClient.send.mockReturnValue(
      defer(() => {
        attempts += 1;
        return attempts === 1
          ? throwError(() => new Error("Connection closed"))
          : of([]);
      }),
    );

    await service.upsertSkus(1, [{ tierIdx: "[0]", price: 100 }]);

    expect(attempts).toBe(2);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(savedPayload.some((s) => s.id === 6)).toBe(false);
  });

  it("falls back to treating every candidate as referenced when the retry also fails", async () => {
    skuRepository.find.mockResolvedValue([
      existingSku(5, [0]),
      existingSku(6, [1]),
    ]);
    ordersClient.send.mockReturnValue(
      throwError(() => new Error("orders service down")),
    );

    await service.upsertSkus(1, [{ tierIdx: "[0]", price: 100 }]);

    expect(deleteMock).not.toHaveBeenCalled();
    expect(savedPayload.find((s) => s.id === 6)?.isActive).toBe(false);
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
      {} as unknown as ProductImageHashService,
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

describe("ProductService.findAllProducts storefront visibility (BUG-B)", () => {
  const queryBuilder = {
    andWhere: jest.fn(),
    leftJoin: jest.fn(),
    getCount: jest.fn(),
    clone: jest.fn(),
    select: jest.fn(),
    addSelect: jest.fn(),
    distinct: jest.fn(),
    orderBy: jest.fn(),
    offset: jest.fn(),
    limit: jest.fn(),
    getRawMany: jest.fn(),
  };
  const productRepository = {
    createQueryBuilder: jest.fn(() => queryBuilder),
    find: jest.fn(),
  };
  const cachedService = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  const ordersClient = { send: jest.fn(), connect: jest.fn() };

  let service: ProductService;

  /** Every `product.isActive = :isActive` value the query received. */
  const isActiveFilters = (): unknown[] =>
    (
      queryBuilder.andWhere.mock.calls as unknown as [
        string,
        { isActive?: unknown },
      ][]
    )
      .filter(([condition]) => condition === "product.isActive = :isActive")
      .map(([, params]) => params.isActive);

  beforeEach(() => {
    jest.clearAllMocks();
    // Chainable builder: every step returns the builder itself.
    for (const method of [
      "andWhere",
      "leftJoin",
      "clone",
      "select",
      "addSelect",
      "distinct",
      "orderBy",
      "offset",
      "limit",
    ] as const) {
      queryBuilder[method].mockReturnValue(queryBuilder);
    }
    queryBuilder.getCount.mockResolvedValue(0);
    queryBuilder.getRawMany.mockResolvedValue([]);
    productRepository.find.mockResolvedValue([]);
    cachedService.get.mockResolvedValue(null);
    cachedService.set.mockResolvedValue("OK");
    service = new ProductService(
      productRepository as unknown as Repository<Product>,
      {} as unknown as Repository<Brand>,
      {} as unknown as Repository<Category>,
      {} as unknown as Repository<ProductReview>,
      {} as unknown as Repository<ProductSku>,
      {} as unknown as Repository<WishlistItem>,
      {} as unknown as DataSource,
      cachedService as unknown as CachedService,
      {} as unknown as CloudinaryService,
      {} as unknown as ProductImageHashService,
      null,
      ordersClient as unknown as ClientProxy,
    );
  });

  it("hides deactivated products from an unscoped storefront browse", async () => {
    await service.findAllProducts({});

    expect(isActiveFilters()).toEqual([true]);
  });

  it("keeps hiding them when the browse is filtered by seller province", async () => {
    // The province filter arrives as `userIds` (plural) — that must NOT be
    // treated as the seller's own dashboard.
    await service.findAllProducts({ userIds: [17, 18] });

    expect(isActiveFilters()).toEqual([true]);
  });

  it("returns every state for a single-seller scoped read (seller dashboard)", async () => {
    await service.findAllProducts({ userId: 17 });

    expect(isActiveFilters()).toEqual([]);
  });

  it("still honours an explicit isActive filter", async () => {
    await service.findAllProducts({ isActive: false });

    expect(isActiveFilters()).toEqual([false]);
  });

  it("caches the unscoped browse under a key that pins the default", async () => {
    await service.findAllProducts({});

    // The key must carry isActive so entries written before this default
    // existed can never be served back to the storefront.
    const [[cacheKey]] = cachedService.get.mock.calls as unknown as [string][];
    expect(cacheKey).toContain('"isActive":true');
  });
});

describe("ProductService.getPriceSuggestion", () => {
  const productRepository = { query: jest.fn() };
  const ordersClient = { send: jest.fn(), connect: jest.fn() };
  let service: ProductService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProductService(
      productRepository as unknown as Repository<Product>,
      {} as unknown as Repository<Brand>,
      {} as unknown as Repository<Category>,
      {} as unknown as Repository<ProductReview>,
      {} as unknown as Repository<ProductSku>,
      {} as unknown as Repository<WishlistItem>,
      {} as unknown as DataSource,
      {} as unknown as CachedService,
      {} as unknown as CloudinaryService,
      {} as unknown as ProductImageHashService,
      null,
      ordersClient as unknown as ClientProxy,
    );
  });

  it("returns rounded catalog percentiles for a sufficient sample", async () => {
    productRepository.query.mockResolvedValue([
      {
        sampleSize: "4",
        median: "150000.50",
        p25: "100000.00",
        p75: "200000.00",
        min: "90000.00",
        max: "300000.00",
      },
    ]);

    await expect(
      service.getPriceSuggestion({
        categoryId: 18,
        brandId: 4,
        condition: "used",
      }),
    ).resolves.toEqual({
      sufficientData: true,
      sampleSize: 4,
      median: 150001,
      p25: 100000,
      p75: 200000,
      min: 90000,
      max: 300000,
    });
    expect(productRepository.query).toHaveBeenCalledWith(
      expect.stringContaining("LEFT JOIN product_skus"),
      [18, 4, "used"],
    );
  });

  it("suppresses price values when fewer than three samples exist", async () => {
    productRepository.query.mockResolvedValue([
      {
        sampleSize: 2,
        median: 150000,
        p25: 100000,
        p75: 200000,
        min: 100000,
        max: 200000,
      },
    ]);

    await expect(
      service.getPriceSuggestion({ categoryId: 18 }),
    ).resolves.toEqual({
      sufficientData: false,
      sampleSize: 2,
      median: null,
      p25: null,
      p75: null,
      min: null,
      max: null,
    });
  });
});

describe("ProductService media cleanup — description images (UP-03)", () => {
  const asset = (leaf: string): string =>
    `https://res.cloudinary.com/demo/image/upload/v1712345678/trybuy/products/${leaf}`;

  const galleryUrl = asset("17_gallery.png");
  const embeddedUrl = asset("17_embedded.png");

  const destroyAssets = jest.fn(() => Promise.resolve());
  const getCount = jest.fn();
  const productRepository = {
    findOne: jest.fn(),
    remove: jest.fn(() => Promise.resolve()),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getCount,
    })),
  };
  const cachedService = { keys: jest.fn(() => Promise.resolve([])) };
  const ordersClient = { send: jest.fn(), connect: jest.fn() };

  let service: ProductService;

  // The cleanup is fire-and-forget (`void`), so the mutation resolves before it
  // runs — drain the microtask queue before asserting on Cloudinary.
  const flushCleanup = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve));

  const productWith = (description: string | null): Product =>
    ({
      id: 1,
      imageUrls: [galleryUrl],
      description,
    }) as unknown as Product;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProductService(
      productRepository as unknown as Repository<Product>,
      {} as unknown as Repository<Brand>,
      {} as unknown as Repository<Category>,
      {} as unknown as Repository<ProductReview>,
      {} as unknown as Repository<ProductSku>,
      {} as unknown as Repository<WishlistItem>,
      {} as unknown as DataSource,
      cachedService as unknown as CachedService,
      { destroyAssets } as unknown as CloudinaryService,
      {} as unknown as ProductImageHashService,
      null,
      ordersClient as unknown as ClientProxy,
    );
  });

  it("destroys an image embedded in the description when the product is deleted", async () => {
    productRepository.findOne.mockResolvedValue(
      productWith(`<p>Mô tả</p><img src="${embeddedUrl}">`),
    );
    getCount.mockResolvedValue(0);

    await service.deleteProduct(1);
    await flushCleanup();

    expect(destroyAssets).toHaveBeenCalledTimes(1);
    expect(destroyAssets).toHaveBeenCalledWith([galleryUrl, embeddedUrl]);
  });

  it("keeps an asset another product still references", async () => {
    productRepository.findOne.mockResolvedValue(
      productWith(`<img src="${embeddedUrl}">`),
    );
    // Gallery image is orphaned; the embedded one is re-used elsewhere.
    getCount.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    await service.deleteProduct(1);
    await flushCleanup();

    expect(destroyAssets).toHaveBeenCalledWith([galleryUrl]);
  });

  it("counts an asset once when it sits in both imageUrls and the description", async () => {
    productRepository.findOne.mockResolvedValue(
      productWith(`<img src="${galleryUrl}">`),
    );
    getCount.mockResolvedValue(0);

    await service.deleteProduct(1);
    await flushCleanup();

    expect(destroyAssets).toHaveBeenCalledWith([galleryUrl]);
  });

  it("destroys nothing when the reference check itself fails", async () => {
    productRepository.findOne.mockResolvedValue(
      productWith(`<img src="${embeddedUrl}">`),
    );
    getCount.mockRejectedValue(new Error("db down"));

    await expect(service.deleteProduct(1)).resolves.toEqual({ success: true });
    await flushCleanup();

    expect(destroyAssets).not.toHaveBeenCalled();
  });
});
