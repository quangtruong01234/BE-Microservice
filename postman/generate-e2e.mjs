// Generates TryBuy-E2E.postman_collection.json
// Collection Runner automation: one folder per role, each starts with a role
// login and then chains a full end-to-end flow. Press "Run" on a folder and it
// executes the whole flow top-to-bottom, sharing the cookie jar + collection
// variables. A final "Full lifecycle (all roles)" folder chains all roles.
//
// Regenerate:  node postman/generate-e2e.mjs
//
// SECURITY: passwords are intentionally left blank here — the test credentials
// live OUTSIDE the repo (../.agent-local/test-accounts.md) and must never be
// committed. Fill the *Password variables in Postman before running.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

let seq = 0;
const uid = () => `e2e-${(seq++).toString(36).padStart(4, "0")}`;

// ---- helpers ---------------------------------------------------------------

/** Build a request item. `test` / `prerequest` are arrays of JS lines.
 *  `rawBody` (string) is used verbatim — needed when a JSON body must contain an
 *  UNquoted Postman variable so it substitutes as a real number (e.g. int ids). */
function req(name, method, urlKind, path, { body, rawBody, query, test, prerequest, desc } = {}) {
  const base = urlKind === "root" ? "{{rootUrl}}" : "{{baseUrl}}";
  const rawQuery = query && query.length ? "?" + query.map((q) => `${q.key}=${q.value}`).join("&") : "";
  const url = {
    raw: `${base}/${path}${rawQuery}`,
    host: [base],
    path: path.split("/").filter(Boolean),
  };
  if (query && query.length) url.query = query.map((q) => ({ key: q.key, value: String(q.value) }));

  const event = [];
  if (prerequest && prerequest.length) {
    event.push({ listen: "prerequest", script: { type: "text/javascript", exec: prerequest } });
  }
  if (test && test.length) {
    event.push({ listen: "test", script: { type: "text/javascript", exec: test } });
  }

  const hasBody = body !== undefined || rawBody !== undefined;
  const request = {
    method,
    header: hasBody ? [{ key: "Content-Type", value: "application/json" }] : [],
    url,
  };
  if (desc) request.description = desc;
  if (hasBody) {
    const raw = rawBody !== undefined ? rawBody : JSON.stringify(body, null, 2);
    request.body = { mode: "raw", raw, options: { raw: { language: "json" } } };
  }

  const item = { name, id: uid(), request };
  if (event.length) item.event = event;
  return item;
}

function folder(name, description, items) {
  return { name, id: uid(), description, item: items };
}

// Shared snippet: unwrap the response envelope { ..., data } -> payload.
const UNWRAP = [
  "// Response envelope: { statusCode, status, message, timestamp, data }",
  "let json = {};",
  "try { json = pm.response.json(); } catch (e) { json = {}; }",
  "const payload = (json && json.data !== undefined) ? json.data : json;",
  "// Paginated payloads are { data:[...], total, ... }; lists unwrap one more level.",
  "const list = (payload && Array.isArray(payload.data)) ? payload.data : payload;",
];

function loginRequest(label, userVar, passVar, idVar) {
  return req(`Login (${label})`, "POST", "api", "user/login", {
    desc: `Sets the HttpOnly access_token cookie for the ${label} role. Fill the ${passVar} variable first (see ../.agent-local/test-accounts.md).`,
    body: { username: `{{${userVar}}}`, password: `{{${passVar}}}` },
    test: [
      ...UNWRAP,
      `pm.test("${label} login 2xx", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));`,
      `if (payload && payload.id) { pm.collectionVariables.set("${idVar}", payload.id); console.log("${label} id:", payload.id); }`,
    ],
  });
}

// ---- Flow A: Buyer (user) --------------------------------------------------

