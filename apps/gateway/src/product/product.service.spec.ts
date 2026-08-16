import { ClientProxy } from "@nestjs/microservices";
import { of, throwError } from "rxjs";
import { CachedService } from "@app/cached";
import { USER_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
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
