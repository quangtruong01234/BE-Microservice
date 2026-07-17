export type InventoryOwnershipData = {
  id: number;
  productId: number;
};

export type ProductOwnershipData = {
  id: number;
  userId?: number;
};

export type SkuOwnershipData = {
  id: number;
  productId: number;
};

export type LowStockInventoryRow = Record<string, unknown> & {
  productId: number | string;
};

export type ProductNameData = {
  id: number | string;
  publicId?: string | null;
  name?: string;
};
