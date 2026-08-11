# Known Behaviors — residual/deliberate behaviours of shipped fixes

> Load on demand — keywords: residual behavior, known issue, 409 version,
> skuList, paymentUrl/orderUrl, compensation, deactivated products. These are
> NOT open bugs: each entry documents deliberate or residual behaviour of a
> shipped fix, so future sessions neither re-diagnose it as a bug nor assert
> the wrong contract in tests. Moved out of `snapshot.md` on 2026-08-04.

## SKU edit over HTTP (BUG-A, fixed 2026-08-03)

`PATCH /api/products/:id` accepts `variations` + `skuList` (P0-05 diff engine).

- `skuList` is the **FULL desired set, not a delta** — any existing tierIdx
  omitted from it is removed (hard-deleted when never ordered/carted, otherwise
  deactivated). A partial `skuList` silently wipes the rest.
- **SKU stock is only pushed to inventory when the value actually changes** in
  that edit. Inventory (`inventory_v2`) is authoritative and drains as orders
  reserve; `product_skus.stock_quantity` is a mirror that is never decremented —
  echoing the mirror back must not, and does not, restock the seller. Reserved
  stock is never rewritten by an edit.
- The removed-SKU reference check (`getReferencedSkuIds` → orders TCP
  `order.get_referenced_sku_ids`) **fails safe**: on error every candidate is
  treated as referenced → deactivated instead of hard-deleted, seller still gets
  200. The call retries once before falling back (a single stale-socket blip
  used to trigger it). A sustained orders outage degrades the same way by
  design — re-sending the same edit hard-deletes the leftover once orders is
  reachable.
- Deactivating a **referenced** SKU deliberately leaves its inventory row
  `is_active:true`: `transitionReservation` requires an active row, so
  deactivating it would break releasing that SKU's in-flight reservations. Only
  hard-deleted (by definition unreferenced) SKUs deactivate inventory.

## `paymentUrl` asymmetry on checkout (confirmed on prod 2026-08-03, not a defect)

- Multi-seller basket: `POST /api/order` returns `{orders:[…], paymentUrl}`.
- Single-seller basket (`apps/gateway/src/order/order.service.ts:390-419`):
  returns the exposed order object with NO `paymentUrl` at all. The client must
  call `GET /api/order/:id/payment-url`, whose body is `{orderUrl, status}` —
  the key is **`orderUrl`**, not `paymentUrl`. Another user on that route → 403.

Never write a test asserting `paymentUrl` on the single-seller shape.

## Legacy payment return URLs keep the numeric order id (2026-08-07)

Since 2026-08-07 the gateway redirect is
`{FRONTEND_URL}/payment-result?order=ord_<16>&method=<gateway>` — the public id,
so the FE deep-link resolves. Payment rows created BEFORE that change still hold
a stored `orderUrl` whose `vnp_ReturnUrl` contains `?order=<numeric PK>`, and it
cannot be rewritten: the VNPay signature covers `vnp_ReturnUrl`, so editing it
invalidates the checksum. A buyer resuming an old pending order therefore lands
on a numeric param, and `GET /api/order/<numeric>` is a PUBID 400. This is
expected decay, not a bug — the FE guard treats a non-`ord_` `order` param as
absent. When the order has no public id, or for multi-order ZaloPay checkouts,
the param is omitted entirely; never emit it numeric.

## P0-03 compensation leg (verified on local 2026-08-03, 3/3)

The product-create failure branch can be forced from outside the API:
`products.sku` is UNIQUE but NULLABLE while `inventory.sku` is UNIQUE NOT NULL,
and the gateway `buildInventorySku` falls back to `PROD-<numericProductId>`.
Create P1 with NO `sku` (its inventory row takes `PROD-<id1>`), then create P2
WITH `sku: "PROD-<id1>"` — the product insert succeeds but the inventory insert
hits the unique constraint → `POST /api/products` → 409 and
`compensateProductCreate` rolls the P2 product row back (no orphan).

The misleading-409 defect is fixed: a **sku** collision returns "Inventory with
sku `<sku>` already exists". Discrimination reads `error.driverError.detail`
(`Key (sku)=(...) already exists`), NOT `error.message` — Postgres names the
index after TypeORM's generated `UQ_<hash>`, so the column never appears in the
message (a first fix matched on `message` and silently did nothing). The
duplicate-product message still comes from the explicit pre-check.