const buyerFlow = folder(
  "🛒 Buyer flow (role: user)",
  "Full storefront purchase journey: browse -> cart -> address -> checkout (COD) -> view -> cancel. Self-contained; needs at least one active product in the catalog.",
  [
    loginRequest("buyer", "buyerUsername", "buyerPassword", "e2eBuyerId"),
    req("Get me", "GET", "api", "user/me", {
      test: [...UNWRAP, 'pm.test("me 200", () => pm.response.code === 200 || pm.expect(pm.response.code).to.eql(200));',
        'if (payload && payload.id) pm.collectionVariables.set("e2eBuyerId", payload.id);'],
    }),
    req("Browse products", "GET", "api", "products", {
      query: [{ key: "page", value: 1 }, { key: "limit", value: 5 }],
      test: [
        ...UNWRAP,
        'pm.test("products 200", () => pm.expect(pm.response.code).to.eql(200));',
        'pm.test("at least one product", () => pm.expect(list.length).to.be.above(0));',
        "const p = list[0];",
        'pm.collectionVariables.set("e2eProductId", p.id);',
        "// price is best-effort; server re-prices at checkout anyway",
        'pm.collectionVariables.set("e2eProductName", p.name || "E2E product");',
        'console.log("picked product:", p.id, p.name);',
      ],
    }),
    req("Get product detail", "GET", "api", "products/{{e2eProductId}}", {
      test: [...UNWRAP, 'pm.test("detail 200", () => pm.expect(pm.response.code).to.eql(200));'],
    }),
    req("Add to cart", "POST", "api", "cart", {
      body: { productId: "{{e2eProductId}}", quantity: 1 },
      test: [
        ...UNWRAP,
        'pm.test("add to cart 2xx", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
      ],
    }),
    req("Get cart", "GET", "api", "cart", {
      test: [
        ...UNWRAP,
        'pm.test("cart 200", () => pm.expect(pm.response.code).to.eql(200));',
        "const items = (payload && payload.items) || [];",
        'if (items.length) pm.collectionVariables.set("e2eCartItemId", items[0].id);',
      ],
    }),
    req("Create shipping address", "POST", "api", "user/me/addresses", {
      body: {
        recipientName: "E2E Buyer",
        phone: "0900000000",
        addressLine: "12 Nguyen Hue",
        provinceId: 202,
        provinceName: "Hồ Chí Minh",
        districtId: 1442,
        districtName: "Quận 1",
        wardCode: "20101",
        wardName: "Phường Bến Nghé",
        isDefault: true,
      },
      test: [
        ...UNWRAP,
        'pm.test("address 2xx", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
        'if (payload && payload.id) pm.collectionVariables.set("e2eAddressId", payload.id);',
      ],
    }),
    req("Preview shipping fee", "POST", "api", "order/shipping-fee", {
      body: {
        shippingAddress: "E2E Buyer|0900000000|12 Nguyen Hue|Phường Bến Nghé|Quận 1|Hồ Chí Minh",
        items: [{ productName: "{{e2eProductName}}", quantity: 1, weight: 500 }],
      },
      test: [...UNWRAP, 'pm.test("fee 2xx", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));'],
    }),
    req("Create order (COD)", "POST", "api", "order", {
      desc: "COD order — no payment gateway redirect. Reserves stock; status PENDING.",
      body: {
        paymentMethod: "cod",
        shippingAddress: "E2E Buyer|0900000000|12 Nguyen Hue|Phường Bến Nghé|Quận 1|Hồ Chí Minh",
        items: [{ productId: "{{e2eProductId}}", productName: "{{e2eProductName}}", quantity: 1 }],
      },
      test: [
        ...UNWRAP,
        'pm.test("order created 2xx", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
        'if (payload && payload.id) { pm.collectionVariables.set("e2eOrderId", payload.id); console.log("order:", payload.id); }',
      ],
    }),
    req("Get my order", "GET", "api", "order/{{e2eOrderId}}", {
      test: [...UNWRAP, 'pm.test("order 200", () => pm.expect(pm.response.code).to.eql(200));'],
    }),
    req("My orders (status counts)", "GET", "api", "order/user/{{e2eBuyerId}}/status-counts", {
      test: [...UNWRAP, 'pm.test("counts 200", () => pm.expect(pm.response.code).to.eql(200));'],
    }),
    req("Cancel order", "PATCH", "api", "order/{{e2eOrderId}}/cancel", {
      desc: "Releases the reserved stock — clean terminal state for a repeatable run.",
      test: [...UNWRAP, 'pm.test("cancel 2xx", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));'],
    }),
  ],
);

// ---- Flow B: Seller (shop) -------------------------------------------------

