# CHANGELOG — TryBuy Backend

> Historical record of completed work. **NOT auto-loaded** by any agent entry point.
> Read on demand only when you need the history/rationale of a past change.
> Current state (overview, active tasks, known issues) lives in `snapshot.md`.

## Completed Milestones

- PDF invoice production-readiness rewrite (2026-07-15, backend-handoff): the
  `GET /api/order/:id/invoice` PDF was unusable in production — Helvetica has zero
  Vietnamese glyph coverage (every diacritic rendered blank/□), it showed only a
  raw total with no money breakdown, no seller block, no ship-to address, no
  invoice number, English/UTC dates, and no SKU labels; access was buyer-only so
  sellers/admin/support could not pull a customer's invoice. Fixed 9 of the 10
  audited gaps (VAT/tax #5 intentionally skipped — shops self-handle VAT or bake
  it into the product price). `apps/orders/src/invoice/invoice.generator.ts`
  rewritten: signature now `generateInvoicePdf(data: InvoiceData)` where
  `InvoiceData = {order, buyer, seller}` (typed `InvoiceParty`/`InvoiceLineItem`/
  `InvoiceOrder` interfaces). Embeds **Roboto** (Apache-2.0, `Roboto-Regular.ttf` +
  `Roboto-Bold.ttf` under `apps/orders/src/invoice/fonts/`) via `doc.registerFont`
  for full Vietnamese coverage; `resolveFontPath` probes dev-src, dist, and
  `process.cwd()` candidates so it works under both `nest --watch` and compiled
  prod. `nest-cli.json` orders project gained `"assets":[{"include":
"invoice/fonts/*.ttf"}]` so webpack copies the TTFs to
  `dist/apps/orders/invoice/fonts/`. Renders: header + invoice number
  (`buildInvoiceNumber` → `INV-YYYYMM-000108`), vi-VN date in `Asia/Ho_Chi_Minh`
  (`Intl.DateTimeFormat`), two-column Người bán / Khách hàng (name + email),
  Giao đến ship-to parsed from the pipe-delimited `shippingAddress`
  (`name|phone|addr|ward|district|province`), order info + `PAYMENT_METHOD_LABELS`
  (cod/vnpay/zalopay), a Chi tiết sản phẩm table with per-item SKU sub-line and a
  page-break guard, then a Tạm tính / Phí vận chuyển / Giảm giá(code) / Tổng cộng /
  Thu hộ(COD) breakdown (`formatVnd` = `Intl.NumberFormat("vi-VN")`,
  discount/COD lines omitted when absent). A4 page size + `bufferPages` page
  numbers (`Trang n/m`) — fixed a phantom blank page caused by default Letter
  height. Backend plumbing: `orders.service.generateInvoice` now fetches buyer +
  seller parties (`fetchInvoiceParty` via `GET_USER_INFO` with `includeEmail`) and
  enforces `isOwner || isSeller || isAdmin` (else `ForbiddenException`);
  `requestingUserRole` threaded through the orders controller, gateway
  `getOrderInvoice`, and the gateway route (`req.user?.role`). Validation:
  Prettier/ESLint clean, `tsc --noEmit` zero errors on orders + gateway,
  `nest build orders` green, fonts confirmed in dist. Self-test 4/4 against the
  live stack: admin (non-owner) → 200 `application/pdf`; non-owner user → 403;
  Vietnamese + full breakdown rendered on both a synthetic order and live order
  #119; single page. No migration.

