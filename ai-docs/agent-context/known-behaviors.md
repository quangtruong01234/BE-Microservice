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
  treated as referenced → deactivated instead of hard-deleted, seller still gets 200. The call retries once before falling back (a single stale-socket blip
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

## Sellers cannot set shipping status by hand (ORD-RBAC-01, 2026-08-13)

`PATCH /api/order/:id/{ship,deliver,complete}` is **admin-only**. Role `shop`
(and every other non-admin role) gets a **403** _"Shipping status after
ready-to-ship is reported by the carrier — a seller cannot set it manually"_
before the order is even loaded — so a seller gets 403 even for an order id that
does not exist or that they do not own. Deliberate, not an oversight:

- `readyToShip` never advances to PROCESSING without a GHN waybill, so **every**
  order those three routes could touch already has one. The carrier owns the
  status from there; a second writer only makes the local order disagree with
  GHN, and a hand-set terminal status makes the order deaf to the webhook that
  follows it (`applyGhnStatus` ignores terminal orders).
- COD stamps `paidAt` in `finalizeOrderCompletion`, so the removed path let a
  seller certify money collected without collecting it, and start the buyer's
  return window early.
- Recovery for a stalled order is the shipping console, not this route:
  `POST /api/order/admin/ghn/orders/:id/sync` (re-pull the real GHN status) and,
  in demo mode, `POST /api/order/admin/ghn/orders/:id/demo-status`.
- The seller's own lifecycle is unchanged: `confirm` and `ready-to-ship` still
  accept role `shop`.
- The guard is on the role, not the `shipping` permission — `shipping_manager`
  and `logistics_operator` get 403 here too and use the `admin/ghn/*` routes.

## `paidAt` gates the seller transitions (ORD-GUARD-01, 2026-08-11)

`orders.paid_at` is the ONLY payment fact the orders service owns — payments
lives on Node B and speaks to orders only through the `payment_completed`
fanout. `confirm`, `ready-to-ship` and every `advanceOrderStatus` step call
`assertOnlinePaymentSettled()`: COD or a non-null `paidAt` passes, anything else
is a **400** _"Order cannot be advanced — the &lt;method&gt; payment has not
completed yet"_. Consequences that are deliberate, not bugs:

- **A genuinely paid order whose `payment_completed` was lost is now blocked for
  the seller too.** It was already stuck — the same lost event is what leaves it
  at `pending` — and the stale-reservation sweeper cancels it. The guard only
  removes the ability to walk it forward by hand while the money state is
  unknown; it applies to the admin path as well (`advanceOrderStatus` calls the
  assert after the ORD-RBAC-01 role check), so there is no admin override on
  purpose. The remedy is fixing the payment event, not stamping the column.
- **The backfill treats a legacy hand-walked order as paid.** A non-COD row at
  processing/shipped/delivering/completed got `paid_at = updated_at`, which
  cannot distinguish "paid" from "a seller advanced it before the guard
  existed". Stranding real paid orders mid-fulfilment was judged worse.
- **The COD stamp happens in `finalizeOrderCompletion`, not from the fanout it
  publishes there** — `paid_at` must not depend on RMQ being up. The stamp is a
  conditional `WHERE paid_at IS NULL`, so hearing its own event back is a no-op.
- `paidAt` is on every order read. NULL on a non-COD order means unpaid; NULL on
  a COD order means "not delivered yet", not "unpaid forever".

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
a partial pair is treated as absent. Truly unresolvable free-text → 400, not 502. Both DTOs carry `@Type(() => Number)` on `toDistrictId` (string-numeric
accepted since 2026-08-04); `toWardCode` stays `@IsString()` on purpose — GHN
ward codes can carry leading zeros. For COD the waybill is created at
ORDER-CREATE time, so ready-to-ship re-uses the existing `ghnOrderCode`.

## `delivery_fail` does not move the local status — on purpose (GHN-FAIL-01, 2026-08-16)

`mapGhnStatus` covers `picking|picked`, `delivering`, `delivered` and the whole
cancel/return family. Everything else returns `null` and the order keeps the
status it has. That is the settled answer for `delivery_fail`, not a gap:

- **`delivery_fail` is a failed delivery ATTEMPT, not a failed delivery.** GHN
  retries by itself and only then moves to the return family, which already maps
  to CANCELED. Canceling on the first miss would release reserved stock for a
  parcel that is still out for redelivery.
- **There is no local status to move to**, and inventing one would be a new
  enum value on `orders.status` — a migration plus a contract change for both
  frontends, for a state the buyer already sees through the GHN badge.
- **`exception` / `damage` / `lost` are held for the same reason**, plus one
  more: mapping them to CANCELED would restock goods that no longer physically
  exist. They need an operator decision, so they stay visible and unmapped.
- **What DID change:** the null branch no longer calls all of these "Unhandled".
  The ten recognised statuses in `GHN_STATUSES_WITHOUT_LOCAL_STATUS`
  (`libs/constant/shipping.constant.ts`) write `GHN status "<x>" acknowledged;
no local equivalent, order stays <status>` to `shipping_history.message` and
  log at `log` level; a string we have never seen still writes `Unhandled GHN
status "<x>"` and now logs at **warn**, so a new GHN vocabulary word is loud.
  Forward-only — rows written before 2026-08-16 keep the old text.
- Applies identically on all three entry points (webhook, admin manual sync,
  demo-status), because all three go through `applyGhnStatus`.
- Still open as a **product** question, not a bug: whether a failed attempt
  should notify the buyer. Nothing notifies today. The decided shape (scope,
  the `shipping_history`-as-ledger dedupe, why not `order.status_changed`) is
  written up as **GHN-FAIL-NTF-01** in `snapshot.md` — read that before
  designing it again.

## An unknown district/ward is a 400 (GHN-DIST-01, 2026-08-13; extended to order create by GHN-CREATE-01)

`buildShippingOrderBody` validates a caller-supplied `toDistrictId` +
`toWardCode` against GHN master data before quoting or cutting a waybill,
because GHN's own `/v2/shipping-order/preview` does **not**: it answers
`200 { total_fee: 0 }` for `to_district_id: 999999`. Master data is strict where
preview is lax, so one cached ward lookup (24h cache — steady-state cost is zero
extra GHN calls) turns a silent 0 into `400 GHN_MESSAGE.DISTRICT_NOT_FOUND` /
`WARD_NOT_IN_DISTRICT`.

- **Validation is fail-open on purpose.** Only an explicit GHN `400` on the
  master-data call rejects. An outage, a circuit-open, a timeout, or an empty
  ward list all log a warn and let the quote through — this is an input check,
  not a health gate, and a GHN outage must never start rejecting addresses that
  worked yesterday.
- **Free-text callers are unaffected** — that branch goes through
  `resolveAddressToGhnIds`, which already only ever yields ids GHN gave us.
- **The order-create path propagates it too, since GHN-CREATE-01 (2026-08-13).**
  `getShippingFeeOrZero()` used to catch every preview error and return `0`, so
  `POST /api/order` accepted a bogus district at fee 0 while the fee endpoint
  400s. It now rethrows `BadRequestException` only — see the GHN-CREATE-01
  section below for the refusal-vs-outage split.
- **A stale ward selection now 400s.** Changing district without re-picking the
  ward used to quote silently; it now returns `WARD_NOT_IN_DISTRICT`.
- Two legacy `canceled` probe orders (128/129, created 2026-07-30 by a synthetic
  "Local Probe" address) carry district `1485` (Cầu Giấy) with ward `1A0807`
  (Phường Mai Động, district `1490`) — mismatched hand-made data, both terminal
  with `ghn_order_code: null`, so no live path re-validates them. Every other
  stored pair (4 distinct, 16 orders) passes.

## Order create rejects an undeliverable address, but still places on a GHN outage (GHN-CREATE-01, 2026-08-13)

`POST /api/order` prices shipping through `getShippingFeeOrZero()`
(`orders.service.ts`), which used to swallow **every** GHN preview error and fall
back to `0`. That booked orders for addresses GHN can never deliver to: the
buyer paid no shipping, `createShippingOrder` then failed silently
(`ghnOrderCode: null`), and the seller's `ready-to-ship` — which shares the same
`buildShippingOrderBody` validation — rejected the order forever, leaving cancel
as the only exit.

The catch now splits the two failure classes:

| GHN said                                                                                            | Exception                                                      | `POST /api/order`                                                  |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| refusal — unknown district, ward from another district, unresolvable free-text, non-operational 4xx | `BadRequestException`                                          | **400**, GHN's own message, nothing reserved or committed          |
| outage — down, timeout, 5xx/401/403/429, circuit open                                               | `ServiceUnavailableException` / `InternalServerErrorException` | **201** at fee 0 (unchanged); `readyToShip` cuts the waybill later |

- **The refusal is deterministic, which is what makes rejecting safe.** Preview
  and waybill create share one body builder, so an address that fails here could
  never have produced a waybill. This is not a health gate: a GHN outage never
  starts blocking addresses (see GHN-DIST-01 fail-open above).
- **Nothing to compensate.** The fee is priced before `reserveOrderItems()` and
  before the order transaction, on both the single-seller and multi-seller
  paths — a rejected checkout leaves zero reserved stock and zero rows.
- **`POST /api/order` and `POST /api/order/shipping-fee` now agree.** Same
  address ⇒ same status ⇒ same message. Before, the fee endpoint 400s and create
  answered 201.
- **Free-text callers (`toDistrictId`/`toWardCode` omitted) can now 400** where
  they used to get a fee-0 order — only when `resolveAddressToGhnIds` cannot
  match the province/district/ward. Not reachable from the storefront: saved
  addresses (`user_addresses`) carry NOT NULL `district_id` + `ward_code`, so
  checkout always sends ids. A valid free-text address still resolves and is
  still quoted (verified: real non-zero fee + live waybill).
- **The COD waybill catch at create is untouched** and still swallows: after
  this gate the only failures reaching it are transient, and `readyToShip`
  re-creates the missing waybill (`orders.service.ts` — `if (!order.ghnOrderCode)`).

## The envelope `error` label is derived from the status (ENVELOPE-01, 2026-08-13)

`HttpExceptionFilter` no longer reports an exception class name in the `error`
field. Deliberate consequences — do not "restore" any of them:

- **`error` is always the HTTP reason phrase for `statusCode`** (`404` →
  `"Not Found"`, `409` → `"Conflict"`), whatever threw and whether or not the
  error crossed a TCP hop. Before, anything propagated from a microservice
  reported `"HttpException"`, because `MicroserviceErrorHandler` rebuilds it as
  a bare `new HttpException(message, status)` and the filter fell back to
  `exception.constructor.name`.
- **An upstream `error` label is accepted only when it is already a phrase.**
  Anything ending in `Exception` or `Error` is dropped (`normalizeErrorLabel`)
  in favour of the status phrase, so an internal class name can never reach a
  client — including a raw `TypeError` from an unhandled gateway bug.
- **Prod and dev agree.** The production 500 override still sanitizes the
  _message_ to `"Internal server error"`, but its label is the same phrase dev
  emits (it used to be the unspaced `"InternalServerError"`).
- No FE reads this field — the storefront client reads `message` + HTTP status,
  the GHN console branches on status. It is a debugging aid, not a contract.

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

## Comment `author` is decorated in the gateway and may be `null` (SOCIAL-AUTHOR-01, 2026-08-13)

The social service does NOT return an author on comments — it never has. The
`author` embed on `POST /posts/:id/comments`, `GET /posts/:id/comments`,
`POST /comments/:id/replies` and `GET /comments/:id/replies` is added by
`attachCommentAuthors()` in `apps/gateway/src/social/social.service.ts`, exactly
like the post path does. Consequences worth knowing before "fixing" any of them:

- **`author: null` is a valid response, not a bug.** `fetchAuthorMap()` swallows
  a user-service failure and returns an empty Map, so an unreachable user service
  degrades to `author: null` instead of failing the comment read. A deleted user
  resolves to `null` for the same reason. Do not make the read throw.
- **The decoration is recursive over `children[]` AND `parent`** — the reply tree
  from `findDescendantsTree` at any depth, plus the `parent` comment embedded in a
  freshly created reply. A new nested comment shape needs adding to that walk.
- **Author resolution is one batched call for the whole payload**, and
  `exposeReferences` makes a second one for the public-id mapping. So a comment
  request costs **2** user-service calls regardless of comment count — flat, not
  N+1. `social-comment-author.service.spec.ts` asserts that count; if it fails
  after a change, something started resolving authors per node.
- Order matters: decorate BEFORE `exposeReferences`, so `author.id` leaves as the
  opaque `usr_` id. Decorating after would emit a raw numeric id.

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
  - a full `TCP_TIMEOUT_MS.READ` budget. The retry only fires on transport
    errors, which fail fast, so this is ~5.1s, not 10s.
- **The retry now covers every idempotent gateway read (SOCIAL-502-ROLLOUT,
  2026-08-14)** — 92 call sites across cart, chat, inventory, notification,
  order, payment-options, product, shipping, social, user. Rules that were
  applied and must hold for any new call site:
  - **Reads only.** No `CREATE`/`UPDATE`/`DELETE`/`RESERVE`/`RELEASE`/`CONSUME`
    pattern carries it — a retried write can apply twice.
  - **Always AFTER `timeout(...)`** in the same `.pipe()`, so each attempt keeps
    its own budget and the rxjs `TimeoutError` is never retried.
  - Read/write is decided by the **message-pattern semantics, not the timeout
    constant** — several pure lookups use `TCP_TIMEOUT_MS.WRITE` and still
    qualify as reads.
  - **Skipped deliberately:** legs that call out to GHN or a payment provider
    (they have their own circuit breaker, RESIL-01), and
    `PRODUCT_DUPLICATE_IMAGE_CHECK` (downloads from Cloudinary + O(catalog)
    pHash scan — too expensive to retry).
- **The race itself is now fixed at the transport, not just retried
  (TCP-RESIL-01, 2026-08-15).** Every TCP client is a `ResilientClientTCP`
  (`libs/common/src/resilience/resilient-client-tcp.ts`), registered with
  `customClass:` instead of `transport: Transport.TCP`. Consequences:
  - The null-socket race no longer reaches rxjs at all — the client reconnects
    and publishes the SAME packet, so it is transparent on **writes too**
    (nothing was written when it fires; the packet is provably unsent).
  - A send on an already-closed socket now fails immediately with
    `NetSocketClosedException` ("The net socket is closed.") instead of hanging
    for the caller's whole timeout budget. `isTransportError()` recognises it.
  - `retryOnTransportError()` stays — it still covers a peer that is genuinely
    down/restarting (`ECONNREFUSED`, `"Connection closed"`), and is still
    reads-only. The two layers are complementary; do not remove either.
  - Sockets carry TCP keep-alive (30s idle) so a peer that dies without FIN
    surfaces as `ECONNRESET` instead of a half-open socket that swallows writes.
  - Warnings are logged under the `[ClientTCP]` context (the base class's
    `readonly logger`), not `[ResilientClientTCP]` — grep the message, not the
    context.
  - **A failed write leaves the dead socket installed for a few ms.** The client
    reports `NetSocketClosedException` before the socket's own 'close' event has
    run, so a caller that retries INSTANTLY hits the same dead socket and fails
    again; recovery is complete one event-loop turn later (measured: fine at
    50ms, and `TRANSPORT_RETRY_DELAY_MS` is 100ms). Do NOT "fix" this by calling
    `handleClose()` from the send callback: it takes no socket argument, so the
    stale socket's late 'close' then tears down the REPLACEMENT socket
    mid-connect and the next call dies with `TypeError: Cannot read properties
of null (reading 'on')` — strictly worse. Tried and reverted 2026-08-15.
  - **Activation is narrower than "restarts under load".** 45k requests through
    a peer restarting every 60ms produced ZERO null-socket failures on the BASE
    client: `publish()` normally wins the race and the packet fails with the
    benign `"Connection closed"` from `handleClose()`. The TypeError needs
    `publish()` to lose to a nextTick-queued close — rare, which is why prod has
    never shown it and dev (watch-mode recompiles all day) did.
  - **Any NEW `ClientsModule.register` client entry must use
    `customClass: ResilientClientTCP`.** `transport: Transport.TCP` in a
    `main.ts` `createMicroservice` is the SERVER side and must stay as is.

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
- **The fix is not retroactive** — stock lost before 2026-08-11 sits on terminal
  `CONSUMED` rows that nothing re-triggers. The three prod units owed were
  repaired by hand on 2026-08-11; see `CHANGELOG.md`.

## Manual stock adjustment — ONE write, either side (STOCK-SYNC-01, 2026-08-11)

Superseding the older "do both writes" recipe: since STOCK-SYNC-01 the two stock
stores keep each other in step, so adjust from **either** side with a single
request.

- `PATCH /api/products/<publicId> { "stockQuantity": N }` → resolves the base
  inventory row first (`resolveStockSyncTarget`), writes the MySQL mirror, then
  pushes `N` into that row (`applyStockSync`,
  `apps/gateway/src/product/product.service.ts`).
- `PUT /api/inventory/<numericId> { "availableStock": N }` → writes Postgres,
  then emits `inventory.stock_changed` so the MySQL mirror follows
  (`InventoryService.update()`). Inventory ids stay numeric — that domain is
  deliberately not PUBID-converted.

Residual behaviours worth knowing, none of them bugs:

- **Absolute set, not a delta.** A seller PATCH writes `availableStock = N`
  outright, so it can clobber a deduction a concurrent reservation just made
  (same semantics `PUT /api/inventory/:id` always had). `reservedStock` is never
  touched, so a held reservation is not lost — only the free count is rewritten.
- **SKU-matrix products are skipped.** They own one inventory row per SKU and no
  base row; `stockQuantity` on such a product is not the authoritative total.
  The PATCH still returns 200 and logs a warn. Adjust those through `skuList`.
- **A simple product with no inventory row at all is also warn-and-skip** — the
  sync does not auto-create a row. `POST /api/products` always creates the base
  row, so this only happens to rows predating that or hand-deleted ones.
- **On an inventory failure the PATCH fails, but not atomically** — see
  PATCH-ATOMIC-01 below for exactly which failure leaves what behind. Products
  and inventory live in different service DBs, so there is no shared transaction
  (same constraint as the `compensateProductCreate` saga).
- **Only base rows emit.** A `PUT` on a SKU row does not touch the product
  mirror, because a variant's stock is not the product-level number.

Verify either direction with `GET /api/inventory/product/<publicId>` and
`GET /api/products/<publicId>` — `availableStock` must equal `stockQuantity`.

## `PATCH /api/products/:id` is not one transaction (PATCH-ATOMIC-01, 2026-08-12)

Answer to the FE question "is the PATCH atomic when the inventory step fails":
**no, and it cannot be.** One PATCH is up to three sequential writes:

1. **Product fields** — one MySQL transaction (`applyProductUpdate` inside
   `runProductUpdate`, `apps/product/src/product.service.ts`). Atomic among
   themselves.
2. **`skuList`** — a _second_, separate MySQL transaction (`upsertSkus`, same
   file). Atomic among themselves, but not with step 1.
3. **`stockQuantity`** — a TCP write to inventory, which is a different service
   on a different database (Postgres). It can never join a MySQL transaction.

What each failure leaves behind, after the 2026-08-12 narrowing:

| Fails                                          | Product fields | `skuList`   | Stock           |
| ---------------------------------------------- | -------------- | ----------- | --------------- |
| step 1                                         | rolled back    | not reached | untouched       |
| step 2                                         | **committed**  | rolled back | untouched       |
| inventory unreachable / no base row read fails | **untouched**  | untouched   | untouched       |
| inventory write (step 3)                       | **committed**  | committed   | mirror restored |

The narrowing: the base-inventory row is now resolved **before** the product
write (`resolveStockSyncTarget`), so an inventory outage aborts the PATCH with
nothing committed — previously that same outage left every product field applied
behind a 502. Only a failure of the inventory write itself can still half-apply,
and that leg restores the stock mirror (`restoreProductStockMirror`,
best-effort — a failed restore only logs).

Consequence for clients: a failed PATCH does **not** mean "nothing changed".
Refetch the product on error rather than trusting the local form state.

## Order lifecycle notifications (NOTIF-LIFECYCLE-01, 2026-08-11)

Every order status move publishes one generic RabbitMQ event
`order.status_changed`; the notification service decides what is worth telling
a user. See `CHANGELOG.md` 2026-08-11 for the design.

- **`order_canceled` is NOT emitted through `order.status_changed`.**
  `applyGhnStatus` skips the publish when the mapped status is CANCELED because
  `finalizeGhnCancellation` already publishes the dedicated `order_canceled`
  event. Do not "fix" the guard — removing it double-notifies the buyer.
- **A seller-leg failure can duplicate the buyer notification.** In
  `handleOrderCreated` / `handleOrderCanceled` the buyer notification is saved
  first and the seller notification second, both inside one try. If the seller
  leg throws, the message is nacked with requeue and the redelivery re-saves the
  buyer row. Chosen deliberately: a duplicate line in the buyer's list is
  cheaper than silently losing the seller's "you have a new order" signal. The
  status-change handler has one leg only and is not affected.
- **Emails are gated to shipping milestones.** In-app + WS fire for all five
  moves (`confirmed`, `processing`, `shipped`, `delivering`, `completed`);
  email only for `shipped|delivering|completed` (`EMAILED_STATUSES`). Mailing
  every move was rejected as spam, not overlooked.
- **Unknown statuses ack and drop.** `statusChangedMessage()` returns `null` for
  any status without copy (e.g. a future state), and the handler acks — it does
  not dead-letter. A new user-visible status needs a case added there.
- **Message text uses the public id** (`#ord_…`) via `orderLabel()`. The numeric
  fallback fires only if a row somehow has no `publicId`.
- **Fanout, so no binding change.** `ORDERS_EXCHANGE` is fanout: inventory,
  payments and rewards also receive `order.status_changed`, match no
  `@EventPattern`, and nack no-requeue. This does not accumulate (all queues
  verified ready=0/unacked=0) — same as the existing `order.return_*` events.

## `inventory_v2.sku` is a label, not a link (INV-CONTRACT-01, 2026-08-11)

`PUT /api/inventory/:id` accepts `sku` and really renames the row.

- **Nothing resolves inventory by sku.** `INVENTORY_FIND_BY_SKU` has a handler
  but no caller anywhere in the monorepo; checkout, reservations and the stock
  fanout all key on `productId` / `productSkuId` / `reservationKey`. So a
  rename cannot break stock movement.
- **It does NOT rename `products.sku`, and vice versa.** `inventory_v2.sku` is
  seeded from the product's sku at create time (`buildInventorySku()`, falling
  back to `PROD-<id>`) and the two drift freely afterwards. Deliberate: the
  catalog sku is seller-facing copy, the inventory sku is only a warehouse
  label. Do not "fix" the drift by syncing them without a migration plan — the
  inventory column is `unique`, the products one is not.