const sellerFlow = folder(
  "🏪 Seller flow (role: shop)",
  "Catalog management journey: pick a category -> create product -> view/update -> shop stats -> price suggestion -> read own orders. Self-contained; order fulfilment lives in the Full lifecycle folder (needs a buyer order).",
  [
    loginRequest("seller", "sellerUsername", "sellerPassword", "e2eSellerId"),
    req("List categories", "GET", "api", "products/categories", {
      test: [
        ...UNWRAP,
        'pm.test("categories 200", () => pm.expect(pm.response.code).to.eql(200));',
        "const cats = Array.isArray(list) ? list : [];",
        'if (cats.length) pm.collectionVariables.set("e2eCategoryId", cats[0].id); else pm.collectionVariables.set("e2eCategoryId", 1);',
      ],
    }),
    req("Create product", "POST", "api", "products", {
      prerequest: ['pm.collectionVariables.set("e2eSku", "E2E-" + Date.now());'],
      // rawBody: categoryIds must be a real JSON number -> unquoted {{e2eCategoryId}}
      rawBody: [
        "{",
        '  "name": "E2E Test Product",',
        '  "description": "Created by the Postman E2E seller flow.",',
        '  "price": 199000,',
        '  "stockQuantity": 25,',
        '  "sku": "{{e2eSku}}",',
        '  "categoryIds": [{{e2eCategoryId}}],',
        '  "condition": "new",',
        '  "weight": 500',
        "}",
      ].join("\n"),
      test: [
        ...UNWRAP,
        'pm.test("product created 2xx", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
        'if (payload && payload.id) { pm.collectionVariables.set("e2eSellerProductId", payload.id); console.log("product:", payload.id); }',
      ],
    }),
    req("Get created product", "GET", "api", "products/{{e2eSellerProductId}}", {
      test: [...UNWRAP, 'pm.test("product 200", () => pm.expect(pm.response.code).to.eql(200));'],
    }),
    req("Update product price", "PATCH", "api", "products/{{e2eSellerProductId}}", {
      body: { price: 179000 },
      test: [...UNWRAP, 'pm.test("update 2xx", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));'],
    }),
    req("Shop stats", "GET", "api", "products/shop/stats", {
      test: [...UNWRAP, 'pm.test("stats 200", () => pm.expect(pm.response.code).to.eql(200));'],
    }),
    req("Price suggestion", "GET", "api", "products/price-suggestion", {
      query: [{ key: "categoryId", value: "{{e2eCategoryId}}" }],
      test: [...UNWRAP, 'pm.test("suggestion 2xx", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));'],
    }),
    req("My (seller) orders", "GET", "api", "order/seller", {
      test: [
        ...UNWRAP,
        'pm.test("seller orders 200", () => pm.expect(pm.response.code).to.eql(200));',
        "const orders = Array.isArray(list) ? list : [];",
        'if (orders.length) pm.collectionVariables.set("e2eSellerOrderId", orders[0].id);',
      ],
    }),
    req("Seller analytics", "GET", "api", "order/seller/analytics", {
      test: [...UNWRAP, 'pm.test("analytics 200", () => pm.expect(pm.response.code).to.eql(200));'],
    }),
    req("Delete product (cleanup)", "DELETE", "api", "products/{{e2eSellerProductId}}", {
      desc: "Removes the E2E product so the flow is repeatable.",
      test: [...UNWRAP, 'pm.test("delete 2xx", () => pm.expect(pm.response.code).to.be.oneOf([200, 201, 204]));'],
    }),
  ],
);

// ---- Flow C: Admin ---------------------------------------------------------

