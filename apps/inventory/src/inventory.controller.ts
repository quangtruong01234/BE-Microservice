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
import { CreateInventoryDto, UpdateInventoryDto } from "./inventory.types";
import { EVENT } from "@app/common/constants/event";
import { HttpToRpcExceptionFilter, RmqService } from "@app/common";

@UseFilters(HttpToRpcExceptionFilter)
@Controller("inventory")
export class InventoryController {
  private readonly logger = new Logger(InventoryController.name);

  constructor(
    private readonly inventoryService: InventoryService,
    private readonly rmqService: RmqService,
  ) {}

  @MessagePattern("inventory.create")
  async createInventory(data: CreateInventoryDto) {
    this.logger.log(`[INVENTORY-TCP] Create inventory`, data);
    return this.inventoryService.create(data);
  }

  @MessagePattern("inventory.find_all")
  async findAllInventory() {
    this.logger.log(`[INVENTORY-TCP] Find all inventory`);
    return this.inventoryService.findAll();
  }

  @MessagePattern("inventory.find_one")
  async findOneInventory(id: number) {
    this.logger.log(`[INVENTORY-TCP] Find inventory id ${id}`);
    return this.inventoryService.findOne(id);
  }

  @MessagePattern("inventory.find_by_product_id")
  async findByProductId(productId: number) {
    this.logger.log(
      `[INVENTORY-TCP] Find inventory by product id ${productId}`,
    );
    return this.inventoryService.findByProductId(productId);
  }

  @MessagePattern("inventory.find_by_sku")
  async findBySku(sku: string) {
    this.logger.log(`[INVENTORY-TCP] Find inventory by sku ${sku}`);
    return this.inventoryService.findBySku(sku);
  }

  @MessagePattern("inventory.get_by_product_ids")
  async getInventoryByProductIds(productIds: number[]) {
    this.logger.log(`[INVENTORY-TCP] Get inventory by product ids`, productIds);
    return this.inventoryService.getInventoryByProductIds(productIds);
  }

  @MessagePattern("inventory.check_stock")
  async checkStock(data: {
    productId: number;
    quantity: number;
    skuId?: number;
  }) {
    this.logger.log(
      `[INVENTORY-TCP] Check stock for product ${data.productId}, quantity ${data.quantity}`,
    );
    return this.inventoryService.checkStock(
      data.productId,
      data.quantity,
      data.skuId,
    );
  }

  @MessagePattern("inventory.reserve_stock")
  async reserveStock(data: {
    productId: number;
    quantity: number;
    skuId?: number;
    reservationKey?: string;
  }) {
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

  @MessagePattern("inventory.release_stock")
  async releaseStock(data: {
    productId: number;
    quantity: number;
    skuId?: number;
    reservationKey?: string;
  }) {
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

  @MessagePattern("inventory.consume_reserved_stock")
  async consumeReservedStock(data: {
    productId: number;
    quantity: number;
    skuId?: number;
    reservationKey?: string;
  }) {
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

  @MessagePattern("inventory.restock_returned")
  async restockReturnedStock(data: {
    productId: number;
    quantity: number;
    skuId?: number;
    reservationKey?: string;
  }) {
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

  @MessagePattern("inventory.get_low_stock")
  async getLowStockItems(data?: { productIds?: number[] }) {
    this.logger.log(`[INVENTORY-TCP] Get low stock items`);
    return this.inventoryService.getLowStockItems(data?.productIds);
  }

  @MessagePattern("inventory.update")
  async updateInventory(data: { id: number; update: UpdateInventoryDto }) {
    this.logger.log(`[INVENTORY-TCP] Update inventory id ${data.id}`);
    return this.inventoryService.update(data.id, data.update);
  }

  @MessagePattern("inventory.remove")
  async removeInventory(id: number) {
    this.logger.log(`[INVENTORY-TCP] Remove inventory id ${id}`);
    const success = await this.inventoryService.remove(id);
    return { success };
  }

  @MessagePattern("inventory.remove_by_product")
  async removeInventoryByProduct(productId: number) {
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
  ) {
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
  ) {
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
