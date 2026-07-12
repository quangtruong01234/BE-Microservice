import { ForbiddenException } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { of } from "rxjs";
import { INVENTORY_MESSAGE_PATTERNS } from "libs/constant/message-pattern-inventory.constant";
import { PRODUCT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-product.constant";
import { ProductService } from "./product.service";

describe("ProductService ownership", () => {
  const productClient = { send: jest.fn() };
  const inventoryClient = { send: jest.fn() };
  const userClient = { send: jest.fn() };
  const ordersClient = { send: jest.fn() };
  let service: ProductService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProductService(
      productClient as unknown as ClientProxy,
      inventoryClient as unknown as ClientProxy,
      userClient as unknown as ClientProxy,
      ordersClient as unknown as ClientProxy,
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

    await expect(service.updateProduct(16, {}, 21, "admin")).resolves.toEqual({
      id: 16,
      userId: 20,
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
    userClient.send.mockReturnValue(
      of({
        id: 20,
        username: "seller20",
        name: "Seller 20",
        avatar: "avatar.jpg",
        email: "seller20@example.test",
      }),
    );

    const product = (await service.getProductById(16)) as {
      user: Record<string, unknown> | null;
    };

    expect(product.user).toEqual({
      id: 20,
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
          username: "seller20",
          name: "Seller 20",
          avatar: "avatar.jpg",
          email: "seller20@example.test",
        },
      ]),
    );

    const products = (await service.getAllProducts({
      page: 1,
      limit: 5,
    })) as Array<{
      user: Record<string, unknown> | null;
    }>;

    expect(products[0].user).toEqual({
      id: 20,
      name: "Seller 20",
      avatar: "avatar.jpg",
    });
    expect(products[0].user).not.toHaveProperty("email");
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
