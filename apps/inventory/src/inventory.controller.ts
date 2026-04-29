
import { Controller, Logger } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { InventoryService, CreateInventoryDto, UpdateInventoryDto } from './inventory.service';

@Controller('inventory')
export class InventoryController {
  private readonly logger = new Logger(InventoryController.name);

  constructor(
    private readonly inventoryService: InventoryService,
  ) { }

  @MessagePattern('inventory.create')
  async createInventory(data: CreateInventoryDto) {
    this.logger.log(`[INVENTORY-TCP] Create inventory`, data);
    return this.inventoryService.create(data);
  }

  @MessagePattern('inventory.find_all')
  async findAllInventory() {
    this.logger.log(`[INVENTORY-TCP] Find all inventory`);
    return this.inventoryService.findAll();
  }

  @MessagePattern('inventory.find_one')
  async findOneInventory(id: number) {
    this.logger.log(`[INVENTORY-TCP] Find inventory id ${id}`);
    return this.inventoryService.findOne(id);
  }

  @MessagePattern('inventory.find_by_product_id')
  async findByProductId(productId: number) {
    this.logger.log(`[INVENTORY-TCP] Find inventory by product id ${productId}`);
    return this.inventoryService.findByProductId(productId);
  }

  @MessagePattern('inventory.find_by_sku')
  async findBySku(sku: string) {
    this.logger.log(`[INVENTORY-TCP] Find inventory by sku ${sku}`);
    return this.inventoryService.findBySku(sku);
  }

  @MessagePattern('inventory.get_by_product_ids')
  async getInventoryByProductIds(productIds: number[]) {
    this.logger.log(`[INVENTORY-TCP] Get inventory by product ids`, productIds);
    return this.inventoryService.getInventoryByProductIds(productIds);
  }

  @MessagePattern('inventory.check_stock')
  async checkStock(data: { productId: number, quantity: number }) {
    this.logger.log(`[INVENTORY-TCP] Check stock for product ${data.productId}, quantity ${data.quantity}`);
    return this.inventoryService.checkStock(data.productId, data.quantity);
  }

  @MessagePattern('inventory.reserve_stock')
  async reserveStock(data: { productId: number, quantity: number }) {
    this.logger.log(`[INVENTORY-TCP] Reserve stock for product ${data.productId}, quantity ${data.quantity}`);
    return this.inventoryService.reserveStock(data.productId, data.quantity);
  }

  @MessagePattern('inventory.release_stock')
  async releaseStock(data: { productId: number, quantity: number }) {
    this.logger.log(`[INVENTORY-TCP] Release stock for product ${data.productId}, quantity ${data.quantity}`);
    return this.inventoryService.releaseStock(data.productId, data.quantity);
  }

  @MessagePattern('inventory.consume_reserved_stock')
  async consumeReservedStock(data: { productId: number, quantity: number }) {
    this.logger.log(`[INVENTORY-TCP] Consume reserved stock for product ${data.productId}, quantity ${data.quantity}`);
    return this.inventoryService.consumeReservedStock(data.productId, data.quantity);
  }

  @MessagePattern('inventory.get_low_stock')
  async getLowStockItems() {
    this.logger.log(`[INVENTORY-TCP] Get low stock items`);
    return this.inventoryService.getLowStockItems();
  }

  @MessagePattern('inventory.update')
  async updateInventory(data: { id: number, update: UpdateInventoryDto }) {
    this.logger.log(`[INVENTORY-TCP] Update inventory id ${data.id}`);
    return this.inventoryService.update(data.id, data.update);
  }

  @MessagePattern('inventory.remove')
  async removeInventory(id: number) {
    this.logger.log(`[INVENTORY-TCP] Remove inventory id ${id}`);
    const success = await this.inventoryService.remove(id);
    return { success };
  }
}