// ============================================================================
// PRODUCT SERVICE MESSAGE PATTERNS
// ============================================================================

export const PRODUCT_MESSAGE_PATTERNS = {
  // Product patterns
  PRODUCT_CREATE: 'product.create',
  PRODUCT_FIND_ALL: 'product.findAll',
  PRODUCT_FIND_BY_ID: 'product.findById',
  PRODUCT_FIND_BY_SKU: 'product.findBySku',
  PRODUCT_UPDATE: 'product.update',
  PRODUCT_DELETE: 'product.delete',
  PRODUCT_FIND_BY_CATEGORY: 'product.findByCategory',
  PRODUCT_FIND_BY_BRAND: 'product.findByBrand',
  PRODUCT_SEARCH: 'product.search',

  // Brand patterns
  BRAND_CREATE: 'brand.create',
  BRAND_FIND_ALL: 'brand.findAll',
  BRAND_FIND_BY_ID: 'brand.findById',

  // Category patterns
  CATEGORY_CREATE: 'category.create',
  CATEGORY_FIND_ALL: 'category.findAll',
  CATEGORY_FIND_BY_ID: 'category.findById',
} as const;

export type ProductMessagePattern = typeof PRODUCT_MESSAGE_PATTERNS[keyof typeof PRODUCT_MESSAGE_PATTERNS];