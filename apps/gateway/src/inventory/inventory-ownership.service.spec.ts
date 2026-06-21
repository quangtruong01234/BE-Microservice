import { ForbiddenException } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { of } from "rxjs";
import { INVENTORY_MESSAGE_PATTERNS } from "libs/constant/message-pattern-inventory.constant";
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
    productClient.send.mockReturnValue(of({ id: 16, userId: 20 }));
    inventoryClient.send.mockReturnValue(of({ id: 8, productId: 16 }));

    await expect(
      service.create(
        { productId: 16, sku: "P16", availableStock: 1 },
        20,
        "shop",
      ),
    ).resolves.toEqual({ id: 8, productId: 16 });
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

  it("allows an admin to remove inventory", async () => {
    inventoryClient.send.mockReturnValue(of({ success: true }));

    await expect(service.remove(8, 21, "admin")).resolves.toEqual({
      success: true,
    });
    expect(inventoryClient.send).toHaveBeenCalledWith(
      INVENTORY_MESSAGE_PATTERNS.INVENTORY_REMOVE,
      8,
    );
  });

  it("forwards skuId for stock operations", async () => {
    inventoryClient.send.mockReturnValue(of(true));

    await expect(service.reserveStock(16, 2, 5)).resolves.toBe(true);
    expect(inventoryClient.send).toHaveBeenCalledWith(
      INVENTORY_MESSAGE_PATTERNS.INVENTORY_RESERVE_STOCK,
      { productId: 16, quantity: 2, skuId: 5 },
    );
  });
});