- **A colliding rename answers 409**, not 500.
- **`POST /api/products` always creates the base inventory row** for a
  non-`skuList` product, and compensates (deletes the product) if that fails —
  a 201 therefore guarantees the row exists. A `skuList` product gets one row
  per SKU asynchronously via `sku_upserted`. A client never needs to
  `POST /api/inventory` after creating a product; doing so is a guaranteed 409.

## Order item `image` — one key on HTTP, two inside (ORDER-SHAPE-01, 2026-08-11; collapsed by OVERFETCH-01, 2026-08-20)

Order items used to carry BOTH `image` and `productImage` on the decorated read
paths. Since OVERFETCH-01 every buyer/seller path through `exposeOrder` emits
`image` ONLY — `productImage` is deleted at the HTTP boundary. The two internal
values still exist and still mean different things:

- `productImage` is the raw purchase-time snapshot column. It is `null` on
  orders created before the P2-02 snapshot columns existed.
- `image` is `decorateItem()`'s resolved value: the snapshot if present, else
  the live product's first image, else `null`. Legacy orders render only
  because of the fallback.

`POST /api/order` does NOT decorate its items — it had only the raw column, so
`exposeOrder` copies `productImage` into `image` when `image` is absent before
deleting it. That is why the create response is not image-less; do not remove
that fallback.

