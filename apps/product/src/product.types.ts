import { Product } from "./entity/product.entity";
import { CATALOG_LOOKUP_STATUSES } from "./product.constants";

export type CatalogLookupStatus = (typeof CATALOG_LOOKUP_STATUSES)[number];

export type WishlistMutationResult = {
  productId: number;
  isWishlisted: boolean;
  createdAt: Date;
};

export type WishlistedProduct = Product & {
  wishlistedAt: Date;
};