- Order response explicit `shippingFee` + `subtotal` (2026-07-14, /sweep,
  backend-handoff): the FE OrderDetailPage price-breakdown footer ("Tạm tính /
  Phí vận chuyển / Giảm giá / Tổng cộng") could not be rendered exactly because
  order responses carried only the net `total` (shipping folded in) + nullable
  `discountAmount` — no explicit `shippingFee` guaranteed as a number and no line
  `subtotal`; the FE was deriving `shippingFee = max(0, total − subtotal +
  discount)`, which misattributes rounding drift. Gateway-only fix (single
  service, no migration, no TCP contract change): added a `computeSubtotal(items)`
  helper in `apps/gateway/src/order/order.service.ts` that sums
  `Number(item.price) * Number(item.quantity)` — the `Number()` coercion is
  required because `OrderItem.price` has no DECIMAL transformer and serializes as
  a string (`"99.00"`) over TCP. Wired `subtotal` + a normalized numeric
  `shippingFee: Number(order.shippingFee ?? 0)` (legacy null-fee orders now return
  `0`, never `null`) onto all four order response paths: `getOrderById`
  (`GET /api/order/:id`), `getOrderByUser` (order list, per row), `getSellerOrderDetail`
  (`GET /api/order/seller/:id`), and the single-seller `createOrderInternal`
  branch (`POST /api/order`). Extended the `OrderResponse` interface in
  `order.types.ts` with `shippingFee?: number | null`, `discountAmount?: number |
  null`, `subtotal?: number`. The money identity `total = subtotal −
  discountAmount + shippingFee` now holds explicitly in the payload so the FE can
  drop its derivation. Validation: Prettier/ESLint clean, `tsc --noEmit -p
  apps/gateway/tsconfig.app.json` zero errors. Self-test (3/3 read paths, gateway
  live): `GET /api/order/user/17` → orders 118/117 `subtotal` 99/299,
  `shippingFee` 0 (number); `GET /api/order/118` → `subtotal:99`,
  `shippingFee:0`, both `typeof "number"`; `GET /api/order/seller/118` (admin) →
  same, both numeric. Create path shares the identical helper wiring. FE impact:
  storefront handoff entry written; backend-handoff item moved Open→Done.

- AI-02F6 image-processing resource bounds (2026-07-14, /sweep): hardened
  `apps/product/src/product-image-hash.service.ts` so the risk-scoring image
  pipeline cannot spike memory/CPU. (1) Streaming byte cutoff — `downloadImage`
  no longer reads the whole `arrayBuffer()` before checking size; the new
  `readBodyWithCap` reads the response body chunk-by-chunk, throws the moment
  cumulative bytes exceed `MAX_IMAGE_BYTES` (10 MB), and `reader.cancel()`s to
  release the socket, so a missing/lying `Content-Length` can no longer force an
  oversized payload fully into memory (the up-front declared-length fast-reject
  is kept; a no-stream response falls back to a bounded full read). (2)
  Concurrency cap — `hashImageUrls` now runs its download+decode+hash work
  through a new order-preserving `mapWithConcurrency` worker pool capped at
  `MAX_CONCURRENT_HASHES=3` instead of an unbounded `Promise.all`, so a seller's
  10-image listing (or several products scored at once) bounds peak sharp decode
  count/RSS. No public API change, no migration, no response/route/status change
  (pure server-side side-effect path behind the fire-and-forget `rescoreProduct`).
  Added 2 unit tests: a concurrency counter asserting ≤3 fetches in flight over 6
  URLs, and an 11 MB no-`Content-Length` `ReadableStream` asserted skipped rather
  than buffered. Validation: Prettier/ESLint clean, `npx tsc --noEmit` zero
  errors, product Jest 17/17. No endpoint touched → endpoint self-test N/A; no FE
  impact → no handoff entry. Remaining AI-02 follow-ups: F1 (durable scoring
  state, blocked on the planned outbox path), F2–F5.

- AI-02 non-null risk response follow-up (2026-07-13, /sweep): fixed `GET
  /api/products/admin/risk` so clean, legacy, and not-yet-scored products always
  follow the documented response contract. The product service now normalizes
  nullable stored values at the read boundary to `riskScore:0` and
  `riskFlags:[]`; scoring, persistence, filtering, sorting, pagination, and
  authorization remain unchanged, and no migration was needed. Added a
  regression test covering a fully null legacy row. Validation: targeted
  Prettier/ESLint clean, product-risk Jest 3/3, and `npx.cmd tsc --noEmit` zero
  errors. Live admin self-test: login `201`, risk list `200`, 20 rows, zero
  null/invalid risk fields, sample clean row `{riskScore:0,riskFlags:[]}`. The
  FE can restore non-null types and remove its temporary `normalizeRiskFields`
  workaround; this was reported in `frontend-handoff.md`.

- AI-02 advisory product risk / duplicate detection (2026-07-13, /sweep):
  product create and risk-relevant updates now schedule post-commit,
  fire-and-forget scoring that can never fail the seller mutation. The product
  service downloads only images from the configured Cloudinary cloud (HTTPS,
  10 MB cap, 8s timeout), normalizes them with `sharp`, and stores 64-bit
  `blockhash-core` perceptual hashes. Three cross-seller signals contribute to
  the capped 0-100 score: image Hamming distance <=6 (60), price below 40% of
  the conservative AI-01 category median (25), and normalized trigram name
  similarity >=0.8 in a shared category (15). New admin-only endpoints:
  `GET /api/products/admin/risk?minScore=&page=&limit=` (`product read:any`)
  returns the paginated queue sorted by score; `POST
  /api/products/admin/risk/:id/rescore` (`product update:any`) recomputes one
  item. Scores are advisory only--no auto-unlist--and internal hashes are
  `select:false`/not exposed by HTTP. Added `products.image_phashes`,
  `risk_score` (indexed), and `risk_flags` through guarded migration
  `database/add_risk_columns_to_products.sql` plus manifest entry
  `nodeA-20260713-001-add-product-risk-columns`; added `sharp` and
  `blockhash-core`. Validation: targeted Prettier/ESLint clean, `npx.cmd tsc
  --noEmit` zero errors, product Jest 14/14, Node A migration dry-run includes
  the candidate, and the full 10-service `npm.cmd run build` passed. Runtime
  HTTP self-test: login 201, unauthenticated queue 401,
  invalid `minScore=101` 400, admin queue 200, rescore product 38 returned 200
  with `{riskScore:0,riskFlags:[]}`; test Node A process tree stopped cleanly.

- AI-01 catalog price suggestion (2026-07-13, /sweep): added authenticated
  `GET /api/products/price-suggestion?categoryId=&brandId=&condition=` backed by
  TCP `product.price_suggestion`. The product service runs one MySQL 8
  window-function query over active, approval-eligible products and active SKU
  prices (`COALESCE(sku.price, product.price)`), returning integer-VND
  `{sufficientData,sampleSize,median,p25,p75,min,max}`. Samples below three
  return `sufficientData:false` with null price statistics. No migration or
  external API. Validation: targeted Prettier/ESLint clean, `npx.cmd tsc
  --noEmit` zero errors, product Jest 10/10. Runtime self-test: unauthenticated
  `401`; category 16 `200` with sample size 3 and numeric stats; category 18
  `200` with sample size 2 and suppressed stats; empty category `200` with
  sample size 0; missing category and invalid condition `400`.

- SEC-L4 cookie/CSRF posture documentation (2026-07-13, /sweep): recorded the
  current browser-auth posture in `ai-docs/agent-context/security.md`: sessions
  use an HttpOnly `access_token` cookie, default `sameSite:lax`, production
  `secure=true`, and no standalone CSRF token today. The guidance now explicitly
  requires state-changing operations to stay on non-safe methods (`POST`,
  `PUT`, `PATCH`, `DELETE`), bans mutations behind `GET`/`HEAD`, and says not to
  set `AUTH_COOKIE_SAME_SITE=none` without a CSRF-token strategy. `$review`
  checklist now includes a security rule to flag new `@Get()` / `@Head()` routes
  that call mutating service methods. Docs-only; no runtime or FE contract
  change.

- F7 email notifications for order lifecycle (2026-07-12, /sweep): the
  notification service now mirrors order in-app notifications to email,
  best-effort, reusing the shared dependency-free `MailerService`
  (`libs/common/src/mailer/`, imported via `MailerModule` from `@app/common` —
  no nodemailer added). New `NotificationService.emailUser(userId, subject,
  text)` resolves the recipient address over user TCP (`{cmd:
  user.get_user_info}` with `{userId, includeEmail:true}`, new USER_SERVICE
  TCP client in `notification.module.ts`) and never throws — TCP/mail failures
  log a warn so the RMQ ack/nack outcome of the triggering handler is
  unchanged. Handlers wired: NEW `order_created` consumer (queue was already
  bound to the orders fanout exchange; saves an in-app `order_created`
  notification for the buyer + emails), plus email mirrors on the existing
  `payment_completed` (buyer), `order_canceled` (buyer),
  `order.return_requested` (seller), `order.return_approved` /
  `order.return_rejected` (buyer) handlers. SMTP_* unset → MailerService dev
  fallback logs the mail and returns false (matches forgot-password
  precedent); real delivery needs `SMTP_HOST/PORT/USER/PASS/FROM` in
  `local/nodeA/.env`. No migration. Files: `apps/notification/src/
  notification.module.ts|notification.service.ts|notification.controller.ts`.
  Validation: prettier/eslint clean, `npx.cmd tsc --noEmit` zero errors.
  Runtime self-test (buyer canceltest1779978329/user 17): COD order 118
  created → new notification id 89 `{type:"order_created", orderId:118,
  message:"Đơn hàng #118 đã được đặt thành công"}`; cancel → id 90
  `order_canceled`; buyer has an email on file so the email path reached
  `sendMail` (dev fallback, SMTP unset); handlers ack'd exactly once (no
  requeue duplicates). FOLLOW-UP recorded in snapshot: shipping-milestone
  emails (SHIPPED/DELIVERING/DELIVERED) need new orders-service events — the
  GHN webhook path updates order status without emitting per-status events.

- SEC-L3 duplicate brand/category proposal conflicts (2026-07-12, /sweep):
  `POST /api/products/brands` and `POST /api/products/categories` now reject
  submitted names that case-insensitively match an existing active or pending
  brand/category. Product service trims the proposal name, checks
  `LOWER(TRIM(name))` over active+pending rows, and throws 409 before saving;
  successful proposals still save as `pending` and invalidate the catalog lookup
  caches. Gateway `createBrand`/`createCategory` now use
  `MicroserviceErrorHandler`, so product-service conflicts propagate as HTTP 409
  instead of an opaque 500. Validation: prettier/eslint clean on touched TS
  files; `npx.cmd jest apps/product/src/product.service.spec.ts --runInBand` ->
  8/8 pass; `npx.cmd tsc --noEmit` clean. Runtime self-test with an existing
  user account: duplicate active brand name with different casing/extra spaces
  returned 409, and duplicate active category name with different casing/extra
  spaces returned 409.

- SEC-L2 login response shaping (2026-07-12, /sweep): `POST /api/user/login`
  no longer relies on gateway-side clone/delete logic to hide the password
  hash. `apps/user/src/user.service.ts` `login()` now returns `SafeUser`
  through the existing `toSafeUser()` helper after password verification, so
  the hash never leaves the user microservice over TCP. Gateway login now
  simply sets the auth cookie and returns that safe user payload. Also removed
  the user TCP controller log of the raw login payload, which could include the
  plaintext password. Contract is unchanged externally: login still returns the
  same safe user fields and sets the HttpOnly `access_token` cookie. Validation:
  prettier/eslint clean on touched TS files; `npx.cmd jest
  apps/user/src/user.service.spec.ts --runInBand` -> 7/7 pass; `npx.cmd tsc
  --noEmit` clean. Runtime self-test: login 201, auth cookie present, login
  response omits `password` and keeps `role`, `/api/user/me` with the cookie
  returns 200 and omits `password`.

