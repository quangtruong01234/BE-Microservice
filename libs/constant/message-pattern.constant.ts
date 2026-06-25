export const USER_MESSAGE_PATTERN = {
  GET_USER_INFO: "get_user_info",
  GET_ALL_USERS: "get_all_users",
  GET_USERS_PAGINATED: "get_users_paginated",
  GET_USERS_BY_IDS: "get_users_by_ids",
  REGISTER_USER: "register_user",
  LOGIN_USER: "login_user",
  GET_ME: "user.get_me",
  UPDATE_USER: "user.update",
};

export const PRODUCT_MESSAGE_PATTERN = {
  GET_PRODUCT_BY_ID: "get_product_by_id",
  GET_PRODUCT_BY_SKU: "get_product_by_sku",
  GET_ALL_PRODUCTS: "get_all_products",
  GET_PRODUCTS_BY_CATEGORY: "get_products_by_category",
  GET_PRODUCTS_BY_BRAND: "get_products_by_brand",
  SEARCH_PRODUCTS: "search_products",
  CREATE_PRODUCT: "create_product",
  UPDATE_PRODUCT: "update_product",
  DELETE_PRODUCT: "delete_product",
  GET_PRODUCT_VARIANTS: "get_product_variants",
  CREATE_PRODUCT_VARIANT: "create_product_variant",
  UPDATE_PRODUCT_VARIANT: "update_product_variant",
  DELETE_PRODUCT_VARIANT: "delete_product_variant",
  // Brand operations
  CREATE_BRAND: "create_brand",
  GET_ALL_BRANDS: "get_all_brands",
  // Category operations
  CREATE_CATEGORY: "create_category",
  GET_ALL_CATEGORIES: "get_all_categories",
};

export const ORDER_MESSAGE_PATTERN = {
  CREATE_ORDER: "create_order",
  CREATE_MULTI_SELLER_ORDER: "order.create_multi_seller",
  GET_ORDERS_BY_USER: "get_orders_by_user",
  GET_ORDER_BY_ID: "get_order_by_id",
  GET_ALL_ORDERS: "get_all_orders",
  CANCEL_ORDER: "cancel_order",
  GET_ORDER_INVOICE: "get_order_invoice",
  GHN_WEBHOOK: "handle_ghn_webhook",
  VERIFY_PRODUCT_PURCHASED: "order.verify_product_purchased",
  GET_ORDERS_BY_SELLER: "order.get_by_seller",
  CONFIRM_ORDER: "order.confirm",
  READY_TO_SHIP: "order.ready_to_ship",
  CALCULATE_SHIPPING_FEE: "order.calculate_shipping_fee",
  GET_REFERENCED_SKU_IDS: "order.get_referenced_sku_ids",
  GET_SELLER_ORDER_DETAIL: "order.get_seller_detail",
  ADVANCE_ORDER_STATUS: "order.advance_status",
  GET_ORDER_STATUS_COUNTS: "order.get_status_counts",
};

export const PAYMENT_MESSAGE_PATTERN = {
  GET_PAYMENT_URL: "get_payment_url",
  GET_PAYMENT_OPTIONS: "get_payment_options",
  INITIATE_MULTI_ORDER_PAYMENT: "payment.initiate_multi_order",
};

export const NOTIFICATION_MESSAGE_PATTERN = {
  GET_USER_NOTIFICATIONS: "get_user_notifications",
  GET_UNREAD_COUNT: "get_notification_unread_count",
  MARK_NOTIFICATION_READ: "mark_notification_read",
};

export const SOCIAL_MESSAGE_PATTERN = {
  CREATE_POST: "social_create_post",
  UPDATE_POST: "social_update_post",
  REPORT_POST: "social_report_post",
  GET_POSTS: "social_get_posts",
  GET_POSTS_BY_USER: "social_get_posts_by_user",
  GET_POST_BY_ID: "social_get_post_by_id",
  DELETE_POST: "social_delete_post",
  LIKE_POST: "social_like_post",
  UNLIKE_POST: "social_unlike_post",
  CREATE_COMMENT: "social_create_comment",
  GET_COMMENTS: "social_get_comments",
  DELETE_COMMENT: "social_delete_comment",
  CREATE_REPLY: "social_create_reply",
  GET_REPLIES: "social_get_replies",
  FOLLOW_USER: "social_follow_user",
  UNFOLLOW_USER: "social_unfollow_user",
  GET_FOLLOWERS: "social_get_followers",
  GET_FOLLOWING: "social_get_following",
  GET_FOLLOWING_FEED: "social_get_following_feed",
};

export const CHAT_MESSAGE_PATTERN = {
  CHAT_CREATE_OR_GET_CONVERSATION: "chat.create_or_get_conversation",
  CHAT_GET_CONVERSATIONS: "chat.get_conversations",
  CHAT_GET_MESSAGES: "chat.get_messages",
  CHAT_SEND_MESSAGE: "chat.send_message",
  CHAT_CHECK_MEMBERSHIP: "chat.check_membership",
};

export const CART_MESSAGE_PATTERN = {
  CART_ADD_ITEM: "cart.addItem",
  CART_GET: "cart.get",
  CART_UPDATE_ITEM: "cart.updateItem",
  CART_REMOVE_ITEM: "cart.removeItem",
  CART_CLEAR: "cart.clear",
};
