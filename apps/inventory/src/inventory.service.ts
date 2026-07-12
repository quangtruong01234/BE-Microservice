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
    if (!this.fanoutChannel) {
      this.logger.warn(
        "Fanout channel unavailable — skipping stock changed emit",
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
          throw new ConflictException(
            INVENTORY_MESSAGE.ALREADY_EXISTS_FOR_PRODUCT(data.productId),
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

    await this.inventoryRepository.update(id, data);
    const updatedInventory = await this.findOne(id);
    if (!updatedInventory) {
      throw new NotFoundException(
        INVENTORY_MESSAGE.NOT_FOUND_BY_ID_AFTER_UPDATE(id),
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

  async createForSku(data: {
    productId: number;
    skuId: number;
    sku: string | null;
    stockQuantity: number;
  }): Promise<void> {
    const existing = await this.inventoryRepository.findOne({
      where: { productId: data.productId, productSkuId: data.skuId },
    });
    if (existing) return;

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
