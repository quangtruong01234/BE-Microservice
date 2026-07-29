#!/usr/bin/env node
/**
 * Seed catalog products for an environment that has an empty `products` table
 * (e.g. a fresh production database created from `database/prod-baseline-*`).
 *
 * Why this exists: `scripts/load/baseline.mjs` aborts with
 * "No prod_ product found via GET /api/products" when the catalog is empty, so
 * the load baseline cannot run on a freshly deployed environment.
 *
 * What it does, in order:
 *   1. Logs in the shop account (products need `product:create:own`).
 *   2. Reads `GET /api/products/categories`. The production baseline seeds only
 *      roles/resources, so this is normally empty — a product cannot be created
 *      without at least one ACTIVE category (`CATEGORIES_NOT_FOUND` / 404).
 *   3. Submits any missing seed category (`POST /api/products/categories` always
 *      saves them as `pending`) and approves each one with the admin account via
 *      `PATCH /api/products/categories/:id/review`. With `--prune`, ACTIVE
 *      categories that are NOT in `CATEGORY_SEED` are rejected instead — this
 *      also sets `approvalBlocked: true, isActive: false` on every product filed
 *      under them, which is how an off-catalog product is retired. Nothing is
 *      deleted, so re-approving the category brings its products back.
 *   4. Creates the seed products (simple: no `skuList`, no `imageUrls`), skipping
 *      any name already in the catalog so a re-run tops it up instead of
 *      duplicating. A simple product with `stockQuantity` makes the gateway
 *      create the matching inventory row, so `availableStock` is > 0 and the
 *      load-test checkout scenario can reserve stock.
 *   5. Verifies the result the exact same way `baseline.mjs` does: a `prod_` id
 *      on page 1 of `GET /api/products` whose inventory has stock.
 *
 * TryBuy is a TECH-ONLY marketplace. `CATEGORY_SEED` / `PRODUCT_SEED` below are
 * the source of truth for what belongs in the catalog.
 *
 * Images are intentionally NOT set — `imageUrls` only accepts Cloudinary URLs
 * owned by the caller, which requires a real upload. Add them later with
 * `PATCH /api/products/:id`.
 *
 * Credentials: copy `.env.seed.example` to `.env.seed` (gitignored) and fill it
 * in, or export the same names as real environment variables. Values already
 * present in the process environment always win over the file. Passwords are
 * never printed by this script.
 *
 * Usage (run it where the gateway is reachable — locally, or on the EC2 host):
 *   node scripts/seed/seed-products.mjs --dry-run
 *   node scripts/seed/seed-products.mjs --prune
 *
 * Flags:
 *   --base <url>   Gateway origin, no trailing slash. Overrides SEED_BASE.
 *   --count <n>    How many seed products to consider. Default: all of them.
 *   --prune        Retire active categories (and their products) that are not
 *                  in CATEGORY_SEED. Needs admin credentials.
 *   --dry-run      Log in + report what would change, change nothing.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ENV_FILE = resolve(REPO_ROOT, ".env.seed");

/**
 * Minimal KEY=VALUE loader. Deliberately dependency-free so the script also
 * runs from a checkout without `node_modules` installed. Never logs values.
 */
function loadEnvFile(path) {
  let contents;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // A real environment variable always beats the file.
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}

/**
 * TryBuy is a TECH-ONLY marketplace: consumer electronics plus the accessories
 * and desk furniture that go with them (mousepad, desk, chair, phone case).
 * Do NOT add fashion / groceries / household categories here — `--prune` will
 * retire any active category that is not on this list.
 */
const CATEGORY_SEED = [
  { name: "Điện thoại", description: "Điện thoại di động và smartphone" },
  { name: "Laptop", description: "Máy tính xách tay" },
  {
    name: "PC & Linh kiện",
    description: "Máy tính để bàn, linh kiện nâng cấp",
  },
  {
    name: "Phụ kiện",
    description: "Ốp lưng, sạc, cáp, phụ kiện điện thoại và máy tính",
  },
  {
    name: "Gaming Gear",
    description: "Chuột, bàn phím, lót chuột, tai nghe gaming",
  },
  {
    name: "Bàn ghế Setup",
    description: "Bàn nâng hạ, ghế công thái học cho góc làm việc",
  },
  { name: "Âm thanh", description: "Tai nghe, loa, thiết bị âm thanh" },
  {
    name: "Thiết bị mạng",
    description: "Router, switch, thiết bị mạng và lưu trữ",
  },
  {
    name: "Thiết bị thông minh",
    description: "Smartwatch, nhà thông minh, thiết bị đeo",
  },
];