## Concurrent `PATCH /api/products/:id` — optimistic locking (fixed 2026-08-02)

`updateProduct` runs in a transaction behind `SELECT … FOR UPDATE`;
`products.version` is a `@VersionColumn`; `ER_DUP_ENTRY` on `sku` → 409;
`ER_LOCK_DEADLOCK` retried once.

- **`version` is OPT-IN.** Omit it → last-writer-wins (no error). Send the
  `version` read from the product → a stale edit gets 409
  `PRODUCT_MESSAGE.VERSION_CONFLICT` instead of silently overwriting.
- **Background writers bump `version` too** (TypeORM appends
  `version = version + 1` to every entity UPDATE): stock sync from inventory,
  risk scoring finish/fail (≈2 bumps shortly after any risk-relevant edit),
  rating recalc on review create/delete, brand/category approve-reject cascades.
  A 409 does not necessarily mean another human edited the product. Clients must
  send the version from a FRESH `GET` and treat 409 as "reload and re-apply",
  never as a hard failure.
- **The SCALE-04 gateway detail micro-cache (TTL 10s) can serve a stale
  `version`.** A PATCH invalidates it, but background writers do not — a
  spurious 409 is possible for up to 10s after one of them. Same remedy.
- A PATCH holds the row lock for its transaction, so a concurrent
  `updateStockQuantity` from inventory waits instead of interleaving.
  `upsertSkus`, cache invalidation, Cloudinary cleanup and the risk rescore stay
  OUTSIDE the tx deliberately.
- Still unreproduced (theoretical): SCALE-04 micro-cache stale-repopulation
  (a GET commits the pre-update body after the PATCH invalidation).

## Cancel-with-waybill — detached GHN cancel (BUG-D, fixed 2026-08-03)

`GhnModule` uses `HttpModule.register({timeout:5000})` (was axios default `0` =
infinite), and the buyer-cancel GHN leg is detached
(`void cancelShippingOrderBestEffort`) behind a never-rejecting wrapper.

- **The detached cancel gets 2 attempts × 5s.** If both fail, the local order is
  still CANCELED but a **live waybill remains at GHN** — remedy:
  `POST /api/order/admin/ghn/orders/:id/cancel`. Exhausting both attempts logs
  `GHN cancel attempt 2/2 failed for <code>`; watch that line.
- The wrapper must never reject: it is `void`-invoked, so a rejection would
  surface as an unhandled rejection and can kill the orders process.
- `finalizeGhnCancellation` (GHN-originated cancel) pushes nothing back to GHN,
  and `sweepStaleReservations` only selects `ghnOrderCode: null` orders — the
  detached branch never fires there.
- The **admin** GHN cancel/return stays awaited and re-throws on GHN rejection —
  documented contract (4xx/5xx + `success:false` `shipping_history` row, local
  order untouched). Do not detach it.
- Master-data GETs pass `timeout: 10000` per request, which overrides the 5s
  instance default (axios merges request config over instance config).

## Array query params on the gateway

Express runs the **simple** query parser, so bracket syntax `?categoryIds[]=18`
arrives as literal key `"categoryIds[]"` → the global pipe
(`forbidNonWhitelisted`) rejects it loudly with 400
`"property categoryIds[] should not exist"` (re-verified 2026-08-03 — do not
re-open as a bug). Supported syntaxes: repeated keys
`?categoryIds=16&categoryIds=18` or a single scalar `?categoryIds=18`
(scalar→array `@Transform` on `GetProductsQueryDto`). Any future array-typed
query DTO field needs the same guard-and-wrap `@Transform`. Note the storefront
FE historically sent singular `categoryId`/`brandId` (never matched the DTO) —
handoff entry written 2026-07-03.

## GHN free-text address resolution is best-effort

Only affects callers that do NOT send `toDistrictId`/`toWardCode` (GHN-ADDR-01,
2026-07-23, prod-verified 2026-07-30 4/4): a garbage/placeholder free-text
address can resolve to a wrong-but-valid GHN location, because short numeric
master-data names match many free-text parts via containment. When BOTH ids are
present the waybill/fee-preview use them exactly and skip free-text resolution;
a partial pair is treated as absent. Truly unresolvable free-text → 400, not
502. Both DTOs carry `@Type(() => Number)` on `toDistrictId` (string-numeric
accepted since 2026-08-04); `toWardCode` stays `@IsString()` on purpose — GHN
ward codes can carry leading zeros. For COD the waybill is created at
ORDER-CREATE time, so ready-to-ship re-uses the existing `ghnOrderCode`.

