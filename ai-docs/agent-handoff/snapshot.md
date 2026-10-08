# Snapshot — Current State

> Auto-loaded every session, so every word here is paid on EVERY session. Keep
> it LEAN: only the live picture (overview, open work, open questions, prod-owed
> items). Everything else has a home:
>
> | Content | File (not auto-loaded) |
> |---|---|
> | Finished work, rationale of past changes | `ai-docs/agent-handoff/CHANGELOG.md` |
> | Designs decided but NOT started | `ai-docs/agent-context/planned-work.md` |
> | Residual behaviour of shipped fixes | `ai-docs/agent-context/known-behaviors.md` |
> | Ops: deploy, pm2, nginx, env, EC2, migrations, GHN ops, seed | `ai-docs/agent-context/ops-runtime.md` |
> | Rules / conventions | `ai-docs/agent-context/*.md` |
>
> Never duplicate a rule from `ai-docs/agent-context/` here.

## System Overview

TryBuy — NestJS monorepo, 10 microservices + 4 shared libs.
Transport: TCP (sync) + RabbitMQ FANOUT (async).
DB: Aiven MySQL 8 (orders/user/product/social/notification/chat) + Aiven
PostgreSQL (inventory/payments/rewards). Cache: Redis (Docker).
Node A: gateway:3000 (HTTP+WS /chat+/notifications), orders:3001, user:3003,
product:3006, social:3008, notification:3009 (TCP+RMQ only, no HTTP), chat:3012 (TCP).
Node B: inventory:3002, payments:3005, rewards:3004.
Base URL: http://localhost:3000 | Swagger: /doc
Prod: EC2 + pm2 (compiled dist), nginx in front, https://<PROD_API_DOMAIN>.

**Status:** backend is deploy-ready and deployed. All P0/P1/P2 FE-blockers,
deploy gate G1–G5, feature roadmap F1–F7, SEC/PERF backlogs, SCALE-01..05/07,
PUBID-00..07, DEP-01, CD-01/02, RESIL-01..03, TCP-RESIL-01 and PRODTEST-0806 are
DONE — see `CHANGELOG.md`. The public-id (PUBID) contract lives in
`ai-docs/agent-context/api.md`.

## Active Tasks

What is genuinely open:

### Feature Roadmap (`/sweep propose` 2026-10-01 — free-tier only)

Order picked by the user: F8 → F9 first, then F10..F12.

- [x] **F8 RMQ-DLQ-01** → **DONE 2026-10-01** (local), see CHANGELOG. Deployed
  2026-10-02. Still owed: confirm the gateway logs `Dead-letter policy applied`
  on prod — the prod RabbitMQ user needs the `policymaker` tag, or it fails
  open with no dead-lettering (`ops-runtime.md` §RabbitMQ dead-letter queue).
- [x] **F9 SESSION-REVOKE-01** → **DONE 2026-10-01** (local), see CHANGELOG.
  Deployed 2026-10-02. Redis-only `validAfter`, no migration. Class B — a role change
  now logs the target out (FE handoff written).
- [x] **F10 REVIEW-VERIFIED-01** → **DONE 2026-10-01** (local), see CHANGELOG.
  Deployed 2026-10-02. The purchase gate already existed (404), so the work was the
  seller self-review 403 and a read-time `isVerifiedPurchase`; class B, not C.
- [x] **F11 WISHLIST-ALERT-01** → **DONE 2026-10-01** (local), see CHANGELOG.
  Deployed 2026-10-02. product → notification over PRODUCT_EXCHANGE (inventory was
  untouched: it already mirrors stock into product). Class B, FE handoff written.
- [x] **F12 ACCOUNT-DELETE-01** → **DONE 2026-10-01** (local), see CHANGELOG.
  Deployed 2026-10-02. `DELETE /api/user/me` anonymizes in place, keeps content and
  orders; no migration after all. Class B, FE handoff written.

`/sweep 3` 2026-10-02 (user pick, both from the FE roadmap):

- [x] **F13 ORDER-TIMELINE-01** → **DONE 2026-10-02** (local), see CHANGELOG.
  Deployed 2026-10-02. New `order_status_history` table (1 additive migration, applied); transitions before the deploy are not backfilled. Class B, FE
  handoff written.