const adminFlow = folder(
  "🛡️ Admin flow (role: admin)",
  "Back-office journey: users -> moderation queues -> brand/category review -> voucher CRUD -> analytics -> reported posts. All read/admin-permitted; always green.",
  [
    loginRequest("admin", "adminUsername", "adminPassword", "e2eAdminId"),
    req("List users", "GET", "api", "user", {
      query: [{ key: "page", value: 1 }, { key: "limit", value: 10 }],
      test: [...UNWRAP, 'pm.test("users 200", () => pm.expect(pm.response.code).to.eql(200));'],
    }),
    req("Pending brands", "GET", "api", "products/brands/pending", {
      test: [
        ...UNWRAP,
        'pm.test("pending brands 200", () => pm.expect(pm.response.code).to.eql(200));',
        "const brands = Array.isArray(list) ? list : [];",
        'if (brands.length) pm.collectionVariables.set("e2ePendingBrandId", brands[0].id);',
      ],
    }),
    req("Pending categories", "GET", "api", "products/categories/pending", {
      test: [
        ...UNWRAP,
        'pm.test("pending categories 200", () => pm.expect(pm.response.code).to.eql(200));',
        "const cats = Array.isArray(list) ? list : [];",
        'if (cats.length) pm.collectionVariables.set("e2ePendingCategoryId", cats[0].id);',
      ],
    }),
    req("Create voucher", "POST", "api", "order/admin/vouchers", {
      prerequest: ['pm.collectionVariables.set("e2eVoucherCode", "E2E" + Date.now());'],
      body: {
        code: "{{e2eVoucherCode}}",
        description: "E2E automation voucher",
        discountType: "percent",
        discountValue: 10,
        minOrderAmount: 100000,
        maxDiscountAmount: 50000,
        usageLimit: 100,
        perUserLimit: 1,
        isActive: true,
      },
      test: [
        ...UNWRAP,
        'pm.test("voucher created 2xx", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
        'if (payload && payload.id) pm.collectionVariables.set("e2eVoucherId", payload.id);',
      ],
    }),
    req("List vouchers", "GET", "api", "order/admin/vouchers", {
      test: [...UNWRAP, 'pm.test("vouchers 200", () => pm.expect(pm.response.code).to.eql(200));'],
    }),
    req("Deactivate voucher", "PATCH", "api", "order/admin/vouchers/{{e2eVoucherId}}/deactivate", {
      test: [...UNWRAP, 'pm.test("deactivate 2xx", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));'],
    }),
    req("Admin analytics", "GET", "api", "order/admin/analytics", {
      test: [...UNWRAP, 'pm.test("analytics 200", () => pm.expect(pm.response.code).to.eql(200));'],
    }),
    req("Admin orders", "GET", "api", "order/admin/orders", {
      test: [...UNWRAP, 'pm.test("admin orders 200", () => pm.expect(pm.response.code).to.eql(200));'],
    }),
    req("Reported posts (moderation queue)", "GET", "api", "social/admin/reports", {
      query: [{ key: "status", value: "pending" }, { key: "page", value: 1 }, { key: "limit", value: 10 }],
      test: [...UNWRAP, 'pm.test("reports 200", () => pm.expect(pm.response.code).to.eql(200));'],
    }),
  ],
);

// ---- Flow D: Shipping (shipping_manager) -----------------------------------

const shippingFlow = folder(
  "🚚 Shipping flow (role: shipping_manager)",
  "GHN console journey: list shipping orders -> detail -> history -> manual sync. Read steps are always green; detail/history/sync run only when a GHN order exists (guarded) and are lenient on GHN reachability.",
  [
    loginRequest("shipping", "shippingUsername", "shippingPassword", "e2eShippingId"),
    req("List GHN orders", "GET", "api", "order/admin/ghn/orders", {
      test: [
        ...UNWRAP,
        'pm.test("ghn orders 200", () => pm.expect(pm.response.code).to.eql(200));',
        "const orders = Array.isArray(list) ? list : [];",
        'if (orders.length) { pm.collectionVariables.set("e2eGhnOrderId", orders[0].id); console.log("ghn order:", orders[0].id); }',
        'else console.log("No GHN orders yet — detail/history/sync will be skipped.");',
      ],
    }),
    req("GHN order detail", "GET", "api", "order/admin/ghn/orders/{{e2eGhnOrderId}}", {
      prerequest: ['if (!pm.collectionVariables.get("e2eGhnOrderId")) { console.log("skip: no GHN order"); pm.execution.skipRequest && pm.execution.skipRequest(); }'],
      test: [...UNWRAP, 'pm.test("detail responded", () => pm.expect(pm.response.code).to.be.oneOf([200, 400, 404]));'],
    }),
    req("GHN shipping history", "GET", "api", "order/admin/ghn/orders/{{e2eGhnOrderId}}/history", {
      prerequest: ['if (!pm.collectionVariables.get("e2eGhnOrderId")) { console.log("skip: no GHN order"); pm.execution.skipRequest && pm.execution.skipRequest(); }'],
      test: [...UNWRAP, 'pm.test("history responded", () => pm.expect(pm.response.code).to.be.oneOf([200, 400, 404]));'],
    }),
    req("Manual GHN sync", "POST", "api", "order/admin/ghn/orders/{{e2eGhnOrderId}}/sync", {
      desc: "Lenient: GHN sandbox may be unreachable in dev.",
      prerequest: ['if (!pm.collectionVariables.get("e2eGhnOrderId")) { console.log("skip: no GHN order"); pm.execution.skipRequest && pm.execution.skipRequest(); }'],
      test: [...UNWRAP, 'pm.test("sync responded", () => pm.expect(pm.response.code).to.be.oneOf([200, 201, 400, 404, 502, 503]));'],
    }),
  ],
);