The ONE path that still ships `productImage` is the admin GHN console detail
(`GET /api/order/admin/ghn/orders/:id`): `getAdminGhnOrderDetail` calls
`decorateItem` WITHOUT `exposeOrder`, and `web-flow-GHN` reads
`item.productImage` (`features/ghn-shipping/api/adapters.ts`). The asymmetry is
deliberate — do not "unify" it without changing that console first.

Item `price` is a `number` on every path (entity transformer), and since
RET-NUM-01 (2026-08-13) so is return-request `refundAmount` — same
`decimalToNumber` transformer on `OrderReturnRequest.refundAmount`, covering the
list, `/mine`, and approve responses. It stays `null` while a request is pending
or rejected; only approval sets it. Any NEW `DECIMAL` column that reaches HTTP
needs that transformer — mysql2 hydrates DECIMAL as a string. `subtotal` is
present on `GET /api/order/:id` and `POST /api/order` but NOT on the two seller
PATCH responses — those return the plain order shape; recompute from `items` if
you need it there.

## Post media cleanup is reference-counted (MEDIA-ORPHAN-01, 2026-08-11)

`editPost`, `deletePost` and moderation delete drop Cloudinary assets through
`destroyUnreferencedMedia()`, not directly. Consequences to expect:

- A URL attached to more than one post is **never** destroyed until the last
  post referencing it is gone. `imageUrls` is client-supplied, so sharing a URL
  across posts is legal and must stay non-destructive.
