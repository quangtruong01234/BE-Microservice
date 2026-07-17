# Snapshot — Current State

> Auto-loaded every session. Keep this LEAN: only the live picture (overview,
> active work, open issues, ops facts). Push finished work to `CHANGELOG.md`.
> Conventions/rules live in `ai-docs/agent-context/` — do not duplicate them here.

## System Overview

TryBuy — NestJS monorepo, 7 microservices + 4 shared libs.
Transport: TCP (sync) + RabbitMQ FANOUT (async).
DB: MySQL 8 (orders/user/product) + PostgreSQL (inventory/payments/rewards). Cache: Redis.
Node A: gateway:3000 (HTTP+WS /chat+/notifications), orders:3001, user:3003, product:3006, social:3008, notification:3009 (TCP+RMQ only, no HTTP), chat:3012 (TCP)
Node B: inventory:3002, payments:3005, rewards:3004
Base URL: http://localhost:3000 | Swagger: /doc

## Active Tasks

### 🆔 Public-ID backlog — Stripe-style opaque external ids (decided 2026-07-17)

> Decision (user-approved): adopt **option B** — keep INT/BIGINT PKs and all FKs/
> TCP contracts as numbers internally; ADD a `public_id` VARCHAR(32) UNIQUE column
> (prefixed opaque id, e.g. `ord_8fK2mQ9xL3pT7vWb`) ONLY on tables whose ids are
> exposed on HTTP route params / responses and are enumerable cross-user. API
> boundary accepts+returns ONLY the public id once a domain is converted. Purpose:
> anti-IDOR/enumeration story for the demo, done at the source (no global
> transform layer). No prod data exists yet, so responses REPLACE `id` outright
> (no dual-field compatibility period); FE migrates per domain via handoff entries.
> NOT converting (stay int, deliberately): order_items, voucher_redemptions,
> shipping_history, product_skus, product_reviews, wishlist_items, cart_items,
> roles, resources, payment_methods, reward_points, inventory, payments, brands,
> categories, vouchers (looked up by `code`).
>
> Shared mechanics per domain task: additive SQL migration (+ manifest entry) →
> entity + generate-on-create → resolve `public_id`→int at the owning service's
> read/write paths → gateway route param drops `ParseIntPipe` (string, validate
> prefix) → response maps `id` to public id → Swagger types → tsc/eslint →
> runtime self-test → FE handoff entry (storefront and/or GHN file as relevant).
> Work top-down; move each to CHANGELOG when shipped and delete its line here.

- [x] **PUBID-00 — DONE 2026-07-17** (see CHANGELOG): `generatePublicId`/
      `isPublicId` in `libs/common/src/public-id/public-id.util.ts` (crypto
      base62, no new deps) + `PUBLIC_ID_PREFIXES`/`PUBLIC_ID_RANDOM_LENGTH` in
      `libs/constant/public-id.constant.ts`. 9 unit tests. Note: `@app/constant`
      alias is NOT in tsconfig — constants are imported as `libs/constant/...`
      (existing repo convention).
- [x] **PUBID-01 — DONE 2026-07-17** (see CHANGELOG): orders pilot shipped and
      runtime-verified. All HTTP order ids are `ord_...`; numeric `:id` → 400
      via `ParsePublicIdPipe`. Migration `nodeA-20260717-001-add-public-id-to-orders`
      applied to Aiven (backfill included). Internals stay int (GHN, invoice
      number, payments TCP, RMQ, notifications until PUBID-04). Pattern for the
      next domains: TCP responses carry `publicId` alongside `id`; gateway
      strips via `exposeOrder`-style mappers; controller TCP handlers accept
      `number | string` + `resolveOrderId` so internal numeric callers keep working.
- [x] **PUBID-02 — DONE 2026-07-17** (see CHANGELOG): users converted and
      runtime-verified (11/11). All HTTP user ids are `usr_...` (login/me/
      register/profile/admin list/featured-sellers + product `user`, social
      `author`, order `buyer`/`seller` embeds); numeric `/user/:id` → 400.
      Migration `nodeA-20260717-002-add-public-id-to-users` applied to Aiven.
      JWT/`req.user.id` stay numeric; PATCH ownership check moved into the user
      service (`resolveUserId` on `targetId` → 403); `GET_USER_INFO` accepts
      `number | string` so internal numeric callers (invoice, notification
      email) keep working. Embedded HTTP `userId`/`sellerId` refs were completed
      by PUBID-07.
- [x] **PUBID-03 — DONE 2026-07-17** (see CHANGELOG): chat converted and
      runtime-verified (7 REST + 14 WS checks). Conversations `conv_...`,
      messages `msg_...` (incl. `lastMessage.id`, `parentMessageId`, WS
      `join`/`send_message` payloads + `new_message` emits via shared
      `exposeChatMessage`). Chat runs `synchronize:false` — migration
      `nodeA-20260717-003-add-public-id-to-chat` applied to Aiven BEFORE code.
      New: invalid/foreign `parentMessageId` now 400 (was unvalidated).
      Chat user references were converted to `usr_...` by PUBID-07.
- [x] **PUBID-04 — DONE 2026-07-17** (see CHANGELOG): addresses (`addr_`),
      notifications (`ntf_`), and return requests (`rr_`) converted and
      runtime-verified; notification order deep-links now use `ord_`.
      Migration `nodeA-20260717-004-add-public-id-to-addresses-notifications-returns`
      applied to Aiven.
- [x] **PUBID-05 — DONE 2026-07-17** (see CHANGELOG): products (`prod_`)
      converted across catalog, SKU/product references, cart, checkout, orders,
      social, risk, inventory embeds, and GHN local-order detail. Migration
      `nodeA-20260717-005-add-public-id-to-products` applied to Aiven.
- [x] **PUBID-06 — DONE 2026-07-17** (see CHANGELOG): posts (`post_`) and
      comments/replies (`cmt_`) converted; guarded migration
      `nodeA-20260717-006-add-public-id-to-posts-comments` applied to Aiven.
- [x] **PUBID-07 — DONE 2026-07-17** (see CHANGELOG): converted-domain numeric
      cross-references no longer leave HTTP/WS boundaries; contract documented
      in API context/root README and enforced by the `$review` checklist.

### Architecture prep - hybrid TCP/RabbitMQ hardening (recorded 2026-06-30)

> Decision: keep the current hybrid transport model. Do NOT migrate all
> service-to-service calls to RabbitMQ. Use TCP for commands/queries that need an
> immediate result (gateway reads, auth, checkout stock check/reserve/release/
> consume). Use RabbitMQ fanout for post-commit integration events and side
> effects (`order_created`, `payment_completed`, `order_canceled`, notification,
> rewards, analytics/email later).
>
> Current order/payment/inventory flow is intentionally not "payment_completed
> -> inventory directly deducts stock": Orders reserves stock synchronously at
> order creation, Payments emits `payment_completed`, Orders handles payment/GHN,
> and reserved stock is consumed when the order reaches COMPLETED. Cancel/return
> releases reserved stock. Keep Orders as the lifecycle coordinator, Inventory as
> stock/reservation owner, and Payments as payment-state owner.
>
> Next architecture improvement when ready: add an outbox-style publish path for
> critical domain events so DB commit + event publish cannot drift. Preserve
> idempotency via `orderId`/`reservationKey`/ledger or unique constraints in all
> consumers. This is reliability hardening, not a release gate.

### 🚀 DEPLOY GATE — "best deploy point" (recorded 2026-06-28)

> The user asked: which task to reach so deploy is cleanest. Answer: **deploy is
> ngon nhất once the items below close** — features are already deploy-complete
> (all P0/P1/P2 closed; GHN Phase 1 + B1 cancel/return + B2 update-COD/receiver +
> webhook dual-path done). What is NOT ready is the **production run/build
> pipeline**. Analytics is POST-LAUNCH, not a gate item — do not block deploy on it.
>
> **ACTION FOR ANY FUTURE SESSION:** when all gate items below are checked off,
> tell the user "backend is deploy-ready" — this is the signal they asked to be
> notified at.
>
> **STATUS (2026-06-28):** ALL GATE ITEMS CLOSED — **backend is deploy-ready.**
> G1+G2+G3 DONE (build green, all 10 `dist/apps/<svc>/main.js` emitted, fail-fast
> verified). G4 DONE (notification controller filter added; payments/inventory/
> rewards/product already had it). G5 verified (nginx conf exists under `api/`,
> valid). Nothing further gates deploy.
>
> **Deploy gate items (production-readiness, verified 2026-06-28):**
>
> - [x] **G1 — `npm run build` fixed.** `nest-cli.json` default project repointed
>       off the removed `apps/ecommerce-nestjs-zzzzz` to `gateway` (+ dead project entry
>       removed, `deleteOutDir:false`); `package.json` `build` now runs `npm run clean`
>       then `nest build <svc>` for all 10 real services, `start:prod` → `pm2 start
ecosystem.config.js --env production`, plus per-service `start:prod:<svc>` →
>       `node dist/apps/<svc>/main`. Verified: full build green, all 10
>       `dist/apps/<svc>/main.js` present.
> - [x] **G2 — `ecosystem.config.js` now runs compiled prod.** Replaced the two
>       `npm run start:nodeA|nodeB` wrappers with one pm2 app per microservice running
>       `node dist/apps/<svc>/main.js` (fork mode, autorestart, 500M max-mem). pm2 now
>       supervises each service directly so a single runtime crash IS restarted. Per-node
>       start via `--only "gateway,orders,…"` (Node A) / `--only "inventory,payments,
rewards"` (Node B), documented in the file header.
> - [x] **G3 — JWT_SECRET fail-fast added.** Gateway `main.ts` throws right after
>       `dotenv.config` if `JWT_SECRET` is absent (before any port bind); the
>       `JwtModule` useFactory in `gateway.module.ts` also throws on an undefined secret.
>       Verified: `JWT_SECRET="" node dist/apps/gateway/main.js` → exit 1 with the guard
>       message; normal boot with the secret present → login still 201.
> - [x] **G4 — `HttpToRpcExceptionFilter` coverage complete.** Audit found
>       payments/inventory/rewards/product controllers ALREADY had `@UseFilters(
HttpToRpcExceptionFilter)` (commit 83b567c); user is covered by its global
>       `AllRpcExceptionFilter`. The only real gap was `notification.controller.ts` —
>       filter now added there. Gateway is HTTP-facing (uses `HttpExceptionFilter`),
>       correctly excluded. `nest build notification` green.
> - [x] **G5 — nginx config verified.** `nginx/trybuy.conf` DOES exist under
>       `api/` (the prior "no nginx/ dir" note was stale) + `nginx/trybuy-local.conf`.
>       `trybuy.conf` is a valid prod conf: `/` → gateway `localhost:3000`,
>       `/socket.io/` → `:3010` (WS upgrade), zalopay/vnpay callbacks → `:3007`,
>       TLS via letsencrypt, `server_name yourdomain.com` placeholder + deploy steps
>       in header. Replace the domain placeholder + run certbot at deploy time.
>
> **Not gate items (ship without them):** `storing` action, analytics aggregation
> endpoints, GHN webhook public-URL registration (operational — email api@ghn.vn at
> deploy time, code already 200/PascalCase-ready). (B2 update-COD/update-receiver is
> now DONE — see CHANGELOG + Ops/Runtime.)

