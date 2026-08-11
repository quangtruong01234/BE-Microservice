import { QueryFailedError, Repository } from "typeorm";
import { ConflictException } from "@nestjs/common";
import { Inventory } from "./inventory.entity";
import {
  InventoryReservation,
  InventoryReservationStatus,
} from "./inventory-reservation.entity";
import { InventoryService } from "./inventory.service";

describe("InventoryService create conflicts", () => {
  /**
   * Postgres names the unique index after TypeORM's generated `UQ_<hash>`, so
   * the offending column never appears in `error.message` — only in the
   * driver's `detail`. Reproduce that exact shape.
   */
  const duplicateSkuError = (sku: string): QueryFailedError => {
    const error = new QueryFailedError(
      "INSERT INTO inventory_v2 ...",
      [],
      new Error(
        'duplicate key value violates unique constraint "UQ_5ec10f972b1fa4f1e60d66d28bc"',
      ),
    );
    (error as unknown as { driverError: { detail: string } }).driverError = {
      detail: `Key (sku)=(${sku}) already exists.`,
    };
    return error;
  };

  const buildService = (save: () => Promise<Inventory>): InventoryService => {
    const repository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: Inventory) => value),
      save: jest.fn(save),
    } as unknown as Repository<Inventory>;
    return new InventoryService(repository, null);
  };

  it("reports a sku unique violation as a sku conflict, not a duplicate product", async () => {
    const service = buildService(() =>
      Promise.reject(duplicateSkuError("PROD-95")),
    );

    await expect(
      service.create({ productId: 96, sku: "PROD-95", availableStock: 5 }),
    ).rejects.toThrow(
      new ConflictException("Inventory with sku PROD-95 already exists"),
    );
  });

  it("keeps the product message for a duplicate that does not name the sku column", async () => {
    const error = new QueryFailedError(
      "INSERT INTO inventory_v2 ...",
      [],
      new Error(
        'duplicate key value violates unique constraint "UQ_product_scoped"',
      ),
    );
    (error as unknown as { driverError: { detail: string } }).driverError = {
      detail: "Key (product_id)=(96) already exists.",
    };
    const service = buildService(() => Promise.reject(error));

    await expect(
      service.create({ productId: 96, sku: "PROD-95", availableStock: 5 }),
    ).rejects.toThrow(
      new ConflictException("Inventory for product ID 96 already exists"),
    );
  });
});

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

/**
 * Reported from prod 2026-08-10: approving a return on a COMPLETED order left
 * the seller's stock permanently short. The order's reservation is CONSUMED at
 * completion, so the release the approve path used to call could not rewind it.
 */
describe("InventoryService restock on approved return", () => {
  const RESERVATION_KEY = "00000000-0000-4000-8000-000000000002";

  type LedgerHarness = {
    service: InventoryService;
    inventory: Inventory;
    getReservation: () => InventoryReservation | null;
  };

  const buildLedgerHarness = (availableStock: number): LedgerHarness => {
    const inventory = {
      id: 1,
      productId: 10,
      productSkuId: null,
      availableStock,
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

    return {
      service: new InventoryService(repository, null),
      inventory,
      getReservation: () => reservation,
    };
  };

  it("restores stock consumed by a completed order, and only once", async () => {
    const { service, inventory, getReservation } = buildLedgerHarness(50);

    await expect(
      service.reserveStock(10, 2, undefined, RESERVATION_KEY),
    ).resolves.toBe(true);
    await expect(
      service.consumeReservedStock(10, 2, undefined, RESERVATION_KEY),
    ).resolves.toBe(true);
    expect(inventory.availableStock).toBe(48);
    expect(inventory.reservedStock).toBe(0);

    // The old approve path: a release cannot rewind a consumed reservation,
    // which is exactly how the units went missing.
    await expect(
      service.releaseStock(10, 2, undefined, RESERVATION_KEY),
    ).resolves.toBe(false);
    expect(inventory.availableStock).toBe(48);

    await expect(
      service.restockReturnedStock(10, 2, undefined, RESERVATION_KEY),
    ).resolves.toBe(true);
    expect(inventory.availableStock).toBe(50);
    expect(getReservation()?.status).toBe(InventoryReservationStatus.RETURNED);

    // Replay must not credit the same units twice.
    await expect(
      service.restockReturnedStock(10, 2, undefined, RESERVATION_KEY),
    ).resolves.toBe(true);
    expect(inventory.availableStock).toBe(50);
  });

  it("drops the hold when the return is approved before completion", async () => {
    const { service, inventory, getReservation } = buildLedgerHarness(50);

    await expect(
      service.reserveStock(10, 2, undefined, RESERVATION_KEY),
    ).resolves.toBe(true);
    expect(inventory.availableStock).toBe(48);
    expect(inventory.reservedStock).toBe(2);

    await expect(
      service.restockReturnedStock(10, 2, undefined, RESERVATION_KEY),
    ).resolves.toBe(true);
    expect(inventory.availableStock).toBe(50);
    expect(inventory.reservedStock).toBe(0);
    expect(getReservation()?.status).toBe(InventoryReservationStatus.RETURNED);
  });

  it("does not double-credit units a cancel already released", async () => {
    const { service, inventory, getReservation } = buildLedgerHarness(50);

    await expect(
      service.reserveStock(10, 2, undefined, RESERVATION_KEY),
    ).resolves.toBe(true);
    await expect(
      service.releaseStock(10, 2, undefined, RESERVATION_KEY),
    ).resolves.toBe(true);
    expect(inventory.availableStock).toBe(50);

    await expect(
      service.restockReturnedStock(10, 2, undefined, RESERVATION_KEY),
    ).resolves.toBe(true);
    expect(inventory.availableStock).toBe(50);
    expect(getReservation()?.status).toBe(InventoryReservationStatus.RETURNED);
  });
});
