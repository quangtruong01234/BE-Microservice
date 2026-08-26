/**
 * Centralized user-facing response/error messages.
 *
 * Grouped by domain. Static messages are plain strings; parameterized
 * messages are arrow functions returning the interpolated string.
 * Never hardcode response message strings inside services/controllers —
 * add them here instead.
 */

export const COMMON_MESSAGE = {
  REQUEST_SUCCESS: "Request Success",
  SERVICE_UNAVAILABLE: "Service unavailable",
  RATE_LIMIT_EXCEEDED: (limit: number, ttl: number): string =>
    `Too many requests. Max ${limit} requests per ${ttl} seconds`,
  RATE_LIMIT_UNAVAILABLE: "Rate limit protection is temporarily unavailable",
} as const;

export const AUTH_MESSAGE = {
  ACCESS_TOKEN_REQUIRED: "Access token is required",
  UNAUTHORIZED: "Unauthorized",
  INSUFFICIENT_ROLE: "Insufficient role",
  INSUFFICIENT_PERMISSIONS: "Insufficient permissions",
  NOT_AUTHENTICATED: "User not authenticated",
  LOGOUT_SUCCESS: "Logged out successfully",
  UNKNOWN_ACTION: (action: string): string => `Unknown action: ${action}`,
} as const;

export const UPLOAD_MESSAGE = {
  FOLDER_NOT_ALLOWED: "Upload folder is not allowed",
  INVALID_PUBLIC_ID_UPLOAD: "Invalid publicId",
  CANNOT_SIGN_FOR_ANOTHER_USER: "Cannot sign media for another user",
  INVALID_PUBLIC_ID_DELETE: "Invalid public_id",
  CANNOT_DELETE_OTHERS_MEDIA: "Cannot delete media owned by another user",
  CANNOT_ATTACH_OTHERS_MEDIA: "Cannot attach media uploaded by another user",
  MEDIA_SERVICE_UNAVAILABLE: "Media service is unavailable",
  DELETE_FAILED: "Failed to delete media",
  FILE_TOO_LARGE: (bytes: number, maxBytes: number): string =>
    `File is ${bytes} bytes, over the ${maxBytes} byte limit for this folder`,
} as const;

export const USER_MESSAGE = {
  DEFAULT_ROLE_NOT_FOUND: "Default role not found, please run seed",
  INVALID_CREDENTIALS: "Invalid username or password",
  INVALID_OR_EXPIRED_VERIFICATION_CODE: "Invalid or expired verification code",
  NOT_FOUND: "User not found",
  USERNAME_TAKEN: "Username is already taken",
  EMAIL_TAKEN: "Email is already registered",
  ADDRESS_NOT_FOUND: "Address not found",
  CANNOT_UPDATE_ANOTHER_USER: "Cannot update another user",
} as const;

export const INVENTORY_MESSAGE = {
  // `productId` is widened to accept the public id too: the inventory service
  // only knows the numeric id, so the gateway re-renders these two messages
  // with the `prod_…` id before they reach the client.
  ALREADY_EXISTS_FOR_PRODUCT: (productId: number | string): string =>
    `Inventory for product ID ${productId} already exists`,
  SKU_ALREADY_EXISTS: (sku: string): string =>
    `Inventory with sku ${sku} already exists`,
  NOT_FOUND_BY_ID: (id: number): string => `Inventory with id ${id} not found`,
  NOT_FOUND_BY_ID_AFTER_UPDATE: (id: number): string =>
    `Inventory with id ${id} not found after update`,
  NOT_FOUND_BY_PRODUCT: (productId: number | string): string =>
    `Inventory for product ${productId} not found`,
  NOT_FOUND_BY_SKU: (sku: string): string =>
    `Inventory with sku ${sku} not found`,
  CANNOT_MODIFY_ANOTHER_USER: "You cannot modify another user's inventory",
  SKU_NOT_OF_PRODUCT: "SKU does not belong to this product",
} as const;

