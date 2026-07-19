/**
 * SCALE-06 — concurrency baseline load test (autocannon runner).
 *
 * Usage:
 *   node scripts/load/baseline.mjs --profile smoke [--write] [--base http://localhost:3000]
 *   node scripts/load/baseline.mjs --profile 500|1k|5k --write
 *
 * Requirements:
 *   - `autocannon` CLI available on PATH (npm i -g autocannon).
 *   - Env: LOAD_USER / LOAD_PASS — an existing buyer account (never hardcode
 *     credentials here; accounts live in ../.agent-local/test-accounts.md).
 *   - For any profile other than `smoke`, the TARGET must be a prod-like build
 *     (`npm run build` + pm2 via ecosystem.config.js, NOT `nest --watch`) and
 *     the gateway env must raise `RATE_LIMIT_DEFAULT_LIMIT` (default 120/60s
 *     per route per user/IP) far above the test rate, or every scenario
 *     collapses into 429s and measures the rate limiter, not the API.
 *   - `--write` enables the checkout scenario (S5): it CREATES real orders
 *     (COD, base-price product). On dev data the stale-reservation sweeper
 *     cancels them after ORDER_STALE_RESERVATION_TTL_HOURS (24h default).
 *     Without `--write`, S5 fires exactly ONE checkout request to validate the
 *     contract and reports its status.
 *
 * Scenarios:
 *   S1 anonymous product list   GET  /api/products?page=1&limit=20
 *   S2 anonymous product detail GET  /api/products/:prodId
 *   S3 logged-in cart read      GET  /api/cart
 *   S4 logged-in order list     GET  /api/order/user/:usrId
 *   S5 checkout write           POST /api/order  (only under --write)
 *
 * Gate rule (snapshot SCALE-06): declare "handles N concurrent" ONLY from
 * numbers produced by this script against a prod-like build. Record p95/p99 +
 * error% below after each official run, newest first.
 *
 * ── Recorded baselines ────────────────────────────────────────────────────
 * 2026-07-19 (4th run) — SCALE-01b probe: gateway pm2 CLUSTER ×4
 * (GATEWAY_INSTANCES=4, exec_mode cluster) on top of run 3 (SCALE-01a/02/04).
 * Functional result: cluster is CORRECT — 4 workers online, 0 restarts,
 * 0 non-2xx across all probes, and 8/8 Socket.IO connects to /chat with
 * transports:["websocket"] across workers (Redis adapter carries broadcast;
 * websocket-only needs no sticky sessions).
 * Throughput result: NOT reliably faster on this dev machine — the load
 * generator (autocannon, 1 core) + 13 Node processes + Redis + Docker share
 * the same 12 cores, so adding gateway workers just reshuffles CPU:
 *   S1 anon list: c=50 → 512 req/s (was 798), c=100 → 923 then 497 on re-run
 *   (was 790 stable), c=200 → 428 (was 679), c=500 → 539 + 336 timeouts
 *   (was 757). detail c=50 → 1106 req/s (was 1692).
 *   S3 auth cart c=100 → 92.6 req/s (was 101.7 — DB-bound, unchanged as
 *   expected; cluster cannot help uncached Aiven-latency paths).
 * VERDICT: ship the env-gated cluster config (default 1); expect real gains
 * only where the gateway has dedicated idle cores (prod VPS, external load
 * source). Re-measure on the target VPS before setting GATEWAY_INSTANCES>1,
 * and FE must be websocket-only first (polling breaks round-robin).
 * Raw: results/2026-07-19-scale01b-c{50,100,200,500}-list.json + -c50-detail
 * + -c100-cart.
 * ──────────────────────────────────────────────────────────────────────────
 * 2026-07-19 (3rd run) — SCALE-04 applied: gateway full-response Redis
 * micro-cache (TTL 10s) on @Public GET /api/products + /api/products/:id
 * (cache hit = 1 local Redis GET, no product/user TCP). Same machine/build
 * chain as run 2 (SCALE-01a + SCALE-02 also active). Direct autocannon probes
 * (20s each) on the cached anon paths:
 *   S1 anon product list ?page=1&limit=20:
 *     c=50  → 797.7 req/s, p50 51ms,  p99 84ms,   0 err        (was 61.1)
 *     c=100 → 790.1 req/s, p50 103ms, p99 1859ms, 0 err        (was 62.9)
 *     c=200 → 678.6 req/s, p50 213ms, p99 4695ms, 0 err        (was 58.3)
 *     c=500 → 756.6 req/s, p50 517ms, p99 6291ms, 15132×2xx,
 *             560 err + 273 timeouts ≈ 3.6%                    (was collapse)
 *   product detail /api/products/:prod_id: c=50 → 1692 req/s, p50 25ms,
 *     p99 45ms, 0 err.
 *   → cached-read ceiling ≈ 800 req/s list / 1700 req/s detail — now bound by
 *     the single gateway Node process (CPU/event loop), NOT the DB pool:
 *     SCALE-01b (gateway cluster) is the next lever for anon reads. The 10s
 *     TTL means a cold burst per key per 10s still pays the old ~250ms DB
 *     path once. Auth paths (cart/order list) are NOT cached — their ceiling
 *     stays ~102 req/s from run 2. Zero 500s, zero pm2 restarts.
 *   Raw: results/2026-07-19-scale04-c{50,100,200,500}-list.json + -c50-detail.
 *   VERDICT: anon read paths no longer gate concurrency; mixed traffic is now
 *   bound by uncached auth paths (~100 req/s) + single-core gateway.
 * ──────────────────────────────────────────────────────────────────────────
 * 2026-07-19 (2nd run) — SCALE-02 applied: per-service DB pool budget via pm2
 * env in ecosystem.config.js (MySQL product 20 / user 16 / orders 16 / social 6
 * / notification 4 / chat 6 = 68 < Aiven-free max_connections 76; PG 5/4/3 = 12
 * < 20). Same machine/build as the 1st run. Interim finding: a flat
 * MYSQL_POOL_SIZE=50 for all 6 services blew past the 76-conn cap under load →
 * ~35% HTTP 500 "Too many connections"; the budgeted split removes ALL 500s.
 *   capacity probes (S1 anon product list, 15s each):
 *     c=50  → 61.1 req/s, p50 766ms,  p99 1495ms, 0 err
 *     c=100 → 62.9 req/s, p50 1522ms, p99 1944ms, 0 err
 *     c=200 → 58.3 req/s, p50 3026ms, p99 3657ms, 0 err
 *     → ceiling ≈ 61 req/s (was 40), bound by the user-enrichment pool
 *       (16 conn × ~250ms ≈ 64 req/s). Aiven-free hard wall ≈ 76/0.25 ≈
 *       300 req/s total across ALL services — bigger pools can't pass it;
 *       next levers are SCALE-01b (cluster) + SCALE-03/04 (caching).
 *   profile 500 (30s): S1 1314 completed (was 213; p50 8348ms, 38% client
 *     timeouts), S2 1389 (was 0), S3 auth cart 3051 completed 101.7 req/s
 *     0 err (was 0), S4 order list still 100% client-timeout at c=500
 *     (heavier path; saturation, zero non2xx). Zero 500s, zero crashes.
 *     Checkout probe 201. Raw: results/2026-07-19T11-23-51-388Z-500.json
 *   VERDICT: ~200–300 concurrent with degraded latency (was ≲100–150);
 *   500 concurrent still saturates reads by client timeout.
 * ──────────────────────────────────────────────────────────────────────────
 * 2026-07-19 — prod build (pm2 fork ×1/service, dev machine, Aiven remote DB,
 * RATE_LIMIT_DEFAULT_LIMIT=100000, autocannon on the same machine; no SCALE
 * items applied yet beyond SCALE-01a):
 *   profile 500 (30s): COLLAPSE — S1 213/2000 completed (p50 9004ms, 85.8%
 *     err), S2/S3/S4 0 completed (100% client connect/timeout errors, zero
 *     non2xx, zero service crashes, all pm2 apps stayed online). Checkout
 *     probe 408. 1k/5k NOT run — moot until SCALE-01b/02/03 land.
 *   capacity probes (S1 anon product list, 15s each):
 *     c=50  → 39.7 req/s, p50 1166ms, p95 2239ms, 0 err
 *     c=100 → 40.0 req/s, p50 2338ms, p95 3015ms, 0 err
 *     c=200 → 36.3 req/s, p50 4684ms, p95 6098ms, 0 err
 *     → throughput ceiling ≈ 40 req/s regardless of concurrency; latency
 *       grows linearly with queue depth (pure saturation). Matches
 *       MYSQL_POOL_SIZE=10 × ~250ms Aiven roundtrip → SCALE-02 is the first
 *       lever, then SCALE-01b (gateway cluster).
 *   auth cart (S3) c=50 → 59.6 req/s, p50 826ms, p99 1013ms, 0 err.
 *   VERDICT: current stack handles ≲100–150 concurrent with degraded latency;
 *   500+ concurrent collapses by client timeout. Raw: results/2026-07-19T09-53-45-278Z-500.json
 * ──────────────────────────────────────────────────────────────────────────
 */
