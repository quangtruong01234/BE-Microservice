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

Nothing is mid-implementation. What is genuinely open:

### Awaiting a push, not awaiting work

`../.agent-local/release-gate.md` **Holding** carries one entry: SEARCH-01
(+ ROLE-ADMIN-01, AUTHOR-NAME-01, NAME-TRIM-01).

**`api` was PUSHED 2026-09-16 (`d8b7f4e..87fc2f8`) and the deploy FAILED AND
ROLLED BACK — prod still runs `d8b7f4e`.** Do not read the git head as proof of
a release: the FE's original unblock test ("`git ls-remote origin main` ≠
`d8b7f4e`") now passes while prod does not have the code. The only honest test
is a runtime probe — `GET /api/social/posts?search=x` must not answer *"property
search should not exist"*, and `GET /api/user/search?q=x` must not answer
*"Invalid id"*. Both still fail on prod (measured 14:11Z). `frontend` therefore
stays HOLD. Cause and state: DEPLOY-PG-01 below.

### Prod-owed

- **DEPLOY-PG-01 🔴 — the prod Aiven PostgreSQL instance is GONE, so every deploy
  rolls back and Node B is dead on prod (found 2026-09-16).** The CD migrate step
  runs on the EC2 and dies with `getaddrinfo ENOTFOUND
  pg-prod-…….h.aivencloud.com`; the host does not resolve from the box or from
  here, while the DEV PG host still resolves. `deploy.yml` runs
  `db:migrate:nodeA`+`nodeB` under `set -e` BEFORE the restart, so the nodeB leg
  aborts the run and the `if: failure()` step resets prod to the previous sha —
  which is why a green push produced no release. Independent of the pushed code:
  the pm2 table in the rollback log shows inventory ↺21, payments ↺22, rewards
  ↺21 in *waiting restart* against ↺1 for every Node A service, and
  `GET /api/products/with-inventory/all` 500s on prod while Node A reads
  (`/api/social/posts`, `/api/products/categories`) are 200. **Nothing ships
  until this is decided:** restore/recreate the PG service and fix `PG_HOST` in
  `local/nodeB/.env` on the EC2, or make the nodeB migrate leg non-fatal so Node
  A can release while Node B stays down. The second is a deploy-policy change,
  not a fix — it ships code onto a box whose Node B half is still broken.
- ~~Migration `nodeA-20260911-001-add-expected-delivery-time-to-orders` is not
  applied to prod~~ → **APPLIED TO PROD 2026-09-16** by the failed run's migrate
  step (`[apply] nodeA-20260911-001-add-expected-delivery-time-to-orders`, which
  ran and succeeded before the nodeB leg failed). The rollback reverted the CODE,
  not the schema; the column is additive so `d8b7f4e` ignores it.
- **`METRICS_TOKEN` is UNSET in `local/nodeA/.env`**, so `GET /metrics` 404s on
  prod (verified 2026-08-15). Set it only when a scraper actually exists. Only
  the gateway is instrumented; the registry is per-process, so
  `GATEWAY_INSTANCES>1` would need `prom-client`'s cluster aggregator.

### Worth a decision, not yet work

- **A real TCP e2e suite still does not exist.** The 7 dead `app.e2e-spec.ts`
  scaffolds were DELETED 2026-09-11 (E2E-SCAFFOLD-01), so the suite no longer
  lies about its coverage — but the gap they pretended to fill is still open.
  Anything real needs live Redis/RabbitMQ/Aiven in CI, which collides with
  free-tier-only; unit coverage (42 suites / 444 tests) is what exists today.
- **CD-03 — build-on-runner deploy variant.** Only if the EC2 gets
  smaller/slower (CI-built `dist/` rsync + `npm ci --omit=dev` + restart). Not
  needed while CD-01 works.
- **GHN Web console (`../web-flow-GHN`)** — backend is ready; the remaining work
  is all FE. Only backend contract still blocking it: analytics charts. Steps
  and deps in `planned-work.md`.
