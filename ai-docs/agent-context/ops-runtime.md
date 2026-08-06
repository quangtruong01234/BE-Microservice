# Ops / Runtime Reference

> Load on demand — keywords: deploy, pm2, nginx, prod env, EC2, cloudinary,
> GHN ops, applied migration, seed. Moved out of `snapshot.md` on 2026-08-04 so
> the auto-loaded snapshot stays lean. Facts here are stable operational
> reference, not active work.

## Production runtime

- **`FRONTEND_URL` for payments is injected by pm2, not by `.env`** (PROD-PAY-01,
  2026-08-01). `ecosystem.config.js` sets it on the `payments` app (default
  `https://tryhavejob.ooguy.com`, override with `FRONTEND_URL=... pm2 start ...`).
  Deliberate: both `dotenv` and `@nestjs/config` only assign keys NOT already in
  `process.env`, so pm2-injected env structurally wins. Payments builds the
  provider return URL (`<FRONTEND_URL>/payment-result?order=<n>&method=<m>`) from
  it — a wrong value makes VNPay reject the payment link at its merchant-domain
  check. Unset → logs a `warn`, falls back to `http://localhost:5173`. Changing it
  needs `pm2 delete payments && pm2 start ecosystem.config.js --env production
  --only payments` — a plain `pm2 restart` does NOT refresh pm2's stored env
  snapshot. `FRONTEND_URL` is ALSO read from `local/nodeA/.env` by the gateway for
  CORS; the two are independent.
- **Prod EC2 runs on a stop/start schedule set by the user in the AWS console**
  (confirmed 2026-08-01) — roughly up ~08:00, stopped ~18:00 server time. Every
  boot writes a recurring burst of harmless ERROR lines that must NOT be
  re-diagnosed: RabbitMQ `Connection closed: 320 (CONNECTION-FORCED) ...
  'shutdown'` in every RMQ-connected service, and `[ioredis] ECONNREFUSED
  127.0.0.1:6379` / `write EPIPE` in gateway/user/product/social (NestJS starts
  before the `restart: unless-stopped` containers are back). Both self-heal.
  Tell-tale of a reboot vs crash: service PIDs drop back to 3–4 digits.
  `pm2 logs --lines N` is misleading — it tails the `*.error-*.log` FILE, so
  days-old bursts look current, and `grep -i error` also matches the
  `<svc>.error-N.log` header lines. Use `pm2 logs --lines 200 --nostream |
  grep -v 'last .* lines:' | grep "$(date +%F)"`, or `pm2 flush` before a deploy
  self-test. `redis-cli` is NOT installed on the host (Redis is containerized) —
  use `docker exec trybuy-redis redis-cli ping`.
