import { ClientProxy } from "@nestjs/microservices";
import {
  DataSource,
  ObjectLiteral,
  Repository,
  SelectQueryBuilder,
} from "typeorm";
import { CachedService } from "@app/cached";
import { CloudinaryService } from "@app/common";
import { ProductService } from "./product.service";
import { ProductImageHashService } from "./product-image-hash.service";
import { Product } from "./entity/product.entity";
import { Brand } from "./entity/brand.entity";
import { Category } from "./entity/category.entity";
import { ProductReview } from "./entity/product-review.entity";
import { ProductSku } from "./entity/product-sku.entity";
import { WishlistItem } from "./entity/wishlist-item.entity";

const createQueryBuilderMock = <T extends ObjectLiteral>(terminal: {
  getOne?: T;
  getMany?: T[];
  getManyAndCount?: [T[], number];
}): SelectQueryBuilder<T> => {
  const queryBuilder = {
    addSelect: jest.fn(),
    leftJoinAndSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    getOne: jest.fn().mockResolvedValue(terminal.getOne),
    getMany: jest.fn().mockResolvedValue(terminal.getMany ?? []),
    getManyAndCount: jest
      .fn()
      .mockResolvedValue(terminal.getManyAndCount ?? [[], 0]),
  };
  for (const method of [
    "addSelect",
    "leftJoinAndSelect",
    "where",
    "andWhere",
    "orderBy",
    "addOrderBy",
    "skip",
    "take",
  ]) {
    queryBuilder[method as keyof typeof queryBuilder].mockReturnValue(
      queryBuilder,
    );
  }
  return queryBuilder as unknown as SelectQueryBuilder<T>;
};