- SEC-L1 order numeric path-param validation (2026-07-11, /sweep): gateway
  order routes now use `ParseIntPipe` uniformly for numeric `:id` path params.
  Removed the remaining controller-side `+id` coercions and updated
  `OrderService` method signatures/tests to pass numeric ids directly for
  `GET /api/order/:id`, `GET /api/order/user/:id`, status-counts, cancel,
  invoice, and payment-url paths. Admin GHN order detail/history/sync and
  existing seller/return/voucher/action paths are covered by the same pipe.
  Focused validation: `npx.cmd jest apps/gateway/src/order/order.service.spec.ts
  --runInBand` -> 8/8 pass; `npx.cmd tsc --noEmit` clean; prettier/eslint
  clean on touched TS files. Runtime self-test: authenticated malformed ids now
  return 400 for storefront order routes (`/api/order/abc`,
  `/api/order/user/abc`, `/status-counts`, `/cancel`, `/payment-url`,
  `/invoice`) and GHN console routes (`/api/order/admin/ghn/orders/abc`,
  `/history`, `/sync`); valid `GET /api/order/user/<own numeric id>` still
  returns 200.

- Product create without SKU fallback (2026-07-11, /sweep `$debug`): fixed the
  pre-existing 502 when `POST /api/products/` omitted optional `sku` for a
  base-price product. Root cause: the gateway creates the product in MySQL, then
  auto-creates its base inventory row in the PostgreSQL inventory service; that
  payload used `sku: dto.sku`, so omitted/blank SKU became `undefined` against
  `inventory_v2.sku NOT NULL UNIQUE`, causing a DB error and saga compensation
  deleted the product. Fix: gateway `ProductService.createProduct` now sends
  `sku: dto.sku.trim()` when present, otherwise deterministic fallback
  `PROD-<productId>` after the product service returns the new id. Explicit SKU
  behavior is unchanged, and SKU-matrix products still skip base auto-inventory.
  Tests: `npx.cmd jest apps/gateway/src/product/product-ownership.service.spec.ts
  --runInBand` -> 7/7 pass (new explicit-SKU and fallback-SKU cases);
  `npx.cmd tsc --noEmit` clean. Runtime self-test: before fix, shop create
  without `sku` returned 502; after fix, login 201, create 201 for product #56,
  `GET /api/inventory/product/56` returned `sku:"PROD-56"` and stock 2, cleanup
  `DELETE /api/products/56` returned 204. Storefront FE handoff written because
  the create-product contract now truly supports omitted `sku`.

- SEC-M8 signed upload format constraints (2026-07-11, /sweep):
  `POST /api/upload/signature` now returns and signs Cloudinary
  `allowed_formats` so direct browser uploads cannot bypass the backend's
  allowed media-format contract. Folder-specific values: `trybuy/products` and
  `avatars` -> `jpg,png,webp`; `trybuy/posts` -> `jpg,png,webp,mp4`.
  `UploadService.generateSignature` includes `allowed_formats` in the SHA1
  string before `folder/public_id/timestamp`, matching Cloudinary signed upload
  rules that all signed upload params must be sent with the request. Storefront
  FE must include the returned `allowed_formats` field in the direct Cloudinary
  upload form along with `folder`, `public_id`, `timestamp`, `api_key`, and
  `signature`; otherwise Cloudinary will reject the request because the signed
  param set no longer matches. Focused tests: `npx.cmd jest
  apps/gateway/src/upload` -> 15/15 pass. Validation: `npx.cmd tsc --noEmit`
  clean; live gateway self-test with user account returned 201 and response
  `data.allowed_formats:"jpg,png,webp"` for `trybuy/products`; direct
  Cloudinary upload using that returned signature rejected a temporary `.txt`
  file with HTTP 400 (`Raw file format txt not allowed`).

- SEC-M7 server-side Cloudinary orphan cleanup (2026-07-11, /sweep): dropped
  media assets are now destroyed on entity update/delete instead of orphaning
  forever. New dependency-free `CloudinaryService` in
  `libs/common/src/cloudinary/` (`CloudinaryModule` exported from
  `@app/common`): `destroyAssets(urls)` dedupes, parses each delivery URL into
  a `public_id` with strict ownership guards (https + `res.cloudinary.com`
  host + our `CLOUDINARY_CLOUD_NAME` + resource type `image|video` + `upload`
  segment + folder allowlist `trybuy/products|trybuy/posts|avatars`; transform
  segments with `,` and `/^v\d+$/` version skipped, extension stripped), then
  SHA1-signs and POSTs `https://api.cloudinary.com/v1_1/{cloud}/{type}/destroy`
  via native fetch (10s abort). NEVER throws — per-asset failures are logged;
  missing `CLOUDINARY_*` env → warn + no-op (mirrors MailerService). Wired
  fire-and-forget (`void destroyAssets(...)`) strictly POST-COMMIT into:
  social `updatePost` (diff old vs kept imageUrls+videoUrl) / `deletePost` /
  `adminDeletePost` (after the tx commits); product `updateProduct` (diff,
  captured before `Object.assign`) / `deleteProduct`; user `updateUser`
  (previous avatar destroyed when replaced or cleared). Cleanup can never fail
  the business mutation. 7 unit tests (`cloudinary.service.spec.ts`) + 2
  existing product spec constructions updated. tsc/eslint clean; jest 13/13.
  Runtime self-test 5/5 with REAL Cloudinary destruction (delivery-URL checks):
  post edit dropping an image → 404; post delete → 404; avatar replace → old
  404 + new 200; avatar clear → 404; product delete → 404. Code-reviewer agent:
  pass, zero blockers. Found (pre-existing, recorded in Known Issues): product
  create WITHOUT `sku` always 502s — gateway auto-inventory sends
  `sku: undefined` into `inventory.sku NOT NULL` → PG violation → saga
  compensation rolls the product back.
- SEC-M1 GHN webhook hardening (2026-07-11, /sweep): `POST /ghn/webhook` +
  `/api/ghn/webhook` (`apps/gateway/src/ghn/ghn-webhook.controller.ts`).
  (1) Runtime body validation via new `GhnWebhookDto`
  (`apps/gateway/src/ghn/dto/ghn-webhook.dto.ts` — `OrderCode`/`Status`/
  `order_code`/`status`, each optional string ≤64). Validation is done
  MANUALLY inside the handler (`validateKnownFields`: pick known keys →
  `plainToInstance` → `validate`) because typing `@Body()` as the DTO class
  triggers the GLOBAL `forbidNonWhitelisted` ValidationPipe, which would 400
  every real GHN callback (they carry extra fields: `Time`, `Type`,
  `CODAmount`, `Warehouse`, …) — discovered live during self-test. Wrong-typed
  known field → 400 + warn; missing orderCode/status still → 200 + warn
  (unchanged ack semantics). (2) Header token `x-ghn-webhook-token` is the
  supported auth path; `?token=` still accepted (removal gated by OQ-2) but
  now logs a deprecation warn (query strings leak into access logs).
  (3) Explicit `@RateLimit({limit:300, ttl:60})` so GHN status-burst
  deliveries are never throttled by a lower global default. tsc/eslint clean.
  Runtime self-test 7/7: no token → 401; wrong token → 401; object-typed
  `Status` → 400 "Status must be a string"; valid header token + extra GHN
  fields (`Time`/`Type`/`CODAmount`/`Warehouse`) → 200 `{success:true}`;
  deprecated `?token=` auth → 200; missing order code → 200; post-refactor
  401 re-check → 401. No FE impact (webhook is GHN→backend only; no contract
  change — query token kept working).