export const SOCIAL_MESSAGE = {
  // No id in the text: the social service only ever sees the internal numeric
  // row id (the gateway resolves `post_...`/`cmt_...` before the TCP hop), so
  // interpolating it leaked that id straight to the client (PRODTEST-0806 #4).
  POST_NOT_FOUND: "Post not found",
  COMMENT_NOT_FOUND: "Comment not found",
  EDIT_OWN_POSTS_ONLY: "You can only edit your own posts",
  DELETE_OWN_POSTS_ONLY: "You can only delete your own posts",
  DELETE_OWN_COMMENTS_ONLY: "You can only delete your own comments",
  CANNOT_REPORT_OWN_POST: "You cannot report your own post",
  ALREADY_REPORTED_POST: "You have already reported this post",
  ALREADY_LIKED: "Already liked",
  LIKE_NOT_FOUND: "Like not found",
  CANNOT_FOLLOW_SELF: "Cannot follow yourself",
  ALREADY_FOLLOWING: "Already following",
  FOLLOW_NOT_FOUND: "Follow relationship not found",
} as const;

export const PRODUCT_MESSAGE = {
  NOT_FOUND: "Product not found",
  NOT_FOUND_BY_ID: (productId: number | string): string =>
    `Product ${productId} not found`,
  INVALID_TIER_IDX_JSON_STRING: (tierIdx: string): string =>
    `Invalid tierIdx "${tierIdx}" — must be a JSON array string`,
  INVALID_TIER_IDX_ARRAY: (tierIdx: string): string =>
    `Invalid tierIdx "${tierIdx}" — must be a JSON array`,
  TIER_IDX_COUNT_MISMATCH: (
    tierIdx: string,
    tierCount: number,
    variationCount: number,
  ): string =>
    `SKU tierIdx ${tierIdx} has ${tierCount} tier(s) but the product defines ${variationCount} variation(s); counts must match`,
  TIER_IDX_OUT_OF_RANGE: (
    tierIdx: string,
    idx: number,
    variationName: string | number,
    optionCount: number,
  ): string =>
    `SKU tierIdx ${tierIdx} index ${idx} is out of range for variation "${variationName}" (${optionCount} option(s))`,
  SKU_NOT_FOUND: (id: number | string): string => `SKU ${id} not found`,
  SKU_ALREADY_EXISTS: "Product with this SKU already exists",
  VERSION_CONFLICT:
    "Product was modified by someone else — reload it and apply your changes again",
  BLOCKED_PENDING_APPROVAL:
    "Product is blocked pending brand/category approval",
  CATEGORIES_NOT_FOUND: "One or more categories not found",
  CATEGORIES_NOT_APPROVED: (categoryIds: string): string =>
    `Categories not approved: ${categoryIds}`,
  BRAND_NOT_FOUND: "Brand not found",
  BRAND_NOT_APPROVED: "Brand has not been approved",
  BRAND_NAME_TAKEN: "Brand with this name already exists or is pending review",
  CATEGORY_NOT_FOUND: "Category not found",
  CATEGORY_NAME_TAKEN:
    "Category with this name already exists or is pending review",
  ALREADY_REVIEWED: "Already reviewed this product",
  REVIEW_NOT_FOUND: "Review not found",
  NOT_YOUR_REVIEW: "Not your review",
  CANNOT_MODIFY_ANOTHER_USER: "You cannot modify another user's product",
  NOT_AVAILABLE: (productId: number | string): string =>
    `Product ${productId} is not available`,
  REQUIRES_SKU: (productId: number | string): string =>
    `Product ${productId} requires a skuId — it has no base price`,
  SKU_NOT_AVAILABLE: (skuId: number | string): string =>
    `SKU ${skuId} is not available`,
  SKU_NOT_OF_PRODUCT: (
    skuId: number | string,
    productId: number | string,
  ): string => `SKU ${skuId} does not belong to product ${productId}`,
  SKU_NOT_OF_SPECIFIED_PRODUCT: "SKU does not belong to the specified product",
  BASE_PRICE_REQUIRES_SKU: "Product has no base price — specify a skuId",
  SKU_INSUFFICIENT_STOCK: (
    skuId: number | string,
    requested: number,
    available: number,
  ): string =>
    `Insufficient stock for SKU ${skuId}: requested ${requested}, available ${available}`,
} as const;

