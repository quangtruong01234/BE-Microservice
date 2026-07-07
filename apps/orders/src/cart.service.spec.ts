import { NotFoundException } from "@nestjs/common";
import { Repository } from "typeorm";
import { CartItem } from "./entity/cart-item.entity";
import { Cart } from "./entity/cart.entity";
import { CartService } from "./cart.service";

type CartRepositoryMock = jest.Mocked<Pick<Repository<Cart>, "delete">>;

type CartItemRepositoryMock = jest.Mocked<
  Pick<Repository<CartItem>, "count" | "delete" | "findOne" | "update">
>;

describe("CartService cart item ownership", () => {
  const createCart = (userId: number): Cart => ({
    id: 5,
    userId,
    items: [],
    createdAt: new Date("2026-07-07T00:00:00.000Z"),
    updatedAt: new Date("2026-07-07T00:00:00.000Z"),
  });

  const createItem = (cart: Cart): CartItem => ({
    id: 10,
    cartId: cart.id,
    productId: 35,
    skuId: null,
    skuTierIdx: null,
    quantity: 1,
    createdAt: new Date("2026-07-07T00:00:00.000Z"),
    updatedAt: new Date("2026-07-07T00:00:00.000Z"),
    cart,
  });

  const createService = (): {
    service: CartService;
    cartRepository: CartRepositoryMock;
    cartItemRepository: CartItemRepositoryMock;
  } => {
    const cartRepository: CartRepositoryMock = {
      delete: jest.fn(),
    };
    const cartItemRepository: CartItemRepositoryMock = {
      count: jest.fn(),
      delete: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    };

    return {
      service: new CartService(
        cartRepository as unknown as Repository<Cart>,
        cartItemRepository as unknown as Repository<CartItem>,
      ),
      cartRepository,
      cartItemRepository,
    };
  };

  it("does not update another user's cart item", async () => {
    const { service, cartItemRepository } = createService();
    const foreignItem = createItem(createCart(2));
    cartItemRepository.findOne.mockResolvedValue(foreignItem);

    await expect(
      service.updateItem(1, foreignItem.id, 3),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(cartItemRepository.findOne).toHaveBeenCalledWith({
      where: { id: foreignItem.id },
      relations: ["cart"],
    });
    expect(cartItemRepository.update).not.toHaveBeenCalled();
    expect(cartItemRepository.delete).not.toHaveBeenCalled();
  });

  it("does not delete another user's cart item", async () => {
    const { service, cartRepository, cartItemRepository } = createService();
    const foreignItem = createItem(createCart(2));
    cartItemRepository.findOne.mockResolvedValue(foreignItem);

    await expect(service.removeItem(1, foreignItem.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(cartItemRepository.delete).not.toHaveBeenCalled();
    expect(cartItemRepository.count).not.toHaveBeenCalled();
    expect(cartRepository.delete).not.toHaveBeenCalled();
  });

  it("applies updates to an owned cart item", async () => {
    const { service, cartRepository, cartItemRepository } = createService();
    const ownedItem = createItem(createCart(1));
    cartItemRepository.findOne.mockResolvedValue(ownedItem);
    cartItemRepository.count.mockResolvedValue(1);

    await service.updateItem(1, ownedItem.id, 4);

    expect(cartItemRepository.update).toHaveBeenCalledWith(ownedItem.id, {
      quantity: 4,
    });
    expect(cartItemRepository.count).toHaveBeenCalledWith({
      where: { cartId: ownedItem.cartId },
    });
    expect(cartRepository.delete).not.toHaveBeenCalled();
  });

  it("routes non-positive owned quantity updates through owned removal", async () => {
    const { service, cartRepository, cartItemRepository } = createService();
    const ownedItem = createItem(createCart(1));
    cartItemRepository.findOne.mockResolvedValue(ownedItem);
    cartItemRepository.count.mockResolvedValue(0);

    await service.updateItem(1, ownedItem.id, 0);

    expect(cartItemRepository.update).not.toHaveBeenCalled();
    expect(cartItemRepository.delete).toHaveBeenCalledWith(ownedItem.id);
    expect(cartRepository.delete).toHaveBeenCalledWith(ownedItem.cartId);
  });

  it("does not route non-positive foreign quantity updates into a delete", async () => {
    const { service, cartItemRepository } = createService();
    const foreignItem = createItem(createCart(2));
    cartItemRepository.findOne.mockResolvedValue(foreignItem);

    await expect(
      service.updateItem(1, foreignItem.id, 0),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(cartItemRepository.update).not.toHaveBeenCalled();
    expect(cartItemRepository.delete).not.toHaveBeenCalled();
  });
});