describe("ProductService product risk scoring", () => {
  const productRepository = {
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    query: jest.fn(),
    update: jest.fn(),
  };
  const productImageHashService = {
    hashImageUrls: jest.fn(),
  };
  const feedbackRepository = {
    findOne: jest.fn(),
    create: jest.fn((input: object) => input),
    save: jest.fn(),
  };
  const dataSource = {
    getRepository: jest.fn().mockReturnValue(feedbackRepository),
  };
  let service: ProductService;

  beforeEach(() => {
    jest.clearAllMocks();
    productRepository.update.mockResolvedValue({ affected: 1 });
    service = new ProductService(
      productRepository as unknown as Repository<Product>,
      {} as unknown as Repository<Brand>,
      {} as unknown as Repository<Category>,
      {} as unknown as Repository<ProductReview>,
      {} as unknown as Repository<ProductSku>,
      {} as unknown as Repository<WishlistItem>,
      dataSource as unknown as DataSource,
      {} as unknown as CachedService,
      {} as unknown as CloudinaryService,
      productImageHashService as unknown as ProductImageHashService,
      null,
      { connect: jest.fn() } as unknown as ClientProxy,
    );
  });

  it("combines duplicate-image, low-price, and similar-name signals", async () => {
    const product = {
      id: 10,
      userId: 20,
      name: "iPhone 15 Pro Max 256GB",
      price: 100,
      imageUrls: [
        "https://res.cloudinary.com/trybuy-test/image/upload/product.png",
      ],
      categories: [{ id: 2 }],
      skus: [],
      condition: "used",
    } as unknown as Product;
    const candidate = {
      id: 11,
      userId: 21,
      name: "iPhone 15 Pro Max 256GB",
      imagePhashes: ["0000000000000000"],
      categories: [{ id: 2 }],
      isActive: true,
    } as unknown as Product;
    productRepository.createQueryBuilder
      .mockReturnValueOnce(createQueryBuilderMock({ getOne: product }))
      .mockReturnValueOnce(createQueryBuilderMock({ getMany: [candidate] }));
    productImageHashService.hashImageUrls.mockResolvedValue([
      "0000000000000000",
    ]);
    productRepository.query.mockResolvedValue([
      {
        sampleSize: 5,
        median: 1000,
        p25: 900,
        p75: 1200,
        min: 800,
        max: 1400,
      },
    ]);

    const summary = await service.rescoreProduct(10);

    expect(summary.riskScore).toBe(100);
    expect(summary.riskFlags.map((flag) => flag.type)).toEqual([
      "duplicate_image",
      "price_anomaly",
      "similar_name",
    ]);
    expect(productRepository.update).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ riskScore: 100 }),
    );
  });

  it("does not flag matching catalog content owned by the same seller", async () => {
    const product = {
      id: 10,
      userId: 20,
      name: "Camera Alpha",
      price: 1000,
      imageUrls: [],
      categories: [{ id: 2 }],
      skus: [],
      condition: "used",
    } as unknown as Product;
    const sameSellerCandidate = {
      id: 11,
      userId: 20,
      name: "Camera Alpha",
      imagePhashes: ["0000000000000000"],
      categories: [{ id: 2 }],
      isActive: true,
    } as unknown as Product;
    productRepository.createQueryBuilder
      .mockReturnValueOnce(createQueryBuilderMock({ getOne: product }))
      .mockReturnValueOnce(
        createQueryBuilderMock({ getMany: [sameSellerCandidate] }),
      );
    productImageHashService.hashImageUrls.mockResolvedValue([
      "0000000000000000",
    ]);
    productRepository.query.mockResolvedValue([
      {
        sampleSize: 5,
        median: 1000,
        p25: 900,
        p75: 1200,
        min: 800,
        max: 1400,
      },
    ]);

    const summary = await service.rescoreProduct(10);
    expect(summary).toEqual({
      productId: 10,
      riskScore: 0,
      riskFlags: [],
      riskScoringStatus: "ready",
      riskScoredAt: summary.riskScoredAt,
    });
    expect(summary.riskScoredAt).toBeInstanceOf(Date);
  });

  it("enqueues a bounded resumable legacy backfill page", async () => {
    productRepository.find.mockResolvedValue([
      { id: 11 },
      { id: 12 },
      { id: 13 },
    ]);
    productRepository.createQueryBuilder.mockReturnValueOnce(
      createQueryBuilderMock({ getMany: [] }),
    );

    await expect(
      service.enqueueRiskBackfill({ cursor: 10, limit: 2 }),
    ).resolves.toEqual({
      enqueued: 2,
      nextCursor: 12,
      hasMore: true,
    });
    expect(productRepository.update).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        riskScoringStatus: "pending",
        riskScoringAttempts: 0,
      }),
    );
  });

  it("returns a public duplicate advisory without exposing stored hashes", async () => {
    const candidate = {
      id: 11,
      userId: 21,
      name: "Camera Alpha",
      imageUrls: ["https://res.cloudinary.com/demo/image/upload/11_camera.jpg"],
      imagePhashes: ["0000000000000000"],
      isActive: true,
    } as unknown as Product;
    productImageHashService.hashImageUrls.mockResolvedValue([
      "0000000000000000",
    ]);
    productRepository.createQueryBuilder.mockReturnValueOnce(
      createQueryBuilderMock({ getMany: [candidate] }),
    );

    const advisory = await service.checkDuplicateImage(
      20,
      "https://res.cloudinary.com/demo/image/upload/20_upload.jpg",
    );

    expect(advisory).toEqual({
      duplicateLikely: true,
      match: {
        productId: 11,
        name: "Camera Alpha",
        imageUrl: "https://res.cloudinary.com/demo/image/upload/11_camera.jpg",
        hammingDistance: 0,
        evidenceCount: 1,
      },
    });
    expect(advisory).not.toHaveProperty("imagePhashes");
  });

  it("upserts auditable moderator feedback without changing listing state", async () => {
    productRepository.findOne.mockResolvedValue({ id: 10 });
    feedbackRepository.findOne.mockResolvedValue(undefined);
    feedbackRepository.save.mockImplementation((feedback: object) =>
      Promise.resolve({
        ...feedback,
        updatedAt: new Date("2026-07-16T00:00:00.000Z"),
      }),
    );

    await expect(
      service.recordRiskFeedback({
        productId: 10,
        moderatorId: 1,
        decision: "dismissed",
        note: "  false positive  ",
      }),
    ).resolves.toEqual({
      productId: 10,
      moderatorId: 1,
      decision: "dismissed",
      note: "false positive",
      updatedAt: new Date("2026-07-16T00:00:00.000Z"),
    });
    expect(productRepository.update).not.toHaveBeenCalledWith(
      10,
      expect.objectContaining({ isActive: false }),
    );
  });

  it("normalizes unscored product risk fields in the admin list", async () => {
    const unscoredProduct = {
      id: 10,
      riskScore: null,
      riskFlags: null,
    } as unknown as Product;
    productRepository.createQueryBuilder.mockReturnValueOnce(
      createQueryBuilderMock({ getManyAndCount: [[unscoredProduct], 1] }),
    );

    const response = await service.findProductRisks({
      page: 1,
      limit: 20,
      minScore: 0,
    });

    expect(response.data[0]).toEqual(
      expect.objectContaining({ riskScore: 0, riskFlags: [] }),
    );
  });

  it("persists bounded retry metadata when scoring fails", async () => {
    const product = {
      id: 10,
      userId: 20,
      name: "Camera Alpha",
      imageUrls: ["https://res.cloudinary.com/demo/image/upload/20_bad.jpg"],
      categories: [{ id: 2 }],
      skus: [],
    } as unknown as Product;
    productRepository.createQueryBuilder.mockReturnValueOnce(
      createQueryBuilderMock({ getOne: product }),
    );
    productImageHashService.hashImageUrls.mockRejectedValue(
      new Error("temporary image fetch failure"),
    );
    productRepository.findOne.mockResolvedValue({
      id: 10,
      riskScoringAttempts: 1,
    });

    await expect(service.rescoreProduct(10)).rejects.toThrow(
      "temporary image fetch failure",
    );
    expect(productRepository.update).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        riskScoringStatus: "failed",
        riskScoringAttempts: 2,
        riskLastError: "temporary image fetch failure",
      }),
    );
  });
});