### GHN Web integration next steps

> Backend Phase 1/1.1 for GHN shipping is complete enough for web integration.
> Next FE workspace: `C:\Users\Quang Truong\Desktop\MCR\web-flow-GHN`
> (Next.js app at repo root, dev port `3013`). The next task should connect
> auth only: `POST /api/user/login`, `POST /api/user/logout`,
> `GET /api/user/me`, using `credentials: "include"` and configurable gateway
> base URL defaulting to `http://localhost:3000/api`.

Implementation order for GHN Web:

- Step 1: auth API integration only; add TanStack Query provider, login submit,
  auth hydration, protected layout, logout, unauthenticated redirect to `/login`,
  forbidden redirect to `/403`; do not connect shipment APIs yet.
- Step 2: ✅ DONE (2026-06-27, runtime-verified) — backend roles/grants for
  `logistics_operator` (shipping `read:any`) and `shipping_manager` (shipping
  `read:any` + `update:any`) added to `apps/user/src/rbac/grants.ts`; `RoleName`
  enum + gateway `UserRole` type extended; migration
  `database/add_shipping_roles.sql` (enum extend + `shipping` resource + 2 role
  rows) applied to Aiven. Test accounts `logistics_test` / `shipmgr_test`
  (pwd `Ship@1234`) seeded. FE may now target these roles instead of admin.
- Step 3: read-only GHN shipment APIs for list/detail/history via TanStack
  Query; keep server order data out of Zustand.
- Step 4: manual sync API mutation only; invalidate list/detail/history and
  refetch; never let FE manually set GHN status or call GHN directly.
- Step 5: production-like API error handling (`401`, `403`, `404`, `400`,
  `500/503`) while preserving loading/empty/error UI states.
- Step 6: settings page remains read-only/mock for GHN config; do not expose or
  save real GHN token/shop config from FE.
- Step 7: add FE tests after auth/API integration; prioritize login, auth
  redirect, protected layout, status mapping, shipment table/detail, sync modal,
  and history timeline.

GHN Web dependencies to add now:
`@tanstack/react-query`, `zustand`, `clsx`, `tailwind-merge`, `lucide-react`.
Do not install `recharts` or `shadcn/ui` yet. GHN action APIs **cancel + return
(B1) and update-COD + update-receiver (B2) are now live** (Phase 2 — see
Ops/Runtime + `frontend-handoff-ghn.md`); delivery-again is **dropped** (not
shop-callable per the GHN probe). Only remaining backend contract still blocking
FE: analytics charts.

### ⛔ Highest priority — FE-blocking backend work

> Source: `frontend/.ai/snapshot.md` (FE readiness audit, 2026-06-25). FE has
> shipped client-side mitigations; these items can only be closed by backend and
> are gating the production release (all P0 must close + regression-tested).

**P0 — release blockers**

> All P0 items are DONE — see `CHANGELOG.md`: P0-02 (tierIdx contract), P0-03
> (atomic product+inventory create & orphan cleanup), P0-04 (create-order
> idempotency key), P0-05 (SKU diff + reference protection on product edit).
> Runtime endpoint self-test for P0-03/P0-04/P0-05 is still pending a full-stack run.

**P1**

> P1-01 (seller order lifecycle) and P1-02 (order item enrichment + server-side
> per-status counts) are DONE — see `CHANGELOG.md`; their runtime endpoint
> self-test is still pending a full-stack run. P1-03 (social↔commerce: post
> `productId` attach, PATCH edit, report endpoint) is DONE and runtime-verified
> (8/8 curl self-tests passed; both migrations applied to Aiven). P1-04
> (multi-category hydrate) is DONE and runtime-verified — every gateway product
> read path now returns a flat `categoryIds: number[]` alongside the full
> `categories[]` (list, by-id, by-sku, by-category, search, with-inventory;
> 5/5 curl self-tests passed, multi-category products confirmed). Note: order item
> `image` is still resolved live from the product service — purchase-time snapshot
> remains open as P2-02.

> P1-06 (chat conversation metadata) is DONE and runtime-verified — see
> `CHANGELOG.md`. `GET /chat/conversations` now returns `lastMessage` +
> `unreadCount` per conversation (active-first order); new
> `POST /chat/conversations/:id/read` resets the viewer's unread. Migration
> `database/add_read_tracking_to_conversations.sql` applied to Aiven 2026-06-26.

**P2**

> P2-02 (order snapshot) is DONE and runtime-verified — `order_items` now stores
> `product_image` + `sku_label` captured from the authoritative product at
> checkout; gateway read paths (buyer detail/list, seller detail) prefer the
> snapshot and skip the live product fetch for snapshot-bearing items, so
> deleted/edited products no longer break historical orders. Migration
> `database/add_snapshot_columns_to_order_items.sql` applied to Aiven 2026-06-26.
> Verified on order 108 (3/3 read paths return the snapshot image, zero live
> lookup). See `CHANGELOG.md`.
> P2-05 (pagination/stat endpoints) is DONE — see `CHANGELOG.md`. Admin pagination
> (`GET /user?page=&limit=`, `@Roles("admin")`), notifications
> `GET /notifications/unread-count`, and shop `GET /products/shop/stats` are live;
> server-side product search by name/SKU already existed. Admin pagination +
> unread-count are runtime-verified; shop-stats is now runtime-verified too
> (`{productCount:12,totalStock:961,lowStockCount:0}`) after the nodeB idle-crash
> fix below.

### 🌱 Feature Roadmap — post-launch enhancement backlog (recorded 2026-06-30)

> All P0/P1/P2 + deploy gate are closed and the backend is deploy-ready. These are
> NET-NEW features to grow the product beyond MVP — none gate deploy. Ordered by
> value/effort; pick top-down. Each needs the usual researcher → (planner if >2
> services / migration) → implement → self-test loop. Move an item to CHANGELOG
> when shipped and delete its line here.

- [x] **F1 — Product reviews & ratings** — DONE (was already implemented in commits
      `3ceb9f6`/`984ff2b`; the roadmap entry was stale). Runtime-verified 2026-06-30
      (8/8 self-tests). `product_reviews` table + `product.rating`/`ratingCount`
      aggregate; gateway `GET/POST /api/products/:id/reviews` (POST gated on a COMPLETED
      order containing the product via `order.verify_product_purchased`, 404 if not
      purchased, 409 on duplicate) + `DELETE /api/products/reviews/:reviewId` (owner only,
      403 otherwise). See CHANGELOG + Ops/Runtime applied-migration note.
- [x] **F2 — Buyer-initiated return/refund request** — DONE and runtime-verified
      2026-06-30 (7/7 self-tests). `order_return_requests` lifecycle: buyer `POST
/api/order/:id/return-request` (eligible only on own DELIVERING/COMPLETED orders;
      dedupes active requests; order → RETURN*REQUESTED), seller(order owner)/admin
      review via `POST /api/order/return-requests/:id/{approve,reject}` (gated
      in-service by seller product ownership or admin role). Approve → best-effort GHN
      return + release reserved stock + refund **recorded/simulated** (online→`refunded`,
      COD→`manual_pending`, NO real gateway call) + order → REFUNDED; reject (reason
      required) restores `previousOrderStatus`. Lists: buyer `GET
/api/order/return-requests/mine`, seller/admin `GET /api/order/return-requests`
      (seller-scoped by owned products, `status` filter). Async fanout
      `order.return*{requested,approved,rejected}` → notification consumers. See
      CHANGELOG + Ops/Runtime applied-migration note.
- [x] **F3 — Voucher / coupon / discount codes** — DONE and runtime-verified
      2026-06-30 (10/10 self-tests). OWNED BY ORDERS (MySQL), not Rewards — chosen for
      transactional integrity (redemption + discount recorded in the same tx as order
      create; Rewards has no TCP server). `vouchers` + `voucher_redemptions` tables;
      `orders.voucher_code`/`discount_amount` columns. Admin CRUD: `POST/GET
/api/order/admin/vouchers`, `PATCH /api/order/admin/vouchers/:id/deactivate`
      (`@CheckPermission("order", create:any|read:any|update:any)`). Buyer preview:
      `POST /api/order/voucher/validate` (JwtAuthGuard; prices the basket via product
      service, returns discount without consuming). Checkout: optional `voucherCode` on
      `POST /api/order` — validated + priced server-side, redemption consumed atomically
      in the create tx (conditional `used_count+1` UPDATE guards the usage cap). Discount
      applies to goods subtotal only (never shipping), clamped to subtotal, percent honours
      `maxDiscountAmount`. **Single-seller only** — multi-seller baskets reject voucher with 400. See CHANGELOG + Ops/Runtime migration note.
- [x] **F4 — Seller analytics dashboard** — DONE and runtime-verified 2026-07-01
      (6/6 self-tests). Read-only aggregation, no migration. See CHANGELOG + Ops/Runtime.
- [x] **F5 — Post moderation actions** — DONE and runtime-verified 2026-07-02
      (10/10 self-tests). Admin-only review/resolve flow over the existing report
      endpoint + post hide/unhide. See CHANGELOG + Ops/Runtime + applied-migration note.