- [x] **F14 RETURN-PHOTO-01** → **DONE 2026-10-02** (local), see CHANGELOG.
  Deployed 2026-10-02. Up to 5 owner-prefixed `trybuy/returns` images on a return
  request, `imageUrls` always an array (1 additive migration, applied).
  Class B, FE handoff written.

`/sweep propose` 2026-10-05 (user pick):

- [x] **F15 NOTIF-INBOX-01** → **DONE 2026-10-05** (local), see CHANGELOG.
  `PATCH /api/notifications/read-all`, `DELETE /api/notifications/:id`,
  `?unreadOnly=true`. 1 index-only migration. Class B, FE handoff written.
  Deployed 2026-10-05; read-all and `?unreadOnly` answered 200 on prod.

`/sweep propose` 2026-10-07 (user pick: a real RAG project, free tier only):

- [x] **F16 PRODUCT-QA-01** → **BE DONE 2026-10-07**, see CHANGELOG. Class B.
  New nodeB `assistant` service; contract
  `ai-docs/specs/PRODUCT-QA-01/contract.md` (implemented). Deployed
  2026-10-07 (Deploy run 37603854117); the FE ships after it. Prod steps
  still owed under §Prod-owed.
- [ ] **F17 RAG-EVAL-01** — offline retrieval/answer eval set for F16 (after F16).

### Prod-owed