- The reference check is a `posts` query (`video_url` equality OR
  `JSON_CONTAINS(image_urls, …)`); it runs AFTER the caller's commit, so the
  edited/deleted row cannot match itself. Do not move it inside the transaction.
- If the check itself fails, nothing is destroyed and a warn is logged. Cleanup
  is best-effort and must never fail the mutation that triggered it.
- Dead post URLs are therefore NOT evidence of an over-eager cleanup. The dev
  cloud was purged wholesale once; leftovers with a doubled `trybuy/posts/
trybuy/posts/` folder or an `undefined_` prefix come from an old FE upload
  bug. Fix such rows as data, do not re-diagnose the cleanup path.

## Upload size caps are a contract, NOT a security boundary (UPLOAD-SIZE-01, 2026-08-15)

`POST /api/upload/signature` returns `maxBytes` (and `maxVideoBytes` on the
posts folder, the only one whose `allowed_formats` admits mp4) and refuses with
400 when the caller declares a `bytes` larger than the folder's ceiling. Read
this before "hardening" it — the limits are deliberately unenforceable server
side, and the reasons are probed facts, not assumptions:

- **Cloudinary cannot enforce a signed size on this account.** Three live probes
  on 2026-08-15: (1) putting `max_file_size` in the signed string → `401 Invalid
Signature`, and Cloudinary's own error echoes the string it expected —
  `allowed_formats=…&folder=…&public_id=…&timestamp=…` — i.e. size params are
  excluded from the signable set; (2) a _signed_ upload preset carrying
  `max_file_size: 10240` still accepted a 40 KB file (HTTP 200, `bytes=40964`);
  (3) the Admin API silently DROPPED `max_file_size` — `GET
upload_presets/<name>` came back with `settings: {"folder":"trybuy/products"}`
  and nothing else. So there is no signed-upload size limit to reach for. Do not
  re-probe this; do not add `max_bytes` to `paramsToSign` — it breaks every
  upload.
