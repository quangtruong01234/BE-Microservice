export const USER_MESSAGE_PATTERN = {
  GET_USER_INFO: 'get_user_info',
  GET_ALL_USERS: 'get_all_users',
  REGISTER_USER: 'register_user',
  LOGIN_USER: 'login_user',
};

export const PRODUCT_MESSAGE_PATTERN = {
  GET_PRODUCT_BY_ID: 'get_product_by_id',
  GET_PRODUCT_BY_SKU: 'get_product_by_sku',
  GET_ALL_PRODUCTS: 'get_all_products',
  GET_PRODUCTS_BY_CATEGORY: 'get_products_by_category',
  GET_PRODUCTS_BY_BRAND: 'get_products_by_brand',
  SEARCH_PRODUCTS: 'search_products',
  CREATE_PRODUCT: 'create_product',
  UPDATE_PRODUCT: 'update_product',
  DELETE_PRODUCT: 'delete_product',
  GET_PRODUCT_VARIANTS: 'get_product_variants',
  CREATE_PRODUCT_VARIANT: 'create_product_variant',
  UPDATE_PRODUCT_VARIANT: 'update_product_variant',
  DELETE_PRODUCT_VARIANT: 'delete_product_variant',
  // Brand operations
  CREATE_BRAND: 'create_brand',
  GET_ALL_BRANDS: 'get_all_brands',
  // Category operations
  CREATE_CATEGORY: 'create_category',
  GET_ALL_CATEGORIES: 'get_all_categories',
};

export const ORDER_MESSAGE_PATTERN = {
  GET_ORDERS_BY_USER: 'get_orders_by_user',
  // Thêm các pattern khác nếu cần
};

// Có thể bổ sung thêm các service khác như INVENTORY_MESSAGE_PATTERN nếu cần
