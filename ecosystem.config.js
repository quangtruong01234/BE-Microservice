// PM2 production process file — TryBuy backend.
//
// One PM2 app per microservice, each running the COMPILED bundle
// (`dist/apps/<svc>/main.js`) produced by `npm run build`. PM2 supervises every
// service process directly, so a single crashed service is restarted on its own
// (the old setup ran `npm run start:nodeA|B` → `concurrently` of `nest --watch`,
// where PM2 only watched the wrapper and a runtime crash went unrestarted).
//
// Build first:   npm run build
// Start all:     pm2 start ecosystem.config.js --env production
// Start one node (pass the machine's service names to --only, comma-separated):
//   Node A: pm2 start ecosystem.config.js --env production \
//             --only "gateway,orders,user,product,social,notification,chat"
//   Node B: pm2 start ecosystem.config.js --env production \
//             --only "inventory,payments,rewards"
// Persist across reboots: pm2 startup, run the printed command, then pm2 save
//
// `cwd` is the api root (where this file lives), so each service's
// `dotenv.config({ path: "./local/node{A,B}/.env" })` resolves correctly.

const logDir = "./logs";

const defaults = {
  cwd: __dirname,
  instances: 1,
  exec_mode: "fork",
  autorestart: true,
  watch: false,
  max_memory_restart: "500M",
  min_uptime: "10s",
  max_restarts: 10,
  restart_delay: 5000,
  kill_timeout: 10000,
  time: true,
  merge_logs: false,
  env_production: { NODE_ENV: "production" },
};

const service = (name, env = {}) => ({
  ...defaults,
  name,
  script: `dist/apps/${name}/main.js`,
  out_file: `${logDir}/${name}.out.log`,
  error_file: `${logDir}/${name}.error.log`,
  env,
});

// Per-service DB pool budget (SCALE-02). dotenv.config() never overrides an
// env var already set by PM2, so these values win over the shared
// local/node{A,B}/.env MYSQL_POOL_SIZE / PG_POOL_SIZE. Totals must stay under
// the DB plan's max_connections (Aiven free tier: MySQL 76, PostgreSQL 20),
// leaving headroom for admin/monitoring connections. Hot read paths (product
// list + user enrichment, orders) get the larger shares.
// MySQL total: 20+16+16+6+4+6 = 68 < 76. PG total: 5+4+3 = 12 < 20.
// Cluster note (SCALE-01b): total = pool × instances — divide before scaling out.
// Gateway horizontal scale (SCALE-01b). The gateway is stateless for HTTP
// (JWT cookie auth, no in-memory session) and WS broadcast is cross-instance
// via the Redis adapter (SCALE-01a), so it can run Node cluster mode.
// GATEWAY_INSTANCES > 1 REQUIRES the frontends to connect Socket.IO with
// transports:["websocket"] (no polling) — cluster round-robin breaks the
// polling handshake without sticky sessions. Default 1 (fork) until FE ships.
//   GATEWAY_INSTANCES=4 pm2 start ecosystem.config.js --env production
const gatewayInstances = Number(process.env.GATEWAY_INSTANCES || 1);

const MYSQL_POOL = {
  product: 20,
  user: 16,
  orders: 16,
  social: 6,
  notification: 4,
  chat: 6,
};
const PG_POOL = { inventory: 5, payments: 4, rewards: 3 };

// Public frontend origins, comma-separated. Injected by PM2 so the value is
// version-controlled and ships with a deploy, instead of living only in the
// gitignored local/node{A,B}/.env on the box: PROD-PAY-01 had payments issuing
// `http://localhost:5173` return URLs — which VNPay rejects — while
// local/nodeB/.env carried the right value. PM2-injected env wins, because
// both dotenv and @nestjs/config only assign keys not already in process.env.
//
// ORDER MATTERS — the two consumers read this same variable differently:
//   - gateway  (apps/gateway/src/common/cors.ts) splits on "," and allows every
//     entry, so EVERY browser origin must be listed (storefront, GHN console).
//   - payments (apps/payments/src/payments.service.ts) takes entry [0] only and
//     builds `<origin>/payment-result`, so the STOREFRONT must come first.
// Entry [0] is the TryBuy storefront; entry [1] is the GHN shipping console,
// which never handles payments — append further origins, never prepend.
// Matching is exact-string, not wildcard: a Vercel/Workers PREVIEW deployment
// gets its own subdomain and will be CORS-rejected until it is listed here.
// Override per machine with `FRONTEND_URL=... pm2 start ecosystem.config.js`.
const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  [
    "https://fe-react-vite.quangtruong01234.workers.dev",
    "https://web-flow-ghn.vercel.app",
  ].join(",");

// The frontends (*.workers.dev, *.vercel.app) and the API (<PROD_API_DOMAIN>) are
// different sites,
// so a `lax` cookie is dropped by the browser on every credentialed XHR the FE
// makes — `none` is mandatory for this split-domain deployment. It also forces
// `secure`, which prod already sets. CSRF trade-off: security.md → Cookie and
// CSRF Posture. Put both frontends on subdomains of one registrable domain and
// this can go back to `lax`.
const AUTH_COOKIE_SAME_SITE = process.env.AUTH_COOKIE_SAME_SITE || "none";

module.exports = {
  apps: [
    // Node A
    {
      ...service("gateway", { FRONTEND_URL, AUTH_COOKIE_SAME_SITE }),
      instances: gatewayInstances,
      exec_mode: gatewayInstances > 1 ? "cluster" : "fork",
    },
    service("orders", { MYSQL_POOL_SIZE: MYSQL_POOL.orders }),
    service("user", { MYSQL_POOL_SIZE: MYSQL_POOL.user }),
    service("product", { MYSQL_POOL_SIZE: MYSQL_POOL.product }),
    service("social", { MYSQL_POOL_SIZE: MYSQL_POOL.social }),
    service("notification", { MYSQL_POOL_SIZE: MYSQL_POOL.notification }),
    service("chat", { MYSQL_POOL_SIZE: MYSQL_POOL.chat }),
    // Node B
    service("inventory", { PG_POOL_SIZE: PG_POOL.inventory }),
    service("payments", { PG_POOL_SIZE: PG_POOL.payments, FRONTEND_URL }),
    service("rewards", { PG_POOL_SIZE: PG_POOL.rewards }),
  ],
};
