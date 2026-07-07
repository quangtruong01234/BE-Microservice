import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  ParseIntPipe,
  Req,
  ValidationPipe,
} from "@nestjs/common";
import { Request } from "express";
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from "@nestjs/swagger";
import { InventoryService } from "./inventory.service";
import { CreateInventoryDto } from "./dto/create-inventory.dto";
import { UpdateInventoryDto } from "./dto/update-inventory.dto";
import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";

@ApiTags("Inventory")
@Controller("inventory")
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post()
  @ApiOperation({ summary: "Create inventory item" })
  @ApiResponse({ status: 201, description: "Inventory created successfully." })
  @ApiResponse({
    status: 400,
    description: "Bad Request - Invalid input data.",
  })
  @ApiResponse({
    status: 409,
    description: "Conflict - Product already has inventory.",
  })
  @ApiResponse({
    status: 403,
    description: "Forbidden - not the product owner.",
  })
  async create(
    @Body(ValidationPipe) body: CreateInventoryDto,
    @Req() req: Request,
  ) {
    return this.inventoryService.create(
      body,
      req.user?.id ?? 0,
      req.user?.role ?? "user",
    );
  }

  @Get("low-stock")
  @Roles("shop", "admin")
  @ApiOperation({
    summary:
      "Get low-stock inventory (admin: all products, shop: own products only)",
  })
  @ApiResponse({
    status: 200,
    description:
      "Inventory rows with availableStock <= minimumStock (max 100, lowest stock first).",
  })
  @ApiResponse({ status: 403, description: "Forbidden - shop/admin only." })
  async getLowStock(@Req() req: Request) {
    return this.inventoryService.getLowStock(
      req.user?.id ?? 0,
      req.user?.role ?? "user",
    );
  }

  @Get("product/:productId")
  @Public()
  @ApiOperation({ summary: "Get inventory by product ID" })
  @ApiParam({ name: "productId", description: "Product ID", type: Number })
  @ApiResponse({
    status: 200,
    description: "Inventory retrieved successfully.",
  })
  @ApiResponse({
    status: 404,
    description: "Inventory not found for this product.",
  })
  async findByProductId(@Param("productId", ParseIntPipe) productId: number) {
    return this.inventoryService.findByProductId(productId);
  }

  @Put(":id")
  @ApiOperation({ summary: "Update inventory item" })
  @ApiParam({ name: "id", description: "Inventory ID", type: Number })
  @ApiResponse({ status: 200, description: "Inventory updated successfully." })
  @ApiResponse({
    status: 400,
    description: "Bad Request - Invalid input data.",
  })
  @ApiResponse({ status: 404, description: "Inventory not found." })
  @ApiResponse({
    status: 403,
    description: "Forbidden - not the product owner.",
  })
  async update(
    @Param("id", ParseIntPipe) id: number,
    @Body(ValidationPipe) body: UpdateInventoryDto,
    @Req() req: Request,
  ) {
    return this.inventoryService.update(
      id,
      body,
      req.user?.id ?? 0,
      req.user?.role ?? "user",
    );
  }
}
