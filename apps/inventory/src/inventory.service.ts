import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, QueryFailedError } from "typeorm";
import { Inventory } from "./inventory.entity";

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
  ) {}

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

  async findOne(id: number): Promise<Inventory | null> {
    return await this.inventoryRepository.findOne({
      where: { id, isActive: true },
    });
  }

  async findByProductId(productId: number): Promise<Inventory | null> {
    return await this.inventoryRepository.findOne({
      where: { productId, isActive: true },
    });
  }

  async findBySku(sku: string): Promise<Inventory | null> {
    return await this.inventoryRepository.findOne({
      where: { sku, isActive: true },
    });
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
    const inventory = await this.findByProductId(productId);

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
    const inventory = await this.findByProductId(productId);

    if (!inventory || inventory.availableStock < quantity) {
      return false;
    }

    await this.inventoryRepository.update(inventory.id, {
      availableStock: inventory.availableStock - quantity,
      reservedStock: inventory.reservedStock + quantity,
    });

    return true;
  }

  async releaseStock(productId: number, quantity: number): Promise<boolean> {
    const inventory = await this.findByProductId(productId);

    if (!inventory || inventory.reservedStock < quantity) {
      return false;
    }

    await this.inventoryRepository.update(inventory.id, {
      availableStock: inventory.availableStock + quantity,
      reservedStock: inventory.reservedStock - quantity,
    });

    return true;
  }

  async consumeReservedStock(
    productId: number,
    quantity: number,
  ): Promise<boolean> {
    const inventory = await this.findByProductId(productId);

    if (!inventory || inventory.reservedStock < quantity) {
      return false;
    }

    await this.inventoryRepository.update(inventory.id, {
      reservedStock: inventory.reservedStock - quantity,
    });

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
