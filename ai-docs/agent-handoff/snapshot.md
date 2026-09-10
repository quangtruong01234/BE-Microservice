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

### Held by the release gate

Nothing. `../.agent-local/release-gate.md` **Holding** and **Ready to release**
are both empty as of 2026-09-10 — check that file, not this line, before you
conclude a push is blocked.

### Prod-owed

- **`METRICS_TOKEN` is UNSET in `local/nodeA/.env`**, so `GET /metrics` 404s on
  prod (verified 2026-08-15). Set it only when a scraper actually exists. Only
  the gateway is instrumented; the registry is per-process, so
  `GATEWAY_INSTANCES>1` would need `prom-client`'s cluster aggregator.

### Worth a decision, not yet work

- **`/ready` cannot fail.** It reports `database:not_configured` and
  `rabbitmq:not_checked`, so readiness stays green even if RabbitMQ is down.
  The last live remnant of the PRODTEST-0806 sweep.
- **CD-03 — build-on-runner deploy variant.** Only if the EC2 gets
  smaller/slower (CI-built `dist/` rsync + `npm ci --omit=dev` + restart). Not
  needed while CD-01 works.
- **GHN Web console (`../web-flow-GHN`)** — backend is ready; the remaining work
  is all FE. Only backend contract still blocking it: analytics charts. Steps
  and deps in `planned-work.md`.

### Planned but not started

Full designs (scope, shape, landmines, release class) live in
`ai-docs/agent-context/planned-work.md` — load it with the Read tool when you
pick one up. Do not re-derive them:

- **GHN-ETA-01** — persist + expose the GHN delivery ETA (1 additive migration, class B).
- **GHN-FAIL-NTF-01** — notify the buyer on a failed delivery attempt (class B, no migration).
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

> Every entry below is a residual/deliberate behaviour of a **shipped** fix, NOT
> an open bug. Full detail is in `ai-docs/agent-context/known-behaviors.md` —
> read it there before re-diagnosing one or writing a test that asserts the
> opposite contract.

**Orders / fulfilment** — ORD-RBAC-01 (ship/deliver/complete are admin-only),
ORD-GUARD-01 (`paidAt` NULL blocks seller transitions on non-COD),
ORD-CRON-01 (orders crons never ran before 2026-08-13; the stale-reservation
sweep has a backlog), buyer cancel leaves a live waybill if GHN cancel fails
twice, single-seller checkout has no `paymentUrl` (`GET /:id/payment-url` →
`orderUrl`), payment return URLs before 2026-08-07 keep a numeric id.

**GHN** — GHN-FAIL-01 (`delivery_fail` deliberately moves no local status),
GHN-DIST-01 (unknown district / cross-district ward → 400, but validation is
fail-open), GHN-MSG-01 (12 of 19 Quận 8 wards unshippable on the dev shop —
**do not "fix" it by quoting from `/shipping-order/fee`**), free-text address is
best-effort, `toWardCode` stays a string.

**Products / inventory** — SKU `skuList` is the full desired set not a delta,
STOCK-SYNC-01 (two-way absolute stock sync), PATCH-ATOMIC-01 (product PATCH is
three steps across two DBs, not one transaction), product PATCH optimistic
`version` is opt-in, `PATCH /api/products/:id` `null` clears exactly six
columns, P0-03 compensation reads `error.driverError.detail`, storefront catalog
defaults `isActive:true`, approved returns restock via
`inventory.restock_returned`.

**Data shape / errors** — SHAPE-01 residuals (empty-cart key set, DB-order batch
reads, `null` not `{}` for a missing relation, no `@IsOptionalNotNull()` sweep),
BATCH-FAIL-01 (product leg errors, inventory leg degrades),
ENRICH-FAIL-01 (a social write can 502 on a user-service outage),
ENVELOPE-01, array query params `?x[]=` → 400.

**Vouchers** — VOUCHER-CONC-01 (Redis quota gate fails open, can be
pessimistic for 300s), VOUCHER-CANCEL-01 (cancel gives the redemption back;
cancel-farming is possible by design), VOUCHER-EDIT-01 (a loosening edit cannot
be walked back), VOUCHER-NULL-01, VOUCHER-SHOP-01 residuals.

**Auth / mail** — CHG-PW-01 (change-password revokes nothing — an attacker's
stolen session survives it), CHG-PW-02 (optional `errorCode`, survives the prod
401 sanitizer), RESET-EXHAUST-01, RESET-TTL-01 (60s, live on prod since
2026-09-10),
MAIL-UI-01 (no copy button — email clients strip `<script>`; SMTP is :465 only),
MAIL-UI-02 (order emails build their CTA from `FRONTEND_URL` entry [0]).

**Messaging** — OUTBOX-SCOPE-01 (only `order_created` is durable; the rest are
best-effort by design), REPORT-TOTAL-01 (orphan `post_reports` are the audit
trail).

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