- Forgot-password API with emailed verification code (2026-07-11, /sweep, user
  request "thêm api quên mật khẩu, cần mã xác nhận gửi qua email đăng ký"):
  two new public gateway routes — `POST /api/user/forgot-password`
  (`{email}`, rate-limit 5/60s, ALWAYS returns the generic 201
  `{message:"If the email exists, a verification code has been sent"}` so
  email existence is never revealed) and `POST /api/user/reset-password`
  (`{email, code, newPassword}`, 10/60s, → `{success:true}`; every failure
  mode is the same 400 "Invalid or expired verification code"). Flow: user
  service (`{cmd: user.forgot_password|user.reset_password}` TCP patterns in
  `USER_MESSAGE_PATTERN`) finds the user by email, generates a 6-digit crypto
  `randomInt` code, stores it in Redis (`user:pwreset:code:<userId>`, TTL
  10 min) with a 5-attempt verify cap (`user:pwreset:attempts:<userId>`,
  exceeded → code invalidated) and a 60s resend cooldown
  (`user:pwreset:cooldown:<userId>` via `setNx`); on success the new password
  is bcrypt-hashed (10 rounds) and all three keys are deleted. Email is sent
  by a NEW dependency-free `MailerService` + `MailerModule` in
  `libs/common/src/mailer/` (raw SMTP dialogue over Node `tls` — implicit-TLS
  SMTPS :465, AUTH LOGIN, RFC 2047 UTF-8 subjects, dot-stuffing, 15s timeout;
  built without nodemailer because `npm install` is user-denied). SMTP env
  keys added to `local/nodeA/.env.example` (SMTP_HOST/PORT/USER/PASS/FROM);
  unconfigured → graceful dev fallback: the code is logged by the user service
  and the endpoint still returns the generic 201. Gateway: `ForgotPasswordDto`
  / `ResetPasswordDto` (email + `@Matches(/^\d{6}$/)` code + `@MinLength(6)`
  newPassword, full Swagger), routes in `user.controller.ts` before logout,
  standard `MicroserviceErrorHandler` + `timeout(10000)` service methods. User
  service: `CachedModule` + `MailerModule` imported; `forgotPassword`/
  `resetPassword` in `user.service.ts` + `@MessagePattern({cmd:…})` handlers.
  Files: `libs/constant/message-pattern.constant.ts`,
  `libs/common/src/mailer/{mailer.service.ts,mailer.module.ts}`,
  `libs/common/src/index.ts`, `apps/user/src/{user.module.ts,user.service.ts,
  user.controller.ts}`, `apps/gateway/src/user/{dto/user.dto.ts,
  user.controller.ts,user.service.ts}`, `local/nodeA/.env.example`.
  Validation: tsc/prettier/eslint clean. Runtime self-test 12/12: unknown
  email → generic 201; real email (user 23) → code in Redis; wrong code →
  400; correct code → 201 `{success:true}`; new password login 201 / old 401
  / code reuse 400; DTO rejects bad email, non-digit code, short password
  (400×3); 5 wrong attempts → correct code afterwards also 400 (invalidated);
  original password restored via a fresh code, final login 201. FE handoff
  entry written (`../.agent-local/frontend-handoff.md`).

- Login "remember me" — optional `rememberMe` extends the auth session to 7 days
  (2026-07-10, user request; FE storefront added a remember-me checkbox): the
  `access_token` cookie `maxAge` was hardcoded to 5h in
  `apps/gateway/src/common/auth-cookie.ts`, capping every session at 5h even
  though `JWT_EXPIRES_IN=7d`. Added optional `rememberMe?: boolean`
  (`@IsOptional @IsBoolean` + `@ApiPropertyOptional`) to the gateway
  `LoginUserDto`; `getAuthCookieOptions(maxAgeMs?)` now takes an override with
  `DEFAULT_AUTH_COOKIE_MAX_AGE_MS` (5h) / `REMEMBER_ME_AUTH_COOKIE_MAX_AGE_MS`
  (7d) constants; login controller picks the 7d options when
  `rememberMe === true`. `generateJwtToken(user, isRememberMe)` signs
  remember-me tokens with an explicit `expiresIn:"7d"` so the JWT can never
  expire before its cookie regardless of env; gateway login now forwards only
  `{username,password}` over TCP (rememberMe never reaches the user service —
  contract unchanged). Decision recorded: **no refresh token added** — single
  7d HttpOnly access token is acceptable at this scale; revisit
  refresh-token rotation only if token revocation or long-lived mobile
  sessions become requirements. Validation: tsc/prettier/eslint clean.
  Runtime self-test 5/5: plain login → `Max-Age=18000`; `rememberMe:true` →
  `Max-Age=604800` + JWT `exp-iat` = 7d exactly; `rememberMe:"abc"` → 400;
  remember cookie accepted on `GET /api/user/me` → 200. FE handoff entry
  written (`../.agent-local/frontend-handoff.md`).

- PERF-11 — `getPaymentUrl` ownership check no longer runs product enrichment
  (2026-07-10, sweep; closes the last open perf-audit item): the gateway
  `GET /api/order/:id/payment-url` previously called the full `getOrderById`,
  which batch-fetches live products (`buildProductMap`) and decorates every
  order item purely to verify the caller owns the order. Extracted a private
  `fetchOwnedOrder(orderId, callerId, callerRole)` helper in
  `apps/gateway/src/order/order.service.ts` — one `GET_ORDER_BY_ID` TCP send +
  404-on-missing + owner-or-admin 403, no enrichment — used by `getPaymentUrl`;
  `getOrderById` now reuses the same helper before its enrichment pass, so
  error semantics stay identical (single code path). No contract change.
  Validation: tsc/prettier/eslint clean. Runtime self-test 4/4 on the live
  gateway: owner (user 17, order 116) → 200 `{orderUrl:"https://qcgateway.
  zalopay.vn/...", status:"pending"}`; foreign user (user 18) → 403; unknown
  order 999999 → 404; unauth → 401. No FE impact — no handoff entry. This
  empties the perf-audit backlog (0 remaining); future perf work is the
  SCALE-01..06 scalability backlog.

- CHANGELOG housekeeping (2026-07-10, user request): condensed all completed
  entries dated 2026-07-06 and earlier into the one-line-per-task
  "Archive — condensed history" section below; entries from 2026-07-07 onward
  keep full detail. Full historical detail remains in the git history of this
  file (pre-2026-07-10 revisions).

