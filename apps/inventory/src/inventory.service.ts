import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, QueryFailedError, IsNull } from "typeorm";
import { Channel } from "amqplib";
import { Inventory } from "./inventory.entity";
import {
  InventoryReservation,
  InventoryReservationStatus,
} from "./inventory-reservation.entity";
import { isRmqPublisherLive } from "@app/common";
import { EXCHANGE } from "@app/common/constants/exchange";
import { EVENT } from "@app/common/constants/event";
import { INVENTORY_MESSAGE } from "libs/constant/response-message.constant";
import { LOW_STOCK_MAX_RESULTS } from "./inventory.constants";
import {
  CreateInventoryDto,
  StockCheckResult,
  UpdateInventoryDto,
} from "./inventory.types";

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
    @Inject(EXCHANGE.RMQ_PUBLISHER_CHANNEL)
    private readonly fanoutChannel: Channel | null,
  ) {}

  private emitStockChanged(productId: number, availableStock: number): void {
    if (!this.fanoutChannel || !isRmqPublisherLive(this.fanoutChannel)) {
      this.logger.warn(
        `Fanout channel unavailable — skipping stock changed emit for product ${productId}`,
      );
      return;
    }
    const eventPayload = {
      data: { productId, availableStock },
      pattern: EVENT.INVENTORY_STOCK_CHANGED_EVENT,
    };
    this.fanoutChannel.publish(
      EXCHANGE.INVENTORY_EXCHANGE,
      EVENT.INVENTORY_STOCK_CHANGED_EVENT,
      Buffer.from(JSON.stringify(eventPayload)),
    );
  }

  async create(data: CreateInventoryDto): Promise<Inventory> {
    try {
      // Check if inventory for this product already exists. A simple
      // (non-SKU) product owns exactly one row with productSkuId NULL.
      const existing = await this.inventoryRepository.findOne({
        where: { productId: data.productId, productSkuId: IsNull() },
      });

      if (existing) {
        // An active row means a live duplicate — reject. An inactive row is
        // stale (left behind by a previously deleted product); never re-attach
        // it, hard-delete it and create a fresh row with the new stock values.
        if (existing.isActive) {
          throw new ConflictException(
            INVENTORY_MESSAGE.ALREADY_EXISTS_FOR_PRODUCT(data.productId),
          );
        }
        this.logger.warn(
          `[INVENTORY] Removing stale inactive inventory row ${existing.id} for product ${data.productId} before re-create`,
        );
        await this.inventoryRepository.delete(existing.id);
      }

      const inventory = this.inventoryRepository.create(data);
      return await this.inventoryRepository.save(inventory);
    } catch (error) {
      // Handle database constraint errors
      if (error instanceof QueryFailedError) {
        if (
          error.message.includes("unique constraint") ||
          error.message.includes("duplicate key")
        ) {
          // `sku` is the only unique column on inventory_v2, and a second row
          // for the same product is already rejected by the explicit pre-check
          // above — so a violation naming the sku column is a SKU collision,
          // not a duplicate product. Reporting it as the latter sent the caller
          // chasing a product id that was never the problem. The constraint is
          // TypeORM-generated (`UQ_<hash>`), so the column name only appears in
          // the driver's `detail` ("Key (sku)=(...) already exists"), never in
          // `error.message`.
          const driverDetail = (error.driverError as { detail?: unknown })
            ?.detail;
          const isSkuCollision =
            error.message.includes("sku") ||
            (typeof driverDetail === "string" && driverDetail.includes("sku"));
          throw new ConflictException(
            isSkuCollision
              ? INVENTORY_MESSAGE.SKU_ALREADY_EXISTS(data.sku)
              : INVENTORY_MESSAGE.ALREADY_EXISTS_FOR_PRODUCT(data.productId),
          );
        }
      }

      // Re-throw if it's already a NestJS exception
      if (error instanceof ConflictException) {
        throw error;
      }

      // Log and re-throw other errors
      this.logger.error("Failed to create inventory:", error);
      throw error;
    }
  }

  async findAll(): Promise<Inventory[]> {
    return await this.inventoryRepository.find({
      where: { isActive: true },
      order: { createdAt: "DESC" },
    });
  }

  async findOne(id: number): Promise<Inventory> {
    const result = await this.inventoryRepository.findOne({
      where: { id, isActive: true },
    });
    if (!result)
      throw new NotFoundException(INVENTORY_MESSAGE.NOT_FOUND_BY_ID(id));
    return result;
  }

  async findByProductId(productId: number): Promise<Inventory> {
    // Base (non-SKU) row only — SKU products own one row per SKU and must be
    // read via product/SKU-specific lookups, never an arbitrary first match.
    const result = await this.inventoryRepository.findOne({
      where: { productId, productSkuId: IsNull(), isActive: true },
    });
    if (!result)
      throw new NotFoundException(
        INVENTORY_MESSAGE.NOT_FOUND_BY_PRODUCT(productId),
      );
    return result;
  }

  private async findByProductIdOrNull(
    productId: number,
  ): Promise<Inventory | null> {
    return this.inventoryRepository.findOne({
      where: { productId, isActive: true },
    });
  }

  private async findByProductAndSkuOrNull(
    productId: number,
    skuId?: number,
  ): Promise<Inventory | null> {
    const qb = this.inventoryRepository
      .createQueryBuilder("inventory")
      .where("inventory.productId = :productId", { productId })
      .andWhere("inventory.isActive = :isActive", { isActive: true });

    if (skuId !== undefined) {
      qb.andWhere("inventory.productSkuId = :skuId", { skuId });
    } else {
      qb.andWhere("inventory.productSkuId IS NULL");
    }

    return qb.getOne();
  }

  async findBySku(sku: string): Promise<Inventory> {
    const result = await this.inventoryRepository.findOne({
      where: { sku, isActive: true },
    });
    if (!result)
      throw new NotFoundException(INVENTORY_MESSAGE.NOT_FOUND_BY_SKU(sku));
    return result;
  }

  async update(id: number, data: UpdateInventoryDto): Promise<Inventory> {
    const inventory = await this.findOne(id);
    if (!inventory) {
      throw new NotFoundException(INVENTORY_MESSAGE.NOT_FOUND_BY_ID(id));
    }

    try {
      await this.inventoryRepository.update(id, data);
    } catch (error: unknown) {
      // `sku` is the only unique column on inventory_v2, so a constraint
      // violation here can only be a SKU already taken by another row. Report
      // it as a 409 instead of letting the driver error surface as a 500.
      if (
        error instanceof QueryFailedError &&
        (error.message.includes("unique constraint") ||
          error.message.includes("duplicate key"))
      ) {
        throw new ConflictException(
          INVENTORY_MESSAGE.SKU_ALREADY_EXISTS(data.sku ?? inventory.sku),
        );
      }
      throw error;
    }
    const updatedInventory = await this.findOne(id);
    if (!updatedInventory) {
      throw new NotFoundException(
        INVENTORY_MESSAGE.NOT_FOUND_BY_ID_AFTER_UPDATE(id),
      );
    }
    // A direct stock edit (PUT /api/inventory/:id) has to reach the product
    // mirror too, otherwise the catalog keeps showing the old quantity until an
    // order happens to move stock. Base rows only: a SKU row's stock is one
    // variant's, and the product mirror holds the simple-product total.
    if (
      data.availableStock !== undefined &&
      updatedInventory.productSkuId == null &&
      updatedInventory.availableStock !== inventory.availableStock
    ) {
      // PG serializes the bigint product_id as a string — normalize it so the
      // event carries the same numeric id every other emitter publishes.
      this.emitStockChanged(
        Number(updatedInventory.productId),
        updatedInventory.availableStock,
      );
    }
    return updatedInventory;
  }

  async remove(id: number): Promise<boolean> {
    const result = await this.inventoryRepository.update(id, {
      isActive: false,
    });
    return result.affected != null && result.affected > 0;
  }

  /**
   * Hard-delete every inventory row (simple + per-SKU) belonging to a product.
   * Called when a product is deleted so no stale inventory is left behind to
   * re-attach to a future product reusing the same ID.
   */
  async removeByProductId(productId: number): Promise<{ deleted: number }> {
    const result = await this.inventoryRepository.delete({ productId });
    const deleted = result.affected ?? 0;
    this.logger.log(
      `[INVENTORY] Hard-deleted ${deleted} inventory row(s) for product ${productId}`,
    );
    return { deleted };
  }

  async getInventoryByProductIds(productIds: number[]): Promise<Inventory[]> {
    if (!productIds || productIds.length === 0) return [];
    return await this.inventoryRepository
      .createQueryBuilder("inventory")
      .where("inventory.productId IN (:...productIds)", { productIds })
      .andWhere("inventory.isActive = :isActive", { isActive: true })
      .getMany();
  }

  async checkStock(
    productId: number,
    quantity: number,
    skuId?: number,
  ): Promise<StockCheckResult> {
    // SKU-matrix products have one inventory row per SKU sharing the same productId —
    // without the SKU filter, findOne would return an arbitrary variant's stock.
    const inventory =
      skuId !== undefined
        ? await this.findByProductAndSkuOrNull(productId, skuId)
        : await this.findByProductIdOrNull(productId);

    if (!inventory) {
      return {
        productId,
        sku: "",
        available: false,
        availableStock: 0,
        requestedQuantity: quantity,
      };
    }

    return {
      productId,
      sku: inventory.sku,
      available: inventory.availableStock >= quantity,
      availableStock: inventory.availableStock,
      requestedQuantity: quantity,
    };
  }

  async reserveStock(
    productId: number,
    quantity: number,
    skuId?: number,
    reservationKey?: string,
  ): Promise<boolean> {
    if (reservationKey) {
      return this.reserveStockWithLedger(
        productId,
        quantity,
        reservationKey,
        skuId,
      );
    }

    const qb = this.inventoryRepository
      .createQueryBuilder()
      .update(Inventory)
      .set({
        availableStock: () => `available_stock - ${quantity}`,
        reservedStock: () => `reserved_stock + ${quantity}`,
      })
      .where("product_id = :productId", { productId })
      .andWhere("available_stock >= :quantity", { quantity })
      .andWhere("is_active = true");

    if (skuId !== undefined) {
      qb.andWhere("product_sku_id = :skuId", { skuId });
    } else {
      qb.andWhere("product_sku_id IS NULL");
    }

    const result = await qb.execute();

    if (result.affected === 0) {
      return false;
    }

    const updated = await this.findByProductAndSkuOrNull(productId, skuId);
    if (updated) {
      this.emitStockChanged(productId, updated.availableStock);
    }
    return true;
  }

  async releaseStock(
    productId: number,
    quantity: number,
    skuId?: number,
    reservationKey?: string,
  ): Promise<boolean> {
    if (reservationKey) {
      return this.transitionReservation(
        productId,
        quantity,
        reservationKey,
        InventoryReservationStatus.RELEASED,
        skuId,
      );
    }

    const inventory = await this.findByProductAndSkuOrNull(productId, skuId);

    if (!inventory || inventory.reservedStock < quantity) {
      return false;
    }

    const updatedAvailableStock = inventory.availableStock + quantity;
    await this.inventoryRepository.update(inventory.id, {
      availableStock: updatedAvailableStock,
      reservedStock: inventory.reservedStock - quantity,
    });

    this.emitStockChanged(productId, updatedAvailableStock);
    return true;
  }

  async consumeReservedStock(
    productId: number,
    quantity: number,
    skuId?: number,
    reservationKey?: string,
  ): Promise<boolean> {
    if (reservationKey) {
      return this.transitionReservation(
        productId,
        quantity,
        reservationKey,
        InventoryReservationStatus.CONSUMED,
        skuId,
      );
    }

    const inventory = await this.findByProductAndSkuOrNull(productId, skuId);

    if (!inventory || inventory.reservedStock < quantity) {
      return false;
    }

    await this.inventoryRepository.update(inventory.id, {
      reservedStock: inventory.reservedStock - quantity,
    });

    this.emitStockChanged(productId, inventory.availableStock);
    return true;
  }

  /**
   * Put physically returned units back on the shelf after a return is approved.
   *
   * This is deliberately NOT `releaseStock`. A release only rewinds a still
   * RESERVED ledger row, and an order that reached COMPLETED has already had
   * its reservation CONSUMED — so releasing it is a silent no-op and the seller
   * loses the stock forever (the realistic return case: you return goods you
   * received). A restock credits `availableStock` from whatever state the
   * reservation reached, and marks the row RETURNED so a replay cannot credit
   * the same units twice.
   */
  async restockReturnedStock(
    productId: number,
    quantity: number,
    skuId?: number,
    reservationKey?: string,
  ): Promise<boolean> {
    let availableStock: number | null = null;
    const restocked = await this.inventoryRepository.manager.transaction(
      async (manager): Promise<boolean> => {
        const inventory = await manager
          .getRepository(Inventory)
          .createQueryBuilder("inventory")
          .setLock("pessimistic_write")
          .where("inventory.productId = :productId", { productId })
          .andWhere("inventory.isActive = true")
          .andWhere(
            skuId === undefined
              ? "inventory.productSkuId IS NULL"
              : "inventory.productSkuId = :skuId",
            skuId === undefined ? {} : { skuId },
          )
          .getOne();
        if (!inventory) return false;

        const reservationRepository =
          manager.getRepository(InventoryReservation);
        const reservation = reservationKey
          ? await reservationRepository.findOne({
              where: { reservationKey, inventoryId: inventory.id },
            })
          : null;

        if (!reservation) {
          // Pre-ledger order (or a reservation row that never landed): there is
          // nothing to make this idempotent, so the caller's one-shot approve
          // guard is what prevents a double credit.
          this.logger.warn(
            `[INVENTORY] Restocking product ${productId} (qty ${quantity}) without a reservation row for key ${reservationKey ?? "none"}`,
          );
          inventory.availableStock += quantity;
          await manager.save(inventory);
          availableStock = inventory.availableStock;
          return true;
        }

        // Already restocked — replay, the units are on the shelf.
        if (reservation.status === InventoryReservationStatus.RETURNED) {
          return true;
        }

        // A cancel already handed these units back; a return on top of that
        // must close the ledger row without crediting a second time.
        if (reservation.status === InventoryReservationStatus.RELEASED) {
          reservation.status = InventoryReservationStatus.RETURNED;
          await reservationRepository.save(reservation);
          return true;
        }

        // Returned before the order completed: the units are still held for
        // this order, so drop the hold as well as crediting availability.
        if (reservation.status === InventoryReservationStatus.RESERVED) {
          inventory.reservedStock = Math.max(
            0,
            inventory.reservedStock - reservation.quantity,
          );
        }

        inventory.availableStock += reservation.quantity;
        reservation.status = InventoryReservationStatus.RETURNED;
        await manager.save(inventory);
        await reservationRepository.save(reservation);
        availableStock = inventory.availableStock;
        return true;
      },
    );

    if (restocked && availableStock !== null) {
      this.emitStockChanged(productId, availableStock);
    }
    return restocked;
  }

  private async reserveStockWithLedger(
    productId: number,
    quantity: number,
    reservationKey: string,
    skuId?: number,
  ): Promise<boolean> {
    let availableStock: number | null = null;
    const reserved = await this.inventoryRepository.manager.transaction(
      async (manager): Promise<boolean> => {
        const inventory = await manager
          .getRepository(Inventory)
          .createQueryBuilder("inventory")
          .setLock("pessimistic_write")
          .where("inventory.productId = :productId", { productId })
          .andWhere("inventory.isActive = true")
          .andWhere(
            skuId === undefined
              ? "inventory.productSkuId IS NULL"
              : "inventory.productSkuId = :skuId",
            skuId === undefined ? {} : { skuId },
          )
          .getOne();

        if (!inventory) return false;

        const reservationRepository =
          manager.getRepository(InventoryReservation);
        const existing = await reservationRepository.findOne({
          where: { reservationKey, inventoryId: inventory.id },
        });
        if (existing) {
          return (
            existing.quantity === quantity &&
            existing.status === InventoryReservationStatus.RESERVED
          );
        }
        if (inventory.availableStock < quantity) return false;

        inventory.availableStock -= quantity;
        inventory.reservedStock += quantity;
        await manager.save(inventory);
        await reservationRepository.save(
          reservationRepository.create({
            reservationKey,
            inventoryId: inventory.id,
            quantity,
            status: InventoryReservationStatus.RESERVED,
          }),
        );
        availableStock = inventory.availableStock;
        return true;
      },
    );

    if (reserved && availableStock !== null) {
      this.emitStockChanged(productId, availableStock);
    }
    return reserved;
  }

  private async transitionReservation(
    productId: number,
    quantity: number,
    reservationKey: string,
    targetStatus: InventoryReservationStatus,
    skuId?: number,
  ): Promise<boolean> {
    let availableStock: number | null = null;
    const transitioned = await this.inventoryRepository.manager.transaction(
      async (manager): Promise<boolean> => {
        const inventory = await manager
          .getRepository(Inventory)
          .createQueryBuilder("inventory")
          .setLock("pessimistic_write")
          .where("inventory.productId = :productId", { productId })
          .andWhere("inventory.isActive = true")
          .andWhere(
            skuId === undefined
              ? "inventory.productSkuId IS NULL"
              : "inventory.productSkuId = :skuId",
            skuId === undefined ? {} : { skuId },
          )
          .getOne();
        if (!inventory) return false;

        const reservationRepository =
          manager.getRepository(InventoryReservation);
        const reservation = await reservationRepository.findOne({
          where: { reservationKey, inventoryId: inventory.id },
        });
        if (!reservation || reservation.quantity !== quantity) return false;
        if (reservation.status === targetStatus) return true;
        if (reservation.status !== InventoryReservationStatus.RESERVED) {
          return false;
        }
        if (inventory.reservedStock < quantity) return false;

        inventory.reservedStock -= quantity;
        if (targetStatus === InventoryReservationStatus.RELEASED) {
          inventory.availableStock += quantity;
        }
        reservation.status = targetStatus;
        await manager.save(inventory);
        await reservationRepository.save(reservation);
        availableStock = inventory.availableStock;
        return true;
      },
    );

    if (transitioned && availableStock !== null) {
      this.emitStockChanged(productId, availableStock);
    }
    return transitioned;
  }

  async getLowStockItems(productIds?: number[]): Promise<Inventory[]> {
    const qb = this.inventoryRepository
      .createQueryBuilder("inventory")
      .where("inventory.availableStock <= inventory.minimumStock")
      .andWhere("inventory.isActive = :isActive", { isActive: true });

    if (productIds !== undefined) {
      if (productIds.length === 0) return [];
      qb.andWhere("inventory.productId IN (:...productIds)", { productIds });
    }

    return await qb
      .orderBy("inventory.availableStock", "ASC")
      .take(LOW_STOCK_MAX_RESULTS)
      .getMany();
  }

  /**
   * Create the inventory row for a product SKU, or — when the seller re-declared
   * that SKU's stock in a product edit (`syncStock`) — set the existing row's
   * available stock to the newly declared number. Reserved stock is left alone:
   * those units are already committed to orders, so a restock adds to what is
   * sellable rather than rewriting outstanding reservations.
   */
  async createForSku(data: {
    productId: number;
    skuId: number;
    sku: string | null;
    stockQuantity: number;
    syncStock?: boolean;
  }): Promise<void> {
    const existing = await this.inventoryRepository.findOne({
      where: { productId: data.productId, productSkuId: data.skuId },
    });
    if (existing) {
      if (!data.syncStock || existing.availableStock === data.stockQuantity) {
        return;
      }
      await this.inventoryRepository.update(existing.id, {
        availableStock: data.stockQuantity,
      });
      this.logger.log(
        `[INVENTORY] Product ${data.productId} SKU ${data.skuId}: available stock ${existing.availableStock} -> ${data.stockQuantity}`,
      );
      return;
    }

    const skuValue = `product-${data.productId}-sku-${data.skuId}`;
    const inventory = this.inventoryRepository.create({
      productId: data.productId,
      productSkuId: data.skuId,
      sku: skuValue,
      availableStock: data.stockQuantity,
      reservedStock: 0,
      minimumStock: 0,
      isActive: true,
      location: "default",
    });
    await this.inventoryRepository.save(inventory);
    this.logger.log(
      `[INVENTORY] Created inventory for product ${data.productId} SKU ${data.skuId} (stock: ${data.stockQuantity})`,
    );
  }

  async softDeleteSkus(deletedSkuIds: number[]): Promise<void> {
    if (deletedSkuIds.length === 0) return;
    await this.inventoryRepository
      .createQueryBuilder()
      .update(Inventory)
      .set({ isActive: false })
      .where("product_sku_id IN (:...deletedSkuIds)", { deletedSkuIds })
      .execute();
    this.logger.log(
      `[INVENTORY] Soft-deleted inventory rows for SKU IDs: ${deletedSkuIds.join(", ")}`,
    );
  }
}
