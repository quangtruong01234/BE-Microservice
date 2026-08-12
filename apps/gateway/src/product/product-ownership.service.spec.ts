import { ForbiddenException } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { of, throwError } from "rxjs";
import { INVENTORY_MESSAGE_PATTERNS } from "libs/constant/message-pattern-inventory.constant";
import { PRODUCT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-product.constant";
import { ProductService } from "./product.service";

describe("ProductService ownership", () => {
  const productClient = { send: jest.fn() };
  const inventoryClient = { send: jest.fn() };
  const userClient = { send: jest.fn() };
  const ordersClient = { send: jest.fn() };
  const cachedService = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    del: jest.fn().mockResolvedValue(1),
    keys: jest.fn().mockResolvedValue([]),
  };
  let service: ProductService;

  beforeEach(() => {
    jest.clearAllMocks();
    cachedService.get.mockResolvedValue(null);
    cachedService.keys.mockResolvedValue([]);
    service = new ProductService(
      productClient as unknown as ClientProxy,
      inventoryClient as unknown as ClientProxy,
      userClient as unknown as ClientProxy,
      ordersClient as unknown as ClientProxy,
      cachedService as unknown as import("@app/cached").CachedService,
    );
  });

  it("rejects updating another user's product", async () => {
    productClient.send.mockReturnValue(of({ id: 16, userId: 20 }));

    await expect(
      service.updateProduct(16, {}, 18, "user"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(productClient.send).toHaveBeenCalledTimes(1);
  });

  it("allows an admin to update a product", async () => {
    productClient.send.mockReturnValue(of({ id: 16, userId: 20 }));
    userClient.send.mockReturnValue(
      of([{ id: 20, publicId: "usr_1111111111111111" }]),
    );

    await expect(service.updateProduct(16, {}, 21, "admin")).resolves.toEqual({
      id: 16,
      userId: "usr_1111111111111111",
    });
    expect(productClient.send).toHaveBeenCalledWith(
      PRODUCT_MESSAGE_PATTERNS.PRODUCT_UPDATE,
      { id: 16, updateProductDto: {} },
    );
  });

  it("rejects deleting another user's product", async () => {
    productClient.send.mockReturnValue(of({ id: 16, userId: 20 }));

    await expect(service.deleteProduct(16, 18, "user")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(productClient.send).toHaveBeenCalledTimes(1);
  });

  it("omits email from single-product seller enrichment", async () => {
    productClient.send.mockReturnValue(
      of({ id: 16, userId: 20, categories: [] }),
    );
    userClient.send
      .mockReturnValueOnce(
        of({
          id: 20,
          publicId: "usr_1111111111111111",
          username: "seller20",
          name: "Seller 20",
          avatar: "avatar.jpg",
          email: "seller20@example.test",
        }),
      )
      .mockReturnValueOnce(of([{ id: 20, publicId: "usr_1111111111111111" }]));

    const product = (await service.getProductById(16)) as {
      user: Record<string, unknown> | null;
    };

    expect(product.user).toEqual({
      id: "usr_1111111111111111",
      name: "seller20",
      avatar: "avatar.jpg",
    });
    expect(product.user).not.toHaveProperty("email");
  });

  it("omits email from batched product seller enrichment", async () => {
    productClient.send.mockReturnValue(
      of({
        items: [{ id: 16, userId: 20, categories: [] }],
        total: 1,
      }),
    );
    userClient.send.mockReturnValue(
      of([
        {
          id: 20,
          publicId: "usr_1111111111111111",
          username: "seller20",
          name: "Seller 20",
          avatar: "avatar.jpg",
          email: "seller20@example.test",
        },
      ]),
    );

    const paginatedProducts = (await service.getAllProducts({
      page: 1,
      limit: 5,
    })) as unknown as {
      data: Array<{ user: Record<string, unknown> | null }>;
      total: number;
      totalPages: number;
      hasNext: boolean;
    };

    expect(paginatedProducts.total).toBe(1);
    expect(paginatedProducts.totalPages).toBe(1);
    expect(paginatedProducts.hasNext).toBe(false);
    expect(paginatedProducts.data[0].user).toEqual({
      id: "usr_1111111111111111",
      name: "Seller 20",
      avatar: "avatar.jpg",
    });
    expect(paginatedProducts.data[0].user).not.toHaveProperty("email");
  });

  it("uses an explicit product SKU when creating the base inventory row", async () => {
    productClient.send.mockReturnValue(of({ id: 321, categories: [] }));
    inventoryClient.send.mockReturnValue(of({ id: 99, productId: 321 }));

    await service.createProduct(
      {
        name: "Explicit SKU product",
        price: 1000,
        stockQuantity: 4,
        sku: "SHOP-321",
        categoryIds: [20],
      },
      23,
    );

    expect(inventoryClient.send).toHaveBeenCalledWith(
      INVENTORY_MESSAGE_PATTERNS.INVENTORY_CREATE,
      {
        productId: 321,
        sku: "SHOP-321",
        availableStock: 4,
        minimumStock: 0,
      },
    );
  });

  describe("stock sync on update", () => {
    const OWNER_ID = 20;
    const stockOwnerProduct = {
      id: 16,
      userId: OWNER_ID,
      stockQuantity: 52,
      categories: [],
    };

    const mockProductUpdate = (): void => {
      productClient.send.mockImplementation((pattern: string) =>
        of(
          pattern === PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_ID
            ? stockOwnerProduct
            : { ...stockOwnerProduct, stockQuantity: 150 },
        ),
      );
      userClient.send.mockReturnValue(
        of([{ id: OWNER_ID, publicId: "usr_1111111111111111" }]),
      );
    };

    it("pushes an edited stockQuantity into the base inventory row", async () => {
      mockProductUpdate();
      inventoryClient.send.mockImplementation((pattern: string) =>
        of(
          pattern === INVENTORY_MESSAGE_PATTERNS.INVENTORY_GET_BY_PRODUCT_IDS
            ? [
                {
                  id: 47,
                  productId: 16,
                  productSkuId: null,
                  availableStock: 52,
                },
              ]
            : { id: 47, availableStock: 150 },
        ),
      );

      await service.updateProduct(16, { stockQuantity: 150 }, OWNER_ID, "shop");

      expect(inventoryClient.send).toHaveBeenCalledWith(
        INVENTORY_MESSAGE_PATTERNS.INVENTORY_UPDATE,
        { id: 47, update: { availableStock: 150 } },
      );
    });

    it("skips the inventory write when the stock is already in sync", async () => {
      mockProductUpdate();
      inventoryClient.send.mockReturnValue(
        of([
          { id: 47, productId: 16, productSkuId: null, availableStock: 150 },
        ]),
      );

      await service.updateProduct(16, { stockQuantity: 150 }, OWNER_ID, "shop");

      expect(inventoryClient.send).not.toHaveBeenCalledWith(
        INVENTORY_MESSAGE_PATTERNS.INVENTORY_UPDATE,
        expect.anything(),
      );
    });

    it("leaves a SKU-matrix product alone — it owns no base inventory row", async () => {
      mockProductUpdate();
      inventoryClient.send.mockReturnValue(
        of([{ id: 48, productId: 16, productSkuId: 83, availableStock: 5 }]),
      );

      await expect(
        service.updateProduct(16, { stockQuantity: 150 }, OWNER_ID, "shop"),
      ).resolves.toBeDefined();
      expect(inventoryClient.send).not.toHaveBeenCalledWith(
        INVENTORY_MESSAGE_PATTERNS.INVENTORY_UPDATE,
        expect.anything(),
      );
    });

    it("never writes the product when inventory is unreachable up front", async () => {
      mockProductUpdate();
      inventoryClient.send.mockReturnValue(
        throwError(() => new Error("inventory unavailable")),
      );

      await expect(
        service.updateProduct(16, { stockQuantity: 150 }, OWNER_ID, "shop"),
      ).rejects.toBeDefined();
      // The pre-flight read failed, so the edit must not be half-applied.
      expect(productClient.send).not.toHaveBeenCalledWith(
        PRODUCT_MESSAGE_PATTERNS.PRODUCT_UPDATE,
        expect.anything(),
      );
    });

    it("restores the product mirror when inventory refuses the new stock", async () => {
      mockProductUpdate();
      inventoryClient.send.mockImplementation((pattern: string) =>
        pattern === INVENTORY_MESSAGE_PATTERNS.INVENTORY_GET_BY_PRODUCT_IDS
          ? of([
              { id: 47, productId: 16, productSkuId: null, availableStock: 52 },
            ])
          : throwError(() => new Error("inventory unavailable")),
      );

      await expect(
        service.updateProduct(16, { stockQuantity: 150 }, OWNER_ID, "shop"),
      ).rejects.toBeDefined();
      expect(productClient.send).toHaveBeenCalledWith(
        PRODUCT_MESSAGE_PATTERNS.PRODUCT_UPDATE,
        { id: 16, updateProductDto: { stockQuantity: 52 } },
      );
    });
  });

  it("generates a base inventory SKU when the product SKU is omitted", async () => {
    productClient.send.mockReturnValue(of({ id: 322, categories: [] }));
    inventoryClient.send.mockReturnValue(of({ id: 100, productId: 322 }));

    await service.createProduct(
      {
        name: "No SKU product",
        price: 1000,
        stockQuantity: 4,
        categoryIds: [20],
      },
      23,
    );

    expect(inventoryClient.send).toHaveBeenCalledWith(
      INVENTORY_MESSAGE_PATTERNS.INVENTORY_CREATE,
      {
        productId: 322,
        sku: "PROD-322",
        availableStock: 4,
        minimumStock: 0,
      },
    );
  });
});
