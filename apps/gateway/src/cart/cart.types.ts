export interface ProductResponse {
  price: number | null;
}

export interface ProductSkuResponse {
  productId: number;
  tierIdx: number[] | string;
}