- SEC-M5 + SEC-M6 closed as stale items — already implemented, now
  runtime-verified (2026-07-10, sweep): both were found fully implemented in
  `apps/gateway/src/common/security.ts` (commit ed7a838), so no code change was
  made. SEC-M5: `securityHeadersMiddleware()` is registered first in gateway
  `main.ts` and sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `X-DNS-Prefetch-Control: off`, COOP/CORP
  `same-origin`, `Origin-Agent-Cluster`, a restrictive `Permissions-Policy`,
  and — only in production — `Strict-Transport-Security: max-age=15552000;
  includeSubDomains`. SEC-M6: Swagger setup is wrapped in `isSwaggerEnabled()`
  (`SWAGGER_ENABLED` boolean env, defaulting to enabled only when
  `NODE_ENV !== "production"`); when disabled the bootstrap logs and skips
  `SwaggerModule.setup`. Runtime verification: dev gateway (:3000) → `/doc` 200
  and all non-HSTS headers present on API responses, HSTS correctly absent;
  fresh `nest build gateway` + compiled boot with `NODE_ENV=production` on
  :3099 → `/doc` 404 (standard error envelope), HSTS + nosniff + frame DENY
  present on `/health`; temp prod process stopped after the check. OQ-3 (nginx
  header ownership) no longer gates anything — headers are enforced in-app;
  nginx remains relevant only for SCALE-03 load absorption. No FE impact
  (headers additive, Swagger is a dev tool) — no handoff entries.

- Low-stock rows now carry `productName` (2026-07-10, sweep; closes the
  backend-handoff 2026-07-09 FE entry): `GET /api/inventory/low-stock` rows are
  enriched at the gateway with a denormalized `productName: string | null`.
  `InventoryService.getLowStock` (apps/gateway/src/inventory/inventory.service.ts)
  now feeds the inventory rows through a new `attachProductNames` helper — one
  batched `PRODUCT_FIND_BY_IDS` send over the deduped `productId` set (bigint
  string ids normalized via `Number()`), mapped back per row. Best-effort:
  product-service failure logs a warn and returns rows with `productName: null`
  (never breaks the read); deleted/orphaned products also resolve to null.
  Shape otherwise unchanged (additive field only). Validation: tsc/prettier/
  eslint clean. Runtime self-test 5/5: admin → 200, 4 rows all carrying the
  key, product 28 resolved "iPhone 15 Pro 256GB", products 10/17 confirmed
  deleted (404) so their null is the correct orphan fallback; shop
  (techstore_demo) → 200 `[]` (empty path intact); user role → 403; unauth →
  401. FE handoff entry written (storefront `frontend-handoff.md`) — FE can
  drop the client-side product-list join + SKU fallback in
  `buildLowStockRows`.

- SEC-H4 — payment callback duplicate-delivery runtime test PASSED, item closed
  (2026-07-10, sweep): the last open piece of the callback hardening was proving
  at runtime that a valid provider callback applied twice causes no second
  transition and no duplicate `payment_completed` emit. No code change needed —
  `PaymentsService.completePayment` (apps/payments/src/payments.service.ts)
  already short-circuits COMPLETED payments before the emit loop and guards the
  pending→completed flip with a conditional
  `UPDATE … WHERE id=? AND status='pending'`. Runtime self-test 8/8 on the live
  stack (fresh ZaloPay order #117, forged HMAC-SHA256 callback via the gateway
  facade `POST :3000/zalopay/callback`): bad MAC → `return_code:-1`, payment
  stays `pending`; valid callback #1 → `return_code:1`, payment `completed`,
  order → `processing` (payment_completed consumed); identical callback #2 →
  `return_code:1` (provider-friendly ack) with payment status/transaction_id/row
  count AND order status/updatedAt all bit-identical — no re-transition, no
  re-emit side effect. VNPay shares the same `completePayment` core (both
  `handleVNPayCallback` and the ZaloPay path call it), so the idempotency proof
  covers both providers. No FE impact (verification only, no contract change). / input bounds on raw-input gateway routes
  (2026-07-09, sweep): (a) `GET /api/products/:id/reviews` swapped raw
  `@Query("page")/@Query("limit")` (+`+page/+limit` coercion, no upper bound)
  for a new `ReviewQueryDto` (`apps/gateway/src/product/dto/review.dto.ts`,
  mirrors `WishlistQueryDto`: optional page `@Min(1)`, limit `@Min(1)@Max(100)`,
  `@Type(()=>Number)`; controller defaults `page ?? 1` / `limit ?? 10`).
  (b) `GET /api/gateway/payment-result` KEEPS the raw `Record<string,string>`
  query — deliberate: VNPay signature verification hashes ALL `vnp_*` params, so
  a whitelisted DTO would strip unknown fields and break the checksum — but now
  bounds it via `assertBoundedPaymentQuery` (`apps/gateway/src/gateway.controller.ts`):
  max 40 keys, max 512 chars per value, string-only values (rejects Express
  repeated-key arrays). All violations → 400. Validation: tsc/prettier/eslint
  clean. Runtime self-test 8/8 on the live gateway: reviews `?page=1&limit=10` →
  200, no params → 200 (defaults, paginated shape), `?limit=100000` → 400
  "limit must not be greater than 100", `?limit=0` → 400, `?page=abc` → 400;
  payment-result no query → 400 "Missing transaction reference" (unchanged),
  46 keys → 400 "Too many query parameters", 600-char value → 400 "Query
  parameter too long", duplicated key → 400 "Invalid query parameter". FE
  impact: only abusive inputs rejected; normal storefront paging (≤100)
  unaffected — no handoff entry needed.

- SEC-H3 — closed as stale, runtime-verified (2026-07-09, sweep): the backlog
  item described an old state. Code inspection showed `login`/`register` already
  carry explicit `@RateLimit({limit:10,ttl:60})`
  (`apps/gateway/src/user/user.controller.ts`), and `CustomRateLimitGuard`
  (`apps/gateway/src/common/guards/rate-limit.guard.ts`) already uses NestJS
  `Logger` (no `console.warn`), a 500ms Redis timeout, and **fails closed in
  production** (`ServiceUnavailableException` 503) while failing open only in
  dev — which also resolves OQ-4. Live self-test: 12 rapid logins → 10× 401
  then 2× 429 with retryAfter. No code change.

- SEC-H2 — bounded/validated body on the public batch product endpoint
  (2026-07-09, sweep): `POST /api/products/with-inventory/multiple` previously
  took an inline `{productIds:number[]}` body with no DTO, so the global
  `ValidationPipe({whitelist:true})` never ran — any shape, any size, any type
  reached the gateway service and the batch TCP fan-out. New
  `GetProductsWithInventoryDto` (`apps/gateway/src/product/dto/product.dto.ts`,
  exported via the dto barrel) enforces `@IsArray` + `@ArrayMaxSize(50)` +
  `@IsInt({each:true})` + `@Type(()=>Number)`; the controller dedupes ids via
  `Set` before calling `getProductsWithInventory`. Swagger `@ApiBody` now points
  at the DTO instead of an inline schema. Response shape unchanged; success
  status stays 201 (POST default, pre-existing). Validation: `tsc --noEmit`
  clean, prettier/eslint clean. Runtime self-test 5/5 on the live gateway:
  51 ids → 400 "no more than 50 elements"; `[1,"abc"]` → 400 "must be an
  integer"; `{}` → 400; `[50,50,52]` → 201 with one product 50 (dedupe + missing
  id skipped); `["50"]` → 201 (string coerced). FE handoff entry written for the
  new 50-id cap (chunk requests if a basket ever exceeds 50 distinct products).

- Brand/category lookup cache-aside (PERF-09 / SEC-M2, 2026-07-09, sweep):
  closed the final unbounded-list performance remainder without changing the
  public API contract. Product service now caches `findAllBrands` and
  `findAllCategories` by status (`products:brands:<active|pending|rejected>` and
  `products:categories:<active|pending|rejected>`) for 300 seconds, with Redis
  read/write failures logged and treated as cache misses so catalog reads still
  fall back to MySQL. Brand/category create and review paths invalidate all list
  variants, covering pending submissions plus approve/reject transitions. Gateway
  response shape remains the existing `Brand[]` / `Category[]` arrays, so no FE
  handoff was needed. Validation: prettier/eslint clean on touched product files,
  `npx.cmd jest apps/product/src/product.service.spec.ts --runInBand` passed 6/6,
  and `npx.cmd tsc --noEmit` passed.