- **Therefore `bytes` is advisory.** It is optional and client-supplied: a
  client that omits it or lies gets a signature and uploads anything. The check
  exists so both sides agree on ONE number instead of the FE hardcoding its own.
  Do not describe it as a limit that protects the account.
- **The only real fix is proxying the bytes through the gateway**, which throws
  away the entire point of direct-to-Cloudinary upload. Considered and declined;
  it would also be a class C contract change.
- **Response fields are camelCase ON PURPOSE.** Everything else in that response
  is snake_case because it is a Cloudinary param the client forwards verbatim;
  `maxBytes`/`maxVideoBytes` are ours and must NOT be forwarded. Verified
  harmless either way — a client that does forward `maxBytes` still uploads
  (HTTP 200): Cloudinary ignores parameter names it does not recognize. That is
  the opposite of `max_file_size`, a name it DOES recognize, which is what makes
  signing it fatal.
- **The ceiling is per folder, not per file type.** The signature is issued
  before any byte is read, so the server cannot tell an image from a video and
  checks `bytes` against the folder's _video_ cap where one exists (posts:
  100 MB). An 11 MB image into `trybuy/posts` therefore passes the server and is
  caught only by the client's own per-type check. That asymmetry is intended —
  do not "fix" it by rejecting on the image cap, which would block legitimate
  video uploads.

