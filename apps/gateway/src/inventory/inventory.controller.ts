import { 
  Controller, 
  Get, 
  Post, 
  Put, 
  Delete, 
  Body, 
  Param, 
  Query,
  ParseIntPipe,
  ValidationPipe
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { CheckStockDto, ReserveStockDto, ReleaseStockDto } from './dto/stock-operations.dto';

@ApiTags('Inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post()
  @ApiOperation({ summary: 'Create inventory item' })
  @ApiResponse({ status: 201, description: 'Inventory created successfully.' })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid input data.' })
  @ApiResponse({ status: 409, description: 'Conflict - Product already has inventory.' })
  async create(@Body(ValidationPipe) body: CreateInventoryDto) {
    return this.inventoryService.create(body);
  }

  @Get()
  @ApiOperation({ summary: 'Get all inventory items' })
  @ApiResponse({ status: 200, description: 'Inventory items retrieved successfully.' })
  async findAll() {
    return this.inventoryService.findAll();
  }

  @Get('low-stock')
  @ApiOperation({ summary: 'Get items with low stock' })
  @ApiResponse({ status: 200, description: 'Low stock items retrieved successfully.' })
  async getLowStock() {
    return this.inventoryService.getLowStock();
  }

  @Get('product/:productId')
  @ApiOperation({ summary: 'Get inventory by product ID' })
  @ApiParam({ name: 'productId', description: 'Product ID', type: Number })
  @ApiResponse({ status: 200, description: 'Inventory retrieved successfully.' })
  @ApiResponse({ status: 404, description: 'Inventory not found for this product.' })
  async findByProductId(@Param('productId', ParseIntPipe) productId: number) {
    return this.inventoryService.findByProductId(productId);
  }

  @Get('sku/:sku')
  @ApiOperation({ summary: 'Get inventory by SKU' })
  @ApiParam({ name: 'sku', description: 'Product SKU', type: String })
  @ApiResponse({ status: 200, description: 'Inventory retrieved successfully.' })
  @ApiResponse({ status: 404, description: 'Inventory not found for this SKU.' })
  async findBySku(@Param('sku') sku: string) {
    return this.inventoryService.findBySku(sku);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get inventory item by ID' })
  @ApiParam({ name: 'id', description: 'Inventory ID', type: Number })
  @ApiResponse({ status: 200, description: 'Inventory retrieved successfully.' })
  @ApiResponse({ status: 404, description: 'Inventory not found.' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.inventoryService.findOne(id);
  }

  @Post('check-stock')
  @ApiOperation({ summary: 'Check stock availability' })
  @ApiResponse({ status: 200, description: 'Stock check completed successfully.' })
  @ApiResponse({ status: 404, description: 'Product not found.' })
  async checkStock(@Body(ValidationPipe) body: CheckStockDto) {
    return this.inventoryService.checkStock(body.productId, body.quantity);
  }

  @Post('reserve-stock')
  @ApiOperation({ summary: 'Reserve stock for an order' })
  @ApiResponse({ status: 200, description: 'Stock reserved successfully.' })
  @ApiResponse({ status: 400, description: 'Insufficient stock.' })
  @ApiResponse({ status: 404, description: 'Product not found.' })
  async reserveStock(@Body(ValidationPipe) body: ReserveStockDto) {
    return this.inventoryService.reserveStock(body.productId, body.quantity);
  }

  @Post('release-stock')
  @ApiOperation({ summary: 'Release reserved stock' })
  @ApiResponse({ status: 200, description: 'Stock released successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid release request.' })
  @ApiResponse({ status: 404, description: 'Product not found.' })
  async releaseStock(@Body(ValidationPipe) body: ReleaseStockDto) {
    return this.inventoryService.releaseStock(body.productId, body.quantity);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update inventory item' })
  @ApiParam({ name: 'id', description: 'Inventory ID', type: Number })
  @ApiResponse({ status: 200, description: 'Inventory updated successfully.' })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid input data.' })
  @ApiResponse({ status: 404, description: 'Inventory not found.' })
  async update(
    @Param('id', ParseIntPipe) id: number, 
    @Body(ValidationPipe) body: UpdateInventoryDto
  ) {
    return this.inventoryService.update(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete inventory item' })
  @ApiParam({ name: 'id', description: 'Inventory ID', type: Number })
  @ApiResponse({ status: 200, description: 'Inventory deleted successfully.' })
  @ApiResponse({ status: 404, description: 'Inventory not found.' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.inventoryService.remove(id);
  }
}
