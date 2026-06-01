import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, QueryFailedError } from "typeorm";
import { Channel } from "amqplib";
import { Inventory } from "./inventory.entity";
import { EXCHANGE } from "@app/common/constants/exchange";
import { EVENT } from "@app/common/constants/event";

export interface CreateInventoryDto {
  productId: number;
  sku: string;
  availableStock: number;
  minimumStock?: number;
  location?: string;
}

export interface UpdateInventoryDto {
  availableStock?: number;
  reservedStock?: number;
  minimumStock?: number;
  location?: string;
  isActive?: boolean;
}

export interface StockCheckResult {
  productId: number;
  sku: string;
  available: boolean;
  availableStock: number;
  requestedQuantity: number;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
    @Inject(EXCHANGE.RMQ_PUBLISHER_CHANNEL)
    private readonly fanoutChannel: Channel,
  ) {}

  private emitStockChanged(productId: number, availableStock: number): void {
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
      // Check if inventory for this product already exists
      const existing = await this.inventoryRepository.findOne({
        where: { productId: data.productId },
      });

      if (existing) {
        throw new ConflictException(
          `Inventory for product ID ${data.productId} already exists`,
        );
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
            `Inventory for product ID ${data.productId} already exists`,
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
      throw new NotFoundException(`Inventory with id ${id} not found`);
    return result;
  }

  async findByProductId(productId: number): Promise<Inventory> {
    const result = await this.inventoryRepository.findOne({
      where: { productId, isActive: true },
    });
    if (!result)
      throw new NotFoundException(
        `Inventory for product ${productId} not found`,
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

  async findBySku(sku: string): Promise<Inventory> {
    const result = await this.inventoryRepository.findOne({
      where: { sku, isActive: true },
    });
    if (!result)
      throw new NotFoundException(`Inventory with sku ${sku} not found`);
    return result;
  }

  async update(id: number, data: UpdateInventoryDto): Promise<Inventory> {
    const inventory = await this.findOne(id);
    if (!inventory) {
      throw new NotFoundException(`Inventory with id ${id} not found`);
    }

    await this.inventoryRepository.update(id, data);
    const updatedInventory = await this.findOne(id);
    if (!updatedInventory) {
      throw new NotFoundException(
        `Inventory with id ${id} not found after update`,
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
  ): Promise<StockCheckResult> {
    const inventory = await this.findByProductIdOrNull(productId);

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

  async reserveStock(productId: number, quantity: number): Promise<boolean> {
    const result = await this.inventoryRepository
      .createQueryBuilder()
      .update(Inventory)
      .set({
        availableStock: () => `available_stock - ${quantity}`,
        reservedStock: () => `reserved_stock + ${quantity}`,
      })
      .where("product_id = :productId", { productId })
      .andWhere("available_stock >= :quantity", { quantity })
      .andWhere("is_active = true")
      .execute();

    if (result.affected === 0) {
      return false;
    }

    const updated = await this.findByProductIdOrNull(productId);
    if (updated) {
      this.emitStockChanged(productId, updated.availableStock);
    }
    return true;
  }

  async releaseStock(productId: number, quantity: number): Promise<boolean> {
    const inventory = await this.findByProductIdOrNull(productId);

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
  ): Promise<boolean> {
    const inventory = await this.findByProductIdOrNull(productId);

    if (!inventory || inventory.reservedStock < quantity) {
      return false;
    }

    await this.inventoryRepository.update(inventory.id, {
      reservedStock: inventory.reservedStock - quantity,
    });

    this.emitStockChanged(productId, inventory.availableStock);
    return true;
  }

  async getLowStockItems(): Promise<Inventory[]> {
    return await this.inventoryRepository
      .createQueryBuilder("inventory")
      .where("inventory.availableStock <= inventory.minimumStock")
      .andWhere("inventory.isActive = :isActive", { isActive: true })
      .getMany();
  }
}