## The voucher quota gate is an admission gate, not the cap (VOUCHER-CONC-01, 2026-08-18)

`voucher:quota:<voucherId>` in Redis is claimed at the top of `placeOrder`,
before the GHN fee preview and before any stock is reserved, so a burst on a
flash code rejects its losers after one round trip instead of after a GHN call
plus a reservation that then needs compensating. What it is NOT is the cap.

- **It fails OPEN.** Redis unreachable ⇒ `claimVoucherQuota` logs a warn, returns
  false, and the checkout proceeds. The conditional
  `UPDATE ... WHERE usage_limit IS NULL OR used_count < usage_limit` inside the
  create transaction is what actually enforces the limit, exactly as before. A
  Redis outage costs throughput, never correctness. Do not "harden" this into a
  fail-closed gate — that turns a cache outage into a checkout outage.
- **It can be pessimistic for up to 300s.** The counter mirrors
  `usage_limit - used_count`, and the refund on a failed checkout is best
  effort. A lost refund (process died between the failure and the release) makes
  the mirror read low, so a buyer gets 409 `JUST_FULLY_REDEEMED` on a code that
  still has room in SQL. Self-heals at the TTL, which re-seeds from SQL. This is
  why the TTL is short and why `releaseToSeededQuota` refuses to recreate an
  expired key — a plain INCR would resurrect it TTL-less at "1 left" forever.
