import { ForbiddenException } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { of } from "rxjs";
import { InventoryService } from "./inventory.service";

describe("InventoryService ownership", () => {
  const inventoryClient = { send: jest.fn() };
  const productClient = { send: jest.fn() };
  let service: InventoryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InventoryService(
      inventoryClient as unknown as ClientProxy,
      productClient as unknown as ClientProxy,
    );
  });

  it("rejects creating inventory for another user's product", async () => {
    productClient.send.mockReturnValue(of({ id: 16, userId: 20 }));

    await expect(
      service.create(
        { productId: 16, sku: "P16", availableStock: 1 },
        18,
        "user",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(inventoryClient.send).not.toHaveBeenCalled();
  });

  it("allows an owner to create inventory", async () => {
    productClient.send
      .mockReturnValueOnce(of({ id: 16, userId: 20 }))
      .mockReturnValueOnce(of([{ id: 16, publicId: "prod_1111111111111111" }]));
    inventoryClient.send.mockReturnValue(of({ id: 8, productId: 16 }));

    await expect(
      service.create(
        { productId: 16, sku: "P16", availableStock: 1 },
        20,
        "shop",
      ),
    ).resolves.toEqual({
      id: 8,
      productId: "prod_1111111111111111",
    });
  });

  it("rejects updating another user's inventory", async () => {
    inventoryClient.send.mockReturnValue(of({ id: 8, productId: 16 }));
    productClient.send.mockReturnValue(of({ id: 16, userId: 20 }));

    await expect(service.update(8, {}, 18, "user")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(inventoryClient.send).toHaveBeenCalledTimes(1);
  });

  it("rejects an SKU that belongs to another product", async () => {
    productClient.send
      .mockReturnValueOnce(of({ id: 16, userId: 20 }))
      .mockReturnValueOnce(of({ id: 5, productId: 17 }));

    await expect(
      service.create(
        {
          productId: 16,
          productSkuId: 5,
          sku: "P16-S5",
          availableStock: 1,
        },
        20,
        "shop",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(inventoryClient.send).not.toHaveBeenCalled();
  });
});