## Deactivated products on the storefront (BUG-B, fixed 2026-08-03)

`findAllProducts` defaults `isActive: true` when the caller passes NEITHER
`isActive` NOR `userId`, so the five `@Public` catalog routes (list, search,
category, brand, with-inventory/all) no longer return `isActive:false` /
risk-blocked rows.

- **The only exception is single-seller `userId`** — that IS the storefront
  seller dashboard (`useProducts({userId: currentUser.id})`), which must keep
  seeing what it hid. `userIds` (plural) is deliberately NOT an exception (the
  gateway province filter passes sellers as `userIds`, so province-filtered
  browse still hides deactivated products).
- **`?userId=` is an anonymous leak by design** — any visitor browsing another
  seller's shop via `?userId=usr_xxx` sees hidden products. Tightening requires
  the FE to migrate the dashboard onto an authenticated route first (none exists
  today); handoff entry written.
- **Explicit `isActive` still wins** — `?isActive=false` returns only
  deactivated products.
- The default is applied BEFORE `buildSearchCacheKey`, so the Redis search cache
  cannot serve a pre-fix entry and "no isActive" / "isActive=true" share a key.
- **`GET /api/products/:id` still returns a deactivated product with 200** —
  pre-existing, relied on by the seller's own product-edit screen.
- 5 unit tests in `product.service.spec.ts` pin the default, `userIds`, the
  `userId` exception, the explicit override, and the cache key.

## Gateway transport failures — one sanitized 502 (SOCIAL-502, fixed 2026-08-09)

`MicroserviceErrorHandler.handleError` classifies a "the call never reached the
microservice" failure BEFORE the keyword matcher, so all 14 gateway services now
answer a dropped/refused/nulled socket with `502` +
`COMMON_MESSAGE.SERVICE_UNAVAILABLE`. Residual behaviours:

- **`"Connection closed"` moved 408 → 502.** It was never a client timeout. A
  genuine rxjs `TimeoutError` is still `408` — it is not a transport error and
  is deliberately never retried (pinned by a test in `transport-error.spec.ts`).
- **The raw socket text is no longer echoed to the client.** Previously
  `connect ECONNREFUSED 127.0.0.1:3008` reached the HTTP body, leaking the
  internal host:port. It is now logged only. Do not assert on socket text in the
  response body.
- **The retry covers the momentary race, not an outage.** A service that is
  genuinely restarting (multi-second) still returns 502 — correctly. Only
  `retryOnTransportError()`'s single 100ms retry hides the sub-tick socket flap.
- **Worst-case latency on a retried read** is one fast transport failure + 100ms
  + a full `TCP_TIMEOUT_MS.READ` budget. The retry only fires on transport
  errors, which fail fast, so this is ~5.1s, not 10s.
- The retry is currently wired to social reads ONLY — see snapshot Active Tasks
  for the optional rollout.

## Approved return restocks via a dedicated path (RETURN-STOCK-01, fixed 2026-08-11)

Approving a return used to call `releaseReservedItems()`. A release only rewinds
a still-`RESERVED` ledger row, and an order that reached COMPLETED already had
its reservation `CONSUMED` — so the release was a silent no-op (returns `false`,
never throws) and the seller's stock stayed short forever. Cancel looked fine
because a cancelable order still holds a RESERVED row. Approve now calls
`inventory.restock_returned`. Residual behaviours:

- **`InventoryReservationStatus.RETURNED` is a new terminal state.** It is what
  makes a replayed restock a no-op. A later release/consume on a RETURNED row
  fails safe (`false`) — that is correct, not a bug to "fix".
- **A restock credits `availableStock` from ANY reservation state**, unlike a
  release. From `RESERVED` (return approved while DELIVERING) it also drops the
  hold; from `RELEASED` (a cancel already handed the units back) it only stamps
  RETURNED and credits nothing.
- **Pre-ledger orders have no reservation row**: the restock still credits, logs
  a warn, and relies on the one-shot "already reviewed" guard on the return
  request for idempotency — there is nothing else to dedupe on.
- **The restock is non-fatal.** A stock write must not sink an approved refund,
  so a failure is logged (`[ORDERS] Return restock rejected/failed …`) and the
  refund proceeds. Grep the orders log for a shortfall.
