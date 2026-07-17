export interface ProductWithInventory {
  // Product fields
  id: string;
  name: string;
  description?: string;
  price: number;
  stockQuantity: number;
  sku: string;
  brandId?: number;
  userId?: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  brand?: unknown;
  categories: unknown[];

  // User information
  user?: {
    id: string;
    name: string;
    avatar?: string;
  };

  // Inventory fields
  inventory?: {
    id: number;
    productId: string;
    sku: string;
    availableStock: number;
    reservedStock: number;
    minimumStock: number;
    location?: string;
    isActive: boolean;
    totalStock: number;
    isLowStock: boolean;
  } | null;
}

export type ProductData = {
  id?: string | number;
  publicId?: string | null;
  userId?: string | number;
  name?: string;
  items?: ProductData[];
  data?: ProductData | ProductData[];
  [key: string]: unknown;
};

export type InventoryData = {
  productId?: number;
  availableStock?: number;
  reservedStock?: number;
  minimumStock?: number;
  updatedAt?: unknown;
  [key: string]: unknown;
};

export type UserData = {
  id?: number | string;
  publicId?: string | null;
  name?: string;
  username?: string;
  avatar?: string;
  province?: { id: number; name: string } | null;
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

export type ProductRiskFlag = {
  type: "duplicate_image" | "price_anomaly" | "similar_name";
  weight: number;
  matchedProductId?: string;
  hammingDistance?: number;
  evidenceCount?: number;
  productPrice?: number;
  categoryMedian?: number;
  ratio?: number;
  similarity?: number;
};

export type ProductRiskSummary = {
  productId: string;
  riskScore: number;
  riskFlags: ProductRiskFlag[];
  riskScoringStatus: "ready";
  riskScoredAt: string | Date;
};

export type ProductRiskBackfillResult = {
  enqueued: number;
  nextCursor: number | null;
  hasMore: boolean;
};

export type ProductDuplicateAdvisory = {
  duplicateLikely: boolean;
  match: {
    productId: string;
    name: string;
    imageUrl: string | null;
    hammingDistance: number;
    evidenceCount: number;
  } | null;
};

export type ProductRiskFeedbackResult = {
  productId: string;
  moderatorId: number;
  decision: "confirmed_duplicate" | "dismissed";
  note: string | null;
  updatedAt: string | Date;
};