- **Deploy runtime**: host PM2 runs compiled NestJS apps from
  `ecosystem.config.js`; Docker Compose runs Redis/RabbitMQ only
  (`docker compose up -d redis rabbitmq`); MySQL/PostgreSQL are external Aiven.
  Internal TCP/payments callback listeners bind to `127.0.0.1` (chat's hardcoded
  `0.0.0.0` and product's stray HTTP bind on 3106 fixed 2026-07-18). Gateway bind
  host is `GATEWAY_HOST` env, default `0.0.0.0` for dev — **set
  `GATEWAY_HOST=127.0.0.1` on the VPS** so only Nginx is public. Nginx exposes
  the gateway on `127.0.0.1:3000` only (incl. `/zalopay/callback` and
  `/vnpay/callback` facades); firewall exposes only 80/443; set the real domain
  in `nginx/trybuy.conf`. Nginx owns L7 load absorption (SCALE-03): per-IP
  `limit_req` 30r/s burst 60 + `limit_conn 32`, gzip, upstream keepalive 32, 5s
  micro-cache on the four @Public catalog GETs. At deploy: `mkdir
  /var/cache/nginx/trybuy` (steps in conf header) and set
  `RATE_LIMIT_SKIP_PUBLIC_GET=true` in the gateway prod env (ONLY behind nginx;
  skips the Redis rate-limit counter for @Public GETs without explicit
  `@RateLimit`).
- **nodeB idle-crash (FIXED 2026-06-26, keep the check)**: inventory/payments/
  rewards used to die silently after machine sleep / broker restart —
  `registerDirectPublisher()` opened a raw amqplib connection with no
  `'error'`/`'close'` listeners. Now: handlers attached, `?heartbeat=30`,
  background connect, self-healing Proxy reconnect. If a nodeB service is ever
  found down, check whether its compiled `dist/apps/<svc>/main` process is
  actually running — `nest --watch` does NOT auto-restart a runtime crash.
- **CORS**: one shared gateway delegate `apps/gateway/src/common/cors.ts`
  (`gatewayCorsOptions`) used by HTTP + both WS gateways (`/chat`,
  `/notifications`). Allows: no-Origin requests, any origin in `FRONTEND_URL`
  (comma-split), and — only when `NODE_ENV !== "production"` — any
  localhost/127.0.0.1 origin. Prod is strict → every allowed web origin MUST be
  in `FRONTEND_URL`. Sockets live on the gateway origin/port (3000), namespaces
  `/chat` + `/notifications`, connect `withCredentials:true`.
- Login route is `POST /api/user/login` (sets the HttpOnly `access_token` cookie).

## CI / CD

- **CI** (`.github/workflows/ci.yml`): validates PRs and pushes to `main` only —
  install / prettier check / lint / typecheck / audit / Jest / build / `dist`
  artifact upload / PM2 syntax / Compose config / whitespace checks with dummy
  env values. No deploy, no Aiven, no migrations, no secrets. Audit split on
  purpose: `npm audit --omit=dev --audit-level=high` BLOCKS; the all-deps run is
  `continue-on-error` (the @nestjs/cli→@swc/cli→@xhmikosr build-tool chain is
  permanently red). Two scoped `overrides` in `package.json` keep the blocking
  gate green — `@nestjs/swagger`→`js-yaml 5.2.3`, `typeorm`→`brace-expansion
  ^2.1.3` (drop an override once the parent ships a fixed pin).
- **CD** (`.github/workflows/deploy.yml`, shipped 2026-08-03, **first successful
  production run 2026-08-06**, sha `19309f6`):
  SSHes into the EC2 and repeats the proven manual sequence — `git reset --hard
  origin/main` → `npm ci` → `db:migrate:nodeA`+`nodeB` (always BEFORE restart;
  migrations are additive) → `npm run build` → `pm2 flush` → `pm2 restart
  ecosystem.config.js --env production` → `pm2 save` → poll
  `http://127.0.0.1:3000/live` (10×5s). **Triggers on CI completion for `main`**
  (`workflow_run`; the job's `if:` drops runs whose CI conclusion is not
  `success`), so merging a PR into `main` releases. `workflow_dispatch` remains
  for redeploys no commit triggers — box stopped at merge time, rollback, env
  change. `concurrency: deploy-production`, `environment: production`. Previous sha saved to
  `~/.trybuy-deploy-prev-sha` before reset; `if: failure()` step rolls back
  (reset + `npm ci` + build + restart + `/live`); the marker is deleted before
  `cd` on every run, so an early failure aborts loudly instead of resetting to a
  stale sha. Asserts Node major 22 on the box and sources `~/.nvm/nvm.sh`
  (non-interactive SSH shell reads no login profile). A pure `pm2 restart` does
  NOT refresh pm2's env snapshot — env changes still need manual `pm2 delete` +
  `pm2 start`.
- **CD box facts** (verified 2026-08-06): checkout is `/opt/trybuy/api` (NOT
  `~/MCR/api` — older notes are wrong), owned by `ubuntu`, which is also the
  user pm2 runs under, so the workflow's `pm2 restart` hits the right daemon.
  `origin` is the SSH alias `git@github-trybuy:` (deploy key in `~/.ssh/config`),
  so `git fetch` never prompts for credentials. Node on the box is v22.23.1.
  Repo secrets set: `EC2_HOST` = `tryhavejob.ooguy.com` (the **domain**, because
  the instance has no Elastic IP and its public IP changes on every stop/start),
  `EC2_USER` = `ubuntu`, `EC2_PATH` = `/opt/trybuy/api`, `EC2_SSH_KEY` =
  `trybuy_key_prod_Mumbai` (ed25519). Security-group `sg-0e16141656b4c24a0` must
  keep port 22 open to `0.0.0.0/0`: GitHub-hosted runners have unpredictable IPs
  and the ~4000 CIDRs in GitHub's meta API do not fit the 60-rule SG limit.
- **`production` Environment has NO protection rules.** GitHub only offers
  required reviewers / wait timers for private repos on paid plans, and this repo
  is private on Free — the section simply does not render. Accepted (CD-04): a
  green CI on `main` ships with nobody in the loop. If that ever needs a brake,
  the options are a paid plan or moving the trigger to `push: tags: ['v*']`.
- **Two traps the first CD run walked into** (both fixed in `19309f6`, keep in
  mind for any future deploy script): `npm run db:migrate:*` must be called with
  `-- --confirm-production`, because `scripts/migrate-database.mjs` refuses an
  apply when `NODE_ENV=production` (which the box's `local/<node>/.env` sets) —
  it never trips locally, where the env files say `development`. And any `/live`
  probe needs the retry loop: `pm2 restart` returns before the gateway binds
  :3000, so a single `curl` always loses the race (`curl: (7) ... after 0 ms`).

## Database migrations

- **Cutoff (2026-07-17)**: all schema work through PUBID-07 is squashed into
  `database/prod-baseline-20260717/`. Retired standalone `database/*.sql` files
  must not be replayed. Empty databases use the Node A/B baseline files; later
  changes use only post-cutoff manifest migrations (`database/migrations/nodeA|nodeB/`
  + `database/migrations.manifest.json`). Historical `schema_migrations` rows are
  `baseline-absorbed`. Full policy + commands: `database.md`.
- **`nodeA-20260802-001-add-version-to-products`** — `products.version` INT NOT
  NULL DEFAULT 1 (additive, guarded). **Applied to prod Aiven 2026-08-02** before
  the code deploy. Dev auto-created the column via `synchronize:true`, so
  `db:migrate:status` reports it `[pending]` on DEV — cosmetic ledger gap only.
- **`nodeA-20260804-001-widen-product-reviews-product-id`** — widens
  `product_reviews.product_id` INT → BIGINT to match `products.id`. Applied to
  DEV Aiven, and **applied to prod Aiven 2026-08-06** by the first CD run (the
  workflow's migration step, before the restart). Background: product forces
  `synchronize:false` in prod and the entity declares `type: "bigint"`; a review
  insert against a still-INT column would silently truncate a product id past
  2,147,483,647. Widening is value-preserving → zero downtime. Runtime note: TypeORM
  maps bigint to a JS **string**, so `ProductReview.productId` is a string on
  read/delete legs — gateway rewrites it to the `prod_` public id (verified);
  `recalculateProductRating` verified on the string path.

### Pre-cutoff applied-migration history (fresh-DB reference only)

All absorbed into the 2026-07-17 baseline; listed for context on WHY columns
exist. Never replay on a baseline-bootstrapped DB: P1-03 social `posts.product_id`
+ `post_reports`; P1-06 chat read-tracking (`user1/2_last_read_at`); P2-02 order
snapshot (`order_items.product_image`/`sku_label`); F1 `product_reviews`; F2
`order_return_requests` + orders status enum extend; F3 `vouchers`/
`voucher_redemptions` + `orders.voucher_code`/`discount_amount`; F5 moderation
columns on `post_reports`/`posts`; F6 `wishlist_items`; AI-02 risk columns on
`products`; shipping roles (`logistics_operator`/`shipping_manager`, `shipping`
resource — authorization driven by `apps/user/src/rbac/grants.ts`, not DB JSON);
user `user_addresses`; social-notification metadata (`notifications.post_id`/
`actor_id`/`preview`, `order_id`→BIGINT); PERF-04/05/06 indexes;
GHN-ADDR-01 `orders.to_district_id`/`to_ward_code` (applied to prod 2026-07-30);
PUBID-00..07 `public_id` columns.

## Seed / fresh-environment bootstrap (SEED-01, 2026-07-29)

An empty catalog makes `scripts/load/baseline.mjs` abort (`No prod_ product
found`). The prod baseline seeds NO categories, product create rejects
non-`active` categories, and shop-submitted categories stay `pending` — a shop
account alone cannot bootstrap. Run `node scripts/seed/seed-products.mjs --count 8`
(credentials in gitignored `api/.env.seed`, template `.env.seed.example`; needs a
shop AND an admin account) to create+approve 5 categories and N image-less
products with `stockQuantity`. `--dry-run` reports without writing. Images
deliberately skipped — add later via `PATCH /api/products/:id` after a real
Cloudinary signed upload. **Env caveat:** `.env.seed` is read ONLY by the seed
script — service runtime config, including the whole payment block
(`FRONTEND_URL`, `VNP_*`, `ZALOPAY_*`), belongs in `local/nodeB/.env` (missing it
caused PROD-PAY-01). A fresh bootstrap must BOTH fill `local/node{A,B}/.env` from
the `.env.example` templates (then `pm2 restart ... --env production`) and run
the seed script.

## GHN shipping reference

- **Env** (`local/nodeA/.env`): `GHN_API_URL=https://dev-online-gateway.ghn.vn/shiip/public-api`,
  `GHN_API_TOKEN`, `GHN_SHOP_ID=200481`; `GHN_WEBHOOK_SECRET` required on the
  gateway webhook (`x-ghn-webhook-token` header preferred; `?token=` still
  accepted but logs a deprecation warn — removal gated by OQ-2). Webhook body
  runtime-validated (`GhnWebhookDto`, extra GHN fields tolerated); rate limit
  300/60s.
- **Webhook dual-path**: served at BOTH `POST /ghn/webhook` (legacy) AND
  `POST /api/ghn/webhook` — same handler, both excluded from the global `api`
  prefix. Body accepts PascalCase (`OrderCode`/`Status`, real GHN) or snake_case
  (manual tests). Public-URL registration is operational: email api@ghn.vn at
  deploy time.
- **shipping_address format**: pipe-delimited
  `name|phone|addr|ward|district|province`; GHN failure non-fatal (order saved
  with `ghn_order_code=null`).
- **Address ids at checkout (GHN-ADDR-01)**: `orders.to_district_id` INT NULL +
  `to_ward_code` VARCHAR(20) NULL persist the GHN location from the FE checkout
  dropdowns (optional `toDistrictId`/`toWardCode` on `POST /api/order` +
  `POST /api/order/shipping-fee`; both DTOs have `@Type(() => Number)` on
  `toDistrictId`; `toWardCode` stays `@IsString()` — ward codes can carry leading
  zeros). When BOTH present, waybill/fee-preview use the exact ids and skip
  free-text resolution; a partial pair is treated as absent → free-text fallback.
  Runtime-verified on prod 2026-07-30 (4/4).
- **Free-text address resolution** (fallback when ids absent,
  `apps/orders/src/ghn/ghn.service.ts`): ward/district/province resolved via
  master-data (`GET /master-data/province|district|ward`, 24h TTL cache) using
  `normalizeAddressPart` (NFD strip, đ→d, drops VN admin prefixes) +
  `rankMasterDataMatches` (exact first, then containment). Walks ALL ranked
  candidates and falls through stub entries (GHN dev sandbox has polluted
  duplicate provinces, e.g. "Hà Nội 02" ProvinceID 2002 with 0 districts).
  Unresolvable → 400. Best-effort: garbage placeholder addresses can resolve to a
  wrong-but-valid location (see `known-behaviors.md`).
- **ready-to-ship gating**: `PATCH /api/order/:id/ready-to-ship` (seller,
  CONFIRMED→PROCESSING) creates the GHN waybill BEFORE advancing and persists
  `ghnOrderCode`. GHN create failure propagates and the order stays CONFIRMED —
  never PROCESSING without a waybill. For COD the waybill is created at
  ORDER-CREATE time, so ready-to-ship just re-uses the existing code.
- **COD**: handled via GHN `cod_amount`; payments service guard skips COD orders
  (no payment row).
- **Status map** (`mapGhnStatus`, webhook + manual sync): `picking|picked`→SHIPPED,
  `delivering`→DELIVERING, `delivered`→COMPLETED (+stock consume/COD
  payment_completed), `cancel` + any `*return*`→CANCELED (+release reserved stock
  + `ORDER_CANCELED_EVENT`, no cancel pushed back to GHN). Forward-only by rank;
  terminal orders untouched.
- **Admin actions (B1 cancel/return)**: `POST /api/order/admin/ghn/orders/:id/cancel`
  and `:id/return` (`@CheckPermission("shipping","update:any")`). Both call GHN
  `POST /v2/switch-status/{cancel|return}` and resolve the local order to
  CANCELED via `applyAdminGhnAction` (release stock + `ORDER_CANCELED_EVENT`).
  GHN rejection → re-throw (4xx/5xx) + `success:false` ACTION `shipping_history`
  row, local order untouched. Allowed matrix (`getAvailableShippingActions`):
  `cancel` for CONFIRMED/PROCESSING/SHIPPED, `return` for SHIPPED/DELIVERING —
  both only with non-null `ghnOrderCode` on a non-terminal order; else 400.
- **Admin actions (B2 update-COD/receiver)**: `POST .../:id/update-cod`
  (`{codAmount}` ≥0; 0 clears) and `:id/update-receiver`
  (`{toName?,toPhone?,toAddress?}`, ≥1 required). GHN `POST
  /v2/shipping-order/updateCOD` / `/v2/shipping-order/update`. On success:
  persist locally (`codAmount` / rewrite `name|phone|addr` head of
  `shippingAddress`) + `success:true` ACTION row; on reject: re-throw +
  `success:false` row. Window: CONFIRMED/PROCESSING with non-null `ghnOrderCode`.
- **Shop-callable GHN surface (live probe, not guessed)**: `cancel`, `return`,
  `storing`, `updateCOD`, `update` (receiver). `delivered|deliver|delivering` →
  400 "không tìm thấy permission command" → delivery-again is NOT shop-callable
  (GHN drives redelivery internally); dropped from Phase 2.
- **Demo-status endpoint (DEMO ONLY)**: `POST /api/order/admin/ghn/orders/:id/demo-status`
  simulates a GHN status without calling GHN, through the same
  `mapGhnStatus`/`applyGhnStatus` path (MANUAL_SYNC history row with
  `action:"demo_status"`). Body `{ghnStatus}` ∈ `ready_to_pick|picking|delivering|
  delivered|delivery_fail|waiting_to_return|returned|cancelled`. Gated by env
  `GHN_DEMO_ENDPOINTS_ENABLED` (else 403). **This demo project deliberately keeps
  it enabled even in prod.** When ON and the latest history row is a
  `demo_status`, GHN order detail overlays that status as `ghnDetail.status` so
  the console badge advances like a real webhook.
- **Stale-reservation sweeper** (orders): hourly `@Cron` cancels
  PENDING/CONFIRMED/PROCESSING orders with `ghn_order_code` null older than
  `ORDER_STALE_RESERVATION_TTL_HOURS` (default 24h), reusing the idempotent
  cancel flow. Orders with a GHN code are never swept.

## Payments

- `payment_methods.is_active` controls active options; `PAYMENT_GATEWAY` env is
  fully unused (strategy chosen per-request from `paymentMethod`).
- `VNPAY_IPN_URL` in `vnpay.config.ts` is dead code — VNPay reads the IPN URL
  from the merchant portal, never from the request.

## Feature ops contracts

- **PDF invoice** (2026-07-15, no migration): `GET /api/order/:id/invoice` → A4
  PDF. Access = buyer OR order's seller OR admin (else 403; role threaded to
  orders TCP as `requestingUserRole`). Vietnamese glyphs need the bundled Roboto
  TTFs at `apps/orders/src/invoice/fonts/*.ttf` — webpack copies them via the
  orders `assets` entry in `nest-cli.json`; if a build drops them Vietnamese
  renders blank, keep that assets rule. Invoice number
  `INV-YYYYMM-<6-digit orderId>`; VAT line intentionally not rendered; generator:
  `apps/orders/src/invoice/invoice.generator.ts`.
- **Forgot-password** (2026-07-11, no migration): `POST /api/user/forgot-password`
  (`@Public`, 5/60s, always generic 201) + `POST /api/user/reset-password`
  (`@Public`, 10/60s, `{email, code, newPassword}`). 6-digit crypto code stored
  PLAINTEXT in Redis `user:pwreset:code:<userId>` (TTL 600s — deliberate:
  short TTL + attempt cap `user:pwreset:attempts:<userId>` max 5 + 60s resend
  cooldown; enables self-test via `docker exec trybuy-redis redis-cli GET ...`).
  Email via dependency-free `MailerService` (`libs/common/src/mailer/`,
  implicit-TLS SMTPS, e.g. Gmail :465 app password; env `SMTP_*` — keys in
  `local/nodeA/.env.example` only; the real `.env` is write-denied to agents).
  SMTP unconfigured → user service logs the code, endpoint still 201.
- **Order email notifications** (F7, 2026-07-12, no migration): notification
  service mirrors order in-app notifications to email, best-effort. Handlers:
  `order_created` (buyer — NEW consumer; also a new in-app notification type/WS
  push), `payment_completed` (buyer), `order_canceled` (buyer),
  `order.return_requested` (seller), `order.return_approved|rejected` (buyer).
  `emailUser` NEVER throws — TCP/mail failure logs a warn, RMQ ack/nack
  unchanged. Needs `SMTP_*` in the notification service env for real delivery.
- **Checkout addressing** (2026-07-01): GHN master-data proxy
  `GET /api/shipping/{provinces,districts?provinceId=,wards?districtId=}`
  (JwtAuthGuard; items `{id,name}`, id = GHN code — number for province/district,
  string WardCode; FE never sees the GHN token). Per-user address book
  `GET/POST /api/user/me/addresses`, `PATCH .../:id`, `PATCH .../:id/default`,
  `DELETE .../:id` (scoped to `req.user.id`; single-default invariant enforced in
  a tx; not-owned/unknown → 404). Order money fields (`total`/`codAmount`/
  `shippingFee`/`discountAmount`) serialize as JSON numbers (`decimalToNumber`).
- **Seller/admin analytics** (F4, 2026-07-01, read-only, no migration):
  `GET /api/order/seller/analytics` (self-scoped) + `GET /api/order/admin/analytics`
  (`@CheckPermission("shipping","read:any")`) → orders TCP `order.analytics`.
  Query: `from`/`to` ISO (default last 30 days; from>to → 400), `interval`
  `day|month`, `topN` 1–50 (default 5). Response `{scope, from, to, interval,
  summary{totalRevenue,completedOrders,totalOrders,averageOrderValue},
  revenueOverTime[], statusDistribution (zero-filled), topProducts[]}`. Revenue =
  goods GMV over COMPLETED orders only (excludes shipping + discount).
  Route ordering: `seller/analytics` + `admin/analytics` BEFORE `seller/:id`.
- **Post moderation** (F5, 2026-07-02): RBAC resource `post` (admin
  `read:any`/`update:any`/`delete:any`, in-memory grants). Gateway
  `social/admin`: `GET reports?status=&page=&limit=` (grouped by post),
  `POST posts/:id/{hide,unhide,dismiss}`, `DELETE posts/:id` (tx-removes post +
  reports). Hidden posts excluded from all feeds; `GET /social/posts/:id` → 404
  when hidden.
- **Low-stock endpoint** (2026-07-06): `GET /api/inventory/low-stock` —
  `@Roles("shop","admin")`. Admin → all rows; shop → auto-scoped server-side via
  `GET_PRODUCT_IDS_BY_SELLER` (empty → `[]` without hitting inventory). Returns
  `Inventory[]` (max 100, `availableStock ASC`, `isActive` only; bigint ids as
  strings; + denormalized `productName: string | null` since 2026-07-10).
  Remaining HTTP inventory surface: `POST /api/inventory`,
  `GET /api/inventory/product/:productId` (`@Public`), `PUT /api/inventory/:id`.
- **Cloudinary**: client uploads direct; server signs via
  `POST /api/upload/signature`; allowed logical folders `trybuy/products`,
  `trybuy/posts`, `avatars`. Upload `publicId` must be a basename matching
  `${userId}_...`; delete `public_id` must be full `<folder>/${userId}_...`
  unless admin; invalid folder → 400, foreign prefix → 403 (before Cloudinary is
  called). Signatures sign `allowed_formats` (SEC-M8): products/avatars
  `jpg,png,webp`, posts `jpg,png,webp,mp4` — FE must forward the returned field
  to Cloudinary. Orphan cleanup is server-side (SEC-M7:
  `CloudinaryService.destroyAssets` in `libs/common/src/cloudinary/`, wired
  post-commit into social/product/user mutations; needs `CLOUDINARY_*` env or it
  warns and no-ops). Folders switch by `NODE_ENV` (2026-07-15): production →
  `trybuy-prod/products|posts`, else `trybuy/products|posts`; avatars always
  legacy `avatars`. Logical→physical resolved server-side
  (`resolvePhysicalUploadFolder`); DTO validators + FE keep the STABLE logical
  names — no FE change needed.