export const ORDER_MESSAGE = {
  NOT_FOUND: (orderId: number | string): string => `Order ${orderId} not found`,
  ACCESS_DENIED: "You do not have access to this order",
  ITEMS_MISSING_SELLER_ID: "Order items are missing sellerId",
  INSUFFICIENT_STOCK: (
    productId: number,
    requested: number,
    available: number,
  ): string =>
    `Insufficient stock for product ${productId}: requested ${requested}, available ${available}`,
  PAYMENT_INIT_UNAVAILABLE: "Payment initialization is temporarily unavailable",
  RESERVE_STOCK_FAILED: (productId: number): string =>
    `Unable to reserve stock for product ${productId}`,
  RMQ_PUBLISHER_UNAVAILABLE: "RabbitMQ publisher unavailable",
  RESERVATION_COMPENSATION_FAILED: (productIds: string): string =>
    `Reservation compensation failed for products: ${productIds}`,
  INVALID_TO_DATE: (to: string): string => `Invalid "to" date: ${to}`,
  INVALID_FROM_DATE: (from: string): string => `Invalid "from" date: ${from}`,
  FROM_AFTER_TO: `"from" must be on or before "to"`,
  NO_GHN_ORDER_CODE: (orderId: number | string): string =>
    `Order ${orderId} has no GHN order code`,
  GHN_ACTION_NOT_ALLOWED: (
    action: string,
    orderId: number | string,
    status: string | undefined,
  ): string =>
    `Action "${action}" is not allowed for order ${orderId} in status "${status}"`,
  GHN_DETAIL_STATUS_MISSING: "GHN detail response did not include a status",
  GHN_DETAIL_STATUS_MISSING_WITH_HISTORY: (
    message: string,
    historyId: number | string,
  ): string => `${message}; historyId=${historyId}`,
  GHN_ACTION_ACCEPTED_CANCELED: (action: string): string =>
    `GHN ${action} accepted; order canceled`,
  GHN_ACTION_ACCEPTED_CONCURRENT: (action: string): string =>
    `GHN ${action} accepted; local order already changed concurrently`,
  GHN_COD_UPDATED: (
    previousCodAmount: number | string | null,
    newCodAmount: number | string,
  ): string => `GHN COD updated from ${previousCodAmount} to ${newCodAmount}`,
  GHN_RECEIVER_UPDATED: (fields: string): string =>
    `GHN receiver updated (${fields})`,
  GHN_STATUS_UNHANDLED: (ghnStatus: string): string =>
    `Unhandled GHN status "${ghnStatus}"`,
  GHN_STATUS_NO_LOCAL_STATUS: (
    ghnStatus: string,
    currentStatus: string,
  ): string =>
    `GHN status "${ghnStatus}" acknowledged; no local equivalent, order stays ${currentStatus}`,
  GHN_STATUS_TERMINAL_IGNORED: (
    ghnStatus: string,
    orderId: number | string,
    currentStatus: string,
  ): string =>
    `Ignored GHN status "${ghnStatus}" for terminal order ${orderId} (${currentStatus})`,
  GHN_STATUS_STALE_IGNORED: (
    ghnStatus: string,
    orderId: number | string,
    currentStatus: string,
  ): string =>
    `Ignored duplicate or stale GHN status "${ghnStatus}" for order ${orderId} (${currentStatus})`,
  GHN_STATUS_CONCURRENT_SKIPPED: (
    orderId: number | string,
    ghnStatus: string,
  ): string =>
    `Order ${orderId} changed concurrently; GHN status "${ghnStatus}" skipped`,
  STATUS_UPDATED: (status: string): string =>
    `Order status updated to ${status}`,
  GHN_DEMO_DISABLED: "GHN demo status endpoint is disabled",
  COD_AMOUNT_INVALID: "codAmount must be a non-negative number",
  RECEIVER_FIELDS_REQUIRED:
    "Provide at least one of toName, toPhone, toAddress",
  CANNOT_CANCEL: "Order cannot be canceled",
  CANCEL_FORBIDDEN: "You do not have permission to cancel this order",
  PRODUCT_NOT_PURCHASED: "Product not found in any completed order",
  CANNOT_CONFIRM: (status: string | undefined): string =>
    `Order cannot be confirmed — current status: ${status}`,
  CANNOT_READY_TO_SHIP: (status: string | undefined): string =>
    `Order cannot be marked ready-to-ship — current status: ${status}`,
  INVALID_TRANSITION: (from: string, to: string): string =>
    `Cannot transition order from ${from} to ${to}`,
  SELLER_CANNOT_ADVANCE:
    "Shipping status after ready-to-ship is reported by the carrier — a seller cannot set it manually",
  PAYMENT_NOT_COMPLETED: (paymentMethod: string): string =>
    `Order cannot be advanced — the ${paymentMethod} payment has not completed yet`,
  CONCURRENT_UPDATE: (orderId: number | string): string =>
    `Order ${orderId} was updated concurrently; please retry`,
  RETURN_FORBIDDEN:
    "You do not have permission to request a return for this order",
  RETURN_NOT_ELIGIBLE: (status: string | undefined): string =>
    `Order is not eligible for a return request — current status: ${status}`,
  RETURN_ALREADY_ACTIVE:
    "An active return request already exists for this order",
  RETURN_REQUEST_NOT_FOUND: (requestId: number | string): string =>
    `Return request ${requestId} not found`,
  RETURN_ALREADY_REVIEWED: (requestId: number | string): string =>
    `Return request ${requestId} has already been reviewed`,
  RETURN_REQUEST_ACCESS_DENIED: "You do not have access to this return request",
  REJECT_REASON_REQUIRED:
    "A reject reason is required to reject a return request",
  CART_ITEM_NOT_FOUND: "Cart item not found",
  CANNOT_ACCESS_OTHERS_ORDERS: "You cannot access another user's orders",
  DUPLICATE_REQUEST_IN_PROGRESS:
    "A duplicate order request is already being processed",
} as const;