import { spawn, execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Spawn the autocannon CLI via `node <cli.js>` instead of a shell so header
// values (Cookie tokens) survive verbatim — cmd.exe re-parsing mangles them.
function resolveAutocannonCli() {
  try {
    return createRequire(import.meta.url).resolve("autocannon/autocannon.js");
  } catch {
    const globalRoot = execSync("npm root -g").toString().trim();
    const globalCli = join(globalRoot, "autocannon", "autocannon.js");
    if (existsSync(globalCli)) return globalCli;
    throw new Error(
      "autocannon not found (local or global). Install: npm i -g autocannon",
    );
  }
}

const PROFILES = {
  smoke: { connections: 5, durationSec: 5, ratePerSec: 15, workers: 1 },
  500: { connections: 500, durationSec: 30, ratePerSec: null, workers: 4 },
  "1k": { connections: 1000, durationSec: 30, ratePerSec: null, workers: 4 },
  "5k": { connections: 5000, durationSec: 30, ratePerSec: null, workers: 8 },
};

function parseArgs(argv) {
  const args = {
    profile: "smoke",
    write: false,
    base: "http://localhost:3000",
  };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--profile") args.profile = argv[++i];
    else if (argv[i] === "--write") args.write = true;
    else if (argv[i] === "--base") args.base = argv[++i];
  }
  if (!PROFILES[args.profile]) {
    console.error(
      `Unknown profile "${args.profile}". Use: ${Object.keys(PROFILES).join(", ")}`,
    );
    process.exit(1);
  }
  return args;
}

