import { Channel } from "amqplib";
import { ClientProxy } from "@nestjs/microservices";
import { DataSource, Repository } from "typeorm";
import { CachedService } from "@app/cached";
import { CloudinaryService } from "@app/common";
import { ProductService } from "./product.service";
import { Product } from "./entity/product.entity";
import { Brand } from "./entity/brand.entity";
import { Category } from "./entity/category.entity";
import { ProductReview } from "./entity/product-review.entity";
import { ProductSku } from "./entity/product-sku.entity";
import { WishlistItem } from "./entity/wishlist-item.entity";
import { ProductImageHashService } from "./product-image-hash.service";

describe("ProductService.purgeUserData (ACCOUNT-DELETE-01)", () => {
  const productRepository = { update: jest.fn(), delete: jest.fn() };
  const reviewRepository = { update: jest.fn(), delete: jest.fn() };
  const wishlistRepository = { delete: jest.fn() };
  const cachedService = { keys: jest.fn(), del: jest.fn() };
  let service: ProductService;

  beforeEach(() => {
    jest.clearAllMocks();
    cachedService.keys.mockResolvedValue(["products:search:a"]);
    wishlistRepository.delete.mockResolvedValue({ affected: 3 });
    service = new ProductService(
      productRepository as unknown as Repository<Product>,
      {} as unknown as Repository<Brand>,
      {} as unknown as Repository<Category>,
      reviewRepository as unknown as Repository<ProductReview>,
      {} as unknown as Repository<ProductSku>,
      wishlistRepository as unknown as Repository<WishlistItem>,
      {} as unknown as DataSource,
      cachedService as unknown as CachedService,
      {} as unknown as CloudinaryService,
      {} as unknown as ProductImageHashService,
      { connection: {}, publish: jest.fn() } as unknown as Channel,
      { send: jest.fn(), connect: jest.fn() } as unknown as ClientProxy,
    );
  });

  it("deactivates the seller's live listings, drops the wishlist and busts the search cache", async () => {
    productRepository.update.mockResolvedValue({ affected: 2 });

    await expect(service.purgeUserData(9)).resolves.toEqual({
      deactivatedProductCount: 2,
      deletedWishlistItemCount: 3,
    });

    expect(productRepository.update).toHaveBeenCalledWith(
      { userId: 9, isActive: true },
      { isActive: false },
    );
    expect(productRepository.delete).not.toHaveBeenCalled();
    expect(wishlistRepository.delete).toHaveBeenCalledWith({ userId: 9 });
    expect(cachedService.del).toHaveBeenCalledWith("products:search:a");
    // Reviews stay, anonymized through the user scrub.
    expect(reviewRepository.update).not.toHaveBeenCalled();
    expect(reviewRepository.delete).not.toHaveBeenCalled();
  });

  it("skips the search-cache bust when the user sold nothing", async () => {
    productRepository.update.mockResolvedValue({ affected: 0 });

    await expect(service.purgeUserData(9)).resolves.toEqual({
      deactivatedProductCount: 0,
      deletedWishlistItemCount: 3,
    });
    expect(cachedService.keys).not.toHaveBeenCalled();
  });
});