const PRODUCT_SEED = [
  {
    name: "Điện thoại TryBuy A1",
    price: 4990000,
    weight: 400,
    category: "Điện thoại",
  },
  {
    name: "Điện thoại TryBuy A2 Pro",
    price: 8990000,
    weight: 420,
    category: "Điện thoại",
  },
  {
    name: "Điện thoại TryBuy Note X",
    price: 12990000,
    weight: 450,
    category: "Điện thoại",
  },
  {
    name: "Laptop TryBuy Book 14",
    price: 15990000,
    weight: 1600,
    category: "Laptop",
  },
  {
    name: "Laptop TryBuy Book Pro 16",
    price: 27990000,
    weight: 2100,
    category: "Laptop",
  },
  {
    name: "PC TryBuy Creator i5",
    price: 18990000,
    weight: 9000,
    category: "PC & Linh kiện",
  },
  {
    name: "SSD TryBuy NVMe 1TB",
    price: 1890000,
    weight: 60,
    category: "PC & Linh kiện",
  },
  {
    name: "Ốp lưng TryBuy Clear Armor",
    price: 149000,
    weight: 45,
    category: "Phụ kiện",
  },
  {
    name: "Sạc nhanh TryBuy 65W",
    price: 450000,
    weight: 180,
    category: "Phụ kiện",
  },
  {
    name: "Cáp sạc TryBuy USB-C 2m",
    price: 129000,
    weight: 70,
    category: "Phụ kiện",
  },
  {
    name: "Chuột không dây TryBuy M1",
    price: 290000,
    weight: 90,
    category: "Gaming Gear",
  },
  {
    name: "Bàn phím cơ TryBuy K2",
    price: 1190000,
    weight: 900,
    category: "Gaming Gear",
  },
  {
    name: "Lót chuột TryBuy XL Pro",
    price: 199000,
    weight: 400,
    category: "Gaming Gear",
  },
  {
    name: "Bàn nâng hạ TryBuy Desk 120",
    price: 4590000,
    weight: 32000,
    category: "Bàn ghế Setup",
  },
  {
    name: "Ghế công thái học TryBuy Ergo One",
    price: 3290000,
    weight: 18000,
    category: "Bàn ghế Setup",
  },
  {
    name: "Tai nghe TryBuy Air",
    price: 890000,
    weight: 120,
    category: "Âm thanh",
  },
  {
    name: "Loa bluetooth TryBuy Sound Mini",
    price: 690000,
    weight: 500,
    category: "Âm thanh",
  },
  {
    name: "Router Wi-Fi 6 TryBuy AX1800",
    price: 1290000,
    weight: 600,
    category: "Thiết bị mạng",
  },
  {
    name: "Đồng hồ thông minh TryBuy Watch S",
    price: 2490000,
    weight: 55,
    category: "Thiết bị thông minh",
  },
  {
    name: "Camera an ninh TryBuy Home 2K",
    price: 790000,
    weight: 300,
    category: "Thiết bị thông minh",
  },
];

const DEFAULT_STOCK = 500;
const CREATE_DELAY_MS = 200;

function parseArgs(argv) {
  const args = {
    base: process.env.SEED_BASE ?? "http://localhost:3000",
    count: PRODUCT_SEED.length,
    dryRun: false,
    prune: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--base") args.base = argv[++i];
    else if (argv[i] === "--count") args.count = Number(argv[++i]);
    else if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--prune") args.prune = true;
    else {
      console.error(`Unknown flag: ${argv[i]}`);
      process.exit(1);
    }
  }
  args.base = args.base.replace(/\/+$/, "");
  if (!Number.isInteger(args.count) || args.count < 1) {
    console.error("--count must be a positive integer");
    process.exit(1);
  }
  if (args.count > PRODUCT_SEED.length) {
    console.error(
      `--count max is ${PRODUCT_SEED.length} (size of PRODUCT_SEED)`,
    );
    process.exit(1);
  }
  return args;
}