async function login(base, username, password) {
  const res = await fetch(`${base}/api/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const cookieMatch = (res.headers.get("set-cookie") ?? "").match(
    /access_token=([^;]+)/,
  );
  if (!res.ok || !cookieMatch) {
    throw new Error(
      `Login failed for LOAD_USER (${res.status}) — check LOAD_USER/LOAD_PASS`,
    );
  }
  const meRes = await fetch(`${base}/api/user/me`, {
    headers: { Cookie: `access_token=${cookieMatch[1]}` },
  });
  const meBody = await meRes.json();
  const userPublicId = meBody?.data?.id ?? meBody?.id;
  if (typeof userPublicId !== "string" || !userPublicId.startsWith("usr_")) {
    throw new Error(
      `Could not resolve usr_ id from /api/user/me (${meRes.status})`,
    );
  }
  return { token: cookieMatch[1], userPublicId };
}

async function pickProduct(base) {
  const res = await fetch(`${base}/api/products?page=1&limit=20`);
  const body = await res.json();
  const rows = body?.data?.data ?? body?.data ?? [];
  const candidates = rows.filter(
    (row) => typeof row?.id === "string" && row.id.startsWith("prod_"),
  );
  if (candidates.length === 0)
    throw new Error("No prod_ product found via GET /api/products");
  // The checkout scenario reserves real stock, so pick a product that actually
  // has available inventory — the first listed product may have none.
  for (const candidate of candidates) {
    const invRes = await fetch(`${base}/api/inventory/product/${candidate.id}`);
    if (!invRes.ok) continue;
    const invBody = await invRes.json();
    const availableStock = Number(
      invBody?.data?.availableStock ?? invBody?.availableStock ?? 0,
    );
    if (availableStock >= 1) {
      return {
        productId: candidate.id,
        productName: candidate.name ?? "load-test product",
      };
    }
  }
  throw new Error(
    "No product on page 1 has available inventory — checkout scenario cannot run",
  );
}

function runAutocannon({ url, method, headers, body, profile }) {
  const cliArgs = [
    "-c",
    String(profile.connections),
    "-d",
    String(profile.durationSec),
    "-w",
    String(profile.workers),
    "-m",
    method,
    "--json",
  ];
  if (profile.ratePerSec) cliArgs.push("-R", String(profile.ratePerSec));
  for (const [name, value] of Object.entries(headers ?? {})) {
    cliArgs.push("-H", `${name}: ${value}`);
  }
  if (body) cliArgs.push("-b", JSON.stringify(body));
  cliArgs.push(url);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [resolveAutocannonCli(), ...cliArgs]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && !stdout) {
        reject(new Error(`autocannon exited ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(
          new Error(`autocannon output was not JSON: ${stdout.slice(0, 300)}`),
        );
      }
    });
  });
}

