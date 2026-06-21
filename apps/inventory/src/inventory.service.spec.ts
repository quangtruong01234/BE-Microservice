import { Repository } from "typeorm";
import { Inventory } from "./inventory.entity";
import {
  InventoryReservation,
  InventoryReservationStatus,
} from "./inventory-reservation.entity";
import { InventoryService } from "./inventory.service";

describe("InventoryService reservation ledger", () => {
  it("makes reserve and release retries idempotent", async () => {
    const inventory = {
      id: 1,
      productId: 10,
      productSkuId: null,
      availableStock: 10,
      reservedStock: 0,
      isActive: true,
    } as Inventory;
    let reservation: InventoryReservation | null = null;

    const queryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockImplementation(() => Promise.resolve(inventory)),
    };
    const reservationRepository = {
      findOne: jest.fn().mockImplementation(() => Promise.resolve(reservation)),
      create: jest.fn(
        (value: InventoryReservation): InventoryReservation => value,
      ),
      save: jest.fn(
        (value: InventoryReservation): Promise<InventoryReservation> => {
          reservation = value;
          return Promise.resolve(value);
        },
      ),
    };
    const inventoryRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === Inventory ? inventoryRepository : reservationRepository,
      ),
      save: jest.fn((value: Inventory) => Promise.resolve(value)),
    };
    const repository = {
      manager: {
        transaction: jest.fn(
          (callback: (value: typeof manager) => Promise<boolean>) =>
            callback(manager),
        ),
      },
    } as unknown as Repository<Inventory>;
    const service = new InventoryService(repository, null);

    await expect(
      service.reserveStock(
        10,
        2,
        undefined,
        "00000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toBe(true);
    await expect(
      service.reserveStock(
        10,
        2,
        undefined,
        "00000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toBe(true);
    expect(inventory.availableStock).toBe(8);
    expect(inventory.reservedStock).toBe(2);

    await expect(
      service.releaseStock(
        10,
        2,
        undefined,
        "00000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toBe(true);
    await expect(
      service.releaseStock(
        10,
        2,
        undefined,
        "00000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toBe(true);
    expect(inventory.availableStock).toBe(10);
    expect(inventory.reservedStock).toBe(0);
    expect(reservation).not.toBeNull();
    expect((reservation as unknown as InventoryReservation).status).toBe(
      InventoryReservationStatus.RELEASED,
    );
  });
});