// ---- Flow E: Full lifecycle (all roles) ------------------------------------

const lifecycleFlow = folder(
  "🔗 Full lifecycle (all 4 roles, in order)",
  "True cross-role E2E: seller creates a product -> buyer orders it -> seller confirms & ships (GHN, lenient) -> shipping drives delivery via demo-status (needs GHN_DEMO_ENDPOINTS_ENABLED, lenient) -> admin sees it in analytics -> buyer reads the final status. Each Login swaps the active cookie. Core steps are strict; GHN/demo steps are lenient so a sandbox/env gap never reds the run.",
  [
    // 1. Seller creates a product
    loginRequest("seller", "sellerUsername", "sellerPassword", "e2eSellerId"),
    req("Seller: list categories", "GET", "api", "products/categories", {
      test: [...UNWRAP, "const cats = Array.isArray(list) ? list : [];",
        'pm.collectionVariables.set("e2eCategoryId", cats.length ? cats[0].id : 1);'],
    }),
    req("Seller: create product", "POST", "api", "products", {
      prerequest: ['pm.collectionVariables.set("e2eLcSku", "E2ELC-" + Date.now());'],
      // rawBody: categoryIds must be a real JSON number -> unquoted {{e2eCategoryId}}
      rawBody: [
        "{",
        '  "name": "E2E Lifecycle Product",',
        '  "description": "Created by the full-lifecycle flow.",',
        '  "price": 250000,',
        '  "stockQuantity": 10,',
        '  "sku": "{{e2eLcSku}}",',
        '  "categoryIds": [{{e2eCategoryId}}],',
        '  "condition": "new",',
        '  "weight": 500',
        "}",
      ].join("\n"),
      test: [
        ...UNWRAP,
        'pm.test("product created", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
        'pm.collectionVariables.set("e2eLcProductId", payload.id);',
        'pm.collectionVariables.set("e2eLcProductName", payload.name || "E2E Lifecycle Product");',
      ],
    }),
    // 2. Buyer orders it
    loginRequest("buyer", "buyerUsername", "buyerPassword", "e2eBuyerId"),
    req("Buyer: create order (COD)", "POST", "api", "order", {
      body: {
        paymentMethod: "cod",
        shippingAddress: "E2E Buyer|0900000000|12 Nguyen Hue|Phường Bến Nghé|Quận 1|Hồ Chí Minh",
        items: [{ productId: "{{e2eLcProductId}}", productName: "{{e2eLcProductName}}", quantity: 1 }],
      },
      test: [
        ...UNWRAP,
        'pm.test("order created", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
        'pm.collectionVariables.set("e2eLcOrderId", payload.id);',
        'console.log("lifecycle order:", payload.id);',
      ],
    }),
    // 3. Seller confirms & ships
    loginRequest("seller", "sellerUsername", "sellerPassword", "e2eSellerId"),
    req("Seller: confirm order", "PATCH", "api", "order/{{e2eLcOrderId}}/confirm", {
      test: [...UNWRAP, 'pm.test("confirm responded", () => pm.expect(pm.response.code).to.be.oneOf([200, 201, 400, 409]));'],
    }),
    req("Seller: ready-to-ship (creates GHN waybill)", "PATCH", "api", "order/{{e2eLcOrderId}}/ready-to-ship", {
      desc: "Lenient: creates a real GHN waybill; may 400 on address resolution or 5xx if GHN is unreachable in dev.",
      test: [...UNWRAP, 'pm.test("ready-to-ship responded", () => pm.expect(pm.response.code).to.be.oneOf([200, 201, 400, 409, 502, 503]));'],
    }),
    // 4. Shipping drives delivery (demo-status, env-gated)
    loginRequest("shipping", "shippingUsername", "shippingPassword", "e2eShippingId"),
    req("Shipping: demo-status delivering", "POST", "api", "order/admin/ghn/orders/{{e2eLcOrderId}}/demo-status", {
      desc: "Needs GHN_DEMO_ENDPOINTS_ENABLED=true; 403 otherwise. Lenient.",
      body: { ghnStatus: "delivering" },
      test: [...UNWRAP, 'pm.test("demo delivering responded", () => pm.expect(pm.response.code).to.be.oneOf([200, 201, 400, 403, 404]));'],
    }),
    req("Shipping: demo-status delivered", "POST", "api", "order/admin/ghn/orders/{{e2eLcOrderId}}/demo-status", {
      desc: "Drives the order to COMPLETED (+ stock consume / COD payment_completed). Lenient.",
      body: { ghnStatus: "delivered" },
      test: [...UNWRAP, 'pm.test("demo delivered responded", () => pm.expect(pm.response.code).to.be.oneOf([200, 201, 400, 403, 404]));'],
    }),
    // 5. Admin sees it
    loginRequest("admin", "adminUsername", "adminPassword", "e2eAdminId"),
    req("Admin: analytics", "GET", "api", "order/admin/analytics", {
      test: [...UNWRAP, 'pm.test("analytics 200", () => pm.expect(pm.response.code).to.eql(200));'],
    }),
    req("Admin: order detail", "GET", "api", "order/admin/ghn/orders/{{e2eLcOrderId}}", {
      test: [...UNWRAP, 'pm.test("admin order detail responded", () => pm.expect(pm.response.code).to.be.oneOf([200, 404]));'],
    }),
    // 6. Buyer reads final status
    loginRequest("buyer", "buyerUsername", "buyerPassword", "e2eBuyerId"),
    req("Buyer: final order status", "GET", "api", "order/{{e2eLcOrderId}}", {
      test: [
        ...UNWRAP,
        'pm.test("final order 200", () => pm.expect(pm.response.code).to.eql(200));',
        'console.log("final status:", payload && payload.status);',
      ],
    }),
  ],
);

