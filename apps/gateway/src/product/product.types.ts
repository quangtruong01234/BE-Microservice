export interface ProductWithInventory {
  // Product fields
  id: number;
  name: string;
  description?: string;
  price: number;
  stockQuantity: number;
  sku: string;
  brandId?: number;
  userId?: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  brand?: unknown;
  categories: unknown[];

  // User information
  user?: {
    id: number;
    name: string;
    avatar?: string;
  };

  // Inventory fields
  inventory?: {
    id: number;
    productId: number;
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
  id?: number;
  name?: string;
  username?: string;
  avatar?: string;
};
