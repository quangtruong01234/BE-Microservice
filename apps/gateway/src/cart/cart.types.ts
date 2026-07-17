export interface ProductResponse {
  id: number;
  price: number | null;
}

export interface ProductSkuResponse {
  productId: number;
  tierIdx: number[] | string;
}