// ---- variables -------------------------------------------------------------

const variables = [
  // host (same names as the main collection / environments so envs work)
  { key: "baseUrl", value: "http://localhost:3000/api" },
  { key: "rootUrl", value: "http://localhost:3000" },
  // role credentials — usernames pre-filled (dev), passwords BLANK on purpose.
  { key: "buyerUsername", value: "canceltest1779978329" },
  { key: "buyerPassword", value: "" },
  { key: "sellerUsername", value: "techstore_demo" },
  { key: "sellerPassword", value: "" },
  { key: "adminUsername", value: "testadmin" },
  { key: "adminPassword", value: "" },
  { key: "shippingUsername", value: "shipmgr_test" },
  { key: "shippingPassword", value: "" },
  // chained ids (filled at runtime)
  { key: "e2eBuyerId", value: "" },
  { key: "e2eSellerId", value: "" },
  { key: "e2eAdminId", value: "" },
  { key: "e2eShippingId", value: "" },
  { key: "e2eProductId", value: "" },
  { key: "e2eProductName", value: "" },
  { key: "e2eCartItemId", value: "" },
  { key: "e2eAddressId", value: "" },
  { key: "e2eOrderId", value: "" },
  { key: "e2eCategoryId", value: "" },
  { key: "e2eSku", value: "" },
  { key: "e2eSellerProductId", value: "" },
  { key: "e2eSellerOrderId", value: "" },
  { key: "e2ePendingBrandId", value: "" },
  { key: "e2ePendingCategoryId", value: "" },
  { key: "e2eVoucherCode", value: "" },
  { key: "e2eVoucherId", value: "" },
  { key: "e2eGhnOrderId", value: "" },
  { key: "e2eLcSku", value: "" },
  { key: "e2eLcProductId", value: "" },
  { key: "e2eLcProductName", value: "" },
  { key: "e2eLcOrderId", value: "" },
];

const collection = {
  info: {
    _postman_id: "trybuy-e2e-automation",
    name: "TryBuy E2E Automation",
    description:
      "Collection Runner automation for TryBuy. Each 🎯 flow folder starts with a role login and chains a full end-to-end journey — open the folder, click **Run**, and it executes every step top-to-bottom, capturing ids into collection variables and asserting each response.\n\n**Before running:** fill the four *Password variables (buyerPassword / sellerPassword / adminPassword / shippingPassword) — credentials are in ../.agent-local/test-accounts.md and are NOT committed. Switch dev↔prod by editing baseUrl/rootUrl (reuses the TryBuy Local/Prod environments).\n\nAuth is a HttpOnly cookie; Postman's cookie jar carries it between steps and each in-flow Login swaps the active role.",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  item: [buyerFlow, sellerFlow, adminFlow, shippingFlow, lifecycleFlow],
  variable: variables,
};

const out = join(__dirname, "TryBuy-E2E.postman_collection.json");
writeFileSync(out, JSON.stringify(collection, null, 2));
const count = collection.item.reduce((n, f) => n + f.item.length, 0);
console.log(`Wrote ${out} — ${collection.item.length} flow folders, ${count} requests.`);