export const VOUCHER_MESSAGE = {
  NOT_FOUND_OR_INACTIVE: (code: string): string =>
    `Voucher ${code} not found or inactive`,
  NOT_ACTIVE_YET: (code: string): string => `Voucher ${code} is not active yet`,
  EXPIRED: (code: string): string => `Voucher ${code} has expired`,
  MIN_ORDER_NOT_MET: (minOrder: number, code: string): string =>
    `Order subtotal must be at least ${minOrder} to use voucher ${code}`,
  FULLY_REDEEMED: (code: string): string =>
    `Voucher ${code} has been fully redeemed`,
  USER_LIMIT_REACHED: (code: string): string =>
    `You have already used voucher ${code} the maximum number of times`,
  NO_DISCOUNT: (code: string): string => `Voucher ${code} yields no discount`,
  JUST_FULLY_REDEEMED: (code: string): string =>
    `Voucher ${code} has just been fully redeemed`,
  ALREADY_EXISTS: (code: string): string => `Voucher ${code} already exists`,
  PERCENT_VALUE_INVALID: "Percent discount value must be between 1 and 100",
  FIXED_VALUE_INVALID: "Fixed discount value must be greater than 0",
  NOT_FOUND_BY_ID: (id: number | string): string => `Voucher ${id} not found`,
  SINGLE_SELLER_ONLY:
    "Voucher codes are only supported on single-seller orders",
  // VOUCHER-SHOP-01: a shop voucher priced against a basket that contains none
  // of that shop's items.
  WRONG_SELLER: (code: string): string =>
    `Voucher ${code} only applies to items from the shop that issued it`,
  // VOUCHER-GUARD-01: a fixed voucher worth as much as (or more than) the
  // spend it requires zeroes the goods total of every qualifying basket.
  FIXED_VALUE_EXCEEDS_MIN_ORDER: (
    discountValue: number,
    minOrderAmount: number,
  ): string =>
    `A fixed voucher must require a minimum order above its own value ` +
    `(discountValue ${discountValue}, minOrderAmount ${minOrderAmount})`,
  // No code in the message on purpose: a shop must not be able to harvest
  // other shops' / platform voucher codes by walking voucher ids.
  NOT_OWNED_BY_SELLER: "This voucher belongs to another shop",
  // VOUCHER-EDIT-01. The immutable fields (code, discountType, discountValue)
  // need no message of their own: they are absent from `UpdateVoucherDto`, so
  // the gateway's whitelist rejects them before the orders service is reached.
  USAGE_LIMIT_BELOW_USED: (usageLimit: number, usedCount: number): string =>
    `usageLimit ${usageLimit} is below the ${usedCount} redemption(s) already made`,
  // Loosening a voucher mid-campaign is fine; tightening it after buyers have
  // started using it changes the rules of a game already in progress.
  CANNOT_TIGHTEN_AFTER_USE: (field: string): string =>
    `${field} cannot be made stricter once the voucher has been redeemed`,
  SELLER_NOT_ASSIGNABLE:
    "A shop voucher is always owned by its creator — remove `sellerId`",
} as const;

