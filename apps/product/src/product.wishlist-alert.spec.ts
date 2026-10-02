import { Channel } from "amqplib";
import { ClientProxy } from "@nestjs/microservices";
import { DataSource, EntityManager, Repository } from "typeorm";
import { CachedService } from "@app/cached";
import { CloudinaryService, WishlistAlertEvent } from "@app/common";
import { EVENT } from "@app/common/constants/event";
import { ProductService } from "./product.service";
import { Product } from "./entity/product.entity";
import { Brand } from "./entity/brand.entity";
import { Category } from "./entity/category.entity";
import { ProductReview } from "./entity/product-review.entity";
import { ProductSku } from "./entity/product-sku.entity";
import { WishlistItem } from "./entity/wishlist-item.entity";
import { ProductImageHashService } from "./product-image-hash.service";

interface PublishedMessage {
  pattern: string;
  data: WishlistAlertEvent;
}

const listedProduct = {
  id: 9,
  publicId: "prod_abc",
  name: "Shoe",
  userId: 31,
  isActive: true,
  approvalBlocked: false,
};

describe("ProductService wishlist alerts (WISHLIST-ALERT-01)", () => {
  let restockedRows: number;
  const queryBuilder = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn(() => Promise.resolve({ affected: restockedRows })),
  };
  const productRepository = {
    createQueryBuilder: jest.fn(() => queryBuilder),
    update: jest.fn(() => Promise.resolve({ affected: 1 })),
    findOne: jest.fn(),
  };
  const skuRepository = { count: jest.fn() };
  const wishlistRepository = { find: jest.fn() };
  const cachedService = {
    setNx: jest.fn(),
    keys: jest.fn(() => Promise.resolve([])),
  };
  const manager = {
    createQueryBuilder: jest.fn(() => ({
      setLock: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn(() => Promise.resolve({ product_id: "9" })),
    })),
    findOne: jest.fn(),
    save: jest.fn((row: Product) => Promise.resolve(row)),
  };
  const dataSource = {
    transaction: jest.fn((work: (entityManager: EntityManager) => unknown) =>
      work(manager as unknown as EntityManager),
    ),
  };
  const publish = jest.fn();
  let service: ProductService;

  const publishedMessages = (): PublishedMessage[] =>
    publish.mock.calls.map(
      ([, , body]: [string, string, Buffer]) =>
        JSON.parse(body.toString()) as PublishedMessage,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    restockedRows = 1;
    productRepository.findOne.mockReset().mockResolvedValue(listedProduct);
    skuRepository.count.mockResolvedValue(0);
    wishlistRepository.find.mockResolvedValue([
      { userId: 44 },
      { userId: 31 },
      { userId: 45 },
    ]);
    cachedService.setNx.mockResolvedValue(true);
    service = new ProductService(
      productRepository as unknown as Repository<Product>,
      {} as unknown as Repository<Brand>,
      { findBy: jest.fn() } as unknown as Repository<Category>,
      {} as unknown as Repository<ProductReview>,
      skuRepository as unknown as Repository<ProductSku>,
      wishlistRepository as unknown as Repository<WishlistItem>,
      dataSource as unknown as DataSource,
      cachedService as unknown as CachedService,
      { destroyAssets: jest.fn() } as unknown as CloudinaryService,
      {} as unknown as ProductImageHashService,
      { connection: {}, publish } as unknown as Channel,
      { send: jest.fn(), connect: jest.fn() } as unknown as ClientProxy,
    );
  });

  describe("back in stock", () => {
    it("publishes one alert to every wishlister except the seller on 0 → >0", async () => {
      await service.updateStockQuantity(9, 5);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith("stock_quantity <= 0");
      expect(productRepository.update).not.toHaveBeenCalled();
      expect(cachedService.setNx).toHaveBeenCalledWith(
        "wishlist-alert:back_in_stock:9",
        "1",
        6 * 60 * 60,
      );
      expect(publishedMessages()).toEqual([
        {
          pattern: EVENT.WISHLIST_ALERT_EVENT,
          data: {
            kind: "back_in_stock",
            productId: 9,
            productPublicId: "prod_abc",
            productName: "Shoe",
            userIds: [44, 45],
            previousPrice: null,
            price: null,
          },
        },
      ]);
    });

    it("publishes nothing when the product was already in stock", async () => {
      restockedRows = 0;

      await service.updateStockQuantity(9, 7);

      expect(productRepository.update).toHaveBeenCalledWith(
        { id: 9 },
        { stockQuantity: 7 },
      );
      expect(publish).not.toHaveBeenCalled();
    });

    it("never claims a restock when stock goes to 0", async () => {
      await service.updateStockQuantity(9, 0);

      expect(productRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });

    it("skips a SKU-matrix product, whose mirrored stock is not trustworthy", async () => {
      skuRepository.count.mockResolvedValue(2);

      await service.updateStockQuantity(9, 5);

      expect(publish).not.toHaveBeenCalled();
    });

    it("skips an inactive or approval-blocked product", async () => {
      productRepository.findOne.mockResolvedValueOnce({
        ...listedProduct,
        isActive: false,
      });
      await service.updateStockQuantity(9, 5);
      productRepository.findOne.mockResolvedValueOnce({
        ...listedProduct,
        approvalBlocked: true,
      });
      await service.updateStockQuantity(9, 5);

      expect(publish).not.toHaveBeenCalled();
    });

    it("skips a product only its own seller wishlisted", async () => {
      wishlistRepository.find.mockResolvedValue([{ userId: 31 }]);

      await service.updateStockQuantity(9, 5);

      expect(cachedService.setNx).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });

    it("stays quiet inside the cooldown", async () => {
      cachedService.setNx.mockResolvedValue(false);

      await service.updateStockQuantity(9, 5);

      expect(publish).not.toHaveBeenCalled();
    });

    it("fails closed and still finishes the stock write on a Redis error", async () => {
      cachedService.setNx.mockRejectedValue(new Error("redis down"));

      await expect(service.updateStockQuantity(9, 5)).resolves.toBeUndefined();
      expect(publish).not.toHaveBeenCalled();
    });
  });

  describe("price drop", () => {
    const flushAlert = (): Promise<void> =>
      new Promise((resolve) => setImmediate(resolve));

    beforeEach(() => {
      jest.spyOn(service, "processRiskScoringQueue").mockResolvedValue();
      // products.id is a BIGINT, so mysql2 hydrates it as a string.
      manager.findOne.mockResolvedValue({
        id: "9",
        version: 1,
        price: 200000,
        imageUrls: [],
        description: null,
        variations: null,
      });
    });

    it("publishes when a PATCH lowers the price", async () => {
      await service.updateProduct(9, { price: 150000 });
      await flushAlert();

      expect(cachedService.setNx).toHaveBeenCalledWith(
        "wishlist-alert:price_drop:9",
        "1",
        24 * 60 * 60,
      );
      expect(publishedMessages()[0]?.data).toMatchObject({
        kind: "price_drop",
        productId: 9,
        userIds: [44, 45],
        previousPrice: 200000,
        price: 150000,
      });
    });

    it("publishes nothing when a PATCH raises or keeps the price", async () => {
      await service.updateProduct(9, { price: 250000 });
      await service.updateProduct(9, { name: "Renamed" });
      await flushAlert();

      expect(publish).not.toHaveBeenCalled();
    });
  });
});
