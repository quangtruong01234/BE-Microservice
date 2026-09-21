import {
  Controller,
  Logger,
  NotFoundException,
  UseFilters,
} from "@nestjs/common";
import {
  Ctx,
  EventPattern,
  MessagePattern,
  Payload,
  RmqContext,
} from "@nestjs/microservices";
import { InventoryService } from "./inventory.service";
import {
  CreateInventoryDto,
  UpdateInventoryDto,
  StockCheckResult,
} from "./inventory.types";
import { EVENT } from "@app/common/constants/event";
import { HttpToRpcExceptionFilter, RmqService } from "@app/common";
import { Inventory } from "./inventory.entity";
import { INVENTORY_MESSAGE_PATTERNS } from "libs/constant/message-pattern-inventory.constant";

@UseFilters(HttpToRpcExceptionFilter)
@Controller("inventory")
export class InventoryController {
  private readonly logger = new Logger(InventoryController.name);

  constructor(
    private readonly inventoryService: InventoryService,
    private readonly rmqService: RmqService,
  ) {}

  @MessagePattern(INVENTORY_MESSAGE_PATTERNS.INVENTORY_CREATE)
  async createInventory(data: CreateInventoryDto): Promise<Inventory> {
    this.logger.log(`[INVENTORY-TCP] Create inventory`, data);
    return this.inventoryService.create(data);
  }

  @MessagePattern(INVENTORY_MESSAGE_PATTERNS.INVENTORY_FIND_ONE)
  async findOneInventory(id: number): Promise<Inventory> {
    this.logger.log(`[INVENTORY-TCP] Find inventory id ${id}`);
    return this.inventoryService.findOne(id);
  }

  @MessagePattern(INVENTORY_MESSAGE_PATTERNS.INVENTORY_FIND_BY_PRODUCT_ID)
  async findByProductId(productId: number): Promise<Inventory> {
    this.logger.log(
      `[INVENTORY-TCP] Find inventory by product id ${productId}`,
    );
    return this.inventoryService.findByProductId(productId);
  }

  @MessagePattern(INVENTORY_MESSAGE_PATTERNS.INVENTORY_GET_BY_PRODUCT_IDS)
  async getInventoryByProductIds(productIds: number[]): Promise<Inventory[]> {
    this.logger.log(`[INVENTORY-TCP] Get inventory by product ids`, productIds);
    return this.inventoryService.getInventoryByProductIds(productIds);
  }

  @MessagePattern(INVENTORY_MESSAGE_PATTERNS.INVENTORY_CHECK_STOCK)
  async checkStock(data: {
    productId: number;
    quantity: number;
    skuId?: number;
  }): Promise<StockCheckResult> {
    this.logger.log(
      `[INVENTORY-TCP] Check stock for product ${data.productId}, quantity ${data.quantity}`,
    );
    return this.inventoryService.checkStock(
      data.productId,
      data.quantity,
      data.skuId,
    );
  }

  @MessagePattern(INVENTORY_MESSAGE_PATTERNS.INVENTORY_RESERVE_STOCK)
  async reserveStock(data: {
    productId: number;
    quantity: number;
    skuId?: number;
    reservationKey?: string;
  }): Promise<boolean> {
    this.logger.log(
      `[INVENTORY-TCP] Reserve stock for product ${data.productId}, quantity ${data.quantity}`,
    );
    return this.inventoryService.reserveStock(
      data.productId,
      data.quantity,
      data.skuId,
      data.reservationKey,
    );
  }

  @MessagePattern(INVENTORY_MESSAGE_PATTERNS.INVENTORY_RELEASE_STOCK)
  async releaseStock(data: {
    productId: number;
    quantity: number;
    skuId?: number;
    reservationKey?: string;
  }): Promise<boolean> {
    this.logger.log(
      `[INVENTORY-TCP] Release stock for product ${data.productId}, quantity ${data.quantity}`,
    );
    return this.inventoryService.releaseStock(
      data.productId,
      data.quantity,
      data.skuId,
      data.reservationKey,
    );
  }

  @MessagePattern(INVENTORY_MESSAGE_PATTERNS.INVENTORY_CONSUME_RESERVED_STOCK)
  async consumeReservedStock(data: {
    productId: number;
    quantity: number;
    skuId?: number;
    reservationKey?: string;
  }): Promise<boolean> {
    this.logger.log(
      `[INVENTORY-TCP] Consume reserved stock for product ${data.productId}, quantity ${data.quantity}`,
    );
    return this.inventoryService.consumeReservedStock(
      data.productId,
      data.quantity,
      data.skuId,
      data.reservationKey,
    );
  }

  @MessagePattern(INVENTORY_MESSAGE_PATTERNS.INVENTORY_RESTOCK_RETURNED)
  async restockReturnedStock(data: {
    productId: number;
    quantity: number;
    skuId?: number;
    reservationKey?: string;
  }): Promise<boolean> {
    this.logger.log(
      `[INVENTORY-TCP] Restock returned stock for product ${data.productId}, quantity ${data.quantity}`,
    );
    return this.inventoryService.restockReturnedStock(
      data.productId,
      data.quantity,
      data.skuId,
      data.reservationKey,
    );
  }