- Upload delete ownership enforcement (backend-handoff Upload/media lifecycle
  item **a**, 2026-07-08, sweep): closed the FE-flagged 🔴 hole where any
  authenticated user could delete another user's Cloudinary media (post images /
  product images / avatars) by guessing/scraping a `public_id`. Enforcement is
  server-side in `UploadService.generateDeleteSignature` →
  `normalizeOwnedDeletePublicId`: the `public_id` must be `<allowed-folder>/${userId}_…`
  (leaf prefixed with the caller's JWT user id) unless the caller's `role` is
  `admin`; disallowed folder or malformed path → 400; foreign-owned leaf → 403 —
  all thrown **before** any Cloudinary `destroy` call (controller unit test proves
  Cloudinary is not hit on rejection). Ownership is authoritative because uploads
  are always named `${userId}_…` at signature time (`normalizeOwnedUploadPublicId`),
  so a user can neither sign nor delete media outside their own namespace. JWT
  `role` = `user.role?.rol_name ?? "user"` (admin = `"admin"`), so the admin bypass
  and the safe `"user"` default both hold. No migration; no response-shape change.
  Verified: `jest apps/gateway/src/upload` 14/14; live gateway (user 17) —
  DELETE `trybuy/posts/18_someoneelse` → 403, `trybuy/private/17_x` → 400,
  `17_nofolder` → 400, unauthenticated → 401. FE-facing result recorded in
  `frontend-handoff.md`. Follow-ups from the same handoff entry later closed
  backend-side: SEC-M7 server-side orphan cleanup and SEC-M8 signed upload-format
  constraints.
- Chat/payments performance indexes (PERF-06, 2026-07-07, sweep): completed the
  pending live Aiven apply for the chat and payments lookup indexes. Node A MySQL
  applied `nodeA-20260707-003-add-chat-message-performance-indexes`
  (`database/add_chat_message_performance_indexes.sql`) for
  `messages(conversation_id, created_at)` using online
  `ALGORITHM=INPLACE, LOCK=NONE`. Node B PostgreSQL applied
  `nodeB-20260707-001-add-payments-order-id-index`
  (`database/add_payments_order_id_index.sql`) and
  `nodeB-20260707-002-add-payments-app-trans-id-index`
  (`database/add_payments_app_trans_id_index.sql`) using
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS` on `payments(order_id)` and
  `payments(app_trans_id)`, each scoped to non-null values. The broad live status
  check showed unrelated pending manifest candidates, so the final dry-run,
  apply, and status verification used `--only` for the three PERF-06 ids. Validation:
  exact-ID dry-runs were clean (`runnable=1` for Node A, `runnable=2` for Node B),
  approved live applies completed, exact status checks report all three as applied,
  and `npx.cmd tsc --noEmit` passed. No API contract change and no FE handoff
  needed.

- Social performance indexes (PERF-05, 2026-07-07, sweep): added an idempotent
  Node A MySQL migration `database/add_social_performance_indexes.sql` for social
  read hot paths: `comments(post_id, created_at)`, `posts(is_hidden, created_at)`,
  and `posts(user_id, is_hidden, created_at)`, all using online
  `ALGORITHM=INPLACE, LOCK=NONE`. Added matching TypeORM `@Index` metadata to the
  `Post` and `Comment` entities. The migration is enabled in
  `database/migrations.manifest.json` as
  `nodeA-20260707-002-add-social-performance-indexes`. Also added
  `--only=<migration-id>` support to `scripts/migrate-database.mjs` so a single
  reviewed migration can be dry-run, status-checked, or applied without applying
  unrelated pending candidates. Validation: prettier/eslint clean on touched TS,
  `npx.cmd tsc --noEmit` clean, filtered dry-run showed exactly one runnable
  migration, and the approved live apply to Aiven Node A completed; filtered status
  now reports the migration as applied. No API contract change and no FE handoff
  needed.

- Wishlist / favorites (F6, 2026-07-07, sweep): added product-owned wishlist support
  for the storefront. New `wishlist_items` table/entity stores `{ user_id,
product_id, created_at }` with unique `(user_id, product_id)` and cascade cleanup
  when a product is deleted; SQL migration `database/create_wishlist_items_table.sql`
  is enabled in `database/migrations.manifest.json` as
  `nodeA-20260707-001-create-wishlist-items`. Product TCP patterns added:
  `product.wishlist.add`, `product.wishlist.remove`, and `product.wishlist.list`.
  Gateway endpoints added under `/api/products`: `GET /wishlist?page=&limit=`,
  `POST /wishlist/:productId`, and `DELETE /wishlist/:productId`. Add is
  idempotent (duplicate add still returns `isWishlisted:true`), delete is
  idempotent 204, missing/inactive product add returns 404, and list returns the
  standard paginated envelope with hydrated product cards plus `categoryIds` and
  `wishlistedAt`. Validation: prettier/eslint clean on touched TS, `npx.cmd tsc
--noEmit` clean, product service Jest spec passed 3/3, Node A migration dry-run
  includes the new enabled schema candidate, and live gateway self-test passed:
  login 201, cleanup delete 204, add 201, duplicate add 201, list 200 with product
  35 + `wishlistedAt` + `categoryIds`, remove 204, list no longer contains product
  35, missing product add 404. Storefront FE handoff recorded.
- Public profile email privacy (2026-07-07, sweep - closes SEC-H1): `GET /api/user/:id`
  and default `GET_USER_INFO` / `GET_USERS_BY_IDS` TCP calls now return only the
  public profile projection (`id`, `username`, `name`, `avatar`, `isActive`) and no
  `email`. Email is preserved only on private/admin paths that explicitly opt in:
  `GET /api/user/me`, admin user pagination, admin/GHN order buyer enrichment, and
  invoice generation. Product seller enrichment and social author decoration now use
  the public projection, and product enrichment no longer debug-logs the raw user
  object. Added focused regression coverage for user-service select shapes and
  gateway product seller enrichment dropping `email` even if an upstream user object
  contains it. Validation: prettier/eslint clean on touched TS files,
  `npx.cmd jest apps/user/src/user.service.spec.ts apps/gateway/src/product/product-ownership.service.spec.ts --runInBand`
  passed 11/11, and `npx.cmd tsc --noEmit` passed. Runtime self-test on the running
  gateway verified `GET /api/user/:id` omits email and social author enrichment omits
  email; admin orders returned no rows to assert buyer-email compatibility. Product
  list runtime verification was blocked because `product:3006` was offline
  (`502 connect ECONNREFUSED`), and starting the product service unsandboxed was not
  approved because it would connect a new process to shared Aiven infrastructure; the
  product enrichment behavior is covered by the new gateway regression tests. API
  context updated and storefront FE handoff recorded.
- Uploaded-media URL validation + upload rate limits + delete error codes (2026-07-07, upload API audit follow-up): closed the consumer-side gap that made the upload-signing hardening bypassable — every field storing an uploaded media URL was previously accepted as any string (`imageUrls` was only `@IsString`, post `imageUrls`/`videoUrl` were `@IsUrl` any-host, `avatar` was `@IsUrl` any-host), so a client could skip the upload flow entirely and persist an external/arbitrary URL (hotlink, dead link, or a non-image file rendered as media). Added a shared `@IsCloudinaryUrl({ folder, media }, { each? })` class-validator (`apps/gateway/src/common/validators/is-cloudinary-url.validator.ts`) that requires: `https:` + host exactly `res.cloudinary.com` (URL-parsed, so `res.cloudinary.com.evil.com` is rejected), our cloud name prefix when `CLOUDINARY_CLOUD_NAME` is set, the expected folder segment (`trybuy/products` / `trybuy/posts` / `avatars`), and a media-type file extension (images `jpg/jpeg/png/webp/gif/avif/bmp/heic/heif` — **svg excluded** as a script vector; video `mp4/mov/webm/mkv/avi/m4v`; extension-less Cloudinary auto-format URLs allowed). Applied to `create-product.dto.ts`/`update-product.dto.ts` (`imageUrls`, products folder), `social/dto/create-post.dto.ts` (`imageUrls` image + `videoUrl` video, posts folder), and `user/dto/user.dto.ts` (`avatar`, avatars folder). Also: `POST /api/upload/signature` gained `@RateLimit({ limit:60, ttl:60 })` and `DELETE /api/upload/media` `@RateLimit({ limit:30, ttl:60 })` (per-user via the existing Redis guard); and `deleteMedia` no longer swallows a non-ok Cloudinary response as `{ result:"not found" }` — an auth/quota/5xx now throws `BadGatewayException` (502) and a network failure `ServiceUnavailableException` (503), logged via `Logger` (Cloudinary returns HTTP 200 + `{result:"not found"}` for a genuinely missing asset, so a non-ok status is always a real upstream failure). Added `is-cloudinary-url.validator.spec.ts` (11 cases: valid, extension-less, wrong host, subdomain spoof, wrong folder, `.exe`, `.svg`, cloud-name enforcement, video field) and 2 new upload-controller specs (delete 502 on non-ok, 503 on network error). Validation: prettier/eslint clean on all touched files, `npx tsc --noEmit` clean, `npx jest apps/gateway` green (47/47 incl. the new specs), and live gateway self-test (shop `techstore_demo`): product create with non-Cloudinary `imageUrl` → 400; `.exe` under the right folder → 400; valid `trybuy/products/*.jpg` → no `imageUrls` error (passes validator); avatar in `trybuy/products` → 400; avatar in `avatars` → no `avatar` error. FE-facing result recorded in `../.agent-local/frontend-handoff.md` (Open).
- Upload signature/delete ownership hardening (2026-07-07, sweep - closes SEC-C2): `POST /api/upload/signature` now signs only allowlisted folders (`trybuy/products`, `trybuy/posts`, plus the existing storefront avatar folder `avatars`) and requires any client-supplied `publicId` to be a caller-owned basename (`${userId}_...`, no path); if omitted, the server still generates an owned id. The legacy storefront `userId` query param is still accepted but ignored; the JWT user id is authoritative. `DELETE /api/upload/media` now validates `public_id` as `<allowed-folder>/${userId}_...` before creating a Cloudinary destroy signature, with admin exempt from the owner-prefix check. Invalid folders/path-shaped IDs return 400; foreign prefixes return 403 before Cloudinary is called. Added focused upload controller/service tests for allowed folders, foreign upload IDs, delete ownership, admin delete bypass, and no-Cloudinary-call on rejected delete. Validation: prettier/eslint clean on upload TS files, `npx.cmd jest apps/gateway/src/upload/upload.controller.spec.ts apps/gateway/src/upload/upload.service.spec.ts --runInBand` passed 12/12, `npx.cmd tsc --noEmit` clean, and live gateway self-test passed: valid product/avatar signatures returned 201 with owned public IDs; legacy `userId` query still returned 201; disallowed folder 400; foreign upload publicId 403; path publicId 400; foreign delete 403; malformed delete public_id 400.
- Cart item ownership binding (2026-07-07, sweep - closes SEC-C1): `PATCH /api/cart/items/:id` and `DELETE /api/cart/items/:id` now bind the mutation to the authenticated user. Gateway cart routes pass `req.user.id` through the TCP payload, and Orders `CartService` loads `cartItem -> cart` before update/delete, returning `NotFoundException` when the item is missing or belongs to another user. Non-positive quantity updates now use the same owned removal path. Added focused unit coverage in `apps/orders/src/cart.service.spec.ts` for foreign update/delete rejection, owned update/delete success, and the `quantity <= 0` path. Validation: prettier/eslint clean on touched cart TS files, `npx.cmd jest apps/orders/src/cart.service.spec.ts --runInBand` passed 5/5, `npx.cmd tsc --noEmit` clean, and live gateway self-test passed: user B PATCH/DELETE against user A cart item returned 404 while quantity stayed 1; user A PATCH returned 200 and set quantity 2; user A DELETE returned 200 and removed the item.
- Notification preview length fix (2026-07-07, sweep - closes backend-handoff "Notification `preview` truncated to 20 chars"): social comment/reply events now send `preview` as the first 255 chars instead of `slice(0, 20)` (`apps/social/src/social.service.ts`), matching the storefront notification contract. `NotificationService.saveNotification` defensively caps persisted `message` and `preview` at 255 chars to match the existing `notifications` varchar columns, and the comment/reply notification `message` is kept generic so a full 255-char preview cannot overflow `message`. No schema change. Validation: prettier/eslint clean on touched TS files, `npx.cmd tsc --noEmit` clean, and live gateway/RabbitMQ self-test passed end-to-end: created post #13, comment #17, reply #18; `GET /api/notifications` returned exact full previews of 141 chars for `type:"comment"` and 134 chars for `type:"reply"` (both >20, both matching source text). FE-facing result recorded in `../.agent-local/frontend-handoff.md`; backend-handoff entry moved to Done.

## Archive — condensed history (2026-07-06 and earlier)

> Old completed tasks condensed to one line each for traceability.
> Full detail lives in the git history of this file (before 2026-07-10).

- Unused-API sweep (2026-07-06).
- VPS first-deploy runbook (2026-07-06).
- GitHub Actions CI for backend monorepo (2026-07-06).
- Gateway payment callback facade hardening (2026-07-06).
- Gateway-owned payment callback facade (2026-07-06).
- Social-notification metadata for deep-linkable comment/reply notifications (2026-07-06, sweep — closes backend-handoff "Notification comment/reply thiếu postId" + FE P-item).
- Production VPS runtime support (2026-07-05).
- Gateway production security hardening (2026-07-05).
- Migration manifest safety tightening (2026-07-05).
- Explicit SQL migration runner (2026-07-05).
- Gateway health endpoints (2026-07-04).
- Socket.IO websocket upgrade confirmation (2026-07-04, backend-handoff sweep).
- Social legacy post image cleanup (2026-07-04).
- Featured sellers endpoint + F2 status-counts confirmation (2026-07-03, backend-handoff sweep).
- PERF-10 — product `findAllProducts` split-query pagination (2026-07-03).
- PERF-08 — checkout `enrichOrderItems` parallelized + deduped (2026-07-03).
- GAP-02 + PERF-03 — social feed Redis/DB N+1 fixed (2026-07-03).
- PERF-04 — orders MySQL hot-path indexes (2026-07-03).
- GAP-01 + PERF-02 + PERF-07 — batch product-by-ids TCP pattern + gateway N+1 fixes (2026-07-02).
- PERF-01 — gateway product-list user-enrichment N+1 fixed (2026-07-02).
- F5 — Post moderation actions (2026-07-02).
- F4 — Seller analytics dashboard (2026-07-01, read-only, NO migration).
- Structured GHN address — master-data proxy + per-user address book + numeric order money fields (2026-07-01).
- Gateway CORS — single delegate, dev allows any localhost/127.0.0.1 origin, prod stays strict (2026-07-01).
- Product money fields serialize as numbers — fix & runtime-verified (2026-07-01).
- F3 Voucher / coupon / discount codes — implemented & runtime-verified (2026-06-30).
- F2 Buyer-initiated return/refund request — implemented & runtime-verified (2026-06-30).
- F1 Product reviews & ratings — verified & closed (2026-06-30).
- GHN detail reflects demo-driven status in demo mode — acts like a webhook (2026-06-30).
- GHN demo-status endpoint — drive the local lifecycle end-to-end for demos (roadmap #6) (2026-06-29).
- GHN manual sync no longer returns an opaque 502 (2026-06-28).
- Deploy gate G4+G5 — backend now fully DEPLOY-READY (2026-06-28).
- Deploy gate G1+G2+G3 — production build/run pipeline fixed (2026-06-28).
- GHN admin actions — update COD + update receiver (Phase 2 / "Hướng B", B2) (2026-06-28).
- GHN webhook now served at both `/ghn/webhook` and `/api/ghn/webhook` (2026-06-28).
- GHN admin actions — manual cancel + return (Phase 2 / "Hướng B", B1) (2026-06-28).
- ready-to-ship now resolves the free-text address server-side and gates the PROCESSING transition on a real GHN waybill (2026-06-28).
- GHN list/detail `lastGhnStatus`/`lastSyncedAt` no longer always null (2026-06-28).
- GHN cancel/return status now syncs to local CANCELED (2026-06-28).
- `GET /api/user/me` now returns `role` (2026-06-27).
- GHN Web Step 2 — dedicated shipping roles (2026-06-27).
- GHN Shipping Admin Phase 1.1 hardening.
- GHN Shipping Admin Phase 1 backend foundation.
- Auth + RBAC: JWT cookie, accesscontrol library, RoleAuthGuard, @CheckPermission decorator.
- Payments: ZaloPay + VNPay strategy pattern; verified callbacks; idempotency (UNIQUE order_id); payment-result endpoint; payment_methods table.
- Orders: create/cancel/paginate/admin-list; owner-or-admin guard; PDF invoice; PaginatedResponse
- GHN + COD: full shipping flow — COD order → GHN push → webhook status transitions → payment_completed emit.
- Inventory: atomic reserveStock (conditional UPDATE); stock sync via RabbitMQ FANOUT.
- Product: multi-category ManyToMany; search indexes (7); cache-aside 5s TTL + invalidation; imageUrls JSON column
- Product SKU matrix: product_skus table, variations JSON, transactional upsertSkus, gateway SKU routes.
- Cart: Cart + CartItem entities (orders service); 5 TCP patterns; gateway fetches authoritative price before forwarding; snapshot columns removed; createOrder() price-injection fix
- User: GET /api/user/me + PATCH /api/user/:id; JWT claim fix (req.user.id); GET_ME + UPDATE_USER patterns
- Social: Post CRUD, Like/Unlike (Redis cache), Comment + Reply tree (materialized-path depth 5), Follow/Feed, isLiked (OptionalJwtAuthGuard)
- Notification: RabbitMQ consumers (payment/order/social events) → DB → paginated REST + WS push.
- Real-time Chat: TCP service (3012), WS via gateway /chat namespace, 1-1 + reply, cleanup cron.
- WebSocket: notification push gateway, JWT auth, per-user rooms.
- Cloudinary: signed upload/delete signature endpoints; image_urls JSON on products + posts.
- Infrastructure: nginx (TLS, WS upgrade, payment callbacks), PM2 ecosystem.config.js, trust proxy.
- MicroserviceErrorHandler 2-layer: HttpToRpcExceptionFilter on all microservice controllers.
- PaginatedResponse.of() factory in @app/common; PaymentMethod enum in @app/common
- api.md fully updated: 14 controllers, all TCP patterns, RabbitMQ events table.
- Product imageUrls fix: gateway DTOs + FE aligned on camelCase imageUrls.
- RewardPoint entity camelCase property names with @Column({ name }) aliases.
- Brand/Category approval flow (Phase 1): pending/active/rejected status + admin review endpoints + RBAC grants.
- Brand/Category approval flow (Phase 2 — notifications).
- Brand/Category approval flow (Phase 2b — Admin UI).
- Brand/Category approval flow (Phase 2c — Product form).
- CheckoutPage: authoritative product name/image via getMultipleWithInventory (FE).
- ProductDetail: variant selection guard on add-to-cart (FE).
- ShopPage: product Edit/Delete row actions (FE).
- useAuth: migrated to GET /api/user/me via react-query; no localStorage reads for display data
- tsc: zero errors, clean build across all services
- Per-SKU inventory Phase 2+3 complete.
- Notification WS moved to gateway.
- Product search by creator + SKU.
- Per-SKU inventory Phase 4 complete.

## Recently Completed

- Payment browser-return completion / NEW (2026-06-26).
- Payment browser return URL (2026-06-26).
- Order snapshot / P2-02 (2026-06-26).
- Chat conversation metadata / P1-06 (2026-06-26).
- nodeB idle-crash root-cause fix + gateway inventory resilience (2026-06-26).
- Pagination / stat endpoints / P2-05 (2026-06-26).
- Multi-category hydrate / P1-04 (2026-06-25).
- Social↔commerce relation / P1-03 (2026-06-25).
- Order item enrichment + per-status counts / P1-02 (2026-06-25).
- Seller order lifecycle / P1-01 (2026-06-25).
- SKU diff + reference protection on product edit / P0-05 (2026-06-25).
- Create-order idempotency / P0-04 (2026-06-25).
- Atomic product+inventory create & orphan cleanup / P0-03 (2026-06-25).
- Stale-reservation sweeper (2026-06-25).
- SKU tierIdx integrity guard (2026-06-24).
- Distributed order creation compensation.
- Inventory reservation idempotency.
- Successful one-click e-commerce Postman automation.
- Full one-click e-commerce Postman automation.
- Product image upload automation.
- Gateway dead endpoint cleanup.
- RabbitMQ acknowledgement + public-route auth alignment.
- Payment completion idempotency.
- Multi-seller payment deduplication.
- Reserve stock before order commit.
- Inventory write authorization.
- Product ownership enforcement.
- Order IDOR fixes.
- Removed obsolete `scripts/health-check-nodeA.sh` and `scripts/health-check-nodeB.sh`.
- Critical user API security fixes.
- GHN webhook security + transition integrity.
- Postman MCP workflow documented in `AGENTS.md`.
- AI documentation directory renamed from `docs/` to `ai-docs/` so repository documentation is clearly distinguished from agent context; all Codex/Claude entry points, skills, permissions, and internal references now…
- Agent context consolidation.
- GHN webhook PascalCase fix + Postman collection.
- Payment gateway selected by user's paymentMethod (env decoupled).
- GHN shipping fee + cancel integration.
- Reserved-stock consume on delivery.
- Stock double-decrement fix.
- Multi-seller stock pre-check.
- Multi-order payment-url lookup fix.
- Multi-order payment gateway wiring.
- Multi-order payment support.
- Product Review feature (Phases 0–4 complete).

## Resolved Audit (2026-06-19)

Static review across gateway, user, product, inventory, orders, payments, rewards, notification, social, and chat. Critical findings were resolved. Validation at audit time: `npx tsc --noEmit` passed with zero errors; ESLint had 6 formatting errors + 7 warnings in files not touched by the read-only audit; runtime flows were not executed (stack not started). Remaining unresolved medium-severity gaps were promoted into `snapshot.md` → Known Issues.