- [ ] **VNPAY-TMN-71-01 — VNPay sandbox rejects our terminal (code 71), user
  action.** Every VNPay checkout ends on `Error.html?code=71` ("website not
  approved"), on prod (`C8XARG2R`) AND locally (`JQNZCA3V`). Not a code bug —
  see `ops-runtime.md` §Payments. Steps: (1) re-register at
  `sandbox.vnpayment.vn/devreg` (or get the terminal approved); (2) set the new
  `VNP_TMN_CODE` + `VNP_HASH_SECRET` in the nodeB env on the box and in
  `local/nodeB/.env`; (3) `pm2 restart payments`; (4) place a NEW VNPay order
  (old rows keep URLs signed with the old code) and expect the VNPay card page,
  not code 71 — this re-runs FE prod route test 7.1.
- [ ] **PRODUCT-QA-01 go-live (BE deployed 2026-10-07; FE follows).**
  1–2. DONE 2026-10-07: `GEMINI_API_KEY` is on the box, the CD migrate step
     applied `nodeB-20261007-001-add-rag-tables` (Deploy run 37603854117),
     pm2 `assistant` came up online, and an anonymous ask on prod answered
     401 (route live).
  3–4. DONE 2026-10-07 (17:12–17:14 UTC): `npm run rag:backfill` on the box
     enqueued all 24 active products, the assistant log shows 24
     `indexed` lines, every Gemini embed answered 200 (~0.5s) and there was
     no 429, warn or error. `free -m`: 1.4 GB of 7.7 GB used.
  5. ⏳ PENDING RUNTIME TEST (PRODUCT-QA-01): ask once with the key unset or
     wrong and expect the exact 503 `ASSISTANT_UNAVAILABLE` body, while an
     unrelated 5xx stays `Internal server error`. Also check the ask p95 < 10s
     in Grafana after some real traffic.
- [ ] **GHN-WEBHOOK-E2E-01 — prove a real GHN callback reaches prod
  (unblocks OQ-2 step 4).** The portal is configured and the auth probe passes
  (see OQ-2), but GHN has never actually called prod. Steps:
  1. With the user's consent, place one test order on prod as shop1/admin1
     from `test-accounts.md`, so a GHN sandbox waybill gets created. EC2 must
     be up.
  2. Move the waybill's status, or wait for GHN sandbox to move it.
  3. Confirm `http_requests_total` shows a `POST /api/ghn/webhook` 200
     (`/metrics` with `METRICS_TOKEN`, or Grafana), and that
     `GET /api/order/:id/history` has the GHN row.
  4. Cancel the test order. Then delete the `?token=` query branch in
     `apps/gateway/src/ghn/ghn-webhook.controller.ts` and close OQ-2.
  Do NOT place the order without asking first: it is a real prod order row.
- No migration owed. `nodeA-20261005-001-add-notifications-user-index` was applied
  by the CD migrate step on 2026-10-05 (Deploy run 37301536206). The six nodeA
  migrations from 2026-09-28..2026-10-02 (export
  jobs, checkout voucher columns, notification product_public_id, order status
  history, return-request image_urls, shipping/return indexes) were applied by
  the CD migrate step on 2026-10-02 (Deploy run 36980317347); every route that
  depends on them answered 200 on prod right after.

DEPLOY-PG-01 was resolved 2026-09-16; both migration failure modes now live in
`ops-runtime.md` (§CI/CD and §Database migrations). No config gap remains:
MONITOR-01 closed 2026-10-03 and CAPTCHA-01 is ENFORCED on prod since
2026-10-06 (see CHANGELOG).

### Worth a decision, not yet work

- **A real TCP e2e suite still does not exist.** The 7 dead `app.e2e-spec.ts`
  scaffolds were DELETED 2026-09-11 (E2E-SCAFFOLD-01), so the suite no longer
  lies about its coverage — but the gap they pretended to fill is still open.
  Anything real needs live Redis/RabbitMQ/Aiven in CI, which collides with
  free-tier-only; unit coverage (51 suites / 601 tests) is what exists today.
- **CD-03 — build-on-runner deploy variant.** Only if the EC2 gets
  smaller/slower (CI-built `dist/` rsync + `npm ci --omit=dev` + restart). Not
  needed while CD-01 works.
- **GHN Web console (`../web-flow-GHN`)** — backend is ready; the remaining work
  is all FE. Only backend contract still blocking it: analytics charts. Steps
  and deps in `planned-work.md`.
- **CTX-PROV-02 — 39 of 74 `known-behaviors.md` anchors carry
  `verified=unrecorded`** (9 prod, 26 local; SEARCH-01, AUTHOR-NAME-01 and
  NAME-TRIM-01 were upgraded to `prod:2026-09-16` by actually exercising them on
  prod after the release; ROLE-ADMIN-01 moved to `local:2026-10-01` when
  SESSION-REVOKE-01 changed its behaviour). Upgrading a tag means actually EXERCISING the
  behaviour (services up, an account from `test-accounts.md`, curl, assert the
  documented outcome), then `verified=prod:<date>` or `local:<date>` for where
  you ran it. Editing the tag without running anything destroys the only thing
  the field is for. Do it drip-feed — when a task makes you open an entry and
  you verify it anyway, upgrade that one — never as a 47-step sweep.
- ~~CONV-CHECK-02 — three more `check-conventions.mjs` assertions~~ → **DONE
  2026-09-17**, see CHANGELOG. Rule **(c) Create/Update DTO drift was DECLINED**
  and should not be re-proposed: of 11 candidate Update DTOs only 4 have a real
  Create sibling, and the strongest of those (`UpdateVoucherDto`) must NOT become
  a `PartialType` — the redeclaration is what encodes the deliberate
  create-vs-edit `null` asymmetry documented in VOUCHER-NULL-01. A gate demanding
  what known-behaviors.md forbids is the wrong gate.

### Audit backlog (SWEEP-0925, `/sweep audit` 2026-09-25 — recorded, not fixed)

-02/-03 DONE → CART-UNIQ-01; -04 DONE → RAIL-RANK-01 (see CHANGELOG).

- ~~ADMIN-ORDERS-RBAC-01 — shop read every seller's orders via
  `/order/admin/orders`~~ → **DONE 2026-09-28**, see CHANGELOG.

The one standing instruction:

- ~~AUD-0925-01 — `order_created` consumers not idempotent under outbox
  redelivery~~ → **DROPPED 2026-09-25 by the user**: rewards has no FE yet.
  Do not re-record the rewards double-credit (`reward_points` has no
  UNIQUE(order_id)) until the FE builds rewards.

### Audit backlog (SWEEP-1002, `/sweep audit` 2026-10-02 — recorded, not fixed)

All seven items are closed and on prod (Deploy 37301536206, 2026-10-05).

- ~~SWEEP-1002-01 — a timed-out checkout released its Idempotency-Key~~ →
  **DONE 2026-10-02** (local), see CHANGELOG. Deployed 2026-10-02. Class B.
  Follow-up IDEM-HOLD-CODE-01 (FE ask): that 409 now carries
  `errorCode: ORDER_REQUEST_IN_PROGRESS` → **DONE 2026-10-03** (local), see
  CHANGELOG. Class B. Deployed 2026-10-05.
- ~~SWEEP-1002-02 — `shipping_history` / `order_return_requests` had no
  order/user index~~ → **DONE 2026-10-02** (local), see CHANGELOG. Deployed 2026-10-02.
  Class A; 1 index-only migration, applied.
- ~~SWEEP-1002-03 — checkout made 2N serial orders→inventory round trips~~
  → **DONE 2026-10-02** (local), see CHANGELOG. Deployed 2026-10-02. Class A. The
  stock pre-check now fans out; the reserve pass is still serial (-05).
- ~~SWEEP-1002-04 — dead `payment_completed` handler in rewards~~ → **DONE
  2026-10-02** (local), see CHANGELOG. Deployed 2026-10-02. Class A.
- ~~SWEEP-1002-05 — the reserve pass was N serial inventory calls~~ →
  **DONE 2026-10-03** (local), see CHANGELOG. Class A, no migration, nodeA
  and nodeB both change (deployed together 2026-10-05). Prod RTT measured at
  ~100 ms, so a 20-line cart outran the 10s budget. It is now one
  all-or-nothing `INVENTORY_RESERVE_STOCK_MANY` per seller.
- ~~SWEEP-1002-06 — a WS `send_message`/`join` without `conversationId`
  landed in the FIRST conversation~~ → **DONE 2026-10-02** (local), see
  CHANGELOG. Class A. Deployed 2026-10-05.
- ~~SWEEP-1002-07 — the nightly chat cleanup 1451'd under the prod NO ACTION
  parent FK~~ → **DONE 2026-10-03** (local), see CHANGELOG. Class A, no
  migration: the cron detaches replies before the DELETE. The FK drift
  itself (DEV CASCADE/SET NULL vs prod NO ACTION) is left as-is, because the
  code no longer depends on the rule. Deployed 2026-10-05.

### Audit backlog (SWEEP-1005, `/sweep audit` 2026-10-05 — recorded, not fixed)

All four fixed 2026-10-05, see CHANGELOG; deployed together (nodeA + nodeB)
by Deploy run 37351597811 on 2026-10-05. The orphaned single-line inventory
handlers were deleted 2026-10-08 (local, not pushed), see CHANGELOG.

- ~~SWEEP-1005-01 — a failed release on cancel skipped the voucher, GHN and
  `order_canceled` legs~~ → **DONE 2026-10-05**, see CHANGELOG. Class A.
  The consumer is the retry and dead-letters a never-releasable line
  (CANCEL-RELEASE-01).
- ~~SWEEP-1005-02 — release/consume were N serial inventory calls~~ → **DONE
  2026-10-05**, see CHANGELOG. Class A, no migration.
- ~~SWEEP-1005-03 — empty never-acking payments `payment_completed`
  handler~~ → **DONE 2026-10-05**, see CHANGELOG. Class A.
- ~~SWEEP-1005-04 — unbounded `GET /api/chat/conversations`~~ → **DONE
  2026-10-05**, see CHANGELOG. Class B: silent cap of 100 by last activity,
  array shape kept (CHAT-LIST-CAP-01); FE handoff written.

### Planned but not started

Full designs (scope, shape, landmines, release class) live in
`ai-docs/agent-context/planned-work.md` — load it with the Read tool when you
pick one up. Do not re-derive them:

- **AI-03 / AI-04** — Sell From Photo, Visual Search (Gemini; AI-04 adds 1 migration).
- **AI-02F5** — pHash lookup scale path (gated on ~10k products).
- **Redis pre-deduct stock via Lua** — gated on a real flash-sale event; the
  primitive is proven by VOUCHER-CONC-01.

## Open questions

- **OQ-2:** can GHN webhook `?token=` query auth be REMOVED entirely (header
  `x-ghn-webhook-token` is preferred and a deprecation warn already logs on
  query use)? **Answered 2026-10-06 (docs only, not seen in the live
  account): yes.** GHN Developer Portal → Webhook configuration takes custom
  headers, configured separately on `developer.ghn.dev` (sandbox) and
  `developer.ghn.vn`. GHN drops a 4xx callback with no retry, so the order is
  fixed: (1) add the header and keep `?token=`; (2) confirm the deprecation
  warn stops in gateway logs; (3) drop `?token=` from the URL; (4) only then
  delete the query branch. Full answer: `backend-handoff.md` § Open →
  `OQ-2 · answer`. **Progress 2026-10-06:** the sandbox portal Order endpoint
  was EMPTY before (GHN had never called prod), so `?token=` was never in use
  and steps 2–3 are moot. The user saved the portal config: `/api/ghn/webhook`,
  header `x-ghn-webhook-token`, timeout 15s. Prod probe answered 200 with
  the header and 401 without it or with a wrong one. Still owed: one real GHN
  callback answering 200, then step 4 — tracked as GHN-WEBHOOK-E2E-01
  (§Prod-owed).
- **OQ-6:** target rate-limit numbers for login/register/upload/checkout
  (product decision) — also informs nginx `limit_req` tuning if FE fan-out
  trips 429.

## Known Issues — index only

> GENERATED from the `summary=` anchors in `ai-docs/agent-context/known-behaviors.md`
> — do not hand-edit; run `node .claude/hooks/kb-hint.mjs --index --write`.
> Every line is a residual/deliberate behaviour of a **shipped** fix, NOT an open
> bug. Match your task against these by MEANING, not by keyword: the stage-0 hook
> only greps `keys=`, so it misses paraphrase and mixed VN/EN prompts. When one
> looks related, grep its id out of that file and read the entry before you
> re-diagnose it, change it, or write a test asserting the opposite contract.

**Orders / fulfilment**
- PAYURL-01 — Single-seller checkout returns NO paymentUrl; GET /:id/payment-url answers with the key orderUrl.
- ORD-RBAC-01 — ship/deliver/complete are admin-only; a seller gets 403 before the order is even loaded.
- ORD-GUARD-01 — A NULL paidAt on a non-COD order blocks every seller transition with a 400 — admin included, no override.
- PAYRET-LEGACY-01 — Payment rows before 2026-08-07 keep a numeric order id in the stored return URL and cannot be rewritten.
- BUG-D — Buyer cancel detaches the GHN cancel — two failed attempts leave a live waybill on a CANCELED order.
- NOTIF-LIFECYCLE-01 — Which lifecycle transitions notify whom; emails are gated to shipping milestones and order_canceled has its own event.
- ORDER-SHAPE-01 — HTTP emits `image` only; productImage survives internally and on the one admin GHN console detail route.
- ORD-CRON-01 — No orders @Cron ever fired before 2026-08-13; the stale-reservation sweep then started with a backlog.
- EXPORT-CSV-01 — The seller CSV export is one row per ORDER ITEM, and the four order-level money columns are written on each order's first row only so a column SUM does not double-count.
- EXPORT-TZ-01 — Order timestamps and every from/to day window are Vietnam wall-clock computed in code, because the server TZ is UTC on prod and UTC+7 on dev — do NOT "fix" a zone bug by setting TZ or the connection timezone.
- CART-UNIQ-01 — carts.user_id and cart_items (cart_id, product_id, COALESCE(sku_id,0)) are UNIQUE, so a racing add re-reads the winning cart or atomically increments the winning line; a line holds an integer 1..999 (a summed add past 999 is a 400, racing adds can overshoot by one request); skuId 0 means no SKU, and a concurrent remove-last-item can still drop an add.
- CART-STOCK-01 — POST /api/cart answers 409 PRODUCT_INACTIVE for a deactivated product or SKU, OUT_OF_STOCK when inventory has 0 available (or no row), and QUANTITY_EXCEEDS_STOCK when the units already in that line plus the request exceed available stock; the check is gateway-only and fails OPEN on a cart-read or inventory error, PATCH /api/cart/items/:id is NOT checked, and checkout's reserve stays the real gate.
- CHECKOUT-INACTIVE-01 — Checkout, voucher/validate and vouchers/available answer 400 "Product <id> is not available" for a line whose product is deactivated even when its SKU is still active, checked before the SKU's own checks, so one such line fails the whole basket (no errorCode, the cart keeps the line).
- ORDER-TIMELINE-01 — GET /api/order/:id/history (owner or admin, a seller is a 403) merges placed, paid, local status changes and successful GHN webhook/sync rows oldest first; status changes exist only from 2026-10-02, are recorded best-effort after the write (a failed insert drops that event, never the transition), and consecutive identical GHN statuses collapse to one.
- RETURN-PHOTO-01 — A return request takes up to 5 unique jpg/png/webp URLs from the trybuy/returns Cloudinary folder whose leaf starts with the caller's id (403 MEDIA_NOT_OWNED otherwise, before any TCP call), and a 400 carries errorCode RETURN_PHOTO_INVALID only when imageUrls is the sole failing field; orders stores none as NULL and every read emits imageUrls as an array ([] for legacy rows); the URLs are not checked to exist, are fixed once created, and are never deleted from Cloudinary.
- IDEM-HOLD-01 — POST /api/order releases its Idempotency-Key only on a definite 4xx other than 408; a 408, a 5xx or a transport failure re-holds the key as in-progress for 300s, so a same-key retry inside that window is a 409 with errorCode ORDER_REQUEST_IN_PROGRESS even when no order was created, and the result is never replayed for an order that committed after the gateway gave up.
- CANCEL-RELEASE-01 — Cancel, GHN cancel, the sweeper and account delete release every line in ONE inventory call (10s WRITE timeout) and only LOG a failure, then still run the voucher give-back, the GHN waybill cancel and order_canceled; the inventory order_canceled consumer re-releases idempotently, requeues on a thrown error and dead-letters a line that can never release, while completion consumes in one call too and still only logs.

**GHN**
- GHN-ADDR-01 — Free-text address resolution is best-effort and can match a wrong-but-valid location; sending both ids skips it.
- GHN-FAIL-01 — delivery_fail (and exception/damage/lost) deliberately move no local order status.
- GHN-FAIL-NTF-01 — The buyer is notified on the FIRST delivery_fail only, deduped via shipping_history; in-app only, no email, no seller copy.
- GHN-FAIL-NTF-02 — A CANCELED/COMPLETED/REFUNDED order is never told about a missed attempt; RETURN_REQUESTED still is.
- GHN-DIST-01 — An unknown district or cross-district ward is a 400, but the validation is fail-open on a GHN outage.
- GHN-ETA-01 — The stored ETA is refreshed by the manual sync only, never by the webhook; create and detail name the field differently.
- GHN-CREATE-01 — Order create 400s on a GHN refusal but still places the order at fee 0 on a GHN outage.
- GHN-MSG-01 — 12 of 19 Quan 8 wards cannot be ordered to; do NOT "fix" it by quoting from /shipping-order/fee.

**Products / inventory**
- BUG-A — skuList is the FULL desired set, not a delta; omitted SKUs are removed and the reference check fails safe.
- P0-03 — Product-create compensation rolls the product row back; sku-collision discrimination reads error.driverError.detail.
- PATCH-LOCK-01 — products.version is OPT-IN, and background writers bump it too — a 409 does not mean a human edited the product.
- BUG-B — The public catalog defaults isActive:true; a single userId is the only exception, and it is an anonymous leak by design.
- RETURN-STOCK-01 — An approved return restocks through inventory.restock_returned, not a release; the fix is not retroactive.
- STOCK-SYNC-01 — Stock syncs two-way — adjust from either side with ONE absolute write; SKU-matrix products are warn-and-skip.
- PATCH-ATOMIC-01 — A product PATCH is up to three writes across two DBs and is NOT atomic — a failed PATCH does not mean nothing changed.
- INV-CONTRACT-01 — inventory_v2.sku is a warehouse label with no resolver — it drifts from products.sku on purpose.
- PATCH-NULL-01 — null on a product PATCH clears exactly six nullable columns; anywhere else it is a 400 by design.
- RAIL-RANK-01 — Featured sellers and GET /api/products/trending rank by units sold over a rolling 30 days of CONFIRMED..COMPLETED orders, backfill with soldCount 0, fail open on the orders/inventory legs and cache 60s; viewCount/likesCount/isTrending are still never written.
- XSS-DESC-01 — Product description is allow-list sanitized on WRITE (create and PATCH) by a dependency-free rebuild sanitizer, so the storefront may render it raw; rows written before 2026-09-25 are cleaned only on their next edit.
- REVIEW-VERIFIED-01 — Reviewing without a COMPLETED order holding the product stays a 404 (not 403), a seller reviewing their own listing is a 403, and isVerifiedPurchase is resolved at read time — it flips to false after a refund/return and is null when the orders leg fails.
- WISHLIST-ALERT-01 — A wishlisted SIMPLE product notifies its wishlisters (seller excluded, newest 1000) in-app when stock goes from <=0 to >0 or a PATCH lowers the price; one alert per product per 6h/24h window, claimed in Redis fail-closed, so a later wishlister or a second drop inside the window gets nothing; SKU products never alert.
- PRODUCT-QA-01 — POST /api/products/:id/ask answers only from the product's indexed name, description, SKU labels/prices and reviews (stock, brand and category are never indexed), counts every authenticated call against 5/min per user before validation, and reads an index that is only as fresh as the last successful product.index_changed — a Gemini failure leaves the product pending (NO_SOURCES or the old text) until the 5-minute retry or the next write; any timeout, outage or Gemini quota is one 503 ASSISTANT_UNAVAILABLE.

**Data shape / errors**
- QUERY-ARRAY-01 — ?x[]= is a 400 by design; use repeated keys or a scalar, and wrap any new array query field with @Transform.
- ENVELOPE-01 — The envelope `error` field is always the HTTP reason phrase, never an exception class name.
- OVERFETCH-01 — Gateway read payloads are trimmed at the boundary; the actor/reporter/reviewer embeds must keep ONE shape.
- SHAPE-01 — Residuals of the data-shape rules — empty-cart key set, DB-order batch reads, null (not {}) for a missing relation, no decorator sweep.
- BATCH-FAIL-01 — On a batch product read the product leg errors (502/408) while the inventory leg degrades to inventory: null.
- ENRICH-FAIL-01 — A user-service outage can turn a committed social write into a 502; exposeSubmittedBy drops its field instead.
- ENRICH-BATCH-01 — Label every user embed with username; the nullable name rides along only on two row-dump routes.
- AUTHOR-NAME-01 — The social author embed carries name as the DISPLAY name (nullable), while product.user.name is the username.
- NAME-TRIM-01 — A whitespace-only name or username is now a 400, trimmed at the gateway DTO — the user service’s own pipe never runs.

**Social / chat / media / moderation**
- SOCIAL-AUTHOR-01 — The comment `author` embed is decorated in the gateway and is legitimately null on a user-service failure.
- SOCIAL-502 — Gateway transport failures collapse to one sanitized 502; the 100ms retry is reads-only and always after timeout().
- MEDIA-ORPHAN-01 — Post media cleanup is reference-counted and best-effort — a URL shared by another post is never destroyed.
- UPLOAD-SIZE-01 — Upload size caps are an advisory contract, NOT a security boundary — Cloudinary cannot sign a size on this account.
- REPORT-TOTAL-01 — Reports outlive their deleted post as an audit trail, so the queue total can read lower than the raw table count.
- CHAT-ROOM-01 — new_message targets a union of user: and conv: rooms, so a recipient no longer needs to join.
- CHAT-E2E-CLEANUP-01 — DELETE /api/chat/messages/:id hard-deletes the caller's own message (204; 403 for anyone else, 404 unknown or already gone, 400 bad msg_ id); replies keep their content but lose parentMessageId, and no socket event or tombstone tells the other side.
- SOCIAL-LIKE-NTF-01 — Likes fold into one unread `like` row per (owner, post) whose count lives in the message text; a read row starts a new one, self-likes and unlikes notify nothing, and the count can overshoot.
- NOTIF-INBOX-01 — PATCH /api/notifications/read-all flips only the caller's unread rows and answers {updatedCount}, DELETE /api/notifications/:id hard-deletes the caller's own row (204; an unknown, already-deleted or foreign id is the same 404, a malformed id is a 400) with no socket event, and ?unreadOnly= accepts only the literal true/false (anything else is a 400) and drives total/totalPages.
- CHAT-LIST-CAP-01 — GET /api/chat/conversations returns a plain array of at most the 100 conversations with the latest activity (newest message, or creation time when none survives the 5-day retention), with no pagination and no total, so a 101st older conversation silently disappears until it gets a new message.

**Search**
- SEARCH-01 — Accent-insensitivity comes from the MySQL collation, not code; % and _ are not escaped and a blank q is a 400.
- LIST-SEARCH-01 — Nine paginated lists take an optional trimmed ?q= (max 100) that ANDs with their filters and LIKE-escapes % and _, while the social feed/user-posts ?search= stays an unescaped wildcard; every q searches only columns its owning service stores.

**Vouchers**
- VOUCHER-CONC-01 — The Redis voucher quota is an admission gate that fails OPEN and can read pessimistically for up to 300s.
- VOUCHER-NULL-01 — null is a 400 on a voucher edit but still a 201 on create — the asymmetry is deliberate.
- VOUCHER-CANCEL-01 — Cancelling gives the redemption back, so cancel-farming a limited code is possible by design; a platform voucher shared by a multi-shop checkout moves to a live sibling instead until the last sub-order is canceled.
- VOUCHER-EDIT-01 — On a redeemed voucher only loosening is allowed, so a mistaken widening cannot be walked back.
- VOUCHER-SHOP-01 — Shop-voucher residuals — at most one shop voucher per seller plus one platform voucher per checkout, the platform discount is priced after shop vouchers and split pro rata by largest remainder; the available list rates each row next to the applied voucherCodes (platform rows on the post-shop base, a shop row that would drop the applied platform code below its minimum is BREAKS_PLATFORM_VOUCHER); sellerId is only checked to exist, available caps at 50, and sellerId:null is a platform voucher.

**Auth / mail**
- MAIL-UI-01 — The reset-code mail has no copy button by design (clients strip script) and repeats the code in the subject.
- CHG-PW-02 — errorCode is optional, closed-set, and deliberately survives the prod 401 sanitizer; only the user service forwards it.
- MAIL-UI-02 — One template for all nine order mails; the CTA origin is FRONTEND_URL entry [0] and the audience decides the path.
- RESET-EXHAUST-01 — Five reset rejections share one 400; only the attempt-limit one carries an errorCode, via a separate marker key.
- RESET-TTL-01 — The reset code lives 60s, not 600 — live on prod since 2026-09-10.
- CHG-PW-01 — change-password revokes every session of the user and re-issues the caller's own cookie with the same exp, so the caller stays logged in and every other device gets a 401.
- SESSION-REVOKE-01 — A JWT is rejected when its iat is older than the user's Redis validAfter, bumped by password change/reset, an actual role change and POST /api/user/logout-all; the check fails OPEN on a Redis error, a same-second token survives, and plain logout still revokes nothing.
- EMAIL-REAUTH-01 — PATCH /api/user/:id requires currentPassword only when email actually changes (missing is a 400, wrong is a 401 with INVALID_CURRENT_PASSWORD); an unchanged email is re-sendable without it and the route is throttled 10/min.
- MAIL-BOUNCE-01 — Mail to the fixture domain / RFC-reserved names is dropped before SMTP after a 45h bounce flood.
- ROLE-ADMIN-01 — An actual role change revokes the target’s sessions, so their next request is a 401 and the re-login carries the new role; GET /api/user/me still reports tokenRole/isRoleStale for the fail-open window.
- CAPTCHA-01 — Turnstile on register and forgot-password has three env postures (off / shadow / enforce); only enforce ever rejects, with a 400 CAPTCHA_REQUIRED, and a siteverify outage or a secret Cloudflare rejects fails OPEN.
- ACCOUNT-DELETE-01 — DELETE /api/user/me scrubs the user to deleted_<publicId> (name/avatar null, inactive, addresses gone, sessions revoked) but KEEPS posts, comments, reviews, chat and every order row; only PENDING..PROCESSING orders auto-cancel, the legs run in sequence and are not atomic, so a mid-way failure leaves canceled orders on a live account and the retry finishes the job; an admin cannot self-delete (403) and deleted_ is a reserved register prefix.

**Ops / probes**
- READY-01 — /ready really probes RabbitMQ but stays 200 on a broker outage; the result is cached 10s.

**Messaging**
- OUTBOX-SCOPE-01 — Only order_created is durable; every other RMQ publish is best-effort by design.
- RMQ-DLQ-01 — A consumer nack(requeue=false) lands in trybuy.dead_letter via a broker policy the gateway applies fail-open on startup, while fanout events a queue has no handler for are ACKED and never dead-letter; replay republishes to the rejecting queue only, bounded by the DLQ depth at call time.

## Ops / Runtime Reference

In `ai-docs/agent-context/ops-runtime.md` (load on demand — keywords: deploy,
pm2, nginx, prod env, EC2, cloudinary, GHN ops, applied migration, seed). It
covers prod runtime (FRONTEND_URL via pm2, EC2 stop/start schedule, log reading,
GATEWAY_HOST, nginx/SCALE-03), CI/CD (CD-01/03/04/05), the migration cutoff and
applied-migration ledger, seed/bootstrap (SEED-01), the full GHN reference,
payments, and feature ops contracts.

## History

Finished milestones and completed tasks live in `CHANGELOG.md` (same folder,
not auto-loaded). Read it only when you need the history or rationale behind a
past change.
