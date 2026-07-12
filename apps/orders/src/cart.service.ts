import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Repository } from "typeorm";
import { ORDER_MESSAGE } from "libs/constant/response-message.constant";
import { Cart } from "./entity/cart.entity";
import { CartItem } from "./entity/cart-item.entity";

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    @InjectRepository(Cart)
    private readonly cartRepository: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly cartItemRepository: Repository<CartItem>,
  ) {}

  async addItem(payload: {
    userId: number;
    productId: number;
    skuId?: number | null;
    skuTierIdx?: string | null;
    quantity: number;
  }): Promise<Cart> {
    const { userId, productId, skuId, skuTierIdx, quantity } = payload;

    let cart = await this.cartRepository.findOne({
      where: { userId },
      relations: ["items"],
    });

    if (!cart) {
      cart = await this.cartRepository.save(
        this.cartRepository.create({ userId }),
      );
      cart.items = [];
    }

    const existingItem = await this.cartItemRepository.findOne({
      where: {
        cartId: cart.id,
        productId,
        skuId: skuId ?? IsNull(),
      },
    });

    if (existingItem) {
      existingItem.quantity += quantity;
      await this.cartItemRepository.save(existingItem);
    } else {
      const newItem = this.cartItemRepository.create({
        cartId: cart.id,
        productId,
        skuId: skuId ?? null,
        skuTierIdx: skuTierIdx ?? null,
        quantity,
      });
      await this.cartItemRepository.save(newItem);
    }

    return this.cartRepository.findOne({
      where: { id: cart.id },
      relations: ["items"],
    }) as Promise<Cart>;
  }

  async getCart(userId: number): Promise<Cart | null> {
    return this.cartRepository.findOne({
      where: { userId },
      relations: ["items"],
    });
  }

  private async findOwnedCartItem(
    userId: number,
    cartItemId: number,
  ): Promise<CartItem> {
    const item = await this.cartItemRepository.findOne({
      where: { id: cartItemId },
      relations: ["cart"],
    });
    if (!item || item.cart.userId !== userId) {
      throw new NotFoundException(ORDER_MESSAGE.CART_ITEM_NOT_FOUND);
    }
    return item;
  }

  async updateItem(
    userId: number,
    cartItemId: number,
    quantity: number,
  ): Promise<void> {
    if (quantity <= 0) {
      await this.removeItem(userId, cartItemId);
      return;
    }

    const item = await this.findOwnedCartItem(userId, cartItemId);

    await this.cartItemRepository.update(cartItemId, { quantity });

    const remaining = await this.cartItemRepository.count({
      where: { cartId: item.cartId },
    });
    if (remaining === 0) {
      await this.cartRepository.delete(item.cartId);
    }
  }

  async removeItem(userId: number, cartItemId: number): Promise<void> {
    const item = await this.findOwnedCartItem(userId, cartItemId);
    const cartId = item.cartId;
    await this.cartItemRepository.delete(cartItemId);

    const remaining = await this.cartItemRepository.count({
      where: { cartId },
    });
    if (remaining === 0) {
      await this.cartRepository.delete(cartId);
    }
  }

  async clearCart(userId: number): Promise<void> {
    const cart = await this.cartRepository.findOne({ where: { userId } });
    if (cart) {
      await this.cartRepository.delete(cart.id);
    }
  }
}