- **409 vs 400 is not arbitrary.** `validateVoucherForCheckout` runs BEFORE the
  claim, so an already-exhausted code still returns the old 400
  `FULLY_REDEEMED`. The gate only ever produces 409 `JUST_FULLY_REDEEMED` — the
  same status the DB-level race loser has always returned. That ordering is what
  keeps the change release class A; do not reorder them.
- **Cancelling never gives a redemption back.** `used_count` is not decremented
  anywhere — not by buyer cancel, not by the post-commit payment-init failure
  path, which cancels the order and releases stock but leaves the redemption
  standing. The Redis mirror deliberately matches that: the claim is kept on
  commit and only refunded when the checkout did NOT commit. If a future change
  makes cancellation restore `used_count`, the mirror has to learn the same
  rule.
- **The per-user re-check inside `redeemVoucher` must stay a LOCKING read.**
  Under MySQL REPEATABLE READ a plain SELECT answers from the snapshot the
  transaction took before its conditional UPDATE, which cannot see the row
  committed by the transaction it just queued behind — it would count zero and
  let a second order through on a one-per-user code. `pessimistic_write` reads
  the latest committed version. Lock order is voucher row first, redemptions
  second, in every caller; keep it that way and it cannot deadlock.

## Gateway read payloads are trimmed at the boundary (OVERFETCH-01, 2026-08-20)

The FE asked for smaller read payloads. Every cut is made in a gateway
boundary walker, never in a microservice — the TCP/RMQ shapes and the entities
are unchanged, so internal consumers keep every field. What HTTP no longer
carries, and why it cannot come back by accident:

- **`reservationKey`** (`exposeOrder`) — the internal inventory-reservation
  handle. Server-side state; shipping it let a caller name another order's
  reservation. `toAdminGhnLocalOrder` projects explicit fields and never had it.
- **`productImage`** on order items — see ORDER-SHAPE-01 above.
- **`previousOrderStatus`** (`exposeReturnRequest`) — exists only so the orders
  service can roll an order back when a return is rejected.
- **`user1LastReadAt` / `user2LastReadAt`** (`exposeChatConversation`) — per-side
  read cursors. `unreadCount` is the derived value the client renders; the
  cursors also told each participant when the other last opened the thread.
  `ChatConversationTcp` still declares them: that type describes the TCP wire.
- **`followerId` / `followingId`** on `GET /api/social/users/:id/followers`
  and `/following` — the embedded `user.id` is the same value.
- **`role.slug`** (`exposeRole`) — `name` is the `RoleName` enum that JWT
  generation and every `CheckPermission` grant key off; `rol_slug` had no reader
  in any of the three repos. Only `{id, name}` is exposed now.
- **Nested `brand` / `categories[]` on a product row** are trimmed to
  `{id, name, isActive}` by `trimTaxonomyReferences`. The moderation columns
  (`description`, `status`, `submittedBy`, `reviewNote`, timestamps) are the
  moderation queue's business, and those routes (`brands`, `brands/pending`,
  `categories`, `categories/pending`) do NOT pass through
  `exposeProductReferences`, so they still carry them. `attachCategoryIds` runs
  BEFORE the trim and only needs `id` — keep that ordering.

Additive in the same pass: a hydrated `{id, username, avatar}` sibling next to a
bare user-reference id, built from the user rows the walker already fetched —
`actor` (notifications), `reporter` (social report rows), `reviewer`
(return requests). The bare id key is unchanged. NEVER add `email` to these:
`getUserSummaryMap` pulls it with `includeEmail: true` for internal use, and the
summary object is what reaches HTTP.

**All three embeds must keep ONE shape** — `{ id: string, username: string,
avatar: string | null } | null`, so the FE can declare a single `UserSummary`
for all of them. The first cut of `actor` did not: it was hand-built as
`publicId ?? null` / `username ?? null`, making all three keys nullable while
`reviewer`/`reporter` (both from `UserInfo`) were not. The FE caught it the same
day and it is fixed — `actor` now emits the embed only when the row has a public
id, so it is either COMPLETE or `null`. Do not "fix" that skip into a
`String(user.id)` fallback: order/social do fall back that way, but on this path
the sibling `actorId` is already `publicId ?? null`, and a numeric fallback here
would put an internal id on the wire (PUBID). In practice neither is reachable —
`users.username` is NOT NULL and `publicId` is assigned at registration.

`actor` rides the realtime push too, not just the list: `NotificationPushController`
runs the same `exposeReferences` before `sendToUser`, so the `notification` event
on WS namespace `/notifications` carries the identical embed (verified live over
a real socket).

Deliberately KEPT after review: `toDistrictId` / `toWardCode` on orders (the FE
needs them to re-open an address picker), and everything the FE listed as
"please keep".

Residual: the product public read cache holds already-exposed payloads
(`PUBLIC_READ_CACHE_TTL_SECONDS = 10`), so for up to 10s after a deploy a
product read can still serve a pre-trim fat row. Self-healing; not a bug.

## Reports outlive their post; the moderation queue hides them (REPORT-TOTAL-01, 2026-08-21)