- [x] **F6 — Wishlist / favorites** — DONE and runtime-verified 2026-07-07
      (7/7 endpoint checks). Product-owned `wishlist_items` table + authenticated
      add/remove/list endpoints. See CHANGELOG + Ops/Runtime migration note.
- [x] **F7 — Email notifications** — DONE and runtime-verified 2026-07-12
      (order-create + cancel self-tests). Best-effort email channel off the
      notification RMQ consumers via the shared `MailerService` (`@app/common`);
      new `order_created` in-app notification type added as part of the same
      handler. No migration. See CHANGELOG + Ops/Runtime note. FOLLOW-UP (not
      scheduled): shipping-milestone emails (SHIPPED/DELIVERING/DELIVERED) need
      new orders-service events — the GHN webhook updates status without
      emitting per-status events today.

### 🧠 Product Intelligence Roadmap — AI-01..AI-04 (AI-01/02 shipped; AI-03/04 planned)

> Four product-intelligence features approved by the user; AI-01/02 are shipped
> and AI-03/04 remain planned. Constraint: **zero
> mandatory cost** — free-tier signup is acceptable (Google AI Studio Gemini key,
> NO credit card), anything pay-only is out of scope. NO new microservice: all
> logic lands in the existing **product service** (owner of catalog data) + thin
> gateway routes; Gemini access via ONE shared client in `libs/` reused by AI-03/
> AI-04. Recommended order: **AI-01 → AI-02 → AI-03 → AI-04** (01 feeds 02's
> price-anomaly signal; 03 builds the Gemini client + image-download util that 04
> and 02's pHash both reuse). Move each to CHANGELOG when shipped.

**AI-01 — DONE 2026-07-13** (see CHANGELOG): authenticated catalog price
suggestion shipped at `GET /api/products/price-suggestion` via
`product.price_suggestion`. It returns integer-VND median/P25/P75/min/max over
active base/SKU prices and suppresses samples smaller than three. No migration
or external API. Storefront integration is recorded in `frontend-handoff.md`.

**AI-02 follow-up backlog — hardening/scale (F1–F4 shipped 2026-07-16; see CHANGELOG)**

- [ ] **AI-02F5 — Hash lookup scale path.** Current Hamming comparison is an
      O(catalog) scan and is acceptable only for the present small catalog.
      Before/at ~10k products, benchmark it and replace the scan with persisted
      hash buckets/BK-tree or another measured candidate index; retain exact
      Hamming verification after candidate retrieval. Add load evidence and an
      index/migration only after the benchmark selects the design.
- [x] **AI-02F6 — DONE 2026-07-14** (see CHANGELOG): image-processing resource
      bounds landed in `apps/product/src/product-image-hash.service.ts`.
      `downloadImage` now streams the body via `readBodyWithCap` (reader loop with
      a hard cumulative-byte cutoff + `reader.cancel()`), so a missing/lying
      `Content-Length` can no longer buffer an oversized payload into memory; and
      `hashImageUrls` runs through a `mapWithConcurrency` worker pool capped at
      `MAX_CONCURRENT_HASHES=3` instead of unbounded `Promise.all`, bounding peak
      sharp decode/RSS regardless of image count. No public API change, no migration.
      2 new unit tests (concurrency counter ≤3; oversized no-`Content-Length` stream
      aborted); product suite 17/17.

**Remaining trigger:** AI-02F5 is activated by catalog size/load evidence near
10k products, not by calendar time. The current catalog remains below that gate.

**AI-03 — Sell From Photo (Gemini)** (Google AI Studio free tier, no card; no migration)

- **User flow:** seller taps "Đăng bán từ ảnh" on the create form → uploads photo
  via the EXISTING Cloudinary signature flow (`POST /api/upload/signature`) → FE
  sends the Cloudinary URL to the draft endpoint → form prefills name/description/
  category/condition/attributes (+AI-01 price hint) → seller edits → normal
  product create. AI output is always editable, never auto-published.
- **Backend flow:** gateway `AiModule` route (stateless, no product-service hop —
  nothing persisted): validate the URL is our Cloudinary cloud (SSRF guard) →
  download image bytes → new shared `GeminiClient` in `libs/common/src/gemini/`
  (`GEMINI_API_KEY` + `GEMINI_MODEL` env, flash model, responseSchema JSON mode)
  → prompt includes the REAL category list (id+name, from the cached
  brand/category read) so Gemini picks existing `categoryIds`, output fields in
  Vietnamese → return `{name, description, categoryIds, condition, attributes[],
confidence}`.
- **Endpoints/patterns:** `POST /api/products/ai/draft-from-photo {imageUrl}`
  (JwtAuthGuard + explicit `@RateLimit` — protect the free-tier quota). No TCP
  pattern needed. Redis cache (`@app/cached`) keyed by image URL hash to dedupe
  repeat calls.
- **DB changes:** none.
- **FE:** "Đăng bán từ ảnh" entry on the create form → loading state → prefilled
  form with an "AI suggested" badge per field.
- **Reuse:** upload signature flow untouched; category cache from PERF-09 work;
  rate-limit guard; `@app/cached`.
- **Risks/edge cases:** Gemini free-tier RPM/daily caps → per-user rate limit +
  Redis dedupe + graceful `503 "AI đang bận, thử lại sau"` on quota errors (FE
  falls back to manual form — feature must degrade, never block selling);
  hallucinated categories → validate returned ids against the real list, drop
  unknowns; non-product/NSFW photos → Gemini safety block returns an error →
  map to 400 "ảnh không phù hợp"; NEVER expose the API key to FE.
- **MVP:** single photo → draft fields. **Later:** multi-photo, brand detection
  mapped to the brands table, auto price via AI-01 wiring, suggested SKU
  variations from the photo.

**AI-04 — Visual Search** (reuses AI-03's GeminiClient + tag pipeline; 1 additive migration)

- **User flow:** camera icon in the storefront search bar → user uploads a photo
  → results page shows catalog products ranked by visual/tag similarity.
- **Backend flow:** two halves. **Index half:** after product create/update,
  product service fire-and-forget calls Gemini once per product (primary image)
  → normalized Vietnamese+English tag list + a one-line caption → saved to
  `products.ai_tags`. Shares the image-download util and (if batched later) the
  same call that AI-02 uses for hashing. Backfill script tags the existing
  catalog once. **Query half:** gateway `POST /api/products/visual-search
{imageUrl}` → Gemini tags the query image (same client, same cache) → TCP
  `product.search_by_tags {tags[]}` → product service scores tag overlap
  (weighted Jaccard; ties broken by rating/viewCount) → returns a standard
  `PaginatedResponse` of the SAME product shape as `product.search` (so FE result
  cards are reused as-is).
- **Endpoints/patterns:** `POST /api/products/visual-search {imageUrl, page?,
limit?}` (JwtAuthGuard + `@RateLimit`) → new `PRODUCT_SEARCH_BY_TAGS:
"product.search_by_tags"`. Internal `product.retag` admin pattern for backfill/
  refresh.
- **DB changes:** `products.ai_tags` JSON NULL (+ optional `ai_caption`
  VARCHAR(512) NULL). Dev sync + guarded `database/add_ai_tags_to_products.sql`
  for prod. (A separate indexed tags table only if/when catalog outgrows
  in-memory overlap scoring.)
- **FE:** camera button in the search bar, upload/crop modal, results grid
  reusing existing product cards + "kết quả tương tự theo ảnh" header.
- **Reuse:** GeminiClient + Redis cache + SSRF/Cloudinary guard from AI-03;
  Cloudinary upload flow for the query photo; existing search response shape +
  FE product cards; AI-02's image-download util.
- **Risks/edge cases:** tag quality gates relevance — constrain the prompt to a
  controlled vocabulary (color/type/material/style) to keep index & query tags
  aligned; untagged products (Gemini failed at create) are invisible to visual
  search → retag path + nightly sweep fixes; free-tier quota shared with AI-03 →
  same rate-limit budget; empty overlap → fall back to text search on the
  caption; catalog growth → this is explicitly the cheap MVP, the upgrade path
  is CLIP embeddings + pgvector (Node B PG) WITHOUT changing the public API.
- **MVP:** tag-overlap search as above. **Later:** CLIP/pgvector similarity,
  "find similar" button on product detail (no upload needed — reuse stored
  tags), category-constrained visual search.

**Shared prerequisites (do once, in AI-03 unless pulled earlier):** `GEMINI_API_KEY`

- `GEMINI_MODEL` in `local/nodeA/.env` (+ `.env.example`); `GeminiClient` in
  `libs/common/src/gemini/` (typed JSON-schema responses, timeout, quota-error
  classification); image-download util with Cloudinary-host allowlist (SSRF guard);
  `sharp` + a blockhash lib as deps (AI-02). All AI paths are best-effort: catalog
  CRUD must never fail or block because Gemini/pHash failed.

### 🔒 Production-control backlog (route-inventory audit, 2026-07-05)

> From a static route-inventory + coverage-matrix pass over all 125 HTTP routes
> (121 gateway + GHN webhook dual-path + 3 payments callbacks). Defensive
> app-engineering hardening; none verified as exploited, all found by code
> inspection only. Fix top-down. Each item: affected route(s) → file → missing
> control → defensive fix → test to add. Move to CHANGELOG when shipped, delete
> the line here. Open questions (OQ-1..6) below gate some items.

**🔴 Critical**

**🟠 High**

- [x] **SEC-H2 — DONE 2026-07-09** (see CHANGELOG): `POST
/api/products/with-inventory/multiple` now validates via
      `GetProductsWithInventoryDto` (`@ArrayMaxSize(50)` + `@IsInt({each:true})` +
      `@Type(()=>Number)`) and dedupes ids before the batch TCP send. Runtime-verified
      5/5 (51 ids → 400, non-numeric → 400, missing field → 400, duplicates deduped,
      string-numeric coerced). FE handoff written (50-id cap = contract change).
- [x] **SEC-H3 — CLOSED 2026-07-09 (stale item, already implemented; now
      runtime-verified).** `login`/`register` already carry explicit
      `@RateLimit({limit:10,ttl:60})`; the guard uses `Logger` (no `console.warn`),
      has a 500ms Redis timeout, and **fails closed in production** (503) while
      allowing in dev — which also answers OQ-4. Live self-test: 12 rapid logins →
      10× 401 then 2× 429.
- [x] **SEC-H4 — DONE 2026-07-10** (see CHANGELOG): callback hardening fully
      closed. The remaining duplicate-delivery runtime test passed 8/8 (forged
      valid-MAC ZaloPay callback applied twice on order #117 → second delivery
      ack'd `return_code:1` but payment row + order status/updatedAt bit-identical;
      bad MAC rejected with no transition). VNPay shares the same idempotent
      `completePayment` core, so both providers are covered. No code change needed.

**🟡 Medium**

- [x] **SEC-M1 — DONE 2026-07-11** (see CHANGELOG): GHN webhook hardened —
      `GhnWebhookDto` validated manually inside the handler (raw body kept so the
      global `forbidNonWhitelisted` pipe doesn't 400 real GHN extra fields; wrong-typed
      `OrderCode`/`Status` → 400), deprecation `Logger.warn` when auth arrives via
      `?token=` (header `x-ghn-webhook-token` preferred; query NOT removed — that
      removal still gated by OQ-2), explicit `@RateLimit({limit:300,ttl:60})`.
      Runtime-verified 7/7.
- [x] **SEC-M2 — DONE 2026-07-09** (see CHANGELOG): unbounded list endpoint risk
      closed without a frontend-breaking response-shape change. Earlier unused-API
      sweep removed `GET /api/user/all`, removed HTTP `GET /api/inventory`, and
      rebuilt `/inventory/low-stock` gated+capped. Final remainder
      `GET /api/products/brands|categories` is now Redis cache-aside by status
      (`active|pending|rejected`) with invalidation on brand/category create/review.
- [x] **SEC-M4 — DONE 2026-07-09** (see CHANGELOG): reviews route now uses
      `ReviewQueryDto` (page ≥1, limit 1–100); payment-result keeps the raw query
      record (VNPay checksum needs ALL `vnp_*` params — a whitelist DTO would break
      verification) but manually bounds it (≤40 keys, ≤512 chars/value, string-only).
      Runtime-verified 8/8.
- [x] **SEC-M5 — CLOSED 2026-07-10 (stale item, already implemented; now
      runtime-verified).** `securityHeadersMiddleware` in
      `apps/gateway/src/common/security.ts` (registered first in `main.ts`) sets
      nosniff/X-Frame-Options DENY/Referrer-Policy/COOP/CORP/Permissions-Policy on
      every response + HSTS only in production. Verified live in dev AND on a
      prod-mode compiled boot (HSTS present). No helmet dep needed; closes
      independent of nginx (OQ-3 now only informs SCALE-03).
- [x] **SEC-M6 — CLOSED 2026-07-10 (stale item, already implemented; now
      runtime-verified).** Swagger setup is gated by `isSwaggerEnabled()`
      (`SWAGGER_ENABLED` env, default ON in dev / OFF when `NODE_ENV=production`).
      Verified: dev `/doc` → 200; prod-mode compiled boot → `/doc` 404.
- [x] **SEC-M7 — DONE 2026-07-11** (see CHANGELOG): orphaned Cloudinary assets
      now destroyed server-side. New dependency-free `CloudinaryService` in
      `libs/common/src/cloudinary/` (URL→public_id parse with cloud-name/host/
      folder-allowlist guards, SHA1-signed destroy via fetch, never throws) wired
      post-commit fire-and-forget into social updatePost/deletePost/adminDeletePost,
      product updateProduct/deleteProduct, user updateUser (avatar). Runtime-verified
      5/5 (post edit-drop, post delete, avatar replace, avatar clear, product delete
      → dropped delivery URLs 404, kept assets 200). 7 unit tests.
- [x] **SEC-M8 — DONE 2026-07-11** (see CHANGELOG): upload signatures now include
      and sign Cloudinary `allowed_formats`. Products/avatars allow `jpg,png,webp`;
      post uploads allow `jpg,png,webp,mp4`. This is a storefront contract change:
      FE must include the returned `allowed_formats` field in the direct Cloudinary
      upload form with the returned signature. Unit tests cover the signed params;
      live gateway self-test verified `POST /api/upload/signature` returns the new
      field under the response `data` envelope; direct Cloudinary upload of a `.txt`
      file with the returned constrained signature was rejected with HTTP 400.

**🟢 Low**

- [x] **SEC-L1 - DONE 2026-07-11** (see CHANGELOG): all gateway order numeric
      path params now use `ParseIntPipe`; remaining `+id`/string-id coercions in
      order gateway routes were removed. Runtime malformed-id checks return 400
      before TCP calls.
- [x] **SEC-L2 - DONE 2026-07-12** (see CHANGELOG): user service login now
      returns `SafeUser` so the password hash never leaves the user microservice;
      gateway login no longer clone/deletes `password`. The user TCP controller
      also no longer logs the login payload.
- [x] **SEC-L3 - DONE 2026-07-12** (see CHANGELOG): duplicate brand/category
      proposals now reject case-insensitive matches against active or pending names.
      `POST /api/products/brands|categories` trims the submitted name, checks
      `LOWER(TRIM(name))`, and returns 409 before saving; gateway create-brand/
      create-category now route TCP errors through `MicroserviceErrorHandler` so
      the conflict reaches HTTP as 409 instead of 500.
- [x] **SEC-L4 — DONE 2026-07-13** (see CHANGELOG): cookie/CSRF posture
      documented in `security.md`; `$review` now flags new `@Get()`/`@Head()`
      routes that call mutating service methods.

**Open questions (gate the above):** OQ-1 RESOLVED 2026-07-06 — SEC-M3 closed by
the unused-API sweep (HTTP inventory list/reserve/release removed; low-stock gated
shop/admin + seller-scoped). OQ-2 GHN dashboard header vs `?token=` → SEC-M1 shipped 2026-07-11 with header
preferred + deprecation warn on query use; OQ-2 now only decides whether query
support can be REMOVED entirely.
OQ-3 (is nginx guaranteed in front of gateway + :3007) no longer gates any SEC
item — SEC-H4 + SEC-M5 closed with in-app enforcement; it now only informs
SCALE-03 nginx tuning. OQ-4 RESOLVED 2026-07-09 by code inspection —
the guard already fails closed in production (503) and open only in dev; SEC-H3 closed. OQ-5 RESOLVED 2026-07-07 — public product/social/user
profiles do not need email; order/admin/invoice paths explicitly opt into email.
OQ-6 target rate-limit numbers for
login/register/upload/checkout (product decision).

### ⚡ Perf-audit backlog (full-project audit, 2026-07-02)

> `/perf-audit` swept all 10 services (gateway/orders/user/product/social/chat/
> notification + inventory/payments/rewards). Clean paths confirmed: gateway social
> (batched `get_users_by_ids`), gateway admin-orders buyer merge, chat conversation
> list (3 grouped queries), `getAllProductsWithInventory` (batch inventory),
> notification RMQ consumers (lean, correct ack/nack), `getReplies` (single-comment
> only, depth capped 5). Fix top-down via `/feature` or `prompts/refactor.md`;
> the two 🔴 product items need a `researcher → implement` pass (new TCP pattern).

**🔴 Critical — N+1 on hot read paths (latency scales with page size)**

- [x] **PERF-01 — DONE 2026-07-02** (see CHANGELOG): `enrichProductsWithUserInfo`
      now one batched `GET_USERS_BY_IDS` send instead of N per-user `GET_USER_INFO`.
      Runtime-verified on list + with-inventory/multiple; same response shape.
- [x] **PERF-02 — DONE 2026-07-02** (see CHANGELOG): GAP-01 closed
      (`PRODUCT_FIND_BY_IDS` pattern + `findProductsByIds` handler, missing ids
      skipped); `getProductsWithInventory` now 1 batch product send ∥ 1 batch
      inventory send + single enrichment pass (3N→3). Runtime-verified.
- [x] **PERF-03 — DONE 2026-07-03** (see CHANGELOG): GAP-02 closed
      (`CachedService.mget`); the triplicated per-post decoration in getPosts/
      getPostsByUser/getFollowingFeed replaced by one shared batched `decoratePosts`
      (2 MGETs + grouped fallbacks + 1 GROUP BY comment count per page, was ≈2N
      Redis + N COUNTs). Same shape; `resolveIsLiked` kept for `getPostById`.
      Runtime-verified on all 3 feeds incl. like/unlike + second viewer + anonymous.

**🟡 Important**

- [x] **PERF-04 — DONE 2026-07-03** (see CHANGELOG): `@Index` added to the orders
      entities (`idx_orders_{user_id,seller_id,status_created_at,ghn_order_code}`,
      `idx_order_items_{seller_id,product_id}`); auto-applied via `synchronize:true`
      (service booted clean post-restart). `EXPLAIN` spot-check still pending.
- [x] **PERF-05 — DONE 2026-07-07** (see CHANGELOG): social feed/comment hot-path
      indexes added via `database/add_social_performance_indexes.sql` and applied to
      Aiven Node A (`nodeA-20260707-002-add-social-performance-indexes`).
- [x] **PERF-06 — DONE 2026-07-07** (see CHANGELOG): chat message and payments
      callback lookup indexes added through scoped manifest applies:
      `nodeA-20260707-003-add-chat-message-performance-indexes`,
      `nodeB-20260707-001-add-payments-order-id-index`, and
      `nodeB-20260707-002-add-payments-app-trans-id-index`.
- [x] **PERF-07 — DONE 2026-07-02** (see CHANGELOG): `buildProductMap` now one
      batched `PRODUCT_FIND_BY_IDS` send (empty set short-circuits; batch failure →
      empty map, same skip semantics). Runtime-verified on legacy buyer list + detail.
- [x] **PERF-08 — DONE 2026-07-03** (see CHANGELOG): `enrichOrderItems` now fetches
      SKU ∥ product via `Promise.all` (product lookup only needs `item.productId`), and
      a `productPromiseById` memo dedupes repeated productIds to one in-flight
      `PRODUCT_FIND_BY_ID`. Same response shape + error semantics. Runtime-verified on
      create-order (base-price 2-line same product 114; SKU 2-line same product 115 →
      labels/tierIdx correct; mismatch still 400).
- [x] **PERF-09 — DONE 2026-07-09** (see CHANGELOG): unbounded user/inventory HTTP
      offenders were closed by the unused-API sweep; final brand/category remainder
      now uses product-service Redis cache-aside (`products:brands:<status>`,
      `products:categories:<status>`, 300s TTL) with invalidation on create/review.
      Kept the existing `Brand[]`/`Category[]` response shape, so no FE-breaking
      pagination contract change.
- [x] **PERF-10 — DONE 2026-07-03** (see CHANGELOG): product `findAllProducts`
      split-query pagination — count + DISTINCT id-page (raw offset/limit, sort column
      in SELECT for MySQL DISTINCT+ORDER BY), then hydrate brand/categories via
      `In(ids)` with order restored. No more distinct-subquery/cartesian inflation;
      bonus: category-filtered products now hydrate their FULL `categories[]` (old
      joinAndSelect truncated to the matched category). Gateway DTO also gained a
      scalar→array `@Transform` on `categoryIds`/`brandIds` (single `?categoryIds=18`
      used to 400). Runtime-verified (TCP probe + HTTP filters/sort/pagination).
      **Found during verification:** FE sends singular `categoryId`/`brandId` →
      whitelist-stripped → marketplace filter was a silent NO-OP; handoff entry
      written (see Known Issues).

**🟢 Minor**

- [x] PERF-11 — DONE 2026-07-10 (see CHANGELOG): `getPaymentUrl` now uses a bare
      `fetchOwnedOrder` helper (order fetch + owner-or-admin check, no product
      enrichment); `getOrderById` reuses the same helper. Runtime-verified 4/4.
- [x] PERF-12 — MOOT 2026-07-06: the standalone SKU mutation routes and their
      gateway `updateSku`/`deleteSku` methods were removed in the unused-API sweep
      (canonical SKU edit path is `PATCH /api/products/:id` with `skuList`).
- [x] PERF-13 — DONE 2026-07-06 (unused-API sweep): `getLowStockItems` now
      filters `isActive`, accepts optional `productIds` seller scoping, orders
      `availableStock ASC`, and caps at 100 rows (`LOW_STOCK_MAX_RESULTS`).

**TOP FIX (next):** none — perf backlog fully closed. **SUMMARY:** 0 critical,
0 important, 0 minor remaining (PERF-01/02/07 + GAP-01 done 2026-07-02;
PERF-03/04/08/10 + GAP-02 done 2026-07-03 — all 🔴 critical closed; PERF-12/13
closed 2026-07-06 by the unused-API sweep, which also removed the PERF-09
user/inventory offenders; PERF-05/06 closed 2026-07-07; PERF-11 closed
2026-07-10). Next perf work lives in the Scalability backlog (SCALE-01..06).

### 📈 Scalability backlog — high-concurrency readiness (recorded 2026-07-07, planning only)

> Question answered 2026-07-07: "can the API survive 1,000–10,000 concurrent
> requests?" Verdict: architecture is sound (batched TCP, MGET, async RMQ side
> effects, Redis rate limit fail-closed in prod) and fine for a few hundred
> concurrent, but the RUNTIME configuration bottlenecks well before 1k. Fix in
> the order below — SCALE-01/02 are the load-bearing items, the rest amplify.
> Each item should ship with a k6/autocannon before/after number (SCALE-06).
> Move to CHANGELOG when shipped, delete the line here.

- [ ] **SCALE-01 — gateway is a single Node process (1 core).**
      `ecosystem.config.js` runs every service `instances:1, exec_mode:'fork'`; the
      gateway's one event loop takes ALL HTTP + both WS namespaces (`/chat`,
      `/notifications`). Biggest bottleneck. Fix in two steps: (a) add
      `@socket.io/redis-adapter` to both WS gateways (Redis already provisioned via
      `@app/cached` env) — WITHOUT this, multi-instance gateway breaks WS rooms/
      emits silently; (b) then scale gateway via pm2 `instances:'max'` cluster mode
      (HTTP is stateless — JWT cookie, no in-memory session) or N fork instances
      behind an nginx `upstream` + `least_conn`. WS needs sticky sessions
      (`ip_hash`) OR polling disabled (`transports:['websocket']` on FE) when going
      multi-instance. TCP-only services (orders/product/user…) can also multiply —
      NestJS TCP clients reconnect per instance — but gateway first.
