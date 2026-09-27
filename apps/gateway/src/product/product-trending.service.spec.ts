import { ClientProxy } from "@nestjs/microservices";
import { Observable, of, throwError } from "rxjs";
import { CachedService } from "@app/cached";
import { PRODUCT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-product.constant";
import { ProductService } from "./product.service";

/**
 * RAIL-RANK-01 — `GET /api/products/trending`. Ranked by units sold, kept only
 * while active and in stock, backfilled by ratingCount. Every ranking input
 * fails OPEN; only the product leg may fail the request.
 */
describe("ProductService.getTrendingProducts (RAIL-RANK-01)", () => {
  const productClient = { send: jest.fn() };
  const inventoryClient = { send: jest.fn() };
  const userClient = { send: jest.fn() };
  const ordersClient = { send: jest.fn() };
  const cached = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  let service: ProductService;

  const product = (id: number, isActive = true): Record<string, unknown> => ({
    id,
    publicId: `prod_${String(id).padStart(16, "0")}`,
    name: `Product ${id}`,
    userId: 31,
    isActive,
  });

  // 1 sells most; 2 is deactivated; 3 is sold out; 4 is a SKU-matrix product
  // whose stock only exists across per-SKU rows; 5 and 6 never sold.
  const catalog = [
    product(1),
    product(2, false),
    product(3),
    product(4),
    product(5),
    product(6),
  ];
  const stockRows = [
    { productId: 1, availableStock: 10 },
    { productId: 2, availableStock: 10 },
    { productId: 3, availableStock: 0 },
    { productId: 4, productSkuId: 40, availableStock: 0 },
    { productId: 4, productSkuId: 41, availableStock: 2 },
    { productId: 5, availableStock: 5 },
    { productId: 6, availableStock: 5 },
  ];
  const ranking = [
    { productId: 1, productPublicId: null, soldCount: 9 },
    { productId: 2, productPublicId: null, soldCount: 8 },
    { productId: 3, productPublicId: null, soldCount: 7 },
    { productId: 4, productPublicId: null, soldCount: 6 },
  ];

  const mockProductLeg = (): void => {
    productClient.send.mockImplementation(
      (pattern: string, payload: unknown): Observable<unknown> =>
        pattern === PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_IDS
          ? of(
              catalog.filter((row) =>
                (payload as number[]).includes(row.id as number),
              ),
            )
          : // Backfill page: the catalog sorted by ratingCount, 6 before 5.
            of({ items: [product(6), product(5), product(1)], total: 3 }),
    );
  };
  const mockInventoryLeg = (): void => {
    inventoryClient.send.mockImplementation(
      (_pattern: string, productIds: number[]): Observable<unknown> =>
        of(stockRows.filter((row) => productIds.includes(row.productId))),
    );
  };
  const trendingIds = async (limit: number): Promise<unknown[]> =>
    (await service.getTrendingProducts(limit)).map((row) => row.name);

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProductService(
      productClient as unknown as ClientProxy,
      inventoryClient as unknown as ClientProxy,
      userClient as unknown as ClientProxy,
      ordersClient as unknown as ClientProxy,
      cached as unknown as CachedService,
    );
    cached.get.mockResolvedValue(null);
    cached.set.mockResolvedValue("OK");
    userClient.send.mockReturnValue(of([]));
    ordersClient.send.mockReturnValue(of(ranking));
    mockProductLeg();
    mockInventoryLeg();
  });

  it("ranks by units sold, drops inactive and sold-out, sums SKU stock", async () => {
    const trending = await service.getTrendingProducts(2);

    expect(trending.map((row) => row.name)).toEqual(["Product 1", "Product 4"]);
    expect(trending.map((row) => row.soldCount)).toEqual([9, 6]);
    // Exposed like every other product read (PUBID).
    expect(trending[0].id).toBe("prod_0000000000000001");
  });

  it("backfills by ratingCount with soldCount 0 and no duplicates", async () => {
    const trending = await service.getTrendingProducts(4);

    expect(trending.map((row) => row.name)).toEqual([
      "Product 1",
      "Product 4",
      "Product 6",
      "Product 5",
    ]);
    expect(trending.map((row) => row.soldCount)).toEqual([9, 6, 0, 0]);
  });

  it("falls back to the pure backfill when the orders ranking is down", async () => {
    ordersClient.send.mockReturnValue(
      throwError(() => new Error("orders service down")),
    );

    expect(await trendingIds(3)).toEqual([
      "Product 6",
      "Product 5",
      "Product 1",
    ]);
  });

  it("skips the stock filter when inventory is down instead of failing", async () => {
    inventoryClient.send.mockReturnValue(
      throwError(() => new Error("inventory service down")),
    );

    // Product 3 (sold out) is back in; product 2 (inactive) is still out.
    expect(await trendingIds(3)).toEqual([
      "Product 1",
      "Product 3",
      "Product 4",
    ]);
  });

  it("fails the request when the product service is down", async () => {
    productClient.send.mockReturnValue(
      throwError(() => new Error("product service down")),
    );

    await expect(service.getTrendingProducts(5)).rejects.toThrow();
    expect(cached.set).not.toHaveBeenCalled();
  });

  it("serves a cached answer without touching any service", async () => {
    cached.get.mockResolvedValue(JSON.stringify([{ id: "prod_cached" }]));

    expect(await service.getTrendingProducts(5)).toEqual([
      { id: "prod_cached" },
    ]);
    expect(ordersClient.send).not.toHaveBeenCalled();
    expect(productClient.send).not.toHaveBeenCalled();
  });
});
