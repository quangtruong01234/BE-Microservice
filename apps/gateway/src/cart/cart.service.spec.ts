import { HttpException, HttpStatus } from "@nestjs/common";
import { TimeoutError } from "rxjs";
import { createTcpClientMock, TcpClientMock } from "@app/testing";
import { CART_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { PRODUCT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-product.constant";
import { INVENTORY_MESSAGE_PATTERNS } from "libs/constant/message-pattern-inventory.constant";
import { ERROR_CODE } from "libs/constant/error-code.constant";
import { CartGatewayService } from "./cart.service";

const PRODUCT_PUBLIC_ID = "prod_8fK2mQ9xL3pT7vWb";
const USER_ID = 7;

describe("CartGatewayService.addItem — stock gate (CART-STOCK-01)", () => {
  let ordersClient: TcpClientMock;
  let productClient: TcpClientMock;
  let userClient: TcpClientMock;
  let inventoryClient: TcpClientMock;
  let service: CartGatewayService;

  const sentPatterns = (client: TcpClientMock): unknown[] =>
    client.send.mock.calls.map(([pattern]) => pattern);

  const inventoryCheckPayload = (): unknown =>
    inventoryClient.send.mock.calls.find(
      ([pattern]) =>
        pattern === INVENTORY_MESSAGE_PATTERNS.INVENTORY_CHECK_STOCK,
    )?.[1];

  const expectRejection = async (
    promise: Promise<unknown>,
    errorCode: string,
  ): Promise<void> => {
    const error: unknown = await promise.catch((err: unknown) => err);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
    expect((error as HttpException).getResponse()).toMatchObject({
      errorCode,
    });
    expect(sentPatterns(ordersClient)).not.toContain(
      CART_MESSAGE_PATTERN.CART_ADD_ITEM,
    );
  };

  beforeEach(() => {
    ordersClient = createTcpClientMock();
    productClient = createTcpClientMock();
    userClient = createTcpClientMock();
    inventoryClient = createTcpClientMock();
    service = new CartGatewayService(
      ordersClient.client,
      productClient.client,
      userClient.client,
      inventoryClient.client,
    );

    productClient.replyTo(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_ID, {
      id: 42,
      price: 100000,
      isActive: true,
    });
    productClient.replyTo(PRODUCT_MESSAGE_PATTERNS.SKU_FIND_BY_ID, {
      productId: 42,
      tierIdx: [0],
      isActive: true,
    });
    productClient.replyTo(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_IDS, [
      { id: 42, publicId: PRODUCT_PUBLIC_ID },
    ]);
    ordersClient.replyTo(CART_MESSAGE_PATTERN.CART_GET, {
      id: null,
      items: [],
    });
    ordersClient.replyTo(CART_MESSAGE_PATTERN.CART_ADD_ITEM, {
      id: 1,
      items: [{ id: 9, productId: 42, skuId: null, quantity: 2 }],
    });
    inventoryClient.replyTo(INVENTORY_MESSAGE_PATTERNS.INVENTORY_CHECK_STOCK, {
      available: true,
      availableStock: 10,
    });
  });

  it("rejects an inactive product with 409 PRODUCT_INACTIVE", async () => {
    productClient.replyTo(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_ID, {
      id: 42,
      price: 100000,
      isActive: false,
    });

    await expectRejection(
      service.addItem(USER_ID, { productId: PRODUCT_PUBLIC_ID, quantity: 1 }),
      ERROR_CODE.PRODUCT_INACTIVE,
    );
  });

  it("rejects an inactive SKU with 409 PRODUCT_INACTIVE", async () => {
    productClient.replyTo(PRODUCT_MESSAGE_PATTERNS.SKU_FIND_BY_ID, {
      productId: 42,
      tierIdx: [0],
      isActive: false,
    });

    await expectRejection(
      service.addItem(USER_ID, {
        productId: PRODUCT_PUBLIC_ID,
        skuId: 5,
        quantity: 1,
      }),
      ERROR_CODE.PRODUCT_INACTIVE,
    );
  });

  it("rejects a product with no available stock with 409 OUT_OF_STOCK", async () => {
    inventoryClient.replyTo(INVENTORY_MESSAGE_PATTERNS.INVENTORY_CHECK_STOCK, {
      available: false,
      availableStock: 0,
    });

    await expectRejection(
      service.addItem(USER_ID, { productId: PRODUCT_PUBLIC_ID, quantity: 1 }),
      ERROR_CODE.OUT_OF_STOCK,
    );
  });

  it("checks the line total, not the request alone — 409 QUANTITY_EXCEEDS_STOCK", async () => {
    ordersClient.replyTo(CART_MESSAGE_PATTERN.CART_GET, {
      id: 1,
      items: [
        { id: 8, productId: 42, skuId: 5, quantity: 9 },
        { id: 9, productId: 42, skuId: null, quantity: 3 },
      ],
    });
    inventoryClient.replyTo(INVENTORY_MESSAGE_PATTERNS.INVENTORY_CHECK_STOCK, {
      available: false,
      availableStock: 5,
    });

    await expectRejection(
      service.addItem(USER_ID, { productId: PRODUCT_PUBLIC_ID, quantity: 3 }),
      ERROR_CODE.QUANTITY_EXCEEDS_STOCK,
    );
    // Only the SKU-less line counts toward a SKU-less add: 3 held + 3 asked.
    expect(inventoryCheckPayload()).toEqual({ productId: 42, quantity: 6 });
  });

  it("passes the skuId to the inventory check for a SKU line", async () => {
    await service.addItem(USER_ID, {
      productId: PRODUCT_PUBLIC_ID,
      skuId: 5,
      quantity: 2,
    });

    expect(inventoryCheckPayload()).toEqual({
      productId: 42,
      quantity: 2,
      skuId: 5,
    });
    expect(sentPatterns(ordersClient)).toContain(
      CART_MESSAGE_PATTERN.CART_ADD_ITEM,
    );
  });

  it("adds the item when stock covers the line", async () => {
    const cart = await service.addItem(USER_ID, {
      productId: PRODUCT_PUBLIC_ID,
      quantity: 2,
    });

    expect(cart).toMatchObject({
      items: [{ productId: PRODUCT_PUBLIC_ID, quantity: 2 }],
    });
  });

  it("fails open when the inventory leg times out — checkout stays the gate", async () => {
    inventoryClient.failOn(
      INVENTORY_MESSAGE_PATTERNS.INVENTORY_CHECK_STOCK,
      new TimeoutError(),
    );

    await service.addItem(USER_ID, {
      productId: PRODUCT_PUBLIC_ID,
      quantity: 2,
    });

    expect(sentPatterns(ordersClient)).toContain(
      CART_MESSAGE_PATTERN.CART_ADD_ITEM,
    );
  });

  it("fails open on a cart read failure, checking the request quantity alone", async () => {
    ordersClient.failOn(CART_MESSAGE_PATTERN.CART_GET, new TimeoutError());

    await service.addItem(USER_ID, {
      productId: PRODUCT_PUBLIC_ID,
      quantity: 2,
    });

    expect(inventoryCheckPayload()).toEqual({ productId: 42, quantity: 2 });
    expect(sentPatterns(ordersClient)).toContain(
      CART_MESSAGE_PATTERN.CART_ADD_ITEM,
    );
  });
});
