import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Request } from "express";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { CartGatewayService } from "./cart.service";
import { AddToCartDto, UpdateCartItemDto } from "./dto/cart.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

@ApiTags("Cart")
@ApiBearerAuth("bearer")
@UseGuards(JwtAuthGuard)
@Controller("cart")
export class CartController {
  constructor(private readonly cartService: CartGatewayService) {}

  @Post()
  @ApiOperation({ summary: "Add item to cart" })
  @ApiResponse({ status: 201, description: "Cart with updated items" })
  async addItem(
    @Req() req: Request,
    @Body() dto: AddToCartDto,
  ): Promise<unknown> {
    const userId = (req.user as { id: number }).id;
    return this.cartService.addItem(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: "Get current user cart" })
  @ApiResponse({ status: 200, description: "Cart with items or null" })
  async getCart(@Req() req: Request): Promise<unknown> {
    const userId = (req.user as { id: number }).id;
    return this.cartService.getCart(userId);
  }

  @Patch("items/:id")
  @ApiOperation({ summary: "Update cart item quantity (0 = remove)" })
  @ApiResponse({ status: 200, description: "Item updated or removed" })
  async updateItem(
    @Param("id", ParseIntPipe) cartItemId: number,
    @Body() dto: UpdateCartItemDto,
  ): Promise<void> {
    return this.cartService.updateItem(cartItemId, dto.quantity);
  }

  @Delete("items/:id")
  @ApiOperation({ summary: "Remove item from cart" })
  @ApiResponse({ status: 200, description: "Item removed" })
  async removeItem(
    @Param("id", ParseIntPipe) cartItemId: number,
  ): Promise<void> {
    return this.cartService.removeItem(cartItemId);
  }

  @Delete()
  @ApiOperation({ summary: "Clear entire cart" })
  @ApiResponse({ status: 200, description: "Cart cleared" })
  async clearCart(@Req() req: Request): Promise<void> {
    const userId = (req.user as { id: number }).id;
    return this.cartService.clearCart(userId);
  }
}
