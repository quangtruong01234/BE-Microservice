import { BadRequestException, NotFoundException } from "@nestjs/common";
import { IsNull, QueryFailedError, Repository } from "typeorm";
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

describe("CartService.addItem concurrency (AUD-0925-02)", () => {
  type AddCartRepositoryMock = jest.Mocked<
    Pick<Repository<Cart>, "findOne" | "save">
  > & { create: jest.Mock<Cart, [Partial<Cart>]> };
  type AddCartItemRepositoryMock = jest.Mocked<
    Pick<Repository<CartItem>, "findOne" | "increment" | "insert">
  >;

  const duplicateEntryError = (): QueryFailedError =>
    new QueryFailedError("INSERT", [], {
      code: "ER_DUP_ENTRY",
      message: "Duplicate entry",
    } as unknown as Error);

  const cartRow = (): Cart => ({
    id: 5,
    userId: 1,
    items: [],
    createdAt: new Date("2026-09-25T00:00:00.000Z"),
    updatedAt: new Date("2026-09-25T00:00:00.000Z"),
  });

  const createService = (): {
    service: CartService;
    cartRepository: AddCartRepositoryMock;
    cartItemRepository: AddCartItemRepositoryMock;
  } => {
    const cartRepository: AddCartRepositoryMock = {
      create: jest.fn((entity: Partial<Cart>) => entity as Cart),
      findOne: jest.fn(),
      save: jest.fn(),
    };
    const cartItemRepository: AddCartItemRepositoryMock = {
      findOne: jest.fn(),
      increment: jest.fn(),
      insert: jest.fn(),
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

  const payload = { userId: 1, productId: 35, quantity: 2 };

  it("re-reads the winning cart when a concurrent first add wins the insert", async () => {
    const { service, cartRepository, cartItemRepository } = createService();
    const winner = cartRow();
    cartRepository.findOne
      .mockResolvedValueOnce(null) // initial lookup misses
      .mockResolvedValueOnce(winner) // re-read after ER_DUP_ENTRY
      .mockResolvedValueOnce(winner); // final response read
    cartRepository.save.mockRejectedValueOnce(duplicateEntryError());
    cartItemRepository.findOne.mockResolvedValue(null);

    await expect(service.addItem(payload)).resolves.toBe(winner);

    expect(cartItemRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ cartId: winner.id, productId: 35 }),
    );
  });

  it("rethrows a non-duplicate cart insert failure", async () => {
    const { service, cartRepository } = createService();
    cartRepository.findOne.mockResolvedValue(null);
    cartRepository.save.mockRejectedValueOnce(new Error("connection lost"));

    await expect(service.addItem(payload)).rejects.toThrow("connection lost");
  });

  it("increments an existing line atomically instead of read-modify-write", async () => {
    const { service, cartRepository, cartItemRepository } = createService();
    cartRepository.findOne.mockResolvedValue(cartRow());
    cartItemRepository.findOne.mockResolvedValue({
      id: 10,
      quantity: 3,
    } as CartItem);

    await service.addItem(payload);

    expect(cartItemRepository.increment).toHaveBeenCalledWith(
      { id: 10 },
      "quantity",
      2,
    );
    expect(cartItemRepository.insert).not.toHaveBeenCalled();
  });

  it("maps skuId 0 onto the SKU-less line", async () => {
    const { service, cartRepository, cartItemRepository } = createService();
    cartRepository.findOne.mockResolvedValue(cartRow());
    cartItemRepository.findOne.mockResolvedValue(null);

    await service.addItem({ ...payload, skuId: 0 });

    expect(cartItemRepository.findOne).toHaveBeenCalledWith({
      where: { cartId: 5, productId: 35, skuId: IsNull() },
    });
    expect(cartItemRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ skuId: null }),
    );
  });

  it("falls back to incrementing the winner when a concurrent add wins the line insert", async () => {
    const { service, cartRepository, cartItemRepository } = createService();
    cartRepository.findOne.mockResolvedValue(cartRow());
    cartItemRepository.findOne
      .mockResolvedValueOnce(null) // initial lookup misses
      .mockResolvedValueOnce({ id: 11, quantity: 1 } as CartItem); // winner
    cartItemRepository.insert.mockRejectedValueOnce(duplicateEntryError());

    await service.addItem(payload);

    expect(cartItemRepository.findOne).toHaveBeenLastCalledWith({
      where: { cartId: 5, productId: 35, skuId: IsNull() },
    });
    expect(cartItemRepository.increment).toHaveBeenCalledWith(
      { id: 11 },
      "quantity",
      2,
    );
  });

  it("rethrows when the winning line vanished before the fallback read", async () => {
    const { service, cartRepository, cartItemRepository } = createService();
    cartRepository.findOne.mockResolvedValue(cartRow());
    cartItemRepository.findOne.mockResolvedValue(null);
    cartItemRepository.insert.mockRejectedValueOnce(duplicateEntryError());

    await expect(service.addItem(payload)).rejects.toBeInstanceOf(
      QueryFailedError,
    );
    expect(cartItemRepository.increment).not.toHaveBeenCalled();
  });
});

describe("CartService.addItem line ceiling (AUD-0925-03)", () => {
  const createService = (
    existingQuantity: number,
  ): {
    service: CartService;
    increment: jest.Mock;
  } => {
    const increment = jest.fn();
    const cartRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 5, userId: 1, items: [] }),
    };
    const cartItemRepository = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 10, quantity: existingQuantity }),
      increment,
    };
    return {
      service: new CartService(
        cartRepository as unknown as Repository<Cart>,
        cartItemRepository as unknown as Repository<CartItem>,
      ),
      increment,
    };
  };

  it("allows a sum that lands exactly on the ceiling", async () => {
    const { service, increment } = createService(990);

    await service.addItem({ userId: 1, productId: 35, quantity: 9 });

    expect(increment).toHaveBeenCalledWith({ id: 10 }, "quantity", 9);
  });

  it("rejects a sum past the ceiling with a 400 and writes nothing", async () => {
    const { service, increment } = createService(990);

    await expect(
      service.addItem({ userId: 1, productId: 35, quantity: 10 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(increment).not.toHaveBeenCalled();
  });
});