`deletePost` (`apps/social/src/social.service.ts:559`) hard-removes the post with
`postRepository.remove` and never deletes the matching `post_reports` rows. There
is no FK and no cascade — `PostReport` carries a plain `post_id` int column
(`apps/social/src/entities/post-report.entity.ts:17`). So every deleted post that
had been reported leaves its report rows behind, permanently.

This is deliberate: those rows are the moderation audit trail for a post that was
taken down. Do NOT "fix" it by deleting reports in `deletePost` without a product
decision.

What WAS a bug and is fixed: `listReportedPosts` counted those orphans in `total`
while dropping them from `data`, so `GET /api/social/admin/reports` could answer
`{data: [], total: 1}` — that is exactly the prod symptom the FE reported on
`?status=resolved`. Both the page query and the count query now inner-join
`posts`, so orphans are excluded from both. The `if (!post) return null` guard
further down is now only a type guard for the `Map.get()` plus a defence against
a post deleted between the two queries — it is no longer what filters orphans.

Consequence to expect: `total` on this endpoint can be LOWER than the raw
`post_reports` row count for that status, and that is correct. Anyone reconciling
the endpoint against the table directly must join `posts` too.

## `null` is a 400 on a voucher edit, but still a 201 on a voucher create (VOUCHER-NULL-01, 2026-08-26)

`PATCH /api/order/vouchers/:id` and `PATCH /api/order/admin/vouchers/:id` now
reject an explicit `null` on `minOrderAmount` and on `isActive` with a 400. Those
two are the only fields on `UpdateVoucherDto` backed by NOT NULL columns
(`min_order_amount decimal(12,2) default 0`, `is_active boolean default true`),
so `null` was never "clear it" — it was a client mistake that used to reach the
service. The other six fields (`description`, `maxDiscountAmount`, `usageLimit`,
`perUserLimit`, `startsAt`, `expiresAt`) are genuinely nullable and still take
`null` to clear.

**Why it was a 500 and not a 400 before:** class-validator's `@IsOptional()`
skips every other validator when the value is `undefined` **or `null`**, so the
gateway pipe waved `null` through. Downstream it surfaced three different ways
depending on the voucher — `minOrderAmount: null` on a percent voucher hit
`input.minOrderAmount.toFixed(2)` → `TypeError` → 500; on a **fixed** voucher it
hit the VOUCHER-GUARD-01 comparison first, where `null` coerces to 0, and
returned a *misleading* 400 `FIXED_VALUE_EXCEEDS_MIN_ORDER`; `isActive: null`
reached a NOT NULL column → driver error → 500. All three collapse into one
honest validation 400 now.

The fix is a decorator, not a service guard: `@IsOptionalNotNull()`
(`apps/gateway/src/common/validators/is-optional-not-null.validator.ts`) is
`ValidateIf(value !== undefined)` — it skips on `undefined` exactly like
`@IsOptional()`, but lets `null` fall through to `@IsNumber()`/`@IsBoolean()`.
Reuse it on any future DTO field that is optional but maps to a NOT NULL column;
do not add runtime null checks in the microservice, whose input type already
says the field is `number | undefined`.

**The 400 body carries two clauses**, because `@Min(0)` also fires on `null`:

```
"minOrderAmount must not be less than 0, minOrderAmount must be a number — send 0 to remove the threshold, not null"
```

Cosmetic, and the actionable clause is present — do not chase decorator ordering
to suppress the first one.

**Deliberate asymmetry — do NOT "fix" it:** `POST /api/order/vouchers` and
`POST /api/order/admin/vouchers` still ACCEPT `minOrderAmount: null` /
`isActive: null` and answer 201, because `createVoucher` already coerces with
`?? 0` / `?? true`. Nothing crashes and nothing is stored wrong. Tightening
create would turn a currently-succeeding call into a 400 — release class C,
needing an FE hold — for zero reported benefit. Create is forgiving, update is
strict, and that is the intended state.

## Chat `new_message` targets a room UNION (CHAT-ROOM-01, 2026-08-15)

`ChatWsGateway.handleSendMessage` emits to `chatMessageRooms(...)` =
`["user:<a>", "user:<b>", "conv:<publicId>"]`, not to the conversation room
alone.

- **A recipient no longer needs `join`.** Every socket enters `user:<id>` at
  connect, so `new_message` arrives wherever the user is in the app. The `join`
  handler is kept and unchanged — a client that still joins per conversation
  keeps working, it is simply redundant now.
- **No duplicate.** Socket.IO delivers the union of the targeted rooms and
  dedupes per socket, so a client in both `user:` and `conv:` gets exactly one
  copy. Do not "fix" this by emitting per room in a loop — that WOULD duplicate.
- **`participantIds` is internal.** It rides on the `chat.send_message` TCP reply
  only. `exposeChatMessage` builds an explicit field list (no spread), so it can
  never reach the wire; a future field added to the TCP shape is dropped the same
  way. Do not assert it in a WS payload test.
- **Fallback:** when the chat service sends no `participantIds`, the helper
  returns the conversation room alone — i.e. the pre-2026-08-15 behaviour. A
  gateway newer than the chat service degrades, it does not break.
- `/chat` and `/notifications` are separate Socket.IO namespaces that both use a
  `user:<id>` room name. The registries are per-namespace, so there is no
  cross-talk between chat messages and notifications.
