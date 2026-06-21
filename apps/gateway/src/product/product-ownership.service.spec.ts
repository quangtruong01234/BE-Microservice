import { ForbiddenException } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { of } from "rxjs";
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

  it("rejects adding a SKU to another user's product", async () => {
    productClient.send.mockReturnValue(of({ id: 16, userId: 20 }));

    await expect(
      service.addSku(16, { tierIdx: "[0]", price: 100 }, 18, "user"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(productClient.send).toHaveBeenCalledTimes(1);
  });

  it("rejects a SKU ID that belongs to another product", async () => {
    productClient.send
      .mockReturnValueOnce(of({ id: 16, userId: 18 }))
      .mockReturnValueOnce(of({ id: 5, productId: 17 }));

    await expect(
      service.updateSku(16, 5, {}, 18, "user"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(productClient.send).toHaveBeenCalledTimes(2);
  });

  it("allows an owner to delete a SKU from their product", async () => {
    productClient.send
      .mockReturnValueOnce(of({ id: 16, userId: 18 }))
      .mockReturnValueOnce(of({ id: 5, productId: 16 }))
      .mockReturnValueOnce(of({ success: true }));

    await expect(service.deleteSku(16, 5, 18, "user")).resolves.toEqual({
      success: true,
    });
    expect(productClient.send).toHaveBeenLastCalledWith(
      PRODUCT_MESSAGE_PATTERNS.SKU_DELETE,
      5,
    );
  });
});
