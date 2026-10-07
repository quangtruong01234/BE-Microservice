import { HttpException, NotFoundException } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { defer, NEVER, of, throwError, TimeoutError } from "rxjs";
import { CachedService } from "@app/cached";
import {
  ORDER_MESSAGE_PATTERN,
  USER_MESSAGE_PATTERN,
} from "libs/constant/message-pattern.constant";
import { PRODUCT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-product.constant";
import { ASSISTANT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-assistant.constant";
import { ASSISTANT_MESSAGE } from "libs/constant/response-message.constant";
import { ERROR_CODE } from "libs/constant/error-code.constant";
import { TCP_TIMEOUT_MS } from "libs/constant/tcp-timeout.constant";
import { ProductService } from "./product.service";

/**
 * PRODTEST-0806 #4 — `submittedBy` is the numeric PK of the seller who proposed
 * a brand/category. The moderation queue resolves it to a `usr_` public id;
 * every other brand/category read drops it.
 */
describe("ProductService submittedBy exposure", () => {
  const productClient = { send: jest.fn() };
  const inventoryClient = { send: jest.fn() };
  const userClient = { send: jest.fn() };
  const ordersClient = { send: jest.fn() };
  const cached = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  let service: ProductService;

  const pendingBrand = {
    id: 12,
    name: "Uniqlo",
    status: "pending",
    submittedBy: 31,
    reviewNote: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProductService(
      productClient as unknown as ClientProxy,
      inventoryClient as unknown as ClientProxy,
      userClient as unknown as ClientProxy,
      ordersClient as unknown as ClientProxy,
      cached as unknown as CachedService,
      { send: jest.fn() } as unknown as ClientProxy,
    );
  });

  it("resolves submittedBy to a public id on the pending brands queue", async () => {
    productClient.send.mockReturnValue(of([pendingBrand]));
    userClient.send.mockReturnValue(
      of([{ id: 31, publicId: "usr_aaaaaaaaaaaaaaaa" }]),
    );

    const brands = (await service.getPendingBrands()) as Record<
      string,
      unknown
    >[];

    expect(userClient.send).toHaveBeenCalledWith(
      { cmd: USER_MESSAGE_PATTERN.GET_USERS_BY_IDS },
      { userIds: [31] },
    );
    expect(brands[0].submittedBy).toBe("usr_aaaaaaaaaaaaaaaa");
    expect(brands[0].name).toBe("Uniqlo");
  });

  it("nulls submittedBy when the submitting user no longer resolves", async () => {
    productClient.send.mockReturnValue(of([pendingBrand]));
    userClient.send.mockReturnValue(of([]));

    const brands = (await service.getPendingBrands()) as Record<
      string,
      unknown
    >[];

    expect(brands[0].submittedBy).toBeNull();
  });

  it("drops submittedBy instead of 500ing when the user service is down", async () => {
    productClient.send.mockReturnValue(of([pendingBrand]));
    userClient.send.mockReturnValue(
      throwError(() => new Error("user service down")),
    );

    const brands = (await service.getPendingBrands()) as Record<
      string,
      unknown
    >[];

    expect(brands[0]).not.toHaveProperty("submittedBy");
    expect(brands[0].name).toBe("Uniqlo");
  });

  it("resolves submittedBy on the pending categories queue", async () => {
    productClient.send.mockReturnValue(
      of([{ id: 5, name: "Áo khoác", status: "pending", submittedBy: 31 }]),
    );
    userClient.send.mockReturnValue(
      of([{ id: 31, publicId: "usr_aaaaaaaaaaaaaaaa" }]),
    );

    const categories = (await service.getPendingCategories()) as Record<
      string,
      unknown
    >[];

    expect(categories[0].submittedBy).toBe("usr_aaaaaaaaaaaaaaaa");
  });

  it("drops submittedBy from the public brand list without calling the user service", async () => {
    productClient.send.mockReturnValue(
      of([{ ...pendingBrand, status: "active" }]),
    );

    const brands = (await service.getAllBrands()) as Record<string, unknown>[];

    expect(brands[0]).not.toHaveProperty("submittedBy");
    expect(brands[0].name).toBe("Uniqlo");
    expect(userClient.send).not.toHaveBeenCalled();
  });

  it("drops submittedBy from the public category list", async () => {
    productClient.send.mockReturnValue(
      of([{ id: 5, name: "Áo khoác", status: "active", submittedBy: 31 }]),
    );

    const categories = (await service.getAllCategories()) as Record<
      string,
      unknown
    >[];

    expect(categories[0]).not.toHaveProperty("submittedBy");
    expect(userClient.send).not.toHaveBeenCalled();
  });

  it("drops submittedBy from the moderation decision response", async () => {
    productClient.send.mockReturnValue(
      of({ ...pendingBrand, status: "active", reviewNote: "ok" }),
    );

    const brand = (await service.reviewBrand(12, { action: "approve" })) as
      | Record<string, unknown>
      | undefined;

    expect(brand).not.toHaveProperty("submittedBy");
    expect(brand?.status).toBe("active");
  });
});

/**
 * BATCH-FAIL-01 — `POST /products/with-inventory/multiple` is a partial-tolerant
 * batch read (SHAPE-01 rule 4): an id that no longer resolves is skipped. That
 * contract only holds while an EMPTY answer means "the catalog says these are
 * gone". A product-service outage must therefore not be flattened into `[]`,
 * while an inventory outage still degrades to `inventory: null`.
 */
describe("ProductService getProductsWithInventory failure modes", () => {
  const productClient = { send: jest.fn() };
  const inventoryClient = { send: jest.fn() };
  const userClient = { send: jest.fn() };
  const ordersClient = { send: jest.fn() };
  const cached = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  let service: ProductService;

  const liveProduct = {
    id: 7,
    publicId: "prod_aaaaaaaaaaaaaaaa",
    name: "Áo thun",
    userId: 31,
    price: 100000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProductService(
      productClient as unknown as ClientProxy,
      inventoryClient as unknown as ClientProxy,
      userClient as unknown as ClientProxy,
      ordersClient as unknown as ClientProxy,
      cached as unknown as CachedService,
      { send: jest.fn() } as unknown as ClientProxy,
    );
    userClient.send.mockReturnValue(of([]));
  });

  it("throws instead of answering [] when the product service is down", async () => {
    productClient.send.mockReturnValue(
      throwError(() => new Error("product service down")),
    );

    await expect(
      service.getProductsWithInventory(["prod_aaaaaaaaaaaaaaaa"]),
    ).rejects.toThrow();
    expect(inventoryClient.send).not.toHaveBeenCalled();
  });

  it("still returns the product with inventory:null when inventory is down", async () => {
    productClient.send.mockReturnValue(of([liveProduct]));
    inventoryClient.send.mockReturnValue(
      throwError(() => new Error("inventory service down")),
    );

    const products = await service.getProductsWithInventory([
      "prod_aaaaaaaaaaaaaaaa",
    ]);

    expect(products).toHaveLength(1);
    expect(products[0].inventory).toBeNull();
  });

  it("skips an id the catalog no longer resolves and keeps the live one", async () => {
    productClient.send.mockReturnValue(of([liveProduct]));
    inventoryClient.send.mockReturnValue(of([]));

    const products = await service.getProductsWithInventory([
      "prod_aaaaaaaaaaaaaaaa",
      "prod_bbbbbbbbbbbbbbbb",
    ]);

    expect(products).toHaveLength(1);
    expect(products[0].id).toBe("prod_aaaaaaaaaaaaaaaa");
  });

  it("answers [] without asking inventory when no id resolves", async () => {
    productClient.send.mockReturnValue(of([]));

    const products = await service.getProductsWithInventory([
      "prod_bbbbbbbbbbbbbbbb",
    ]);

    expect(products).toEqual([]);
    expect(inventoryClient.send).not.toHaveBeenCalled();
  });

  // The back door the FE found in the hậu kiểm of BATCH-FAIL-01: the status
  // matcher reads keywords out of the error TEXT, so an infrastructure failure
  // that merely says "not found" used to answer 404 — which the FE treats as
  // "the batch is gone", retries per id, and ends up with the empty list again.
  it("reports an undeclared product-service error as 502 even when its text says 'not found'", async () => {
    productClient.send.mockReturnValue(
      throwError(
        () =>
          new Error(
            'QueryFailedError: relation "products" does not exist / column not found',
          ),
      ),
    );

    await expect(
      service.getProductsWithInventory(["prod_aaaaaaaaaaaaaaaa"]),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("keeps a status the product service actually declared", async () => {
    productClient.send.mockReturnValue(
      throwError(() => ({ statusCode: 400, message: "Invalid product id" })),
    );

    await expect(
      service.getProductsWithInventory(["prod_aaaaaaaaaaaaaaaa"]),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("keeps 408 for a timeout instead of flattening it into 502", async () => {
    productClient.send.mockReturnValue(
      throwError(() =>
        Object.assign(new Error("Timeout has occurred"), {
          name: "TimeoutError",
        }),
      ),
    );

    await expect(
      service.getProductsWithInventory(["prod_aaaaaaaaaaaaaaaa"]),
    ).rejects.toMatchObject({ status: 408 });
  });
});

/**
 * ENRICH-FAIL-01 — the seller embed used to swallow a user-service failure into
 * the same `user: null` a deleted seller produces. The two must stay
 * distinguishable: a missing seller is data, an unreachable user service is an
 * error.
 */
describe("ProductService seller enrichment failure modes", () => {
  const productClient = { send: jest.fn() };
  const inventoryClient = { send: jest.fn() };
  const userClient = { send: jest.fn() };
  const ordersClient = { send: jest.fn() };
  const cached = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  let service: ProductService;

  const liveProduct = {
    id: 7,
    publicId: "prod_aaaaaaaaaaaaaaaa",
    name: "Áo thun",
    userId: 31,
    price: 100000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProductService(
      productClient as unknown as ClientProxy,
      inventoryClient as unknown as ClientProxy,
      userClient as unknown as ClientProxy,
      ordersClient as unknown as ClientProxy,
      cached as unknown as CachedService,
      { send: jest.fn() } as unknown as ClientProxy,
    );
    productClient.send.mockReturnValue(of([liveProduct]));
    inventoryClient.send.mockReturnValue(of([]));
  });

  it("throws instead of blanking the seller when the user service is down", async () => {
    userClient.send.mockReturnValue(
      throwError(() => new Error("user service down")),
    );

    await expect(
      service.getProductsWithInventory(["prod_aaaaaaaaaaaaaaaa"]),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("still answers 200 with user:null when the seller no longer exists", async () => {
    userClient.send.mockReturnValue(of([]));

    const products = (await service.getProductsWithInventory([
      "prod_aaaaaaaaaaaaaaaa",
    ])) as unknown as Array<Record<string, unknown>>;

    expect(products).toHaveLength(1);
    expect(products[0].user).toBeNull();
    expect(products[0].name).toBe("Áo thun");
  });

  it("embeds the seller when the user service answers", async () => {
    userClient.send.mockReturnValue(
      of([
        {
          id: 31,
          publicId: "usr_aaaaaaaaaaaaaaaa",
          name: "Shop A",
          username: "shopa",
          avatar: null,
        },
      ]),
    );

    const products = (await service.getProductsWithInventory([
      "prod_aaaaaaaaaaaaaaaa",
    ])) as unknown as Array<Record<string, unknown>>;

    // ENRICH-BATCH-01: `username`, not the nullable `users.name` display
    // column — this is the value the single-product read exposes, and the two
    // paths must not name the same seller differently.
    expect(products[0].user).toMatchObject({
      id: "usr_aaaaaaaaaaaaaaaa",
      name: "shopa",
    });
  });

  // ENRICH-BATCH-01 — the case that was actually broken on prod: a seller who
  // never set a display name. `users.name` is NULL, so the batch answered
  // `user.name: null` for a seller that plainly exists, while
  // `GET /api/products/:id` answered "shop1". One nullable column away from
  // the FE rendering "Người bán không còn tồn tại" over a live shop.
  it("names a seller whose display name is unset, matching the per-id read", async () => {
    userClient.send.mockReturnValue(
      of([
        {
          id: 31,
          publicId: "usr_xU2Q7pGhhFpduGWz",
          name: null,
          username: "shop1",
          avatar: null,
        },
      ]),
    );

    const products = (await service.getProductsWithInventory([
      "prod_aaaaaaaaaaaaaaaa",
    ])) as unknown as Array<Record<string, unknown>>;

    expect(products[0].user).toEqual({
      id: "usr_xU2Q7pGhhFpduGWz",
      name: "shop1",
      avatar: null,
    });
  });
});

/**
 * REVIEW-VERIFIED-01 — every review read carries `isVerifiedPurchase`, resolved
 * against orders in one batch per page; an orders failure degrades it to null.
 */
describe("ProductService review isVerifiedPurchase", () => {
  const productClient = { send: jest.fn() };
  const userClient = { send: jest.fn() };
  const ordersClient = { send: jest.fn() };
  const cached = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  let service: ProductService;

  const reviewPage = {
    data: [
      { id: 1, productId: 9, userId: 31, rating: 5, comment: null },
      { id: 2, productId: 9, userId: 44, rating: 2, comment: "meh" },
    ],
    total: 2,
    page: 1,
    limit: 10,
    totalPages: 1,
    hasNext: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    productClient.send.mockImplementation((pattern: string) => {
      if (pattern === PRODUCT_MESSAGE_PATTERNS.REVIEW_FIND_BY_PRODUCT) {
        return of(reviewPage);
      }
      return of([{ id: 9, publicId: "prd_aaaaaaaaaaaaaaaa" }]);
    });
    userClient.send.mockReturnValue(
      of([
        { id: 31, publicId: "usr_aaaaaaaaaaaaaaaa" },
        { id: 44, publicId: "usr_bbbbbbbbbbbbbbbb" },
      ]),
    );
    service = new ProductService(
      productClient as unknown as ClientProxy,
      { send: jest.fn() } as unknown as ClientProxy,
      userClient as unknown as ClientProxy,
      ordersClient as unknown as ClientProxy,
      cached as unknown as CachedService,
      { send: jest.fn() } as unknown as ClientProxy,
    );
  });

  it("marks only the reviewers holding a completed order", async () => {
    ordersClient.send.mockReturnValue(of([31]));

    const reviews = (await service.getProductReviews(
      "prd_aaaaaaaaaaaaaaaa",
      1,
      10,
    )) as { data: Record<string, unknown>[]; total: number };

    expect(ordersClient.send).toHaveBeenCalledWith(
      ORDER_MESSAGE_PATTERN.FIND_VERIFIED_PURCHASERS,
      { productId: 9, userIds: [31, 44] },
    );
    expect(reviews.total).toBe(2);
    expect(reviews.data.map((row) => row.isVerifiedPurchase)).toEqual([
      true,
      false,
    ]);
    expect(reviews.data[0].userId).toBe("usr_aaaaaaaaaaaaaaaa");
  });

  it("degrades isVerifiedPurchase to null when orders is down", async () => {
    ordersClient.send.mockReturnValue(
      throwError(() => new Error("orders down")),
    );

    const reviews = (await service.getProductReviews(
      "prd_aaaaaaaaaaaaaaaa",
      1,
      10,
    )) as { data: Record<string, unknown>[] };

    expect(reviews.data.map((row) => row.isVerifiedPurchase)).toEqual([
      null,
      null,
    ]);
  });

  it("does not ask orders about an empty page", async () => {
    productClient.send.mockReturnValue(of({ ...reviewPage, data: [] }));

    const reviews = (await service.getProductReviews(
      "prd_aaaaaaaaaaaaaaaa",
      1,
      10,
    )) as { data: unknown[] };

    expect(reviews.data).toEqual([]);
    expect(ordersClient.send).not.toHaveBeenCalled();
  });
});

/**
 * PRODUCT-QA-01 [TC-26] — the gateway leg of POST /api/products/:id/ask: an
 * unknown or inactive product is a 404 before the assistant is touched, and
 * every "could not answer right now" collapses to the one contract 503.
 */
describe("[TC-26] askProductQuestion", () => {
  const productClient = { send: jest.fn() };
  const assistantClient = { send: jest.fn() };
  const cached = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  let service: ProductService;

  const publicId = "prd_aaaaaaaaaaaaaaaa";
  const question = "Có vừa laptop 15 inch không?";
  const answer = {
    answer: "Vừa laptop 15.6 inch [1].",
    abstained: false,
    abstainReason: null,
    citations: [{ index: 1, source: "PRODUCT", snippet: "15.6 inch" }],
  };
  const transportError = (): Error =>
    Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3010"), {
      code: "ECONNREFUSED",
    });

  const expectContract503 = async (call: Promise<unknown>): Promise<void> => {
    const error: unknown = await call.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    const httpError = error as HttpException;
    expect(httpError.getStatus()).toBe(503);
    expect(httpError.getResponse()).toEqual({
      statusCode: 503,
      error: "Service Unavailable",
      message: ASSISTANT_MESSAGE.UNAVAILABLE,
      errorCode: ERROR_CODE.ASSISTANT_UNAVAILABLE,
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    productClient.send.mockReturnValue(of({ id: 9, isActive: true }));
    assistantClient.send.mockReturnValue(of(answer));
    service = new ProductService(
      productClient as unknown as ClientProxy,
      { send: jest.fn() } as unknown as ClientProxy,
      { send: jest.fn() } as unknown as ClientProxy,
      { send: jest.fn() } as unknown as ClientProxy,
      cached as unknown as CachedService,
      assistantClient as unknown as ClientProxy,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("sends the numeric product id and the question to the assistant", async () => {
    await expect(service.askProductQuestion(publicId, question)).resolves.toBe(
      answer,
    );

    expect(productClient.send).toHaveBeenCalledWith(
      PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_ID,
      publicId,
    );
    expect(assistantClient.send).toHaveBeenCalledWith(
      ASSISTANT_MESSAGE_PATTERNS.ASK,
      { productId: 9, question },
    );
  });

  it("is a 404 for an unknown product and never calls the assistant", async () => {
    productClient.send.mockReturnValue(of(null));

    await expect(
      service.askProductQuestion(publicId, question),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(assistantClient.send).not.toHaveBeenCalled();
  });

  it("is a 404 for an inactive product and never calls the assistant", async () => {
    productClient.send.mockReturnValue(of({ id: 9, isActive: false }));

    await expect(
      service.askProductQuestion(publicId, question),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(assistantClient.send).not.toHaveBeenCalled();
  });

  it.each([
    ["a TimeoutError", (): Error => new TimeoutError()],
    ["a transport error", transportError],
  ])(
    "maps %s on the product leg to the contract 503",
    async (_label, buildError) => {
      productClient.send.mockReturnValue(throwError(buildError));

      await expectContract503(service.askProductQuestion(publicId, question));
      expect(assistantClient.send).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["a TimeoutError", (): unknown => new TimeoutError()],
    ["a transport error", transportError],
    [
      "an RPC 503",
      (): unknown => ({ statusCode: 503, message: "Gemini quota exhausted" }),
    ],
  ])(
    "maps %s on the assistant leg to the contract 503",
    async (_label, buildError) => {
      assistantClient.send.mockReturnValue(throwError(buildError));

      await expectContract503(service.askProductQuestion(publicId, question));
    },
  );

  it("passes an RPC 400 from the assistant through unchanged", async () => {
    assistantClient.send.mockReturnValue(
      throwError(() => ({ statusCode: 400, message: "question too short" })),
    );

    const error: unknown = await service
      .askProductQuestion(publicId, question)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(400);
  });

  it("does not retry the assistant on a transport error", async () => {
    // A retry re-subscribes to the same observable without a second send(),
    // so count subscriptions, not send() calls.
    let subscriptionCount = 0;
    assistantClient.send.mockReturnValue(
      defer(() => {
        subscriptionCount += 1;
        return throwError(transportError);
      }),
    );

    await expectContract503(service.askProductQuestion(publicId, question));
    expect(subscriptionCount).toBe(1);
  });

  it("waits the WRITE budget, not the READ one, before giving up", async () => {
    jest.useFakeTimers();
    assistantClient.send.mockReturnValue(NEVER);
    let isSettled = false;
    const pending = service
      .askProductQuestion(publicId, question)
      .finally(() => {
        isSettled = true;
      });
    const outcome = expectContract503(pending);

    await jest.advanceTimersByTimeAsync(TCP_TIMEOUT_MS.WRITE - 1);
    expect(isSettled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await outcome;
    expect(isSettled).toBe(true);
  });
});
