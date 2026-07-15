export const PRODUCT_RISK_WEIGHTS = {
  duplicateImage: 60,
  priceAnomaly: 25,
  similarName: 15,
} as const;

export type DuplicateImageRiskFlag = {
  type: "duplicate_image";
  weight: number;
  matchedProductId: number;
  hammingDistance: number;
};

export type PriceAnomalyRiskFlag = {
  type: "price_anomaly";
  weight: number;
  productPrice: number;
  categoryMedian: number;
  ratio: number;
};

export type SimilarNameRiskFlag = {
  type: "similar_name";
  weight: number;
  matchedProductId: number;
  similarity: number;
};

export type ProductRiskFlag =
  | DuplicateImageRiskFlag
  | PriceAnomalyRiskFlag
  | SimilarNameRiskFlag;

export type ProductRiskQuery = {
  minScore?: number;
  page?: number;
  limit?: number;
};

export type ProductRiskSummary = {
  productId: number;
  riskScore: number;
  riskFlags: ProductRiskFlag[];
};