- [ ] **SCALE-02 — DB pools default to 10 connections/service (ops tuning only;
      code now env-driven).** MySQL `connectionLimit` is now
      `Number(MYSQL_POOL_SIZE) || 10` across ALL 6 Node A MySQL pools
      (`libs/database/src/database.module.ts` for user/product + the inline
      TypeORM configs in orders/social/notification/chat), PG `max:10`
      (`postgres-database.module.ts:23`, `PG_POOL_SIZE` env already existed). The
      earlier hardcode was removed 2026-07-16; the dead `libs/common` raw
      `mysql/` + `postgres/` pool wrappers (the only other `MYSQL_POOL_SIZE`
      reader, never wired in) were deleted at the same time. Remaining work is
      OPS, not code: set `MYSQL_POOL_SIZE`/`PG_POOL_SIZE` (30–50 prod) and raise
      per Aiven plan — CHECK the Aiven plan's max_connections first; total = pool
      × service count × pm2 instances, so cluster mode (SCALE-01) multiplies pool
      consumption.
- [ ] **SCALE-03 — nginx does zero load absorption.** `nginx/trybuy.conf` has
      no `limit_req`/`limit_conn` (L7 floods reach Node), no `gzip`, no upstream
      `keepalive` (new conn per proxied request), no `proxy_cache`. Fix: `limit_req`
      zone per IP (burst tuned above FE's normal fan-out), `gzip on` for JSON,
      `keepalive 32` in the upstream block, and a 1–5s micro-cache
      (`proxy_cache` + `proxy_cache_lock on` = stampede guard) for public GETs
      (product list/detail, brands, categories) — absorbs most read bursts before
      Node sees them. Nginx owning gzip means no Node `compression` middleware
      needed.
- [ ] **SCALE-04 — hot public product detail reads still uncached in-app.**
      Brand/category lookup caching closed the PERF-09 overlap on 2026-07-09.
      Remaining concurrency question: consider product detail cache-aside (short TTL)
      if SCALE-03 micro-cache is not adopted.
- [ ] **SCALE-05 — overload failure modes untuned.** (a) `timeout(10000)` on
      every TCP call is too long under saturation — one slow service parks
      requests+sockets for 10s and the pileup cascades; drop read paths to 3–5s
      (keep 10s for checkout/payment writes). (b) Rate-limit guard does Redis
      INCR(+EXPIRE) on EVERY request and is fail-closed in prod → single Redis is
      a shared choke/kill switch; verify Redis maxclients/latency under load,
      consider skipping the guard for `@Public` cacheable GETs once nginx
      `limit_req` (SCALE-03) owns L7 flood control. (c) No backpressure signal:
      add a cheap `503` guard (event-loop-delay or in-flight counter) so the
      gateway sheds load instead of timing out everything at once.
- [ ] **SCALE-06 — no load-test evidence.** Nothing in the repo proves ANY
      concurrency number. Add a k6 (or autocannon) script under `scripts/load/`
      covering: anonymous product list/detail (cache path), logged-in cart+order
      read, checkout write path; run at 500 → 1k → 5k VU against a prod-like build
      (`npm run build` + pm2, NOT `nest --watch`). Record p95/p99 + error% in the
      script header; re-run after each SCALE item to attribute gains. Gate: declare
      "handles N concurrent" only from these numbers, never from code reading.

**Recommended order:** SCALE-01a (redis-adapter) → SCALE-06 baseline → SCALE-02
→ SCALE-01b (cluster) → SCALE-03 → SCALE-04 → SCALE-05, re-running the k6
baseline between steps. **Cost note:** all items are config/infra-level on the
existing single-VPS+Aiven+Redis stack — no new paid services required; true
10k concurrent sustained likely also needs a bigger VPS/Aiven tier, which the
SCALE-06 numbers will prove or disprove.

### 📦 Dependency maintenance backlog

- [ ] **DEP-01 — Triage the current npm audit report.** The AI-02 dependency
      install reported 27 total findings (1 low, 14 moderate, 10 high, 2
      critical) across the repository dependency tree; this is not evidence
      that AI-02 introduced all of them. Run `npm audit`, map each finding to
      direct vs transitive/runtime vs dev-only exposure, apply safe compatible
      upgrades first, and validate lint/typecheck/Jest/full build. Do not run
      `npm audit fix --force` without reviewing each breaking upgrade.

## Known Issues

- Array query params on the gateway (discovered in PERF-10 verification, 2026-07-03): Express runs the **simple** query parser, so bracket syntax `?categoryIds[]=18` arrives as literal key `"categoryIds[]"` and the global `ValidationPipe({whitelist:true})` silently strips it → 200 UNFILTERED, no error. Supported syntaxes: repeated keys `?categoryIds=16&categoryIds=18` or a single `?categoryIds=18` (scalar→array `@Transform` added to `GetProductsQueryDto`). The storefront FE has been sending singular `categoryId`/`brandId` (never matched the DTO) — marketplace filter was a silent NO-OP; FE handoff entry written 2026-07-03 (`../.agent-local/frontend-handoff.md`). Any future array-typed query DTO field needs the same guard-and-wrap `@Transform`.
- GHN free-text address resolution is best-effort: a garbage/placeholder address (e.g. `District 1 | Ward 1`) can resolve to a wrong-but-valid GHN location instead of failing, because short numeric master-data names match many free-text parts via containment. Real well-formed VN addresses resolve correctly. Durable fix is collecting GHN numeric IDs at checkout rather than resolving free-text at ship time. (Truly unresolvable addresses now correctly return 400, not 502 — see the ready-to-ship ops note below.)
- nodeB services (inventory/payments/rewards) used to silently crash after an idle period (e.g. machine sleep / broker restart): `RmqModule.registerDirectPublisher()` opened a raw amqplib connection+channel with NO `'error'`/`'close'` listeners, so an idle connection drop was thrown as an uncaught exception and killed the process (the `nest --watch` wrapper survived, masking it). FIXED 2026-06-26: the publisher now attaches error/close handlers, uses a `?heartbeat=30` URI, connects in the background (never blocks bootstrap), and auto-reconnects via a self-healing Proxy. If a nodeB service is ever found down, check whether its compiled `dist/apps/<svc>/main` process is actually running — `--watch` does NOT auto-restart a runtime crash.
- Login route is `POST /api/user/login` (sets the HttpOnly `access_token` cookie). (The CLAUDE.md self-test protocol text was corrected to match on 2026-06-28.)
- **Stale doc (perf-audit 2026-07-02): `ai-docs/agent-context/database.md` index/entity info is partially out of date** vs current entities (e.g. orders entities have no indexes at all; inventory/social uniques exist that the doc doesn't reflect). Cross-check entities directly when planning index migrations.

## Ops / Runtime Reference

- PDF invoice (2026-07-15, NO migration): `GET /api/order/:id/invoice` returns a
  production-ready A4 PDF. Access = buyer OR order's seller OR admin (else 403;
  role read from `req.user.role`, threaded to orders TCP as `requestingUserRole`).
  Vietnamese glyphs require the bundled **Roboto** TTFs at
  `apps/orders/src/invoice/fonts/*.ttf` — webpack copies them to
  `dist/apps/orders/invoice/fonts/` via the orders `assets` entry in
  `nest-cli.json`; if a build ever drops them the generator falls back and
  Vietnamese renders blank, so keep that assets rule. Money breakdown, seller/
  buyer blocks, ship-to (parsed from pipe-delimited `shippingAddress`), invoice
  number `INV-YYYYMM-<6-digit orderId>`, and vi-VN/`Asia/Ho_Chi_Minh` dates all
  come from `apps/orders/src/invoice/invoice.generator.ts`. VAT/tax line
  intentionally NOT rendered (shops self-handle VAT). No DB fields for company
  MST/tax id exist — adding a legal seller MST block later needs a migration + FE.
- Forgot-password (2026-07-11, NO migration): `POST /api/user/forgot-password` (`@Public`, rate-limit 5/60s, `{email}` → always generic 201) and `POST /api/user/reset-password` (`@Public`, 10/60s, `{email, code, newPassword}` → `{success:true}` or 400 "Invalid or expired verification code"). User service TCP `{cmd: user.forgot_password|user.reset_password}`. Code: 6-digit crypto `randomInt`, stored PLAINTEXT in Redis `user:pwreset:code:<userId>` (TTL 600s — plaintext is deliberate: short TTL + attempt cap, and enables self-testing via `docker exec redis redis-cli GET user:pwreset:code:<id>`); attempts counter `user:pwreset:attempts:<userId>` (max 5, then code invalidated); resend cooldown `user:pwreset:cooldown:<userId>` (60s via setNx). Email via dependency-free `MailerService` (`libs/common/src/mailer/`, implicit-TLS SMTPS only, e.g. Gmail :465 app password; env `SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM` — keys in `local/nodeA/.env.example` only; the real `.env` is write-denied to agents, so the user must add SMTP\_\* manually for real delivery). SMTP unconfigured → dev fallback: user service logs the code, endpoint still returns the generic 201.
- Order email notifications (F7, 2026-07-12, NO migration): the notification service mirrors order in-app notifications to email, best-effort. Handlers covered: `order_created` (NEW consumer — notification queue was already bound to the orders fanout; recipient = buyer), `payment_completed` (buyer), `order_canceled` (buyer), `order.return_requested` (seller), `order.return_approved`/`order.return_rejected` (buyer). Flow: after `saveNotification`, `NotificationService.emailUser(userId, subject, text)` resolves the address via user TCP `{cmd: user.get_user_info}` `{userId, includeEmail:true}` then `MailerService.sendMail` (shared `libs/common/src/mailer/`, SMTPS). `emailUser` NEVER throws — any TCP/mail failure logs a warn and the RMQ ack/nack outcome is unchanged. SMTP\_\* unset (current dev state) → MailerService logs the mail and returns false. Requires `SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM` in the notification service env (`local/nodeA/.env`) for real delivery. Side effect for FE: a new `order_created` notification row/WS push now exists (was previously only `payment_completed`).
- GHN env (local/nodeA/.env): `GHN_API_URL=https://dev-online-gateway.ghn.vn/shiip/public-api`, `GHN_API_TOKEN`, `GHN_SHOP_ID=200481`; `GHN_WEBHOOK_SECRET` required on the gateway webhook (`x-ghn-webhook-token` preferred; `?token=` still accepted but logs a deprecation warn — SEC-M1 2026-07-11). Webhook body known fields runtime-validated (`GhnWebhookDto`, extra GHN fields tolerated); explicit rate limit 300/60s.
- GHN webhook is served at BOTH `POST /ghn/webhook` (legacy) AND `POST /api/ghn/webhook` (prefix-consistent) — same handler, both excluded from the global `api` prefix (`main.ts` exclude list + `GhnWebhookController` `@Post(["ghn/webhook","api/ghn/webhook"])`). A GHN dashboard configured with either URL works; no more silent 404 if `/api` is included. Body accepts PascalCase (`OrderCode`/`Status`, real GHN) or snake_case (`order_code`/`status`, manual tests).
- GHN shipping_address: pipe-delimited `name|phone|addr|ward|district|province`; failure non-fatal (order saved with ghn_order_code=null).
- GHN address resolution (`apps/orders/src/ghn/ghn.service.ts`): the free-text ward/district/province are resolved to GHN numeric `to_district_id` + string `to_ward_code` at waybill-create time via master-data (`GET /master-data/province|district|ward`, 24h TTL cache) using `normalizeAddressPart` (NFD diacritic strip, đ→d, drops VN admin prefixes, alnum-only) + `rankMasterDataMatches` (exact-normalized first, then containment by closest length). The resolver walks ALL ranked province→district→ward candidates and falls through stub entries — required because the GHN dev sandbox has polluted duplicate provinces (e.g. "Hà Nội 02" ProvinceID 2002 with 0 districts shares the "hanoi" alias with the real Hà Nội 201). Unresolvable address → `BadRequestException` (400).
- ready-to-ship gating: `PATCH /api/order/:id/ready-to-ship` (seller, CONFIRMED→PROCESSING) now creates the GHN waybill BEFORE advancing and persists `ghnOrderCode`. If GHN create fails (400 unresolvable address / 500 GHN unreachable) the error propagates and the order stays at CONFIRMED — never PROCESSING without a waybill. (Replaces the old log-and-silently-advance behavior that left `ghnOrderCode` null.)
- COD: handled via GHN cod_amount; payments service guard skips COD orders (no payment row).
- GHN→local status map (`mapGhnStatus`, used by webhook + manual sync): `picking|picked`→SHIPPED, `delivering`→DELIVERING, `delivered`→COMPLETED (+stock consume/COD payment_completed), `cancel` + any `*return*`→CANCELED (+release reserved stock + `ORDER_CANCELED_EVENT`, no cancel pushed back to GHN). Forward-only by rank; terminal orders (canceled/completed) untouched.
- GHN admin actions (manual cancel/return): `POST /api/order/admin/ghn/orders/:id/cancel` and `:id/return` (`@CheckPermission("shipping","update:any")`, TCP `order.admin_ghn_cancel`/`order.admin_ghn_return`). Both call GHN `POST /v2/switch-status/{cancel|return}` (identical shape `{order_codes:[code]}`→`{data:[{order_code,result,message}]}`) and resolve the local order to CANCELED via `applyAdminGhnAction` (reuses `finalizeGhnCancellation` = release stock + emit `ORDER_CANCELED_EVENT`). GHN rejection → re-throw (gateway 4xx/5xx) + a `success:false` ACTION `shipping_history` row, **local order untouched**. Allowed by the `getAvailableShippingActions` matrix: `cancel` for CONFIRMED/PROCESSING/SHIPPED, `return` for SHIPPED/DELIVERING — both only with a non-null `ghnOrderCode` on a non-terminal order; otherwise 400. No migration (`ShippingHistoryType.ACTION` already existed).
- GHN admin actions (B2, update COD / receiver): `POST /api/order/admin/ghn/orders/:id/update-cod` (`{codAmount:number}`, ≥0; 0 clears COD) and `:id/update-receiver` (`{toName?,toPhone?,toAddress?}`, ≥1 required else 400). Both `@CheckPermission("shipping","update:any")`, TCP `order.admin_ghn_update_cod`/`order.admin_ghn_update_receiver`. update-cod → GHN `POST /v2/shipping-order/updateCOD` (`{order_code,cod_amount}`); update-receiver → GHN `POST /v2/shipping-order/update` (`{order_code,to_name?,to_phone?,to_address?}`). On success: persist locally (`order.codAmount` / rewrite the `name|phone|addr` head of the pipe-delimited `shippingAddress`, preserving ward|district|province) + a `success:true` ACTION `shipping_history` row; on GHN reject: re-throw + `success:false` row, **local order untouched**. Editable window enforced by `getAvailableShippingActions`: `update_cod`/`update_receiver` only for CONFIRMED/PROCESSING with a non-null `ghnOrderCode` (in-transit edits are GHN's call); else 400. No migration. Runtime-verified 2026-06-28 on order 62 (7/7 self-tests).
- GHN shop-callable action surface (established by a live dev-API probe, not guessed): `cancel`, `return`, `storing`, `updateCOD`, `update` (receiver) are shop-callable; `delivered`/`deliver`/`delivering` return 400 "không tìm thấy permission command" → **delivery-again cannot be triggered by the shop** (GHN drives redelivery internally after a failed attempt) and was dropped from Phase 2. `storing` remains available if a future need arises.
- GHN demo-status endpoint (DEMO ONLY): `POST /api/order/admin/ghn/orders/:id/demo-status` (`@CheckPermission("shipping","update:any")`, TCP `order.admin_ghn_demo_status`) simulates a GHN status WITHOUT calling real GHN and drives the local lifecycle through the same `mapGhnStatus`/`applyGhnStatus` path as real sync (writes a MANUAL_SYNC `shipping_history` row with `action:"demo_status"`, returns the sync shape `{orderId,previousStatus,newStatus,ghnStatus,syncedAt}`). Body `{ghnStatus}` ∈ `ready_to_pick|picking|delivering|delivered|delivery_fail|waiting_to_return|returned|cancelled`. **Gated behind env `GHN_DEMO_ENDPOINTS_ENABLED`** — unless set to `"true"` it returns `403 "GHN demo status endpoint is disabled"` (inert in prod; must be ABSENT/false in production). No migration. Lets the GHN console demo `picking→delivering→delivered` on a sandbox order GHN never advances. **Detail override (fixed 2026-06-30):** when demo mode is ON and the latest `shipping_history` row is a `demo_status`, `GET /api/order/admin/ghn/orders/:id` surfaces that demo status as `ghnDetail.status` (overlaying the still-fetched live detail so receiver/COD fields stay real, or synthesizing a minimal detail if the live fetch failed) — so the console GHN badge advances exactly as a real webhook would, instead of staying stuck at the sandbox's `ready_to_pick`. Outside demo mode, live GHN `getOrderDetail.status` wins unchanged.
- Stale-reservation sweeper (orders): hourly `@Cron` cancels orders in PENDING/CONFIRMED/PROCESSING with `ghn_order_code` null older than `ORDER_STALE_RESERVATION_TTL_HOURS` (default 24h, set in `local/nodeA/.env`), reusing the idempotent cancel flow to release stock. Orders with a GHN code are never swept (driven by the delivery webhook).
- payment_methods table: `is_active` controls active options; `PAYMENT_GATEWAY` env is fully unused (strategy chosen per-request from `paymentMethod`).
- Low-stock endpoint (unused-API sweep, 2026-07-06): `GET /api/inventory/low-stock` — `@Roles("shop","admin")`. Admin → all low-stock rows; shop → auto-scoped server-side (gateway first fetches the seller's productIds via `PRODUCT_MESSAGE_PATTERNS.GET_PRODUCT_IDS_BY_SELLER`, empty → `[]` without hitting inventory). Returns `Inventory[]` (max 100, `availableStock ASC`, `isActive` only; bigint ids serialize as strings). Since 2026-07-10 each row also carries a denormalized `productName: string | null` (gateway batch `PRODUCT_FIND_BY_IDS` enrichment, best-effort — null for deleted products or on product-service failure). Remaining HTTP inventory surface: `POST /api/inventory`, `GET /api/inventory/product/:productId` (`@Public`), `PUT /api/inventory/:id` — list/sku/by-id/delete/check-stock/reserve/release HTTP routes were removed (internal TCP paths unchanged).
- CORS: one shared gateway delegate `apps/gateway/src/common/cors.ts` (`gatewayCorsOptions`) used by HTTP (`main.ts` `enableCors`) + both WS gateways (`/chat`, `/notifications`). Allows: no-Origin requests, any origin in `FRONTEND_URL` (comma-split), and — only when `NODE_ENV !== "production"` — any `localhost`/`127.0.0.1` origin on any port. Prod is strict (localhost bypass off) → every allowed web origin MUST be in `FRONTEND_URL`. Sockets live on the gateway origin/port (3000), namespaces `/chat`+`/notifications`, connect `withCredentials:true`.
- Cloudinary: client uploads direct; server signs via `POST /api/upload/signature`; allowed folders are `trybuy/products`, `trybuy/posts`, and existing storefront avatar folder `avatars`. Upload `publicId` must be a basename matching `${userId}_...` (server generates one if omitted); delete `public_id` must be full `<allowed-folder>/${userId}_...` unless caller role is admin. Invalid folder/path → 400; foreign prefix → 403 before Cloudinary is called. Delete ownership enforcement runtime-verified 2026-07-08 (user 17 deleting a `18_` leaf → 403; disallowed folder → 400; no-folder public_id → 400; unauth → 401; all reject inside `generateDeleteSignature` before any Cloudinary destroy). Orphan cleanup of dropped media on entity update is now server-side (SEC-M7, 2026-07-11 — `CloudinaryService.destroyAssets` in `libs/common/src/cloudinary/`, wired into social/product/user mutations post-commit; needs `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` in the service env or it logs a warn and no-ops). Upload signatures now sign `allowed_formats` (SEC-M8): products/avatars `jpg,png,webp`, posts `jpg,png,webp,mp4`; FE must forward that returned field to Cloudinary with the signature. Upload folders switch by `NODE_ENV` (2026-07-15) so ONE shared Cloudinary account separates prod from dev media: `NODE_ENV==="production"` → `trybuy-prod/products` + `trybuy-prod/posts`; any other env (dev/test) → `trybuy/products` + `trybuy/posts`. Avatars always stay in the shared legacy `avatars` folder. Prefix derived in `getCloudinaryFolderPrefix()` (`libs/common/src/cloudinary/cloudinary.constants.ts`) — no Cloudinary folder env var to set (prod already sets `NODE_ENV=production` via `.env` + pm2 `env_production`). DTO validators + the FE still use the STABLE LOGICAL folders (`trybuy/products`, `trybuy/posts`, `avatars`); the server resolves logical→physical at runtime (`resolvePhysicalUploadFolder`) for signing, delete-allowlist, orphan-destroy, and delivery-URL validation. FE contract unchanged (server-authoritative folder is returned in the signature response and echoed into the Cloudinary upload form) — no FE change needed.
- Deploy runtime: host PM2 runs compiled NestJS apps from `ecosystem.config.js`; Docker Compose runs Redis/RabbitMQ only (`docker compose up -d redis rabbitmq`); MySQL/PostgreSQL are external Aiven services; internal TCP/payments callback listeners bind to `127.0.0.1` (chat's hardcoded `0.0.0.0` and product's stray HTTP bind on 3106 fixed 2026-07-18); gateway bind host is `GATEWAY_HOST` env, default `0.0.0.0` for dev — **set `GATEWAY_HOST=127.0.0.1` in the VPS env** so only Nginx is public; production Nginx exposes the gateway on `127.0.0.1:3000` only (including `/zalopay/callback` and `/vnpay/callback` facades); VPS firewall/security group must expose only 80/443 publicly; set the real domain in `nginx/trybuy.conf`.
- CI: `.github/workflows/ci.yml` validates PRs and pushes to `main` only; it runs npm install/lint/typecheck/Jest/build/PM2 syntax/Compose config/whitespace checks with safe dummy env values. It does not deploy, publish Docker images, connect to Aiven, run migrations, or require repository secrets.
- Database migration cutoff (2026-07-17): all schema work through PUBID-07 is
  squashed into `database/prod-baseline-20260717/`. Standalone historical
  `database/*.sql` and app-local migration files referenced by older notes
  below were retired and must not be replayed. Empty databases use the Node
  A/Node B baseline files; later changes use only post-cutoff manifest
  migrations. Existing historical `schema_migrations` rows are classified as
  `baseline-absorbed`.
- Applied migrations (P1-03, social DB, `synchronize:false`): `database/add_product_id_to_posts.sql` (`posts.product_id INT NULL`) and `database/create_post_reports_table.sql` (`post_reports` table) — both applied to Aiven on 2026-06-25. Re-run on any fresh DB before the post-edit / report endpoints work.
- Applied migration (P1-06, chat read-tracking, `synchronize:false`): `database/add_read_tracking_to_conversations.sql` (`conversations.user1_last_read_at` / `user2_last_read_at` DATETIME NULL) — applied to Aiven on 2026-06-26. Re-run on any fresh DB before `unreadCount` / mark-read work.
- Applied migration (P2-02, order snapshot, `synchronize:false`): `database/add_snapshot_columns_to_order_items.sql` (`order_items.product_image` VARCHAR(2048) NULL, `order_items.sku_label` VARCHAR(512) NULL) — applied to Aiven on 2026-06-26. Re-run on any fresh DB before order-snapshot rendering works.
- Applied migration (F1 product reviews, `synchronize:false`): `database/create_product_reviews_table.sql` (`product_reviews` table: `product_id`, `user_id`, `rating` TINYINT 1–5, `comment`, unique `(product_id,user_id)`) — already present on Aiven (confirmed live 2026-06-30: GET/POST/DELETE review endpoints all work). Re-run on any fresh DB before review endpoints work. `product.rating`/`ratingCount` (already on `products`) are recalculated by the product service on every review create/delete. Note: `product-review.entity.ts` declares `product_id` as `int` while the migration + `products.id` are `bigint` — harmless for current id ranges, latent inconsistency.
- Applied migration (F6 wishlist/favorites): `database/create_wishlist_items_table.sql` — creates `wishlist_items` (`user_id`, `product_id`, unique `(user_id, product_id)`, indexes for user-created ordering and product cleanup, FK to `products(id)` with cascade delete). Product service runs TypeORM sync in dev, but the SQL is enabled in `database/migrations.manifest.json` for production deploy/fresh reviewed Node A schemas. Re-run before wishlist endpoints work on a DB without sync.
- Applied schema (AI-02 product risk, 2026-07-13): current Aiven Node A has `products.image_phashes`, indexed `risk_score`, and `risk_flags` (confirmed by live admin list/rescore after the product dev-sync boot). Guarded deploy migration `database/add_risk_columns_to_products.sql` is enabled as `nodeA-20260713-001-add-product-risk-columns` for production/fresh reviewed schemas; the runtime sync does not create a `schema_migrations` record, so the guarded migration remains safe to run through the manifest later.
- Applied migration (GHN Web Step 2 shipping roles, `synchronize:false`): `database/add_shipping_roles.sql` — extends `roles.rol_name` enum with `logistics_operator`/`shipping_manager`, adds the `shipping` resource (res_id=7 on Aiven), seeds both role rows (rol_id 4/5). Applied to Aiven on 2026-06-27. Authorization is driven by `apps/user/src/rbac/grants.ts` (`ac`), not the DB `rol_grants` JSON. Re-run on any fresh DB before the shipping roles resolve.
- Applied migration (F2 buyer return/refund): `database/create_order_return_requests_table.sql` — extends `orders.status` enum with `return_requested`/`refunded` and creates the `order_return_requests` table (`order_id`, `user_id`, `reason`, `status` enum `pending_review|approved|rejected`, `reject_reason`, `previous_order_status`, `refund_amount`, `refund_method`, `refund_status`, `reviewed_by`, timestamps + idx on order/user/status). NOTE: the orders service runs TypeORM `synchronize:true`, so on a normal restart the new entity/enum auto-sync and the table already exists (confirmed live 2026-06-30 — return-request inserts succeeded). The SQL file is for fresh/`synchronize:false` DBs; run it before the return endpoints work there. Refund is **recorded only** (no real payment-gateway call): online methods (vnpay/zalopay) set `refund_status=refunded`, COD sets `manual_pending`. On approve, reserved stock is released and a GHN return is attempted best-effort (failure non-fatal).
- Applied migration (F3 vouchers): `database/create_vouchers_table.sql` — creates `vouchers` (`code` UNIQUE, `discount_type` enum `percent|fixed`, `discount_value`, `min_order_amount`, `max_discount_amount`, `usage_limit`, `used_count`, `per_user_limit`, `starts_at`, `expires_at`, `is_active`) + `voucher_redemptions` (`voucher_id`, `user_id`, `order_id`, `discount_amount`, UNIQUE `(voucher_id,order_id)`, idx `(voucher_id,user_id)`) and ALTERs `orders` to add `voucher_code` VARCHAR(64) NULL + `discount_amount` DECIMAL(12,2) NULL. NOTE: orders runs TypeORM `synchronize:true`, so a normal restart auto-creates the tables/columns (confirmed live 2026-06-30 — voucher create + checkout-apply succeeded; orders 113). The SQL file is for fresh/`synchronize:false` DBs. Usage cap is enforced atomically via a conditional `used_count = used_count + 1 WHERE id=? AND (usage_limit IS NULL OR used_count < usage_limit)` UPDATE inside the order-create tx; per-user limit via a `voucher_redemptions` count. Codes are normalized to UPPERCASE on create/lookup. Vouchers are single-seller only (multi-seller checkout rejects with 400).
- Checkout addressing (2026-07-01): GHN master-data proxy `GET /api/shipping/{provinces,districts?provinceId=,wards?districtId=}` (gateway `ShippingModule` → orders TCP `order.shipping_{provinces,districts,wards}` → `GhnService.list*`, reuses the existing 24h master-data cache; `JwtAuthGuard`; each item `{id,name}` where `id` is the GHN code — ProvinceID/DistrictID number, WardCode string; missing/invalid query param → 400; FE never sees the GHN token). Per-user address book `GET/POST /api/user/me/addresses`, `PATCH /api/user/me/addresses/:id`, `PATCH .../:id/default`, `DELETE .../:id` (all `JwtAuthGuard`, scoped to `req.user.id`; USER TCP `user.address_{list,create,update,delete,set_default}`, `{cmd:…}` wrapper). Single-default invariant enforced in a tx: first address forced default, `isDefault:true` demotes others, deleting the default auto-promotes the newest remaining; not-owned/unknown id → 404. `Order` money fields (`total`/`codAmount`/`shippingFee`/`discountAmount`) now serialize as JSON **numbers** via the `decimalToNumber` transformer, so the `GET /api/order/:id` fee matches the `POST /api/order/shipping-fee` preview.
- Applied migration (user address book): `database/create_user_addresses_table.sql` — `user_addresses` (recipient_name/phone/address_line + province_id/province_name/district_id/district_name/ward_code/ward_name + is_default TINYINT, idx on user_id). User service runs TypeORM `synchronize:true`, so the table auto-created on restart (confirmed live on Aiven: `user_addresses` present). SQL file is for fresh/`synchronize:false` DBs.
- Analytics (F4, 2026-07-01, NO migration — read-only aggregation): gateway `GET /api/order/seller/analytics` (JwtAuthGuard, self-scoped to `req.user.id`) and `GET /api/order/admin/analytics` (`@CheckPermission("shipping","read:any")`, global) → orders TCP `order.analytics` (`ORDER_MESSAGE_PATTERN.ANALYTICS`, bare-string pattern) → `OrdersService.getAnalytics({sellerId, from?, to?, interval?, topN?})`. `sellerId:number` → seller scope (filters `order.sellerId`/`oi.sellerId`, valid because orders are single-seller); `sellerId:null` → global. Query: `from`/`to` ISO dates (validated `@IsDateString`; service snaps `from`→start-of-day, `to`→end-of-day inclusive; default = last 30 days; invalid or from>to → 400), `interval` `day|month` (default `day`, MySQL `DATE_FORMAT` group), `topN` 1–50 (default 5). Response `{scope, from, to, interval, summary{totalRevenue,completedOrders,totalOrders,averageOrderValue}, revenueOverTime[{period,revenue,orderCount}], statusDistribution(zero-filled all OrderStatus), topProducts[{productId,productName,quantitySold,revenue}]}`. **Revenue = goods GMV** = `SUM(oi.price*oi.quantity)` over COMPLETED orders only (excludes shipping fee + voucher discount; consistent with topProducts revenue), rounded to integer VND. `statusDistribution`/`totalOrders` count ALL orders in the window regardless of status. New gateway route ordering: `seller/analytics` + `admin/analytics` declared BEFORE `seller/:id`. Runtime-verified 2026-07-01: seller scope 200 (techstore_demo, 6 orders zero-filled), global 200 (10 completed, revenue 1,224,843, monthly series + top 3), invalid-date/from>to 400, shop→admin 403, unauth 401.
- Post moderation (F5, 2026-07-02): admin-only review/resolve flow over the existing `POST /social/posts/:id/report`. New RBAC resource `post` (admin `read:any`/`update:any`/`delete:any`) added to `apps/user/src/rbac/grants.ts` — **no DB grant migration** (grants are in-memory, imported by the gateway `RoleAuthGuard`). Gateway `SocialAdminController` (`@Controller("social/admin")`): `GET reports?status=pending|resolved|dismissed&page=&limit=` (`post read:any`) → PaginatedResponse grouped by post `{post{…,isHidden,hiddenAt,author{id,username,avatar}},reportCount,pendingCount,latestReportedAt,reports[{id,reporterId,reason,status,createdAt}]}` ordered by most-recent report, `total`=distinct reported posts; `POST posts/:id/hide` (`update:any`) hides + flips `pending` reports→`resolved` (stamps `resolvedBy`/`resolvedAt`); `POST posts/:id/unhide`; `POST posts/:id/dismiss` marks `pending`→`dismissed`, post stays visible, returns `{postId,dismissed:n}`; `DELETE posts/:id` (`delete:any`) tx-removes post + its report rows. TCP `social_admin_{list_reported_posts,hide_post,unhide_post,dismiss_reports,delete_post}` (bare-string patterns). **Feed impact:** hidden posts excluded from `GET /social/posts`, `/social/posts/user/:userId`, and the following-feed; `GET /social/posts/:id` → 404 when hidden. Any action on a missing post → 404. Runtime-verified 2026-07-02 (10/10 self-tests: create→report→list(pending)→hide→404+resolved→unhide→200→re-report→dismiss→delete→404; non-admin→403).
- Applied migration (F5 post moderation, social runs `synchronize:false` so REQUIRED): `database/add_moderation_to_social.sql` — ALTERs `post_reports` add `status` ENUM('pending','resolved','dismissed') DEFAULT 'pending' + `resolved_by` INT NULL + `resolved_at` TIMESTAMP NULL + idx `idx_post_reports_status`; ALTERs `posts` add `is_hidden` TINYINT(1) DEFAULT 0 + `hidden_at` TIMESTAMP NULL. Applied to Aiven 2026-07-02 (idempotent script, existence-guarded). Re-run on any fresh DB before the moderation endpoints work — unlike the orders service, social will NOT auto-create these columns.
- Applied migration (PERF-05 social indexes, social runs `synchronize:false`): `database/add_social_performance_indexes.sql` — adds `idx_comments_post_id_created_at (post_id, created_at)`, `idx_posts_visible_created_at (is_hidden, created_at)`, and `idx_posts_user_visible_created_at (user_id, is_hidden, created_at)` with `ALGORITHM=INPLACE, LOCK=NONE`. Applied to Aiven Node A on 2026-07-07 via `nodeA-20260707-002-add-social-performance-indexes`.
- Applied migration (PERF-06 chat/payments indexes): `database/add_chat_message_performance_indexes.sql` adds `idx_messages_conversation_created_at (conversation_id, created_at)` on Node A MySQL; `database/add_payments_order_id_index.sql` adds `idx_payments_order_id (order_id) WHERE order_id IS NOT NULL` on Node B PostgreSQL; `database/add_payments_app_trans_id_index.sql` adds `idx_payments_app_trans_id (app_trans_id) WHERE app_trans_id IS NOT NULL` on Node B PostgreSQL. Applied to Aiven on 2026-07-07 via scoped `--only` applies: `nodeA-20260707-003-add-chat-message-performance-indexes`, `nodeB-20260707-001-add-payments-order-id-index`, and `nodeB-20260707-002-add-payments-app-trans-id-index`.
- Applied migration (social-notification metadata, notification runs `synchronize:false` so REQUIRED): `database/add_social_notification_metadata.sql` — widens `notifications.order_id` INT→BIGINT NULL and ADDs `post_id` INT NULL + `actor_id` INT NULL + `preview` VARCHAR(255) NULL (idempotent, INFORMATION_SCHEMA-guarded). Applied to Aiven 2026-07-06. **REQUIRED once this code deploys** — the `Notification` entity now declares those 3 columns, so with `synchronize:false` every `saveNotification` INSERT (ALL notification types, not just comment/reply) fails with "Unknown column" until the table has them. Comment→post-owner and reply→comment-owner notifications now persist `type:"comment"|"reply"`, `orderId:null`, `postId`, `actorId`, `preview` (first 255 chars; WS push + `GET /api/notifications` carry the same fields); FE can deep-link `/post/:id` and render "X commented: <preview>". Re-run on any fresh DB.

## History

Finished milestones, completed tasks, and the resolved 2026-06-19 audit live in
`CHANGELOG.md` (same folder, not auto-loaded). Read it only when you need the
history or rationale behind a past change.