function summarize(name, raw) {
  // `requests.total` counts completed responses; `errors` counts socket-level
  // failures (connect errors/timeouts) that never produced a response.
  const completed = raw.requests?.total ?? 0;
  const socketErrors = raw.errors ?? 0;
  const non2xx = raw.non2xx ?? 0;
  const attempts = completed + socketErrors;
  const status429 = raw.statusCodeStats?.["429"]?.count ?? 0;
  return {
    scenario: name,
    "req/s (avg)": raw.requests?.average ?? 0,
    "p50 ms": raw.latency?.p50 ?? 0,
    "p95 ms": raw.latency?.p97_5 ?? raw.latency?.p95 ?? 0,
    "p99 ms": raw.latency?.p99 ?? 0,
    "error %": attempts
      ? Number((((non2xx + socketErrors) / attempts) * 100).toFixed(2))
      : 0,
    "429s": status429,
  };
}

const args = parseArgs(process.argv);
const profile = PROFILES[args.profile];
const scriptDir = dirname(fileURLToPath(import.meta.url));

const loadUser = process.env.LOAD_USER;
const loadPass = process.env.LOAD_PASS;
if (!loadUser || !loadPass) {
  console.error(
    "Set LOAD_USER and LOAD_PASS env vars (see ../.agent-local/test-accounts.md).",
  );
  process.exit(1);
}

if (args.profile !== "smoke") {
  console.warn(
    "[!] Non-smoke profile: target MUST be a prod build (pm2, not nest --watch) " +
      "with RATE_LIMIT_DEFAULT_LIMIT raised, or results are meaningless.",
  );
}

const { token, userPublicId } = await login(args.base, loadUser, loadPass);
const { productId, productName } = await pickProduct(args.base);
const authHeaders = { Cookie: `access_token=${token}` };
console.log(
  `Target ${args.base} | profile ${args.profile} | user ${userPublicId} | product ${productId}\n`,
);

const checkoutBody = {
  paymentMethod: "cod",
  shippingAddress:
    "Load Test|0900000000|1 Test St|Phường Bến Nghé|Quận 1|Hồ Chí Minh",
  items: [{ productId, productName, quantity: 1 }],
};

const scenarios = [
  {
    name: "S1 anon product list",
    url: `${args.base}/api/products?page=1&limit=20`,
    method: "GET",
  },
  {
    name: "S2 anon product detail",
    url: `${args.base}/api/products/${productId}`,
    method: "GET",
  },
  {
    name: "S3 auth cart read",
    url: `${args.base}/api/cart`,
    method: "GET",
    headers: authHeaders,
  },
  {
    name: "S4 auth order list",
    url: `${args.base}/api/order/user/${userPublicId}`,
    method: "GET",
    headers: authHeaders,
  },
];
if (args.write) {
  scenarios.push({
    name: "S5 checkout write",
    url: `${args.base}/api/order`,
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: checkoutBody,
  });
}

const summaries = [];
const rawResults = {};
for (const scenario of scenarios) {
  console.log(`Running ${scenario.name} ...`);
  const raw = await runAutocannon({ ...scenario, profile });
  rawResults[scenario.name] = raw;
  summaries.push(summarize(scenario.name, raw));
}

if (!args.write) {
  const res = await fetch(`${args.base}/api/order`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(checkoutBody),
  });
  const orderBody = await res.json().catch(() => null);
  summaries.push({
    scenario: "S5 checkout (single contract probe, --write for load)",
    "req/s (avg)": "-",
    "p50 ms": "-",
    "p95 ms": "-",
    "p99 ms": "-",
    "error %": res.status === 201 ? 0 : 100,
    "429s": `status ${res.status} id=${orderBody?.data?.id ?? "?"}`,
  });
}

console.table(summaries);

const resultsDir = join(scriptDir, "results");
mkdirSync(resultsDir, { recursive: true });
const outFile = join(
  resultsDir,
  `${new Date().toISOString().replace(/[:.]/g, "-")}-${args.profile}.json`,
);
writeFileSync(
  outFile,
  JSON.stringify({ args, summaries, rawResults }, null, 2),
);
console.log(`\nRaw results saved to ${outFile}`);
console.log(
  args.profile === "smoke"
    ? "Smoke run only — NOT a recordable baseline (dev/watch target, tiny rate)."
    : "Record p95/p99 + error% in the header of this script (Recorded baselines).",
);