- **CTX-PROV-02 — 47 of 56 `known-behaviors.md` anchors carry
  `verified=unrecorded`.** Upgrading a tag means actually EXERCISING the
  behaviour (services up, an account from `test-accounts.md`, curl, assert the
  documented outcome), then `verified=prod:<date>` or `local:<date>` for where
  you ran it. Editing the tag without running anything destroys the only thing
  the field is for. Do it drip-feed — when a task makes you open an entry and
  you verify it anyway, upgrade that one — never as a 47-step sweep.
- **CONV-CHECK-02 — three more `scripts/check-conventions.mjs` assertions.**
  Candidates: (a) writer symmetry — an `emit()` whose event has no
  `@EventPattern` consumer, (b) orphan handler — a `@MessagePattern` no gateway
  ever sends, (c) Create/Update DTO drift — an Update DTO redeclaring fields
  instead of `PartialType`. Gated on an AUDIT FIRST: count existing violations
  per rule before choosing hard-fail vs warn — `check:conventions` runs in CI
  (`.github/workflows/ci.yml`), so a rule that lights up working code turns the
  gate red on day one and trains people to skip it.

### Planned but not started

Full designs (scope, shape, landmines, release class) live in
`ai-docs/agent-context/planned-work.md` — load it with the Read tool when you
pick one up. Do not re-derive them:

- **EXPORT-CSV-01** — seller order export to CSV, split into T1 (shared csv util)
  → T2 (orders TCP leg) → T3 (gateway route, goes live); T4 admin / T5 async are
  optional. No migration, class B.
- **SOCIAL-LIKE-NTF-01** — liking a post notifies nobody (product decision, needs batching).
- **VOUCHER-SHOP-01 phase 2** — Shopee-style stacking + multi-shop apportionment.
- **AI-03 / AI-04** — Sell From Photo, Visual Search (Gemini; AI-04 adds 1 migration).
- **AI-02F5** — pHash lookup scale path (gated on ~10k products).
- **Redis pre-deduct stock via Lua** — gated on a real flash-sale event; the
  primitive is proven by VOUCHER-CONC-01.

## Open questions

- **OQ-2:** can GHN webhook `?token=` query auth be REMOVED entirely (header
  `x-ghn-webhook-token` is preferred and a deprecation warn already logs on
  query use)? Depends on what the GHN dashboard supports.
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

**Search**
- SEARCH-01 — Accent-insensitivity comes from the MySQL collation, not code; % and _ are not escaped and a blank q is a 400.

**Vouchers**
- VOUCHER-CONC-01 — The Redis voucher quota is an admission gate that fails OPEN and can read pessimistically for up to 300s.
- VOUCHER-NULL-01 — null is a 400 on a voucher edit but still a 201 on create — the asymmetry is deliberate.
- VOUCHER-CANCEL-01 — Cancelling gives the redemption back, so cancel-farming a limited code is possible by design.
- VOUCHER-EDIT-01 — On a redeemed voucher only loosening is allowed, so a mistaken widening cannot be walked back.
- VOUCHER-SHOP-01 — Shop-voucher residuals — sellerId is only checked to exist, available caps at 50, and sellerId:null is a platform voucher.

**Auth / mail**
- MAIL-UI-01 — The reset-code mail has no copy button by design (clients strip script) and repeats the code in the subject.
- CHG-PW-02 — errorCode is optional, closed-set, and deliberately survives the prod 401 sanitizer; only the user service forwards it.
- MAIL-UI-02 — One template for all nine order mails; the CTA origin is FRONTEND_URL entry [0] and the audience decides the path.
- RESET-EXHAUST-01 — Five reset rejections share one 400; only the attempt-limit one carries an errorCode, via a separate marker key.
- RESET-TTL-01 — The reset code lives 60s, not 600 — live on prod since 2026-09-10.
- CHG-PW-01 — change-password revokes nothing — an attacker’s stolen session survives it until its own expiry.
- MAIL-BOUNCE-01 — Mail to the fixture domain / RFC-reserved names is dropped before SMTP after a 45h bounce flood.
- ROLE-ADMIN-01 — A role change reaches the JWT only on the target’s NEXT login; GET /api/user/me exposes the drift as a signal only.

**Ops / probes**
- READY-01 — /ready really probes RabbitMQ but stays 200 on a broker outage; the result is cached 10s.

**Messaging**
- OUTBOX-SCOPE-01 — Only order_created is durable; every other RMQ publish is best-effort by design.

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
