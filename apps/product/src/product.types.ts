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

export type PriceSuggestionQuery = {
  categoryId: number;
  brandId?: number;
  condition?: "new" | "used" | "refurbished";
};

export type PriceSuggestion = {
  sufficientData: boolean;
  sampleSize: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
};

export type PriceSuggestionRawRow = {
  sampleSize: string | number;
  median: string | number | null;
  p25: string | number | null;
  p75: string | number | null;
  min: string | number | null;
  max: string | number | null;
};
