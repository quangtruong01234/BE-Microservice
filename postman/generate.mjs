import { writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

const OUT_DIR = "C:/Users/Quang Truong/Desktop/MCR/api/postman";
mkdirSync(OUT_DIR, { recursive: true });

// Helper builders -----------------------------------------------------------
const jsonBody = (obj) => ({
  mode: "raw",
  raw: JSON.stringify(obj, null, 2),
  options: { raw: { language: "json" } },
});

// base: "api" (=> {{baseUrl}}) or "root" (=> {{rootUrl}}, un-prefixed routes)
function req(name, method, path, opts = {}) {
  const base = opts.base === "root" ? "{{rootUrl}}" : "{{baseUrl}}";
  const segments = path.split("/").filter(Boolean);
  const url = {
    raw: `${base}/${segments.join("/")}`,
    host: [base],
    path: segments,
  };
  if (opts.query && opts.query.length) {
    url.query = opts.query.map((q) => ({
      key: q.key,
      value: q.value ?? "",
      disabled: q.disabled ?? false,
      description: q.description ?? "",
    }));
    url.raw +=
      "?" + opts.query.map((q) => `${q.key}=${q.value ?? ""}`).join("&");
  }
  const request = {
    method,
    header: [],
    url,
    description: opts.description ?? "",
  };
  if (opts.body) {
    request.body = jsonBody(opts.body);
    request.header.push({ key: "Content-Type", value: "application/json" });
  }
  const item = { name, request, response: [] };
  if (opts.event) item.event = opts.event;
  return item;
}

const folder = (name, items, description = "") => ({
  name,
  description,
  item: items,
});

// Login test script: quick sanity check in the Postman console.
const loginEvent = [
  {
    listen: "test",
    script: {
      type: "text/javascript",
      exec: [
        "pm.test('login ok', () => pm.expect(pm.response.code).to.be.oneOf([200,201]));",
        "// The HttpOnly access_token cookie is stored automatically in Postman's",
        "// cookie jar for this host and sent on every following request.",
        "console.log('Logged in — auth cookie stored for', pm.variables.replaceIn('{{rootUrl}}'));",
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// FOLDERS
// ---------------------------------------------------------------------------

const health = folder("Health", [
  req("Liveness", "GET", "live", { base: "root" }),
  req("Readiness", "GET", "ready", { base: "root" }),
  req("Health", "GET", "health", { base: "root" }),
]);

const user = folder(
  "User / Auth",
  [
    req("Register", "POST", "user/register", {
      body: {
        username: "john_doe",
        email: "john@example.com",
        password: "password123",
      },
      description: "Public. Rate-limited 10/60s.",
    }),
    req("Login", "POST", "user/login", {
      body: {
        username: "{{username}}",
        password: "{{password}}",
        rememberMe: false,
      },
      event: loginEvent,
      description:
        "Public. Sets the HttpOnly `access_token` cookie — Postman stores it automatically and reuses it for the rest of the collection.",
    }),
    req("Forgot password", "POST", "user/forgot-password", {
      body: { email: "john@example.com" },
    }),
    req("Reset password", "POST", "user/reset-password", {
      body: {
        email: "john@example.com",
        code: "123456",
        newPassword: "newPassword123",
      },
    }),
    req("Logout", "POST", "user/logout"),
    req("List users (admin)", "GET", "user", {
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
      ],
      description: "admin role only.",
    }),
    req("Featured sellers", "GET", "user/featured-sellers", {
      query: [{ key: "limit", value: "5" }],
    }),
    req("Me", "GET", "user/me"),
    req("List my addresses", "GET", "user/me/addresses"),
    req("Add address", "POST", "user/me/addresses", {
      body: {
        recipientName: "Nguyen Van A",
        phone: "0987654321",
        addressLine: "123 Le Loi",
        provinceId: 201,
        provinceName: "Ha Noi",
        districtId: 1442,
        districtName: "Quan Ba Dinh",
        wardCode: "20101",
        wardName: "Phuong Cong Vi",
        isDefault: true,
      },
    }),
    req("Update address", "PATCH", "user/me/addresses/{{addressId}}", {
      body: { addressLine: "456 Tran Hung Dao" },
    }),
    req(
      "Set default address",
      "PATCH",
      "user/me/addresses/{{addressId}}/default",
    ),
    req("Delete address", "DELETE", "user/me/addresses/{{addressId}}"),
    req("Get user by id", "GET", "user/{{userId}}", {
      description: "userId = usr_... public id.",
    }),
    req("Update profile", "PATCH", "user/{{userId}}", {
      body: { name: "John Doe" },
      description: "Own account only.",
    }),
  ],
  "Auth uses an HttpOnly cookie set by Login. Run Login first; the cookie jar carries it.",
);

const cart = folder("Cart", [
  req("Add to cart", "POST", "cart", {
    body: { productId: "{{productId}}", skuId: 5, quantity: 1 },
  }),
  req("Get cart", "GET", "cart"),
  req("Update item qty (0 = remove)", "PATCH", "cart/items/{{cartItemId}}", {
    body: { quantity: 2 },
  }),
  req("Remove item", "DELETE", "cart/items/{{cartItemId}}"),
  req("Clear cart", "DELETE", "cart"),
]);

const product = folder("Products", [
  req("Create product", "POST", "products", {
    body: {
      name: "iPhone 14 Pro Max",
      description: "Latest iPhone with A16 Bionic chip",
      price: 1299.99,
      stockQuantity: 100,
      sku: "IPH14PM-256-BLK",
      brandId: 1,
      categoryIds: [1, 2],
      condition: "new",
      weight: 500,
      imageUrls: [],
    },
    description:
      "shop role. For variation products omit price/stock and send variations + skuList.",
  }),
  req("List products", "GET", "products", {
    query: [
      { key: "page", value: "1" },
      { key: "limit", value: "20" },
      { key: "categoryIds", value: "1", disabled: true },
      { key: "brandIds", value: "1", disabled: true },
      { key: "sortBy", value: "createdAt", disabled: true },
    ],
    description: "Public.",
  }),
  req("Price suggestion", "GET", "products/price-suggestion", {
    query: [{ key: "categoryId", value: "1", disabled: true }],
  }),
  req("Admin risk list", "GET", "products/admin/risk", {
    query: [
      { key: "page", value: "1", disabled: true },
      { key: "limit", value: "20", disabled: true },
    ],
    description: "admin.",
  }),
  req(
    "Admin risk rescore",
    "POST",
    "products/admin/risk/{{productId}}/rescore",
  ),
  req("Admin risk backfill", "POST", "products/admin/risk/backfill"),
  req("Duplicate check", "POST", "products/risk/duplicate-check", {
    body: {
      imageUrls: [
        "https://res.cloudinary.com/demo/image/upload/v1/trybuy/products/a.jpg",
      ],
    },
  }),
  req(
    "Admin risk feedback",
    "POST",
    "products/admin/risk/{{productId}}/feedback",
    {
      body: { decision: "approve" },
    },
  ),
  req("Search products", "GET", "products/search", {
    query: [
      { key: "q", value: "iphone" },
      { key: "page", value: "1", disabled: true },
    ],
    description: "Public.",
  }),
  req("By category", "GET", "products/category/{{categoryId}}", {
    description: "Public.",
  }),
  req("By brand", "GET", "products/brand/{{brandId}}", {
    description: "Public.",
  }),
  req("By SKU", "GET", "products/sku/{{sku}}", { description: "Public." }),
  req("List brands", "GET", "products/brands", { description: "Public." }),
  req("Pending brands", "GET", "products/brands/pending", {
    description: "admin.",
  }),
  req("Create brand", "POST", "products/brands", { body: { name: "Apple" } }),
  req("Review brand", "PATCH", "products/brands/{{brandId}}/review", {
    body: { status: "active" },
    description: "admin.",
  }),
  req("Get brand", "GET", "products/brands/{{brandId}}", {
    description: "Public.",
  }),
  req("List categories", "GET", "products/categories", {
    description: "Public.",
  }),
  req("Pending categories", "GET", "products/categories/pending", {
    description: "admin.",
  }),
  req("Create category", "POST", "products/categories", {
    body: { name: "Phones" },
  }),
  req("Review category", "PATCH", "products/categories/{{categoryId}}/review", {
    body: { status: "active" },
    description: "admin.",
  }),
  req("Get category", "GET", "products/categories/{{categoryId}}", {
    description: "Public.",
  }),
  req("My wishlist", "GET", "products/wishlist"),
  req("Add to wishlist", "POST", "products/wishlist/{{productId}}"),
  req("Remove from wishlist", "DELETE", "products/wishlist/{{productId}}"),
  req("List reviews", "GET", "products/{{productId}}/reviews", {
    query: [
      { key: "page", value: "1", disabled: true },
      { key: "limit", value: "10", disabled: true },
    ],
    description: "Public.",
  }),
  req("Create review", "POST", "products/{{productId}}/reviews", {
    body: { rating: 5, comment: "Great product" },
    description: "Must have a COMPLETED order containing the product.",
  }),
  req("Delete review", "DELETE", "products/reviews/{{reviewId}}", {
    description: "Owner only.",
  }),
  req("Product SKUs", "GET", "products/{{productId}}/skus", {
    description: "Public.",
  }),
  req("Get product", "GET", "products/{{productId}}", {
    description: "Public.",
  }),
  req("Update product", "PATCH", "products/{{productId}}", {
    body: { name: "iPhone 14 Pro Max (updated)", price: 1249.99 },
  }),
  req("Delete product", "DELETE", "products/{{productId}}"),
  req("Shop stats", "GET", "products/shop/stats", { description: "shop." }),
  req("With-inventory (all)", "GET", "products/with-inventory/all", {
    description: "Public.",
  }),
  req("With-inventory (one)", "GET", "products/{{productId}}/with-inventory", {
    description: "Public.",
  }),
  req("With-inventory (multiple)", "POST", "products/with-inventory/multiple", {
    body: { productIds: [1, 2, 3] },
    description: "Max 50 ids. Public.",
  }),
  req("Stock check", "GET", "products/{{productId}}/stock-check", {
    query: [{ key: "quantity", value: "1", disabled: true }],
    description: "Public.",
  }),
]);

const order = folder("Orders", [
  req("Admin: all orders", "GET", "order/admin/orders", {
    query: [
      { key: "page", value: "1", disabled: true },
      { key: "status", value: "", disabled: true },
    ],
    description: "admin.",
  }),
  req("Admin GHN: list", "GET", "order/admin/ghn/orders", {
    description: "shipping role.",
  }),
  req(
    "Admin GHN: history",
    "GET",
    "order/admin/ghn/orders/{{orderId}}/history",
  ),
  req("Admin GHN: detail", "GET", "order/admin/ghn/orders/{{orderId}}"),
  req("Admin GHN: sync", "POST", "order/admin/ghn/orders/{{orderId}}/sync"),
  req("Admin GHN: cancel", "POST", "order/admin/ghn/orders/{{orderId}}/cancel"),
  req("Admin GHN: return", "POST", "order/admin/ghn/orders/{{orderId}}/return"),
  req(
    "Admin GHN: update COD",
    "POST",
    "order/admin/ghn/orders/{{orderId}}/update-cod",
    {
      body: { codAmount: 250000 },
    },
  ),
  req(
    "Admin GHN: update receiver",
    "POST",
    "order/admin/ghn/orders/{{orderId}}/update-receiver",
    {
      body: {
        toName: "Nguyen Van B",
        toPhone: "0912345678",
        toAddress: "456 Tran Hung Dao",
      },
    },
  ),
  req(
    "Admin GHN: demo status",
    "POST",
    "order/admin/ghn/orders/{{orderId}}/demo-status",
    {
      body: { ghnStatus: "delivering" },
      description: "Demo only — needs GHN_DEMO_ENDPOINTS_ENABLED=true.",
    },
  ),
  req("Create order", "POST", "order", {
    body: {
      paymentMethod: "cod",
      shippingAddress:
        "Nguyen Van A|0987654321|123 Nguyen Hue|Phuong Ben Nghe|Quan 1|Ho Chi Minh",
      items: [
        {
          productId: "{{productId}}",
          productName: "iPhone 15 Pro",
          quantity: 1,
        },
      ],
      voucherCode: "SALE10",
    },
    description: "Optionally send Idempotency-Key header.",
  }),
  req("Validate voucher", "POST", "order/voucher/validate", {
    body: {
      code: "SALE10",
      items: [
        {
          productId: "{{productId}}",
          productName: "iPhone 15 Pro",
          quantity: 1,
        },
      ],
    },
  }),
  req("Admin: create voucher", "POST", "order/admin/vouchers", {
    body: {
      code: "SALE10",
      description: "10% off",
      discountType: "percent",
      discountValue: 10,
      minOrderAmount: 100000,
      maxDiscountAmount: 50000,
      usageLimit: 100,
      perUserLimit: 1,
      isActive: true,
    },
    description: "admin.",
  }),
  req("Admin: list vouchers", "GET", "order/admin/vouchers", {
    query: [
      { key: "page", value: "1", disabled: true },
      { key: "limit", value: "20", disabled: true },
    ],
    description: "admin.",
  }),
  req(
    "Admin: deactivate voucher",
    "PATCH",
    "order/admin/vouchers/{{voucherId}}/deactivate",
  ),
  req("Shipping fee preview", "POST", "order/shipping-fee", {
    body: {
      shippingAddress:
        "Nguyen Van A|0987654321|123 Nguyen Hue|Phuong Ben Nghe|Quan 1|Ho Chi Minh",
      items: [{ productName: "iPhone 15 Pro", quantity: 1, weight: 300 }],
    },
  }),
  req("Invoice (PDF)", "GET", "order/{{orderId}}/invoice", {
    description: "Buyer / seller / admin. Returns application/pdf.",
  }),
  req("Seller orders", "GET", "order/seller"),
  req("Seller analytics", "GET", "order/seller/analytics", {
    query: [
      { key: "from", value: "", disabled: true },
      { key: "to", value: "", disabled: true },
      { key: "interval", value: "day", disabled: true },
    ],
  }),
  req("Admin analytics", "GET", "order/admin/analytics", {
    description: "shipping read:any.",
  }),
  req("Seller order detail", "GET", "order/seller/{{orderId}}"),
  req("My return requests", "GET", "order/return-requests/mine"),
  req("Return requests (seller/admin)", "GET", "order/return-requests", {
    query: [{ key: "status", value: "pending_review", disabled: true }],
  }),
  req(
    "Approve return",
    "POST",
    "order/return-requests/{{returnRequestId}}/approve",
  ),
  req(
    "Reject return",
    "POST",
    "order/return-requests/{{returnRequestId}}/reject",
    {
      body: { reason: "Item not eligible" },
    },
  ),
  req("Get order", "GET", "order/{{orderId}}"),
  req("User order status counts", "GET", "order/user/{{userId}}/status-counts"),
  req("User orders", "GET", "order/user/{{userId}}", {
    query: [
      { key: "page", value: "1", disabled: true },
      { key: "status", value: "", disabled: true },
    ],
  }),
  req("Cancel order", "PATCH", "order/{{orderId}}/cancel"),
  req("Buyer return request", "POST", "order/{{orderId}}/return-request", {
    body: { reason: "Damaged on arrival" },
  }),
  req("Payment URL", "GET", "order/{{orderId}}/payment-url"),
  req("Confirm order (seller)", "PATCH", "order/{{orderId}}/confirm"),
  req("Ready to ship (seller)", "PATCH", "order/{{orderId}}/ready-to-ship"),
  req("Ship (seller)", "PATCH", "order/{{orderId}}/ship"),
  req("Deliver", "PATCH", "order/{{orderId}}/deliver"),
  req("Complete", "PATCH", "order/{{orderId}}/complete"),
]);

const inventory = folder("Inventory", [
  req("Create inventory", "POST", "inventory", {
    body: {
      productId: "{{productId}}",
      productSkuId: 6,
      sku: "IPHONE15-BK-128",
      availableStock: 50,
      minimumStock: 10,
      location: "WAREHOUSE-A1",
    },
  }),
  req("Low stock", "GET", "inventory/low-stock", {
    description: "shop / admin.",
  }),
  req("By product", "GET", "inventory/product/{{productId}}", {
    description: "Public.",
  }),
  req("Update inventory", "PUT", "inventory/{{inventoryId}}", {
    body: { availableStock: 40 },
  }),
]);

const shipping = folder("Shipping (GHN master data)", [
  req("Provinces", "GET", "shipping/provinces"),
  req("Districts", "GET", "shipping/districts", {
    query: [{ key: "provinceId", value: "201" }],
  }),
  req("Wards", "GET", "shipping/wards", {
    query: [{ key: "districtId", value: "1442" }],
  }),
]);

const payment = folder("Payment", [
  req("Payment options", "GET", "payment/options"),
  req("Payment result", "GET", "gateway/payment-result", {
    query: [{ key: "orderId", value: "", disabled: true }],
  }),
]);

const notifications = folder("Notifications", [
  req("List", "GET", "notifications", {
    query: [
      { key: "page", value: "1", disabled: true },
      { key: "limit", value: "20", disabled: true },
    ],
  }),
  req("Unread count", "GET", "notifications/unread-count"),
  req("Mark read", "PATCH", "notifications/{{notificationId}}/read", {
    description: "notificationId = ntf_... public id.",
  }),
]);

const chat = folder("Chat", [
  req("Create conversation", "POST", "chat/conversations", {
    body: { otherUserId: "{{userId}}" },
  }),
  req("List conversations", "GET", "chat/conversations"),
  req("Messages", "GET", "chat/conversations/{{conversationId}}/messages", {
    query: [
      { key: "page", value: "1", disabled: true },
      { key: "limit", value: "50", disabled: true },
    ],
  }),
  req(
    "Mark conversation read",
    "POST",
    "chat/conversations/{{conversationId}}/read",
  ),
]);

const upload = folder("Upload", [
  req("Get upload signature", "POST", "upload/signature", {
    query: [
      { key: "folder", value: "trybuy/products" },
      { key: "publicId", value: "", disabled: true },
    ],
  }),
  req("Delete media", "DELETE", "upload/media", {
    body: { public_id: "trybuy/posts/3_abc123" },
  }),
]);

const social = folder("Social", [
  folder("Posts", [
    req("Create post", "POST", "social/posts", {
      body: {
        content: "Hello world",
        imageUrls: [],
        productId: "{{productId}}",
      },
    }),
    req("Update post", "PATCH", "social/posts/{{postId}}", {
      body: { content: "Edited content" },
    }),
    req("Report post", "POST", "social/posts/{{postId}}/report", {
      body: { reason: "Spam" },
    }),
    req("List posts", "GET", "social/posts", {
      query: [
        { key: "page", value: "1", disabled: true },
        { key: "limit", value: "10", disabled: true },
      ],
    }),
    req("Posts by user", "GET", "social/posts/user/{{userId}}"),
    req("Get post", "GET", "social/posts/{{postId}}"),
    req("Like post", "POST", "social/posts/{{postId}}/like"),
    req("Unlike post", "DELETE", "social/posts/{{postId}}/like"),
    req("Delete post", "DELETE", "social/posts/{{postId}}"),
    req("Add comment", "POST", "social/posts/{{postId}}/comments", {
      body: { content: "Nice post!" },
    }),
    req("List comments", "GET", "social/posts/{{postId}}/comments"),
  ]),
  folder("Comments", [
    req("Delete comment", "DELETE", "social/comments/{{commentId}}"),
    req("Add reply", "POST", "social/comments/{{commentId}}/replies", {
      body: { content: "I agree", postId: "{{postId}}" },
    }),
    req("List replies", "GET", "social/comments/{{commentId}}/replies"),
  ]),
  folder("Follow", [
    req("Follow user", "POST", "social/users/{{userId}}/follow"),
    req("Unfollow user", "DELETE", "social/users/{{userId}}/follow"),
    req("Followers", "GET", "social/users/{{userId}}/followers"),
    req("Following", "GET", "social/users/{{userId}}/following"),
    req("Feed", "GET", "social/users/{{userId}}/feed"),
  ]),
  folder("Admin moderation", [
    req("Reported posts", "GET", "social/admin/reports", {
      query: [{ key: "status", value: "pending", disabled: true }],
    }),
    req("Hide post", "POST", "social/admin/posts/{{postId}}/hide"),
    req("Unhide post", "POST", "social/admin/posts/{{postId}}/unhide"),
    req("Dismiss reports", "POST", "social/admin/posts/{{postId}}/dismiss"),
    req("Delete post (admin)", "DELETE", "social/admin/posts/{{postId}}"),
  ]),
]);

const callbacks = folder(
  "Callbacks & Webhooks (un-prefixed)",
  [
    req("ZaloPay callback", "POST", "zalopay/callback", {
      base: "root",
      body: {},
    }),
    req("VNPay callback (POST)", "POST", "vnpay/callback", {
      base: "root",
      body: {},
    }),
    req("VNPay callback (GET)", "GET", "vnpay/callback", { base: "root" }),
    req("GHN webhook", "POST", "ghn/webhook", {
      base: "root",
      body: { OrderCode: "GHN123", Status: "delivering" },
      description:
        "Send x-ghn-webhook-token header. Also served at /api/ghn/webhook.",
    }),
  ],
  "Called by external providers (not the frontend). Un-prefixed — use {{rootUrl}}.",
);

// ---------------------------------------------------------------------------
// COLLECTION
// ---------------------------------------------------------------------------
const collection = {
  info: {
    _postman_id: randomUUID(),
    name: "TryBuy API",
    description:
      "TryBuy gateway HTTP API (all microservices are TCP-only behind the gateway).\n\n" +
      "## Switch dev <-> prod\n" +
      "Only two variables control the target host:\n" +
      "- `baseUrl` — prefixed routes, default `http://localhost:3000/api`\n" +
      "- `rootUrl` — un-prefixed routes (health, callbacks, webhook), default `http://localhost:3000`\n\n" +
      "Edit them on the collection (or import an Environment) — e.g. set `baseUrl` to " +
      "`https://api.yourdomain.com/api` and `rootUrl` to `https://api.yourdomain.com`.\n\n" +
      "## Auth\n" +
      "Run **User / Auth > Login** first. It sets the HttpOnly `access_token` cookie; " +
      "Postman's cookie jar stores it per host and sends it automatically on every request. " +
      "Set `username` / `password` variables to a real account.\n\n" +
      "## Path variables\n" +
      "IDs like `{{orderId}}`, `{{productId}}`, `{{userId}}` are collection variables — fill in a real " +
      "public id (`ord_...`, `prod_...`, `usr_...`) before sending. Numeric-id params (cart items, " +
      "inventory, brands, categories) take plain integers.",
    schema:
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  item: [
    health,
    user,
    cart,
    product,
    order,
    inventory,
    shipping,
    payment,
    notifications,
    chat,
    upload,
    social,
    callbacks,
  ],
  variable: [
    { key: "baseUrl", value: "http://localhost:3000/api" },
    { key: "rootUrl", value: "http://localhost:3000" },
    { key: "username", value: "" },
    { key: "password", value: "" },
    { key: "userId", value: "usr_xxxxxxxxxxxxxxxx" },
    { key: "productId", value: "prod_xxxxxxxxxxxxxxxx" },
    { key: "orderId", value: "ord_xxxxxxxxxxxxxxxx" },
    { key: "postId", value: "post_xxxxxxxxxxxxxxxx" },
    { key: "commentId", value: "cmt_xxxxxxxxxxxxxxxx" },
    { key: "conversationId", value: "conv_xxxxxxxxxxxxxxxx" },
    { key: "addressId", value: "addr_xxxxxxxxxxxxxxxx" },
    { key: "notificationId", value: "ntf_xxxxxxxxxxxxxxxx" },
    { key: "returnRequestId", value: "rr_xxxxxxxxxxxxxxxx" },
    { key: "reviewId", value: "1" },
    { key: "voucherId", value: "1" },
    { key: "cartItemId", value: "1" },
    { key: "inventoryId", value: "1" },
    { key: "brandId", value: "1" },
    { key: "categoryId", value: "1" },
    { key: "skuId", value: "IPH14PM-256-BLK" },
    { key: "sku", value: "IPH14PM-256-BLK" },
  ],
};

// Environments --------------------------------------------------------------
const env = (name, baseUrl, rootUrl) => ({
  id: randomUUID(),
  name,
  values: [
    { key: "baseUrl", value: baseUrl, enabled: true },
    { key: "rootUrl", value: rootUrl, enabled: true },
    { key: "username", value: "", enabled: true },
    { key: "password", value: "", enabled: true },
  ],
  _postman_variable_scope: "environment",
});

writeFileSync(
  `${OUT_DIR}/TryBuy.postman_collection.json`,
  JSON.stringify(collection, null, 2),
);
writeFileSync(
  `${OUT_DIR}/TryBuy-local.postman_environment.json`,
  JSON.stringify(
    env("TryBuy Local", "http://localhost:3000/api", "http://localhost:3000"),
    null,
    2,
  ),
);
writeFileSync(
  `${OUT_DIR}/TryBuy-prod.postman_environment.json`,
  JSON.stringify(
    env(
      "TryBuy Prod",
      "https://api.yourdomain.com/api",
      "https://api.yourdomain.com",
    ),
    null,
    2,
  ),
);

// Count requests for the summary
let count = 0;
const walk = (items) =>
  items.forEach((i) => (i.request ? count++ : i.item ? walk(i.item) : null));
walk(collection.item);
console.log(`Wrote collection with ${count} requests to ${OUT_DIR}`);