/** The gateway wraps successful payloads in a `{ data }` envelope. */
function unwrap(body) {
  if (body && typeof body === "object" && "data" in body) return body.data;
  return body;
}

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 400) };
  }
}

async function login(base, username, password, label) {
  const res = await fetch(`${base}/api/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await readJson(res);
  const cookieMatch = (res.headers.get("set-cookie") ?? "").match(
    /access_token=([^;]+)/,
  );
  if (!res.ok || !cookieMatch) {
    throw new Error(
      `${label} login failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  const me = unwrap(body);
  // `role` may be a scalar or a populated relation object.
  const roleName =
    me?.role && typeof me.role === "object"
      ? (me.role.rol_name ?? me.role.rolName ?? me.role.name ?? "?")
      : (me?.role ?? "?");
  console.log(
    `  ${label} logged in as ${String(me?.username ?? username)} (id ${String(me?.id ?? "?")}, role ${String(roleName)})`,
  );
  return `access_token=${cookieMatch[1]}`;
}

async function call(base, path, { method = "GET", cookie, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, ok: res.ok, body: await readJson(res) };
}

async function getActiveCategories(base) {
  const res = await call(base, "/api/products/categories");
  if (!res.ok) {
    throw new Error(
      `GET /api/products/categories failed (${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`,
    );
  }
  const rows = unwrap(res.body);
  return Array.isArray(rows) ? rows : [];
}

async function ensureCategories(base, shopCookie, adminCookie, prune) {
  let active = await getActiveCategories(base);
  console.log(`  active categories on this environment: ${active.length}`);

  const seedNames = new Set(CATEGORY_SEED.map((row) => row.name));
  const activeNames = new Set(active.map((row) => String(row.name)));
  const missing = CATEGORY_SEED.filter((row) => !activeNames.has(row.name));
  const offTopic = active.filter((row) => !seedNames.has(String(row.name)));

  if (offTopic.length > 0) {
    console.log(
      `  off-catalog categories present: ${offTopic.map((row) => String(row.name)).join(", ")}` +
        (prune ? "" : " (run with --prune to retire them)"),
    );
  }
  if (missing.length === 0 && (!prune || offTopic.length === 0)) return active;

  if (!adminCookie) {
    throw new Error(
      "Category changes are needed but no admin credentials were supplied.\n" +
        "  A product cannot be created without an ACTIVE category, and a category\n" +
        "  submitted by a shop is saved as `pending` until an admin approves it.\n" +
        "  Re-run with SEED_ADMIN_USER / SEED_ADMIN_PASS, or insert active\n" +
        "  categories directly into the database.",
    );
  }

  // Retiring a category rejects it AND deactivates every product filed under
  // it (`approvalBlocked: true, isActive: false`) — reversible by approving the
  // category again. Nothing is deleted.
  if (prune) {
    for (const row of offTopic) {
      const rejected = await call(
        base,
        `/api/products/categories/${String(row.id)}/review`,
        {
          method: "PATCH",
          cookie: adminCookie,
          body: {
            action: "reject",
            note: "Off-catalog: TryBuy sells tech products only",
          },
        },
      );
      if (!rejected.ok) {
        throw new Error(
          `Reject category ${String(row.id)} failed (${rejected.status}): ${JSON.stringify(rejected.body).slice(0, 300)}`,
        );
      }
      console.log(
        `  retired category "${String(row.name)}" (id ${String(row.id)}) — its products are now inactive`,
      );
    }
  }

  for (const category of missing) {
    const created = await call(base, "/api/products/categories", {
      method: "POST",
      cookie: shopCookie,
      body: category,
    });
    // 409 = a category with this name is already active or pending — reuse it.
    if (!created.ok && created.status !== 409) {
      throw new Error(
        `POST category "${category.name}" failed (${created.status}): ${JSON.stringify(created.body).slice(0, 300)}`,
      );
    }
    console.log(
      `  submitted category "${category.name}" -> ${created.status === 409 ? "already exists" : "pending"}`,
    );
  }

  const pending = await call(base, "/api/products/categories/pending", {
    cookie: adminCookie,
  });
  if (!pending.ok) {
    throw new Error(
      `GET /api/products/categories/pending failed (${pending.status}): ${JSON.stringify(pending.body).slice(0, 300)}`,
    );
  }
  const pendingRows = unwrap(pending.body) ?? [];
  for (const row of pendingRows) {
    // Only approve what this seed asked for — a pending category submitted by
    // somebody else is not this script's call to make.
    if (!seedNames.has(String(row.name))) {
      console.log(
        `  left pending (not in the seed list): "${String(row.name)}"`,
      );
      continue;
    }
    const reviewed = await call(
      base,
      `/api/products/categories/${String(row.id)}/review`,
      { method: "PATCH", cookie: adminCookie, body: { action: "approve" } },
    );
    if (!reviewed.ok) {
      throw new Error(
        `Approve category ${String(row.id)} failed (${reviewed.status}): ${JSON.stringify(reviewed.body).slice(0, 300)}`,
      );
    }
    console.log(
      `  approved category "${String(row.name)}" (id ${String(row.id)})`,
    );
  }

  active = await getActiveCategories(base);
  if (active.length === 0) {
    throw new Error(
      "Still no active category after the approve pass — aborting",
    );
  }
  return active;
}

/**
 * Names already in the catalog, so a re-run tops the catalog up instead of
 * creating a second copy of every product. Only ACTIVE products are listed —
 * a product deactivated by `--prune` is not in the seed list anyway.
 */
async function fetchExistingProductNames(base) {
  const names = new Set();
  for (let page = 1; page <= 10; page += 1) {
    const res = await call(base, `/api/products?page=${page}&limit=100`);
    if (!res.ok) break;
    const payload = unwrap(res.body);
    const rows = Array.isArray(payload) ? payload : (payload?.data ?? []);
    for (const row of rows) names.add(String(row?.name));
    if (rows.length < 100) break;
  }
  return names;
}

async function createProducts(base, shopCookie, categories, count) {
  const categoryIdByName = new Map(
    categories.map((row) => [String(row.name), Number(row.id)]),
  );
  const fallbackCategoryId = Number(categories[0].id);
  const skuSuffix = Date.now().toString(36).toUpperCase();
  const existingNames = await fetchExistingProductNames(base);
  const created = [];
  let skipped = 0;

  for (let i = 0; i < count; i += 1) {
    const seed = PRODUCT_SEED[i];
    if (existingNames.has(seed.name)) {
      skipped += 1;
      continue;
    }
    const categoryId =
      categoryIdByName.get(seed.category) ?? fallbackCategoryId;
    const payload = {
      name: seed.name,
      description: `${seed.name} — hàng chính hãng, bảo hành 12 tháng.`,
      price: seed.price,
      stockQuantity: DEFAULT_STOCK,
      sku: `TB-${skuSuffix}-${String(i + 1).padStart(2, "0")}`,
      categoryIds: [categoryId],
      condition: "new",
      weight: seed.weight,
      isActive: true,
    };
    const res = await call(base, "/api/products", {
      method: "POST",
      cookie: shopCookie,
      body: payload,
    });
    if (!res.ok) {
      throw new Error(
        `POST /api/products "${seed.name}" failed (${res.status}): ${JSON.stringify(res.body).slice(0, 400)}`,
      );
    }
    const product = unwrap(res.body);
    console.log(
      `  created ${String(product?.id)} — ${seed.name} (${seed.price.toLocaleString("vi-VN")}đ, stock ${DEFAULT_STOCK})`,
    );
    created.push(product);
    if (i < count - 1) await new Promise((r) => setTimeout(r, CREATE_DELAY_MS));
  }
  if (skipped > 0) {
    console.log(`  skipped ${skipped} product(s) already in the catalog`);
  }
  return created;
}

/** Mirrors `pickProduct()` in scripts/load/baseline.mjs. */
async function verifyLoadTestPrerequisite(base) {
  const res = await call(base, "/api/products?page=1&limit=20");
  const rows = res.body?.data?.data ?? unwrap(res.body) ?? [];
  const candidates = rows.filter(
    (row) => typeof row?.id === "string" && row.id.startsWith("prod_"),
  );
  if (candidates.length === 0) {
    return { ok: false, reason: "no prod_ product on page 1" };
  }
  for (const candidate of candidates) {
    const inv = await call(base, `/api/inventory/product/${candidate.id}`);
    if (!inv.ok) continue;
    const availableStock = Number(unwrap(inv.body)?.availableStock ?? 0);
    if (availableStock >= 1) {
      return {
        ok: true,
        productId: candidate.id,
        productName: candidate.name,
        availableStock,
      };
    }
  }
  return {
    ok: false,
    reason: `${candidates.length} prod_ product(s) on page 1 but none has available inventory`,
  };
}

async function main() {
  const hasEnvFile = loadEnvFile(ENV_FILE);
  console.log(
    hasEnvFile
      ? `Loaded credentials from ${ENV_FILE}`
      : `No ${ENV_FILE} found — using process environment only`,
  );

  const args = parseArgs(process.argv);
  const shopUser = process.env.SEED_SHOP_USER;
  const shopPass = process.env.SEED_SHOP_PASS;
  const adminUser = process.env.SEED_ADMIN_USER;
  const adminPass = process.env.SEED_ADMIN_PASS;

  if (!shopUser || !shopPass) {
    console.error(
      "SEED_SHOP_USER and SEED_SHOP_PASS are required (account must have the `shop` role).\n" +
        `Fill them in ${ENV_FILE} — copy .env.seed.example if the file is missing.`,
    );
    process.exit(1);
  }

  console.log(`Target: ${args.base}`);
  console.log("Step 1 — authenticate");
  const shopCookie = await login(args.base, shopUser, shopPass, "shop");
  const adminCookie =
    adminUser && adminPass
      ? await login(args.base, adminUser, adminPass, "admin")
      : null;
  if (!adminCookie) {
    console.log(
      "  admin credentials not supplied (category approval unavailable)",
    );
  }

  console.log("Step 2 — categories");
  if (args.dryRun) {
    const active = await getActiveCategories(args.base);
    const seedNames = new Set(CATEGORY_SEED.map((row) => row.name));
    const offTopic = active
      .map((row) => String(row.name))
      .filter((name) => !seedNames.has(name));
    const existingNames = await fetchExistingProductNames(args.base);
    const toCreate = PRODUCT_SEED.slice(0, args.count).filter(
      (row) => !existingNames.has(row.name),
    );
    const before = await verifyLoadTestPrerequisite(args.base);
    console.log(`  active categories: ${active.length}`);
    console.log(
      `  off-catalog categories: ${offTopic.length > 0 ? offTopic.join(", ") : "none"}`,
    );
    console.log(
      `  products that would be created: ${toCreate.length} (${args.count - toCreate.length} already present)`,
    );
    console.log(`  load-test prerequisite: ${JSON.stringify(before)}`);
    console.log("Dry run — nothing was created.");
    return;
  }
  const categories = await ensureCategories(
    args.base,
    shopCookie,
    adminCookie,
    args.prune,
  );

  console.log(`Step 3 — create up to ${args.count} products (no images)`);
  const products = await createProducts(
    args.base,
    shopCookie,
    categories,
    args.count,
  );

  console.log("Step 4 — verify the load-test prerequisite");
  const verdict = await verifyLoadTestPrerequisite(args.base);
  if (!verdict.ok) {
    console.error(`  FAILED: ${verdict.reason}`);
    process.exit(1);
  }
  console.log(
    `  OK — baseline.mjs will pick ${verdict.productId} ("${String(verdict.productName)}", availableStock ${verdict.availableStock})`,
  );
  console.log(`\nDone. ${products.length} product(s) created.`);
  console.log(
    "Images were skipped — add them later via PATCH /api/products/:id.",
  );
}

main().catch((err) => {
  console.error(
    `\nSeed failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
