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
import {
  InventoryService,
  CreateInventoryDto,
  UpdateInventoryDto,
} from "./inventory.service";
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
  async checkStock(data: { productId: number; quantity: number }) {
    this.logger.log(
      `[INVENTORY-TCP] Check stock for product ${data.productId}, quantity ${data.quantity}`,
    );
    return this.inventoryService.checkStock(data.productId, data.quantity);
  }

  @MessagePattern("inventory.reserve_stock")
  async reserveStock(data: { productId: number; quantity: number }) {
    this.logger.log(
      `[INVENTORY-TCP] Reserve stock for product ${data.productId}, quantity ${data.quantity}`,
    );
    return this.inventoryService.reserveStock(data.productId, data.quantity);
  }

  @MessagePattern("inventory.release_stock")
  async releaseStock(data: { productId: number; quantity: number }) {
    this.logger.log(
      `[INVENTORY-TCP] Release stock for product ${data.productId}, quantity ${data.quantity}`,
    );
    return this.inventoryService.releaseStock(data.productId, data.quantity);
  }

  @MessagePattern("inventory.consume_reserved_stock")
  async consumeReservedStock(data: { productId: number; quantity: number }) {
    this.logger.log(
      `[INVENTORY-TCP] Consume reserved stock for product ${data.productId}, quantity ${data.quantity}`,
    );
    return this.inventoryService.consumeReservedStock(
      data.productId,
      data.quantity,
    );
  }

  @MessagePattern("inventory.get_low_stock")
  async getLowStockItems() {
    this.logger.log(`[INVENTORY-TCP] Get low stock items`);
    return this.inventoryService.getLowStockItems();
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

  @EventPattern(EVENT.ORDER_CANCELED_EVENT)
  async handleOrderCanceled(
    @Payload()
    order: {
      orderId: number;
      items: { product_id: number; quantity: number }[];
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
            item.product_id,
            item.quantity,
          );
          if (released) {
            this.logger.log(
              `[INVENTORY] Released ${item.quantity} units of product ${item.product_id} for canceled order ${order.orderId}`,
            );
          } else {
            this.logger.warn(
              `[INVENTORY] Failed to release stock for product ${item.product_id} (qty: ${item.quantity}) in order ${order.orderId}`,
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

  @EventPattern(EVENT.ORDER_CREATED_EVENT)
  async handleOrderCreated(
    @Payload()
    order: {
      id: number;
      user_id: number;
      items: { product_id: number; quantity: number }[];
    },
    @Ctx() context: RmqContext,
  ) {
    this.logger.log(
      `[INVENTORY] Processing order_created for order ${order.id}`,
    );

    if (Array.isArray(order.items)) {
      for (const item of order.items) {
        const reserved = await this.inventoryService.reserveStock(
          item.product_id,
          item.quantity,
        );
        if (reserved) {
          await this.inventoryService.consumeReservedStock(
            item.product_id,
            item.quantity,
          );
        } else {
          this.logger.warn(
            `[INVENTORY] Insufficient stock for product ${item.product_id} (qty: ${item.quantity}) in order ${order.id}`,
          );
        }
      }
    }

    this.rmqService.ack(context);
    this.logger.log(`[INVENTORY] Deducted stock for order ${order.id}`);
  }
}