/**
 * Stable, machine-readable reason a voucher cannot be applied to the current
 * basket. Sent by `order.voucher_available` so the frontend renders its own
 * copy — the backend never ships prose for this.
 */
export const VOUCHER_INELIGIBLE_REASON = {
  INACTIVE: "INACTIVE",
  WRONG_SELLER: "WRONG_SELLER",
  NOT_ACTIVE_YET: "NOT_ACTIVE_YET",
  EXPIRED: "EXPIRED",
  MIN_ORDER_NOT_MET: "MIN_ORDER_NOT_MET",
  FULLY_REDEEMED: "FULLY_REDEEMED",
  USER_LIMIT_REACHED: "USER_LIMIT_REACHED",
  NO_DISCOUNT: "NO_DISCOUNT",
} as const;

export type VoucherIneligibleReason =
  (typeof VOUCHER_INELIGIBLE_REASON)[keyof typeof VOUCHER_INELIGIBLE_REASON];

export const GHN_MESSAGE = {
  ADDRESS_MISSING_PARTS:
    "Shipping address is missing the ward/district/province parts required by GHN",
  CREATE_ERROR: (message: string): string => `GHN error: ${message}`,
  PREVIEW_ERROR: (message: string): string => `GHN preview error: ${message}`,
  ACTION_ERROR: (action: string, message: string): string =>
    `GHN ${action} error: ${message}`,
  ORDER_NOT_FOUND: (ghnOrderCode: string, message: string): string =>
    `GHN order ${ghnOrderCode} not found: ${message}`,
  DETAIL_REQUEST_FAILED: (message: string): string =>
    `GHN detail request failed: ${message}`,
  PROVINCE_UNRESOLVED: (provinceName: string): string =>
    `Cannot resolve province "${provinceName}" to a GHN province`,
  ADDRESS_UNRESOLVED: (
    wardName: string,
    districtName: string,
    provinceName: string,
  ): string =>
    `Cannot resolve shipping address "${wardName}, ${districtName}, ${provinceName}" to a GHN district/ward`,
  DISTRICT_NOT_FOUND: (districtId: number): string =>
    `GHN does not know district ${districtId} — pick a district from GET /api/shipping/districts`,
  WARD_NOT_IN_DISTRICT: (wardCode: string, districtId: number): string =>
    `Ward ${wardCode} does not belong to GHN district ${districtId} — pick a ward from GET /api/shipping/wards`,
  INVALID_WEBHOOK_AUTH: "Invalid webhook authentication",
  MASTER_DATA_ERROR: (message: string): string =>
    `GHN address lookup error: ${message}`,
  CIRCUIT_OPEN: (retryAfterSeconds: number): string =>
    `GHN is temporarily unavailable; retry in ${retryAfterSeconds}s`,
} as const;

export const PAYMENT_MESSAGE = {
  PERSIST_APP_TRANS_ID_FAILED:
    "Failed to persist appTransId — payment row not found by orderId",
  PERSIST_APP_TRANS_ID_MULTI_ORDER_FAILED:
    "Failed to persist appTransId — multi-order payment row not found",
  NOT_FOUND: (appTransId: string): string => `Payment ${appTransId} not found`,
  COMPLETION_FAILED: "Payment completion failed",
  UPDATE_FAILED: "Payment update failed",
  UNSUPPORTED_METHOD: (method: string): string =>
    `Unsupported payment method: ${method}`,
  MISSING_TRANSACTION_REF: "Missing transaction reference",
  TOO_MANY_QUERY_PARAMS: "Too many query parameters",
  INVALID_QUERY_PARAM: (key: string): string =>
    `Invalid query parameter: ${key}`,
  QUERY_PARAM_TOO_LONG: (key: string): string =>
    `Query parameter too long: ${key}`,
} as const;

export const CHAT_MESSAGE = {
  CANNOT_CHAT_WITH_SELF: "Cannot chat with yourself",
  ACCESS_DENIED: "Access denied",
  INVALID_PARENT_MESSAGE: "Parent message not found in this conversation",
} as const;