  @MessagePattern(INVENTORY_MESSAGE_PATTERNS.INVENTORY_GET_LOW_STOCK)
  async getLowStockItems(data?: {
    productIds?: number[];
  }): Promise<Inventory[]> {
    this.logger.log(`[INVENTORY-TCP] Get low stock items`);
    return this.inventoryService.getLowStockItems(data?.productIds);
  }

  @MessagePattern(INVENTORY_MESSAGE_PATTERNS.INVENTORY_UPDATE)
  async updateInventory(data: {
    id: number;
    update: UpdateInventoryDto;
  }): Promise<Inventory> {
    this.logger.log(`[INVENTORY-TCP] Update inventory id ${data.id}`);
    return this.inventoryService.update(data.id, data.update);
  }

  @MessagePattern(INVENTORY_MESSAGE_PATTERNS.INVENTORY_REMOVE_BY_PRODUCT)
  async removeInventoryByProduct(
    productId: number,
  ): Promise<{ deleted: number }> {
    this.logger.log(
      `[INVENTORY-TCP] Remove all inventory for product ${productId}`,
    );
    return this.inventoryService.removeByProductId(productId);
  }

  @EventPattern(EVENT.ORDER_CANCELED_EVENT)
  async handleOrderCanceled(
    @Payload()
    order: {
      orderId: number;
      reservationKey: string;
      items: { productId: number; quantity: number; skuId?: number | null }[];
    },
    @Ctx() context: RmqContext,
  ): Promise<void> {
    this.logger.log(
      `[INVENTORY] Processing order_canceled for order ${order.orderId}`,
    );

    try {
      if (Array.isArray(order.items)) {
        for (const item of order.items) {
          const released = await this.inventoryService.releaseStock(
            item.productId,
            item.quantity,
            item.skuId ?? undefined,
            order.reservationKey,
          );
          if (released) {
            this.logger.log(
              `[INVENTORY] Released ${item.quantity} units of product ${item.productId} for canceled order ${order.orderId}`,
            );
          } else {
            throw new Error(
              `Reservation ${order.reservationKey} could not release product ${item.productId} (qty: ${item.quantity})`,
            );
          }
        }
      }
      this.rmqService.ack(context);
      this.logger.log(
        `[INVENTORY] Released stock for canceled order ${order.orderId}`,
      );
    } catch (err: unknown) {
      this.logger.error(
        `[INVENTORY] Error processing order_canceled for order ${order.orderId}`,
        err instanceof Error ? err.stack : String(err),
      );
      const channel = context.getChannelRef() as {
        nack: (msg: unknown, allUpTo: boolean, requeue: boolean) => void;
      };
      const originalMsg = context.getMessage();
      if (err instanceof NotFoundException) {
        channel.nack(originalMsg, false, false);
      } else {
        channel.nack(originalMsg, false, true);
      }
    }
  }

  @EventPattern(EVENT.SKU_UPSERTED_EVENT)
  async handleSkuUpserted(
    @Payload()
    payload: {
      productId: number;
      skus: { skuId: number; sku: string | null; stockQuantity: number }[];
      deletedSkuIds: number[];
      // Absent on messages published before this field existed — an empty set
      // then means "create only", the previous behavior.
      stockChangedSkuIds?: number[];
    },
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const stockChangedSkuIds = new Set(payload.stockChangedSkuIds ?? []);
    this.logger.log(
      `[INVENTORY] Processing sku_upserted for product ${payload.productId}: ${payload.skus.length} skus, ${payload.deletedSkuIds.length} deleted, ${stockChangedSkuIds.size} restocked`,
    );

    try {
      for (const sku of payload.skus) {
        await this.inventoryService.createForSku({
          productId: payload.productId,
          skuId: sku.skuId,
          sku: sku.sku,
          stockQuantity: sku.stockQuantity,
          syncStock: stockChangedSkuIds.has(sku.skuId),
        });
      }
      await this.inventoryService.softDeleteSkus(payload.deletedSkuIds);
      this.rmqService.ack(context);
    } catch (err: unknown) {
      this.logger.error(
        `[INVENTORY] Error processing sku_upserted for product ${payload.productId}`,
        err instanceof Error ? err.stack : String(err),
      );
      const channel = context.getChannelRef() as {
        nack: (msg: unknown, allUpTo: boolean, requeue: boolean) => void;
      };
      const originalMsg = context.getMessage();
      channel.nack(originalMsg, false, true);
    }
  }

  @EventPattern(EVENT.ORDER_CREATED_EVENT)
  handleOrderCreated(
    @Payload() order: { id: number },
    @Ctx() context: RmqContext,
  ): void {
    // Stock is already reserved synchronously via TCP (inventory.reserve_stock)
    // by the orders service at order creation — deducting again here caused a
    // double-decrement. This consumer only acknowledges the event.
    this.logger.log(
      `[INVENTORY] order_created for order ${order.id} — stock already reserved via TCP, ack only`,
    );
    this.rmqService.ack(context);
  }
}
