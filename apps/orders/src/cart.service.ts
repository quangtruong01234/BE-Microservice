import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Repository } from "typeorm";
import { ORDER_MESSAGE } from "libs/constant/response-message.constant";
import { Cart } from "./entity/cart.entity";
import { CartItem } from "./entity/cart-item.entity";

/**
 * Shape returned when the user has no cart row yet. The KEY SET is identical to
 * `Cart` — an endpoint must not answer with two different shapes (SHAPE-01
 * rule 2), so the timestamps are present and `null` rather than absent.
 */
export interface EmptyCart {
  id: null;
  userId: number;
  createdAt: null;
  updatedAt: null;
  items: CartItem[];
}

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    @InjectRepository(Cart)
    private readonly cartRepository: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly cartItemRepository: Repository<CartItem>,
  ) {}

  private emptyCart(userId: number): EmptyCart {
    return { id: null, userId, createdAt: null, updatedAt: null, items: [] };
  }

  async addItem(payload: {
    userId: number;
    productId: number;
    skuId?: number | null;
    skuTierIdx?: string | null;
    quantity: number;
  }): Promise<Cart | EmptyCart> {
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

    // Not `as Promise<Cart>`: the re-read can legitimately miss if the row was
    // deleted between the write and here (a concurrent clear/remove-last-item
    // drops the cart row), and casting that away puts `data: null` back on
    // `POST /api/cart` — the exact shape SHAPE-01 exists to remove.
    const saved = await this.cartRepository.findOne({
      where: { id: cart.id },
      relations: ["items"],
    });
    return saved ?? this.emptyCart(userId);
  }

  /**
   * An empty cart is an EMPTY CART, not the absence of one (SHAPE-01). The row
   * is deleted once the last item is removed, and returning `null` for that
   * made `data.items` a crash for any caller that did not guard — the same
   * "collection came back null" class the response-shape rules ban. A user
   * always has a cart conceptually, so answer with the empty shape and let the
   * row stay an implementation detail. `id` and both timestamps are null while
   * no row exists — same keys either way, so the caller types one shape.
   */
  async getCart(userId: number): Promise<Cart | EmptyCart> {
    const cart = await this.cartRepository.findOne({
      where: { userId },
      relations: ["items"],
    });
    return cart ?? this.emptyCart(userId);
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
