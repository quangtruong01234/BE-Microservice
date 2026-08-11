# CHANGELOG — TryBuy Backend

> Historical record of completed work. **NOT auto-loaded** by any agent entry point.
> Read on demand only when you need the history/rationale of a past change.
> Current state (overview, active tasks, known issues) lives in `snapshot.md`.

## Completed Milestones

- **RETURN-STOCK-01 — approving a return never restocked inventory (2026-08-11).**
  Reported by FE from prod: `prod_BWg2OVHUlmrlEfP5` sat at 48 units after an
  approved return of 2 units (order `refunded`, `refundStatus: "refunded"`,
  `reservedStock: 0`), while a cancel on the same product restocked correctly.
  - **Root cause:** `approveReturnRequest` called `releaseReservedItems()`, which
    routes to `transitionReservation()` in `apps/inventory/src/inventory.service.ts`.
    That method opens with `if (reservation.status !== RESERVED) return false;`.
    An order that reached COMPLETED has had its reservation **CONSUMED**, so the
    release matched nothing and returned `false` — silently, because the caller
    only logged. Cancel worked precisely because a cancelable order (PENDING/
    CONFIRMED/PROCESSING) still holds a RESERVED row. The old code even carried a
    comment calling the release "a safe no-op"; it was a no-op, but not safe —
    the seller lost the units permanently.
  - **Fix:** a distinct operation, not a widened release. New
    `InventoryService.restockReturnedStock()` credits `availableStock` under the
    same `pessimistic_write` lock from *whatever* state the reservation reached,
    and stamps the row `RETURNED` so a replay cannot credit twice. From
    `RESERVED` (return approved while DELIVERING) it also drops the hold; from
    `RELEASED` it stamps RETURNED without crediting; from `RETURNED` it is a
    no-op. Exposed as TCP `inventory.restock_returned`
    (`INVENTORY_MESSAGE_PATTERNS.INVENTORY_RESTOCK_RETURNED`) and called from a
    new `restockReturnedItems()` in `orders.service.ts`, which is non-fatal by
    design — a stock write must not sink an approved refund — but logs every
    rejection/failure so a shortfall is greppable.
  - **No migration.** `inventory_reservations.status` is a plain `VARCHAR(20)`
    with no PG enum or CHECK constraint (see
    `database/prod-baseline-20260717/nodeB-postgresql-baseline.sql:14`), so the
    new `RETURNED` value needs no schema change — which is why prod can take
    this as a code-only deploy.
  - **Verified.** `tsc --noEmit` clean, eslint/prettier clean on all 5 changed
    files, `npx jest` → 30 suites / 259 tests green, including 3 new ones in
    `inventory.service.spec.ts` — one of which asserts `releaseStock` resolves
    `false` on a consumed reservation, pinning the exact defect. End-to-end on
    localhost against `prod_ffc7fc2281d211f1` (baseline 100/0): order
    `ord_8Fvn64OUDUPJWICa` (3 units, COD, GHN waybill `L89XUX`) driven confirm →
    ready-to-ship → ship → deliver → complete gave `availableStock: 97,
    reservedStock: 0` (the exact prod state); return `rr_QuBq7lkAs17cfPBZ` →
    approve → **`availableStock: 100`**; replay approve → 400 "already been
    reviewed" with stock still 100; product mirror `stockQuantity: 100` (the
    `inventory.stock_changed` fanout propagated).
  - **Blast radius checked:** `InventoryReservationStatus` is used only inside
    `inventory.service.ts`; a RETURNED row makes any later release/consume fail
    safe. `cancelOrder` admits only PENDING/CONFIRMED/PROCESSING, so a REFUNDED
    order can never re-enter the release path via `order_canceled`.
    `sweepStaleReservations` filters on those same three statuses plus
    `ghnOrderCode IS NULL`, so it cannot touch a returned order. Returns are
    only openable from DELIVERING or COMPLETED — both states are covered by a
    unit test.
  - Residual behaviours recorded in `ai-docs/agent-context/known-behaviors.md`.

- **RESIL-01 — circuit breaker + GHN error mapping (2026-08-10).** Closes
  PRODTEST-0806 defect #1. Every outbound GHN call in `apps/orders/src/ghn/
  ghn.service.ts` posted via axios with no catch, so a non-2xx GHN reply threw a
  raw AxiosError *before* the `GHN_MESSAGE.*_ERROR` branch could run — the seller
  got "Internal server error" (or a gateway 502 when the TCP timeout fired
  first), and GHN's actual reason ("Trạng thái đơn hàng không hợp lệ", "context
  deadline exceeded") survived only in shipping history and logs.
  - **New shared primitive:** `libs/common/src/resilience/circuit-breaker.ts`,
    exported from `@app/common`. Hand-rolled rather than adding `opossum` — ~150
    lines, no new dependency, and the project rule is to search `libs/` first.
    CLOSED → OPEN after N consecutive qualifying failures → HALF_OPEN after
    `openDurationMs`, where exactly ONE trial call probes the dependency (the
    trial flag is captured per-call so a CLOSED-path call cannot clear it) and
    closes the circuit on success / reopens it on failure. In-process by design:
    one instance per protected dependency, held as a field by the owning service.
    With multiple instances each learns the outage independently — acceptable,
    because the goal is shedding load, not global consensus.
  - **Failure discrimination is the whole trick.** `isFailure` is what keeps a
    shared integration safe: an outage is "GHN did not answer" (timeout / DNS /
    ECONNREFUSED) or answered 5xx, **plus** the operational faults `401/403`
    (our token is broken) and `429` (GHN is rate-limiting us) — none of which a
    caller can fix by retrying with different input. Any other 4xx is GHN
    rejecting THAT request (bad address, waybill in the wrong state) and must
    NOT count, or one seller's malformed address would open the circuit for
    every other seller.
  - **Mapping:** `callGhn()` wraps ONLY the transport call — never the response
    validation that follows it, so a domain rejection we raise ourselves never
    counts toward the threshold. `toGhnDomainError()` then maps GHN refusal →
    `400` carrying `response.data.message`, outage → `503`, and an open circuit →
    `503 "GHN is temporarily unavailable; retry in <n>s"`. Applied to
    `createShippingOrder`, `previewShippingFee`, `switchOrderStatus`,
    `postOrderMutation` (updateCOD/updateReceiver — these went from always-500 to
    400/503), `getOrderDetail`, and the three master-data getters behind the
    public `/api/shipping/*` dropdowns. `getOrderDetail` gained an early
    `instanceof HttpException` rethrow so an open circuit is not misreported as
    "waybill not found". New `GHN_MESSAGE.MASTER_DATA_ERROR` / `CIRCUIT_OPEN`.
  - **Blast radius checked:** all five other `createShippingOrder` callers
    already catch-all (COD create, payment_completed, multi-seller) except
    `ready-to-ship`, which deliberately propagates — that path now returns an
    actionable 400/503 instead of an opaque 502, which also softens (not closes)
    PRODTEST-0806 defect #2. Gateway `MicroserviceErrorHandler` passes any
    `statusCode` through generically, so 503 reaches the client; the envelope
    `error` field still reads `"HttpException"` (defect #5, unchanged).
  - **Verified:** `tsc --noEmit` clean, eslint clean, 16/16 new tests
    (`circuit-breaker.spec.ts` 7 + `ghn.service.spec.ts` 9), existing
    `orders.service.spec.ts` 43/43 green. Live against the GHN sandbox:
    nonexistent district/ward → `400 "GHN preview error: phường/xã người nhận
    không tồn tại trong hệ thống"` (was a 500), happy path `1442/20110`
    unchanged at `201`. The outage/circuit legs are covered by mocked-transport
    tests — a real GHN outage cannot be forced against the sandbox, and
    `local/nodeA/.env` is permission-blocked so the base URL could not be
    pointed at a blackhole. Note the snapshot's recorded prod reproducer
    (district 1534 / ward 22306, Huyện Nhà Bè) did NOT reproduce locally —
    it returned a successful fee, so PRODTEST-0806 defect #3 needs re-checking
    on prod rather than being assumed still live.
  - FE handoff written to both `frontend-handoff.md` (checkout shipping-fee +
    address dropdowns) and `frontend-handoff-ghn.md` (admin GHN actions).

- **SOCIAL-502 — intermittent 502 on `GET /api/social/posts` root-caused and
  fixed (2026-08-09).** FE reported a 502 followed by a 200 on the immediate
  retry, same params/session, on a one-user dev box. **Root cause is a race in
  `@nestjs/microservices` 11.1.19 `ClientTCP`, not our code and not load:**
  `send()` resolves its cached `connectionPromise` in a *promise microtask*, but
  Node drains the *nextTick* queue first — and that is where the socket `'close'`
  listener runs `handleClose()`, which sets `this.socket = null`. `publish()`
  then dereferences the null socket and throws
  `TypeError: Cannot read properties of null (reading 'sendMessage')`. That
  TypeError matched no branch in `extractStatusCode`, so it fell through to the
  `502` default. The next request finds `connectionPromise === null`, builds a
  fresh socket, and returns 200 — exactly the reported 502-then-200.
  - **Reproduced deterministically** with a standalone probe (scratchpad
    `tcp-race.js`): warm the connection, dispatch a `send()`, call
    `handleClose()` in the same tick → the exact TypeError; the follow-up
    request succeeds on a fresh socket.
  - **Disproven first, so nobody re-litigates them:** social crash-loop
    (`registerDirectPublisher` is already hardened — null-return factory,
    heartbeat 30, error/close listeners); gateway starting before social
    (social came up 2m12s *before* the gateway); load (25 rounds × 8 concurrent
    feed reads → 200/200). The `logs/*.log` files are stale (Jul 19) — the dev
    stack runs under `concurrently`, not pm2.
  - **New `apps/gateway/src/common/exception/transport-error.ts`:**
    `isTransportError()` (socket error codes, `"Connection closed"`, the
    not-initialized message, and the null-socket `sendMessage` TypeError in both
    the modern and legacy V8 phrasings) + `retryOnTransportError()`, a single
    100ms rxjs `retry` that resubscribes the whole `send()` so the ClientProxy
    builds a fresh socket. Business errors and rxjs `TimeoutError` are rethrown
    untouched.
  - **`MicroserviceErrorHandler`** gained an early transport branch before the
    rpc unwrap: any transport failure is now one `502` +
    `COMMON_MESSAGE.SERVICE_UNAVAILABLE`, logged in full but never echoed. This
    fixed **two latent defects across all 14 gateway services**, not just social:
    `connect ECONNREFUSED 127.0.0.1:3008` used to be copied verbatim into the
    HTTP body (leaking the internal host:port, against the "never expose raw
    errors" rule), and `"Connection closed"` used to map to a nonsensical `408`.
    A dead branch in `extractStatusCode` was also fixed (it tested `"ETIMEDOUT"`
    against an already-lower-cased string).
  - **`social.service.ts`:** `retryOnTransportError()` added to the 7 idempotent
    read call sites (`getPosts`, `getPostsByUser`, `getPostById`,
    `getFollowingFeed`, `fetchAuthorMap`, `resolveUserId`, and the
    `exposeReferences`/`exposeProductIds` id fan-outs), always AFTER
    `timeout(...)` so each attempt keeps its own budget. **No write path got a
    retry** — a retried write can apply twice.
  - **Verified:** tsc/eslint clean; Jest **28 suites / 240 tests** green (was
    27/224 — +1 suite, +16 tests). Live on the running stack: feed returns 200
    unchanged; forcing a real social restart via the watcher produced 9 × 502
    that were **all** sanitized (`"Service unavailable"`, zero `127.0.0.1` /
    `ECONNREFUSED` in the body) and the feed recovered on its own. A regression
    test pins that a genuine rxjs timeout is still 408.
  - Residual behaviours in `known-behaviors.md`; optional rollout of the retry
    to other gateway reads tracked in `snapshot.md` Active Tasks.

- **CD-05 — frontend origin + cookie policy moved from `.env` into pm2, and the
  deploy now refreshes env (2026-08-08, second origin added 2026-08-10).** Both
  frontends went live on their own domains — storefront
  `https://fe-react-vite.quangtruong01234.workers.dev` (Cloudflare Workers) and
  GHN shipping console `https://web-flow-ghn.vercel.app` (Vercel) — while the API
  stays on `https://<PROD_API_DOMAIN>` (nginx serves the gateway only, no static
  root), so both are cross-site: a `lax` cookie is dropped on every credentialed
  XHR and the gateway CORS allow-list must name each origin. Both values used to
  live in `local/nodeA/.env`, which is gitignored — CD could neither update it
  (`git reset --hard` leaves ignored files alone; there is no `git clean`) nor
  survive the "someone edits it and nothing changes" trap. Changes:
  - `ecosystem.config.js` now injects `FRONTEND_URL` **and**
    `AUTH_COOKIE_SAME_SITE` into the `gateway` app (payments already got
    `FRONTEND_URL`). pm2-injected env structurally wins over dotenv, so these are
    now the single source of truth and are version-controlled.
  - **Order contract documented in the config:** the two consumers read the same
    variable differently — gateway `cors.ts` splits on `,` and allows every
    entry; payments `payments.service.ts:368` takes entry `[0]` only to build
    `<origin>/payment-result`. The storefront is entry `[0]` and must stay
    first; the GHN console is `[1]` and never handles payments. Append further
    origins, never prepend. Matching is exact-string — Vercel/Workers PREVIEW
    subdomains are rejected until listed, and `cors.ts` drops `*` on purpose
    because credentials are enabled.
  - `deploy.yml` swapped `pm2 restart` for `pm2 startOrRestart ...
    --update-env` (deploy step, rollback step, and the by-hand rollback recipe
    in the header), so a committed env change actually reaches the process and a
    box with deleted/missing apps still comes up. `package.json` `pm2:restart`
    matches. The header gotcha note was rewritten accordingly.
  - Dead-key guards: `local/nodeA/.env.production.example`,
    `local/nodeB/.env.production.example` and `docs/deployment-runtime.md` now
    say explicitly not to declare these two keys in `.env`.
  - `security.md` Cookie/CSRF section updated — it previously said "do not set
    `AUTH_COOKIE_SAME_SITE=none`", which the deployment topology now forces. It
    records why, what still limits exposure (JSON-only body parsing defeats the
    no-preflight form POST; strict allow-list; mutations on non-safe methods
    only), the residual risk (a mutating route accepting an empty body), and
    that the clean fix is topological — put both FEs on subdomains of one
    registrable domain and revert to `lax`.
  - Verified pre-deploy: `tsc --noEmit` 0 errors, Jest 28 suites / 240 tests
    green, and a throwaway spec ran the REAL `cors.ts` + `auth-cookie.ts`
    against the env `ecosystem.config.js` injects — allow-list = both origins,
    storefront and GHN console accepted, a `*-git-<branch>.vercel.app` preview /
    `evil.example.com` / `localhost:5173` all rejected under
    `NODE_ENV=production`, cookie `sameSite:none` + `secure:true` +
    `httpOnly:true`, payments return origin = the storefront.
  - **Shipped and verified on prod 2026-08-10 (commit `6400656`).** CORS came
    back ~3.5 min after the push. Post-deploy curls: both listed origins echo
    `Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials: true`
    with `Vary: Origin`; an unlisted origin gets none (response still 200 — CORS
    is browser-enforced, so do not expect a 403 when curling a rejected origin);
    `OPTIONS /api/user/login` → 204 with
    `Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE`; login → `Set-Cookie:
    access_token=…; Max-Age=18000; Path=/; HttpOnly; Secure; SameSite=None`,
    and that cookie authenticated `GET /api/user/me` → 200.
  - **`pm2 startOrRestart --update-env` is now PROVEN sufficient.** It was
    listed as not verifiable off-box; the release settled it — the deploy alone
    applied the new env with no SSH at all.
  - **`pm2 env <id>` is the WRONG verification tool — do not repeat this.** On
    2026-08-09 the one-time SSH below was run BEFORE the change was committed or
    deployed, and `pm2 env 0` printed an empty `FRONTEND_URL`. That output is
    uninformative either way: pm2 prints only what it injected at spawn, while
    `dotenv` loads `.env` *inside* the process where pm2 cannot see it. Verify
    from outside instead — `curl -sI -H "Origin: <fe-origin>"
    https://<PROD_API_DOMAIN>/live | grep -i access-control`. That curl is what
    actually diagnosed it: no `access-control-allow-origin` for ANY origin,
    i.e. the box's allow-list was empty because the `.env` key had been commented
    out while the new pm2-injected value had not yet shipped.
  - **Ordering is load-bearing.** What caused the outage: the box's `.env`
    `FRONTEND_URL` was commented out BEFORE the pm2-injected replacement
    shipped, so the allow-list was empty in between. Change the new source of
    truth, deploy, then remove the old one — never the reverse. The same rule
    killed the attempted fix: the one-time SSH (`pm2 delete gateway payments &&
    pm2 start ecosystem.config.js --env production --only gateway,payments &&
    pm2 save`) was run BEFORE the deploy landed the new `ecosystem.config.js`,
    so pm2 reloaded the old config and injected nothing. In the end that SSH was
    never needed — keep it only as a fallback for the day `--update-env` does
    not take. Changing an FE domain is now a one-line commit.

- **FE-inbox batch — all four `backend-handoff.md` Open items closed (2026-08-07).**
  `/sweep` fix mode over the FE→BE inbox; three code fixes and one investigation.
  - **PATCH null-clear.** `PATCH /api/products/:id` now treats an explicit `null`
    as "clear this column" for the six nullable ones (`description`, `sku`,
    `brandId`, `sellerNotes`, `weight`, `imageUrls`). Omitting a key still means
    "leave unchanged", so the FE's dirty-field patch is unaffected — it just
    sends `null` instead of dropping the key. Every OTHER field rejects `null`
    with 400 via `RejectsNull = ValidateIf((_o, v) => v !== undefined)`, so a
    stray `null` cannot wipe `name`/`price`/`skuList`. Shape: the microservice
    DTO is `PartialType(OmitType(CreateProductDto, CLEARABLE_FIELDS))` with the
    six redeclared as `T | null` — Omit-then-redeclare because a subclass cannot
    widen an inherited property type (TS2416). **Second bug found by the
    self-test and fixed in the same diff:** the inverse case was broken too —
    `PATCH {brandId: 28}` on a brand-less product saved `NULL`. The product is
    loaded WITH its `brand` relation and TypeORM writes `brand_id` from the
    relation object, so the FK column alone never decides the saved value;
    `product.brand` is now dropped on clear and refreshed on set
    (`apps/product/src/product.service.ts:1508-1543`). Worth remembering as a
    general TypeORM rule, not a product-specific quirk. **Third bug, found by
    the change-impact review after the self-test passed:** `PATCH {brandId: 0}`
    answered 200 with a self-contradictory body (`brandId: 0` next to
    `brand: {id:"28"}`). `0` is falsy, so the service guard
    `if (dto.brandId)` skipped the existence check AND both relation branches —
    the row kept its old brand while the response echoed the request. Newly
    reachable because a client clearing a brand might send `0` rather than
    `null`. Fixed with `@Min(1)` on `brandId` in both update DTOs (`@IsOptional`
    still skips `null`, so the clear path is untouched): `0`/`-1` → 400
    "brandId must not be less than 1".
  - **Buyer order status filter.** `GET /api/order/user/:id` accepts `status` —
    repeated keys or a comma-separated list (`status[]=` is unsupported by the
    Express simple parser → 400; same limitation as `provinceId`). Unknown value
    → 400 with the allowed list. Gateway forwards it only when non-empty, so the
    unfiltered path is unchanged; `total`/`totalPages`/`hasNext` describe the
    filtered set. A compile-time guard
    (`type EveryStatusIsShared = OrderStatus extends OrderStatusValue ? true : never`)
    breaks the build if the orders-service enum drifts from the DTO's list. This
    deletes an expensive FE mitigation: the reported account (65 orders) was
    fetching all 7 pages to surface 1 refunded row.
  - **Payment return URL carries the public id.** The order's `publicId` is
    threaded from the `order_created` RMQ event through `processPayment` →
    `issueGatewayPaymentUrl` → `buildFrontendPaymentResultUrl`, covering both the
    create path and the `GET /api/order/:id/payment-url` recovery path. Redirect
    is now `?order=ord_<16>&method=<gateway>` — previously the numeric PK, which
    `GET /api/order/:id` rejects with a PUBID 400, i.e. every payment deep-link
    was dead. No public id (and multi-order ZaloPay, where no single order
    applies) → the param is omitted, never numeric. Config also corrected in
    `.env.example` and `local/nodeB/.env.example` (the FE report cited a
    non-existent `apps/payments/.env.example`): `VNP_RETURN_URL` /
    `ZALOPAY_REDIRECT_URL` pointed at the gateway's JSON-only endpoint instead of
    the FE page, and are now documented as fallbacks — the real URL is built from
    `FRONTEND_URL`. **Residual:** payments created
    before this change keep a signed URL with the numeric id — the VNPay
    signature covers `vnp_ReturnUrl`, so it cannot be rewritten
    (`known-behaviors.md`).
  - **GHN-ADDR-01 `shippingFee: 0` — not a defect, closed.** Probing
    `dev-online-gateway.ghn.vn` directly: `code: 200 Success` with `total_fee: 0`
    and every component zero, for EVERY destination district/ward, EVERY weight,
    and BOTH `/v2/shipping-order/preview` and `/v2/shipping-order/fee`.
    `service_type_id: 2` ("Hàng nhẹ", what we send) prices at zero on the
    sandbox; "Hàng nặng" rejects a 2 kg parcel as an invalid weight. All three FE
    hypotheses ruled out: seller origin IS configured (far provinces still 0),
    same-district is not it (cross-province also 0), and explicit item weights
    change nothing. Prod uses the same base URL, so 0 is expected there too until
    real GHN production credentials exist. No code changed
    (`ops-runtime.md` → GHN).
  - **Verified:** `tsc --noEmit` and eslint clean; Jest 27 suites / 224 tests
    green (5 new/updated payment tests + the product DTO cases). Runtime: all six
    fields cleared and re-read on sku `XM-RBUDS5-BLK` with all eleven
    non-clearables 400ing and the product restored to seed state afterwards;
    `?status=refunded` → `total:1` on page 1 (was page 2), 5-status tab → 15 rows,
    `?status=bogus` → 400; and a real order through RabbitMQ produced
    `vnp_ReturnUrl = …/payment-result?order=ord_DdtwEyoNyBD2Foda&method=vnpay`
    with that id resolving `GET /api/order/:id` → 200.

- **PRODTEST-0806 defects #1â€“#3 fixed (2026-08-06).** The first three findings of
  the full prod API sweep; #4â€“#9 stay open in `snapshot.md`.
  - **#1 Duplicate register no longer 500s.** `user.service.register()` gained a
    `assertCredentialsAvailable()` pre-check (one `find` over `username`/`email`)
    that throws `ConflictException` with a field-specific message
    (`USER_MESSAGE.USERNAME_TAKEN` / `EMAIL_TAKEN`), plus
    `duplicateCredentialConflict()` which maps a racing MySQL `ER_DUP_ENTRY` on
    save to the same 409. The pre-check alone is not race-proof â€” the catch is
    what closes the window. It only claims the 409 when the duplicated value
    parsed out of `sqlMessage` is the username/email we tried to write, so the
    unique `public_id` keeps its own error. `AllRpcExceptionFilter` already
    understood only PostgreSQL codes (`23505`), which is why the MySQL duplicate
    fell through to "Database operation failed". Same treatment applied to
    `updateUser()` â€” `UpdateUserDto.email` is the only other unique field it can
    write.
  - **#2 Role entity no longer leaks.** Two layers. (a) At the HTTP boundary,
    gateway `exposeUser()` now runs `role` through `exposeRole()` â†’
    `{id, name, slug}`; `generateJwtToken` still reads `rol_name`/`rol_grants`
    off the RAW TCP payload, so grants are not lost (verified: reshaped login
    still yields a working admin JWT). (b) In the user service, `getInfo()` and
    `getUsersByIds()` pass `loadEagerRelations: false`. **Gotcha worth keeping:**
    a column-level `select` does NOT suppress an `eager: true` relation, so those
    "summary" reads had been joining and returning the whole `roles` row â€”
    including the `rol_grants` permission matrix â€” into every cross-service user
    embed (orders/GHN admin `buyer`/`seller`, social, chat, cart, product,
    notification). Deliberate asymmetry left behind: `GET /api/user` (admin-only)
    keeps `role` as the reshaped summary, while `GET /api/user/:id` (public
    profile) now returns no `role` at all.
  - **#3 Pagination shape unified.** `GET /api/products` returns
    `PaginatedResponse` instead of a bare array; `GET /api/order/admin/orders`
    goes through `PaginatedResponse.of()` so it gains `totalPages`/`hasNext`.
    The product list cache prefix was deliberately NOT bumped â€”
    `PUBLIC_READ_CACHE_TTL_SECONDS` is 10, so the stale-shape window after
    deploy is 10 s.
  - Verified locally end-to-end: duplicate username â†’ 409, duplicate email â†’
    409, fresh register â†’ 201, login â†’ role summary + working admin JWT,
    `PATCH /api/user/:id` duplicate email â†’ 409 while re-submitting the user's
    OWN email â†’ 200 (no false conflict), `GET /api/products` and
    `GET /api/order/admin/orders` â†’ full envelope, admin-orders `buyer` embed
    and admin user list contain no `rol_` key. 26 suites / 202 tests green.
  - **Deployed and re-verified on prod 2026-08-10 (commit `b0e982d`).** Worth
    recording because the gap was the real risk: the contract was announced to
    both frontends on 2026-08-06 and integrated by the storefront on 2026-08-07,
    but the code sat uncommitted in the working tree until 2026-08-10 — for four
    days prod served the OLD shape to a frontend already reading the new one.
    Prod curls after the deploy: `GET /api/user/me` → `role:{"id":1,"name":
    "admin","slug":"admin-001"}` (`admin1`) and `{"id":3,"name":"user","slug":
    "user-001"}` (`user1`), no `rol_*` key anywhere; `GET /api/products?limit=2`
    → `{data,total,page,limit,totalPages,hasNext}` with `total:21 totalPages:11
    hasNext:true`; `GET /api/order/admin/orders?limit=2` → `total:34
    totalPages:17 hasNext:true`, no `rol_` in the buyer/seller embeds;
    `?status=completed` → `total:2`, only completed rows; buyer
    `GET /api/order/user/:id?status=refunded` → `total:1 totalPages:1
    hasNext:false` out of 23 unfiltered, `?status=bogus` → 400 listing the nine
    statuses; `PATCH /api/products/:id {"brandId":0}` → 400 "brandId must not be
    less than 1" and `{"brandId":null}` → 200 with `brandId:null`; duplicate
    username → 409 "Username is already taken", duplicate email → 409 "Email is
    already registered" (envelope `error` still reads `"HttpException"` —
    PRODTEST defect #5, still open).
  - **Side effect of that verification:** the duplicate-email probe was run with
    an address that turned out NOT to be registered on prod, so it created a
    real account (`dupprobe0810`, role `user`, `usr_kOREpdKYQq3Ivb6g`). Recorded
    in `../.agent-local/test-accounts.md`; delete it in DB if that address is
    ever needed for a genuine signup.

- **First production deploy through CD-01 (2026-08-06, sha `19309f6`).** The
  workflow shipped 2026-08-03 had never run; this closes it. Repo secrets set:
  `EC2_HOST` = `<PROD_API_DOMAIN>` (the DDNS domain, not an IP — the instance
  has no Elastic IP, and its public address had already rotated across three
  values), `EC2_USER` = `ubuntu`, `EC2_PATH` = `/opt/trybuy/api` (absolute,
  because `cd "$EC2_PATH"` cannot expand `~`), `EC2_SSH_KEY` =
  `trybuy_key_prod_Mumbai`. Security-group 22 opened to `0.0.0.0/0`: the SG had
  been pinned to "My IP", and GitHub-hosted runners publish ~4000 CIDRs against a
  60-rule SG limit, so key-only auth on an open port is the only workable option
  short of a self-hosted runner.
  - **Two workflow bugs found by running it, fixed in `19309f6`.** (a) The
    migration step failed with `Refusing production apply without
    --confirm-production` — `scripts/migrate-database.mjs:536` guards on
    `NODE_ENV`, which the box's `local/<node>/.env` sets to `production` while
    the dev env files say `development`, so the guard is invisible locally. Both
    `npm run db:migrate:node{A,B}` calls now pass `-- --confirm-production`.
    (b) The rollback step reported failure while actually succeeding: `curl: (7)
    ... after 0 ms` because `pm2 restart` returns before the gateway binds :3000.
    Both liveness probes are now 10×5s retry loops — proven on the green run,
    which logged `not live yet (attempt 1)` → `live (attempt 2)`. Also dropped
    `script_stop` from both steps (removed as an input in
    `appleboy/ssh-action@v1`; `set -euo pipefail` already covers it).
  - **Migration `nodeA-20260804-001-widen-product-reviews-product-id` is now
    applied to prod** — the workflow ran it before the restart, as designed.
  - **Verified after the run:** `/live`, `/health`, `/ready` all `status: ok`
    with `redis.status: ok`; `GET /api/products?page=1&limit=2` → 200 with `prod_`
    public ids and the `version` field.
  - **`production` Environment has no protection rules** — GitHub restricts
    required reviewers / wait timers to public repos on the Free plan, and this
    repo is private.

- **CD-04 — merging into `main` releases to production (settled 2026-08-06).**
  Briefly switched to `workflow_dispatch`-only (`e102cdf`) on the argument that
  nothing gated an unattended release, then reverted at the user's call: the
  deploy should follow the merge, not a button. `deploy.yml` triggers on CI
  completion for `main` again, with the job's `if:` dropping any run whose CI
  conclusion is not `success`, so a red build cannot reach the box.
  `workflow_dispatch` is retained for redeploys no commit triggers — the box was
  stopped when its deploy fired, a rollback, an env change. Two consequences
  accepted rather than engineered around: docs-only commits redeploy prod (a few
  minutes, harmless), and a merge landing inside the EC2's stopped window fails
  at the SSH step and leaves prod on the previous build until someone starts the
  instance and dispatches by hand.

- **AI-context audit executed end-to-end (2026-08-04, docs-only — no `.ts`
  touched).** Follow-through on the five-part context-audit report; goal was
  recurring-token cost reduction + stale-info removal + workflow automation.
  - **Snapshot compaction:** `ai-docs/agent-handoff/snapshot.md` rewritten from
    13,522 words / 1,134 lines to **1,565 words / 217 lines** (~88% smaller —
    this file is auto-loaded EVERY session, so the saving recurs per session).
    Nothing was deleted outright: DONE narratives stayed in this CHANGELOG, ops
    facts moved to NEW `ai-docs/agent-context/ops-runtime.md` (2,480 words),
    residual behaviours of shipped fixes moved to NEW
    `ai-docs/agent-context/known-behaviors.md` (1,268 words). Both new files are
    on-demand, registered in BOTH keyword tables (`.claude/CLAUDE.md` +
    `AGENTS.md`).
  - **Dedupe:** `typescript-rules.md` DELETED — its unique content merged into
    `conventions.md` (always-loaded), keyword-table rows removed from both entry
    points.
  - **Stale-info fixes:** service count 7 → 10 everywhere; `timeout(10000)` →
    `TCP_TIMEOUT_MS.READ|WRITE` tiers in CLAUDE.md Key Rules, `/review`,
    `/feature`; `api.md` purged of removed routes (`GET /api/user/all` → paginated
    `GET /api/user`, standalone SKU mutation routes → `PATCH /api/products/:id`
    `skuList`, inventory table cut to the real 4-route surface with low-stock
    roles/scoping, user projection `id` → `"usr_..."` string); `research.md`
    port + service-owner tables completed to all 10 services; `sweep.md` step 5
    now states the post-cutoff migration policy; `perf-audit.md` gained a
    prior-audit dedupe section + post-cutoff migration paths; agents
    (`code-reviewer`, `researcher`, `planner`) and `/debug` refreshed the same
    way; `/review` gained public-id, `@Type(() => Number)`, CSRF, and
    cookie-JWT checks.
  - **New commands:** `/migrate` (`commands/migrate.md` — guarded SQL +
    manifest entry + prod-owed tracking under the post-cutoff policy),
    `/handoff` (`commands/handoff.md` — routes storefront vs GHN handoff files,
    contract-first template), `/context-gc` (`commands/context-gc.md` —
    periodic snapshot GC with before/after measurement). All three registered
    in the CLAUDE.md Slash Commands section.

- **Two defects closed: `toDistrictId` now accepts a numeric string, and
  `product_reviews.product_id` widened INT → BIGINT. Runtime-verified on LOCAL
  2026-08-04 (10/11 on the first pass; the one failure was a probe artifact,
  re-proved 2/2 against the DB — see below).** These are the two items I listed
  as still-active defects when the user asked "hiện còn bug nào".

  - **Defect 1 — `toDistrictId` rejected `"3440"` with a 400.**
    - **Root cause:** `create-order.dto.ts` and `shipping-fee.dto.ts` both
      declared `@IsOptional() @IsInt() @Min(1) toDistrictId?: number` with no
      `@Type(() => Number)`. The gateway's global `ValidationPipe`
      (`apps/gateway/src/main.ts:82-93`) sets `transform: true` but deliberately
      NOT `enableImplicitConversion` — so `@IsInt()` runs against the raw JSON
      string and fails. An FE GHN district dropdown yields a string option value,
      so the exact-id path (GHN-ADDR-01) was unreachable without a manual cast on
      the client. Recorded as a "Minor" in the GHN-ADDR-01 Known Issue since
      2026-07-23.
    - **Fix:** `@Type(() => Number)` on `toDistrictId` in both DTOs (one line
      each; `Type` was already imported in both files). `toWardCode` is
      deliberately left `@IsString()` — GHN ward codes can carry leading zeros
      (`"13010"`), so coercing through Number would be lossy.
    - **Why the gateway is the right layer:** `apps/orders/src/orders.controller.ts:33-37`
      guards the exact-id path with `typeof toDistrictId === "number" &&
      toDistrictId > 0 && toWardCode`, treating anything else as absent →
      free-text fallback. Coercing at the DTO is precisely what that guard needs;
      a string would have silently degraded to free-text resolution rather than
      erroring, which is the worse failure.
    - **Verified (6/6), with an unresolvable free-text ward/district/province in
      the address on purpose so a success can ONLY come from the exact ids:**
      `POST /api/order/shipping-fee` with `toDistrictId:"3440"` → 201
      `{shippingFee:46207}` (was 400); with `3440` → 201 (no regression); with
      `"abc"` → 400; `POST /api/order` with `"3440"` → 201 with a real waybill
      `ghnOrderCode:"L8Q6EX"` (proves the coerced id reached the GHN leg, not
      just validation); with `"abc"` → 400; and the legacy no-ids free-text path
      still 201.

  - **Defect 2 — `product_reviews.product_id` was INT while `products.id` is BIGINT.**
    - **Root cause / real shape:** the prod baseline declares the column INT,
      matching the old entity — so the mismatch was against the PARENT
      `products.id` BIGINT, not against the migration. Every other FK pointing at
      `products.id` was already bigint (`product-sku.entity.ts:19`,
      `wishlist-item.entity.ts:24`, `product-risk-feedback.entity.ts:18`);
      `product-review.entity.ts` was the lone outlier. Latent: a product id past
      the signed-INT ceiling 2,147,483,647 would truncate or fail on review
      insert.
    - **Fix:** entity column → `type: "bigint"`, plus guarded migration
      `nodeA-20260804-001-widen-product-reviews-product-id` registered in
      `database/migrations.manifest.json`. Widening-only, so existing values are
      preserved and the currently-deployed code keeps working against the new
      column. Applied to the dev Aiven Node A (a no-op ALTER there — dev's
      `synchronize:true` had already widened it — which still proves the SQL
      parses, runs, and writes the ledger row). **Prod still owes this migration**
      (product forces `synchronize:false`).
    - **Contract safety — why bigint→string does not leak:** TypeORM maps bigint
      to a JS string, so `ProductReview.productId` is a string at runtime. The
      gateway's `exposeProductReferences` (`apps/gateway/src/product/product.service.ts:201-258`)
      already accepts `number | string` and rewrites any `productId` to the
      product's `prod_` public id, and `createProductReview` returns
      `{...review, productId}` with the public id — so HTTP never sees the raw
      value either way.
    - **Verified (5/5):** live dev schema confirms all five columns bigint;
      `GET /api/products/:id/reviews` 200 paginated; `POST` review after a
      COMPLETED order 201 (write path on the widened column); the listed review's
      `productId` is `prod_KPriGdWjvMkFRN49`, not a bigint string; product
      `ratingCount:1 rating:5` after create, and DB-confirmed back to `0/0` after
      delete. tsc 0, eslint 0, Jest 199/199.
    - **Both legs of the widened column exercised** (the change-impact concern —
      create takes a real number off the TCP payload, delete takes the string off
      the hydrated entity): `recalculateProductRating(dto.productId)` on create
      and `recalculateProductRating(review.productId)` on delete
      (`product.service.ts:1668,1683`), the latter feeding a string into
      `productRepository.update(productId, …)`. Runtime-verified on both.

  - **The one apparent failure was a probe artifact, not a defect.** B5 ("delete
    review → ratingCount back to 0") read 1 over HTTP. Isolating it against MySQL
    directly showed the recalculation is correct (`rating=0.00 ratingCount=0`
    immediately after the delete) and the stale read came from the SCALE-04
    gateway detail micro-cache: the preceding assertion's `GET /api/products/:id`
    had warmed `gw:products:detail:<publicId>`, and a review delete is one of the
    "background writers" that does not invalidate it. Bounded by the 10s TTL,
    pre-existing, and already documented in the concurrent-PATCH Known Issue
    ("rating recalc on review create/delete" is listed there by name). With a
    cold cache the immediate HTTP read is correct.

  - **Adjacent finding, deliberately NOT changed:** sibling numeric body fields
    in the same DTOs (`skuId`, `quantity`, `weight` on the order-item DTO) also
    lack `@Type(() => Number)`. Left alone — they are natural JSON numbers with
    no dropdown-string origin, orders have always worked with them, and widening
    them is scope the user did not ask for.

- **Inventory 409 no longer blames the wrong thing — a `sku` collision now says
  so. Fixed and runtime-verified on LOCAL 2026-08-03 (2/2 functional + 2/2
  change-impact + 2 new unit tests).** Item 5️⃣ of the 2026-08-03 bug ranking,
  recorded as a cosmetic defect while verifying the P0-03 compensation leg.
  - **Root cause:** `InventoryService.create` (`apps/inventory/src/inventory.service.ts:80-105`)
    mapped EVERY duplicate-key `QueryFailedError` to
    `INVENTORY_MESSAGE.ALREADY_EXISTS_FOR_PRODUCT(data.productId)`. `sku` is the
    only unique column on `inventory_v2` (`inventory.entity.ts:24-26`) and a
    second row for the same product is already rejected by the explicit
    productId pre-check at line 59 — so every conflict that actually reached the
    catch block was a SKU collision, reported as a duplicate product. A seller
    hitting it was told "Inventory for product ID 96 already exists" about a
    product id that had just been created and was never the problem.
  - **Fix:** the catch block now discriminates and throws the new
    `INVENTORY_MESSAGE.SKU_ALREADY_EXISTS(data.sku)` ("Inventory with sku
    `<sku>` already exists") for a sku violation, keeping
    `ALREADY_EXISTS_FOR_PRODUCT` as the defensive fallback.
  - **The non-obvious part — where the column name lives.** The first attempt
    matched `error.message.includes("sku")` and changed nothing at runtime:
    Postgres names the index after TypeORM's generated
    `UQ_5ec10f972b1fa4f1e60d66d28bc`, so `error.message` is
    `duplicate key value violates unique constraint "UQ_<hash>"` — the column
    never appears in it. The column is in the driver's `detail`
    (`Key (sku)=(PROD-95) already exists.`), so the check reads
    `error.driverError.detail` (with the `message` check kept as a cheap
    fallback). The pre-existing `apps/inventory/src/filters/rpc-exception.filter.ts:121`
    sidesteps the same problem by hardcoding that constraint hash; the new code
    does not hardcode it.
  - **Status is unchanged:** the gateway `MicroserviceErrorHandler` maps to 409
    by the `"already exists"` substring (`microservice-error.handler.ts:92`),
    which the new message keeps. Verified live — still HTTP 409.
  - **Runtime self-test (2/2)** using the documented P0-03 trigger — create a
    product with NO `sku` (its inventory row takes `PROD-<numericId>`), read that
    sku, then create a second product carrying it: the product row inserts fine
    (the first product's `products.sku` is NULL) and the INVENTORY insert
    collides. `409 "Inventory with sku PROD-97 already exists"` (was
    `"Inventory for product ID 96 already exists"`), and the P0-03 compensation
    still rolls the orphan product row back (0 rows survive).
  - **Change-impact review (2/2)** — the functional test only exercised the sku
    leg, so the untested leg was the duplicate-PRODUCT path that throws from the
    pre-check before any insert. `POST /api/inventory` for a product that already
    has a row, using a sku nothing else owns → still
    `409 "Inventory for product ID 99 already exists"`, proving the pre-check
    path is untouched and that nothing now misattributes a product duplicate to
    a sku. Blast radius grepped: `ALREADY_EXISTS_FOR_PRODUCT` has no other
    caller and nothing in the repo matches on the message text beyond the
    gateway's `"already exists"` → 409 substring rule.
  - **Regression guard:** 2 unit tests in
    `apps/inventory/src/inventory.service.spec.ts` build the REAL Postgres error
    shape (hash-named constraint in `message`, column in `driverError.detail`)
    and pin both branches — so a future refactor cannot regress to matching on
    `message` alone. Files: `apps/inventory/src/inventory.service.ts`,
    `libs/constant/response-message.constant.ts`,
    `apps/inventory/src/inventory.service.spec.ts`. No migration, no route or
    status-code change. Validation: tsc 0 errors, eslint 0 errors, Jest 199/199
    across 26 suites (was 197).

- **BUG-B — deactivated products no longer appear on the public storefront.
  Fixed and runtime-verified on LOCAL 2026-08-03 (7/7 functional + 3/3
  change-impact + 5 new unit tests).** Found 2026-07-30 while making the prod
  catalog tech-only: `GET /api/products` and `GET /api/products/with-inventory/all`
  returned rows with `isActive:false, approvalBlocked:true` (2 visible on prod
  after a category-reject cascade), so AI-02 risk-blocked products stayed on the
  sàn even though the admin UI labels them "Đang ẩn khỏi sàn".
  - **Root cause:** `findAllProducts` (`apps/product/src/product.service.ts:1266`)
    applied `product.isActive = :isActive` ONLY when the caller happened to pass
    the flag. There was no active-only default, and none of the five `@Public`
    catalog routes passes one.
  - **Fix (`product.service.ts:1178-1212`):** the method now derives an
    `effectiveQuery` that defaults `isActive: true` when the caller passes
    NEITHER `isActive` NOR `userId`, and destructures from it. Two lines of real
    logic; the defect line itself is untouched.
  - **Why `userId` is the exception:** the storefront seller dashboard
    (`frontend/src/features/shop/ShopPage.tsx:256`,
    `useProducts({userId: currentUser.id})`) uses the SAME public list route and
    must keep seeing the products it hid. Scoping the exception to the
    single-seller read is what let this ship WITHOUT a paired FE change — the
    snapshot had previously recorded the fix as blocked on one.
  - **Why `userIds` (plural) is deliberately NOT an exception:** the gateway
    implements the province filter by resolving `sellerIdsInProvinces` via
    `USER_MESSAGE_PATTERN.GET_USER_IDS_BY_PROVINCE` and passing them as
    `userIds`. Including it would have left province-filtered marketplace browse
    still leaking hidden products.
  - **Cache correctness:** the normalization happens BEFORE
    `buildSearchCacheKey`, so (a) "no isActive" and "isActive=true" collapse to
    one key instead of duplicating entries, and (b) pre-fix entries keyed without
    `isActive` can never be served back to the storefront.
    `invalidateSearchCache` is prefix-based (`products:search:*`) so it clears
    both key shapes. The SCALE-04 gateway micro-cache (`gw:products:list:*`,
    TTL 10s) is keyed by query and invalidated by PATCH — unaffected.
  - **Blast radius (verified by grep, not assumed):** the gateway is the ONLY
    sender of `PRODUCT_FIND_ALL` / `PRODUCT_SEARCH` / `PRODUCT_FIND_BY_CATEGORY` /
    `PRODUCT_FIND_BY_BRAND` (`apps/gateway/src/product/product.service.ts:559,
    871, 887, 900`) — no other microservice consumes them. They back exactly five
    HTTP routes, all `@Public()`. `getProductRisks` (`@Get("admin/risk")`) is a
    separate method and keeps seeing hidden products.
  - **Functional self-test 7/7** (local, anon + shop): list, `with-inventory/all`,
    `search`, `category/:id` all hide the deactivated product while still listing
    the active one; `?userId=<seller>` still returns the seller's hidden product;
    `?isActive=false` still returns only deactivated products.
  - **Change-impact review 3/3** (the legs the self-test never reached): I1
    `brand/:id` hides it too; I2 the province/`userIds` leg hides it (required
    temporarily giving the shop account a default address —
    `getUserIdsByProvince` filters on `is_default = true` — then deleting it
    again; the GHN sandbox stub province "Hà Nội 02" with zero districts forced
    the probe to walk provinces→districts→wards until one resolved); I3 the admin
    risk queue is unaffected. Recorded as pre-existing, NOT regressions: `GET
/api/products/:id` still returns a deactivated product with 200, and
    `shop/stats` still counts hidden products.
  - **Regression guard:** `describe("ProductService.findAllProducts storefront
visibility (BUG-B)")` in `product.service.spec.ts` — 5 tests pinning the
    default, the `userIds` behaviour, the `userId` exception, the explicit
    override, and that the cache key carries `"isActive":true`.
  - **Residual, recorded in snapshot Known Issues:** `?userId=` remains an
    anonymous shop-page leak by design. Closing it needs the FE to migrate the
    seller dashboard onto a new authenticated route first (none exists today);
    storefront handoff entry written.
  - Validation: `tsc --noEmit` 0 errors, eslint 0 errors, Jest **197/197 across
    26 suites** (was 192). All test products deleted and the temporary address
    removed — nothing left behind on local.

- **BUG-D — `PATCH /api/order/:id/cancel` no longer returns 503 for a cancel that
  committed. Fixed and runtime-verified on LOCAL 2026-08-03 (5/5 + 4/4 + 3/3).**
  Seen once on prod 2026-08-01 (order `ord_HuypgIrmcskqq4Ny` / waybill `LAYGKP`):
  first call 503, the order was `canceled` afterwards, retry then 400 "Order
  cannot be canceled". Two independent defects compounded.
  - **D1 — GHN HTTP calls were unbounded.** `GhnModule` imported a bare
    `HttpModule`, so `GhnService`'s axios instance inherited the axios default
    timeout of `0` (infinite). Only the three master-data GETs passed a
    per-request `timeout: MASTER_DATA_TIMEOUT_MS` (10000); every mutation —
    `createShippingOrder`, `switchOrderStatus` (cancel/return), `updateOrderCod`,
    `updateOrderReceiver`, `getOrderDetail`, `previewShippingFee` — could hang
    until the socket died. `OrdersModule` registers
    `HttpModule.register({timeout:5000})` but that is a different dynamic-module
    instance and never reaches `GhnService` (module-scoped provider resolution).
    Fixed by registering `HttpModule.register({timeout:5000, maxRedirects:5})` in
    `GhnModule`. The master-data per-request `timeout: 10000` still wins (axios
    merges request config over instance config) — verified at runtime.
  - **D2 — the GHN cancel blocked the response after the commit.**
    `finalizeCancellation` ran `updateOrderStatus` + `releaseReservedItems` (both
    committed) and only THEN awaited `ghnService.cancelShippingOrder`. The
    gateway's `timeout(TCP_TIMEOUT_MS.WRITE)` = 10s then fired on an
    already-successful cancel. Fixed by detaching the GHN leg
    (`void this.cancelShippingOrderBestEffort(...)`) — the same best-effort shape
    the waybill-create leg already uses.
  - **Regression caught in the change-impact review (not by a test):** the new 5s
    cap meant a slow-but-alive GHN cancel would leave a live waybill on a canceled
    order, whereas the old infinite timeout eventually landed it (at the cost of
    the 503). Closed by retrying the detached call once — 2 attempts × 5s, both
    entirely off the response path. `cancelShippingOrderBestEffort` never rejects:
    a `void`-invoked rejecting promise becomes an unhandled rejection and can kill
    the process.
  - **Deliberately NOT changed:** the admin GHN cancel/return
    (`applyAdminGhnAction` → `switchOrderStatus`) stays awaited and re-throws on
    GHN rejection — its documented contract is 4xx/5xx to the caller plus a
    `success:false` `shipping_history` row with the local order untouched.
    `sweepStaleReservations` only selects `ghnOrderCode: null` orders, so the two
    `finalizeCancellation` callers stay symmetric.
  - **Runtime self-test (5/5)** — COD order `ord_h1rQ8uPBaIP9RMer` with waybill
    `L8Q6MY`: created 201 with a real `ghnOrderCode`; cancel **200 in 1530ms**
    with `status: canceled` (was 503); well inside the 10s TCP budget; the
    detached cancel still landed at GHN (`ghnDetail.status = cancel` on
    `GET /api/order/admin/ghn/orders/:id`); re-cancel still 400.
  - **Change-impact review — every other GHN call site the 5s cap now bounds
    (4/4 + 3/3):** master-data list 200/65 rows; free-text
    `POST /api/order/shipping-fee` 201 in 788ms (real resolution, not cached);
    awaited admin GHN cancel 201 in 1785ms → local order `canceled`;
    `update-cod` 201 in 744ms (58207 → 15000, persisted); `update-receiver` 201
    in 955ms (persisted into the pipe-delimited head, ward/district/province
    preserved). `readyToShip` reuses the `createShippingOrder` proven by the
    order-create leg.
  - **Files:** `apps/orders/src/ghn/ghn.module.ts`,
    `apps/orders/src/orders.service.ts`, `apps/orders/src/orders.service.spec.ts`
    (3 new tests: caller answers while the GHN promise is still pending; the
    detached call retries once; a rejected detached call is swallowed).
    Validation: tsc 0 errors, eslint clean, Jest **192/192** across 26 suites.

- **BUG-A — SKU edit reachable over HTTP again + the inventory leg that was
  missing behind it. Fixed and runtime-verified on LOCAL 2026-08-03 (9/9 + 5/5).**
  Found during the 2026-08-03 prod verification: `POST /api/products` accepted
  `variations` + `skuList` but the gateway `UpdateProductDto` declared neither,
  so the global `forbidNonWhitelisted` pipe rejected every SKU edit with 400
  `"property skuList should not exist"` before the service was reached. A seller
  could create a variant product and then never change its SKU prices/stock, and
  the whole P0-05 diff engine was dead code from the HTTP boundary.
  - **The fix (gateway):** `SkuItemDto`/`VariationItemDto` are now exported from
    `create-product.dto.ts` and reused as optional `variations?`/`skuList?`
    fields on `UpdateProductDto` (`@IsOptional() @IsArray() @ValidateNested
({each:true}) @Type(...)` + `@ApiPropertyOptional`). No new DTO classes — the
    create/update contract stays literally the same shape.
  - **Tier validation moved inside the transaction.** `validateSkuTiers
(product.variations, dto.skuList)` now runs in `applyProductUpdate`, after
    `Object.assign`, so a bad `tierIdx` is rejected against the variations the
    edit is actually establishing rather than the pre-edit ones — and it rolls
    back with the rest of the product fields instead of leaving a partial write.
  - **P0-05 assertions re-run on the now-reachable path (9/9):** matched
    `tierIdx` updated in place (id preserved), an UNREFERENCED dropped SKU
    hard-deleted, a REFERENCED one (present in `order_items`/`cart_items`)
    surviving as `isActive:false`, out-of-range `tierIdx` → 400, and a
    `{description}`-only PATCH leaving SKUs untouched. The A8 assertion was
    validated with a negative control (deliberate break → `8/9 passed (failed:
A8)`) after it was first found to pass spuriously off the SCALE-04 micro-cache;
    the suite now forces an invalidating no-op PATCH before asserting.
  - **Change-impact review found a second, deeper bug — the edit never reached
    inventory.** `upsertSkus` emits `sku.upserted`, whose consumer called
    `createForSku()`, which returned early when the row already existed. So a
    SKU stock edit only moved the `product_skus.stock_quantity` MIRROR while
    checkout kept reserving against the unchanged authoritative `inventory_v2`
    row (probe: mirror 99, inventory still 5). Fixed by making `createForSku` an
    upsert — but **only for SKUs whose stock the seller actually re-declared in
    that edit**. `upsertSkus` now collects `stockChangedSkuIds` (comparing the
    incoming value against the pre-mutation `match.stockQuantity`) and ships it
    in the fanout; the consumer passes `syncStock` per SKU. This guard is
    load-bearing: inventory drains as orders reserve while the product mirror is
    never decremented, so a plain price edit echoing the stale mirror back would
    otherwise silently restock the seller. Reserved stock is never rewritten —
    a restock sets `available_stock` and leaves committed units alone.
  - **Deliberately NOT done:** propagating soft-deactivated (still-referenced)
    SKUs to inventory as `is_active:false`. `transitionReservation` and
    `reserveStockWithLedger` both filter `inventory.isActive = true`, so that
    would break RELEASE of in-flight reservations on exactly the SKUs that have
    them. Only hard-deleted (by definition unreferenced) SKUs deactivate their
    inventory row, which the existing `softDeleteSkus(deletedSkuIds)` already did.
  - **Backward compatible mid-deploy:** `stockChangedSkuIds` is optional on the
    consumer (an old message ⇒ create-only, the previous behavior) and
    `syncStock` is optional on `createForSku`, whose only caller is that
    consumer. `createProduct` passes only new SKUs, so the list is empty there.
  - **Inventory leg verified 5/5** against local Postgres (per-SKU inventory has
    no HTTP read path — `findByProductId` returns only the base
    `productSkuId IS NULL` row): create seeds a row per SKU with the declared
    stock; a 5→99 edit now reaches `inventory_v2` (this is the exact assertion
    that failed before the fix); an untouched SKU keeps its stock; echoing a
    stale mirror after a simulated sale leaves inventory at 60 while the price
    change lands; a dropped SKU's row goes `is_active:false`.
  - **Follow-up found by re-running the suite (2026-08-03): the reference check
    was one stale socket away from downgrading a delete.** A re-run came back
    `8/9 (failed: A4)` — an UNREFERENCED SKU deactivated instead of
    hard-deleted — then went green again on the very next run. The orders handler
    (`findReferencedSkuIds`, `orders.service.ts:2501`) is correct and a
    seconds-old SKU cannot legitimately match `order_items`/`cart_items`, and
    `referencedIds.has(...)` is the only route to deactivation, so the cause was
    `getReferencedSkuIds`'s fail-safe catch firing on a transient TCP error:
    a NestJS `ClientProxy` fails the first send on a dropped socket and
    reconnects on the next. The seller saw a 200 with the variant still present
    but greyed out. Fixed with `retry({count:1, delay:200})` on the send — the
    fail-safe itself is unchanged (a sustained orders outage still deactivates
    rather than risking data loss). 2 new unit tests cover both legs
    deterministically: one transient failure ⇒ 2 attempts ⇒ hard delete, and a
    persistent failure ⇒ every candidate treated as referenced. Jest 189/189.
  - Validation: `tsc --noEmit` clean, eslint clean, prettier unchanged, jest
    `apps/product apps/inventory` 22/22. Files: gateway `create-product.dto.ts`
    (exports) + `update-product.dto.ts` (the fix), `apps/product/src/
product.service.ts` (`stockChangedSkuIds`), `apps/inventory/src/
inventory.controller.ts` + `inventory.service.ts` (the upsert). No migration.
  - FE impact recorded in `../.agent-local/frontend-handoff.md` — the storefront
    edit form can now send SKUs, and `skuList` is a FULL set, not a delta.
- **PROD runtime self-test of the never-tested backlog items — 2026-08-03.**
  Closed the "pending a full-stack run" debt on P0-03/P0-04/P0-05/P1-01/P1-02 by
  driving the real prod API (`https://<PROD_API_DOMAIN>`) with all five
  `.env.seed` accounts (shop / user / admin-less buyer / logistic / shipping).
  Test driver was a throwaway Node `fetch` script in the scratchpad (never
  committed); every object it created was cleaned up in a `finally` block.
  **Results — 36/37 assertions passed across two runs.**
  - **P0-03 (atomic product+inventory create) 3/3.** `POST /api/products` → 201
    `prod_rgw5qrBLI3xp71bP`; `GET /api/inventory/product/:id` → 200 with
    `availableStock` 40, i.e. the cross-service saga created the inventory row.
    The compensation branch is not forceable from outside — recorded as a
    ⏳ PENDING RUNTIME TEST note in `snapshot.md` with the exact local steps.
  - **P0-04 (create-order idempotency) 4/4.** Key K1 → 201 `ord_4Yi4Dat9L9LckKaH`;
    replaying K1 → the SAME order id, no second row; K2 → a new order
    `ord_sl7T1DRV6hm7gezL`; two concurrent K3 requests → one 201 + one 409 with a
    single resulting order `ord_5vjl2x4BBZFDbYvw` (the Redis `SET NX` in-flight
    lock behaving as designed).
  - **P0-05 (SKU diff + reference protection) — CANNOT BE TESTED; real gap
    found.** Both diff PATCHes returned 400. Root cause is not the test: the
    gateway `UpdateProductDto` declares no `skuList`/`variations`, so
    `forbidNonWhitelisted` rejects them (`"property skuList should not exist"`)
    before the service is reached — while a `{description}` control PATCH on the
    same product returned 200 and both SKUs stayed unchanged. The 2026-07-06
    unused-API sweep removed the standalone SKU routes assuming the product PATCH
    covered them; it never did. Logged as a 🔴 Known Issue with the fix and the
    assertions to re-run. `PERF-12`'s "canonical SKU edit path" note was corrected.
  - **P1-01 (seller order lifecycle) 7/7.** Buyer attempting confirm → 403; then
    confirm → `confirmed`, ready-to-ship → `processing`, ship → `shipped`,
    deliver → `delivering`, complete → `completed` (all 200); cancelling the
    completed order → 400.
  - **P1-02 (order enrichment + per-status counts) 6/6.** `status-counts` returned
    `{all:13, pending:4, processing:1, completed:1, canceled:7, …}` with the
    per-status values summing exactly to `all`; another user's counts → 403; order
    items came back enriched (`productName`, `productImage`, `skuLabel`,
    `skuTierIdx`, public `productId`/`sellerId`); the seller list paginated.
  - **Shipping RBAC 4/4** (not previously exercised): `logistics_operator` reads
    `GET /api/order/admin/ghn/orders` 200 but `update-cod` → 403;
    `shipping_manager` reads 200; a plain user → 403.
  - **ZaloPay payment-url leg 4/4**, under the user's ≤ 50 000 VND cap. First
    attempt breached it (goods 15 000 + GHN fee 46 207 = 61 207) so the leg was
    re-run without the GHN address ids (fee resolves to 0) → order total 15 000.
    `GET /api/order/:id/payment-url` → 200
    `{orderUrl:"https://qcgateway.zalopay.vn/openinapp?order=…"}`; foreign user →
    403. No payment was ever completed. Documented the contract asymmetry in
    `snapshot.md`: only the MULTI-seller create returns `paymentUrl`; single-seller
    callers must use this endpoint, whose key is `orderUrl`.
  - **Prod residue:** every test product was hard-deleted (204) and every order
    canceled (200) except `ord_4Yi4Dat9L9LckKaH`, which the P1-01 lifecycle test
    drove to COMPLETED — a terminal state that cannot be cancelled, so that one
    order remains on prod permanently.
- CD-01 + CD-02 — CI/CD pipeline, shipped 2026-08-03 (`/sweep tiep tuc CI/CD`).
  Deploy was fully manual before this (local push → on EC2 `git pull` +
  `npm run build` + `pm2 restart`).
  **CD-01 — `.github/workflows/deploy.yml` (new).** One `appleboy/ssh-action@v1`
  step with `script_stop: true` running the already-proven manual sequence:
  record `git rev-parse HEAD` → `~/.trybuy-deploy-prev-sha` → `git fetch --prune`
  + `git reset --hard origin/main` → `npm ci` → `npm run db:migrate:nodeA` +
  `:nodeB` → `npm run build` → `pm2 flush` → `pm2 restart ecosystem.config.js
--env production` → `pm2 save` → poll `http://127.0.0.1:3000/live` up to 10×5s
  (prints `pm2 status` and fails if it never answers). Migrations deliberately
  run BEFORE the restart: every project migration is additive and
  INFORMATION_SCHEMA-guarded, so the running old code tolerates the new columns
  while new code would crash on a missing one. Triggers: `workflow_run` on the
  `CI` workflow for `main` (guarded by `conclusion == 'success'`, since
  `workflow_run` also fires on failed runs) plus `workflow_dispatch`;
  `concurrency: deploy-production` (no cancel-in-progress) and
  `environment: production` so Required reviewers can hold a deploy while the
  EC2 is inside its scheduled stopped window. A second `if: failure()` step
  rolls back automatically: read `~/.trybuy-deploy-prev-sha` → reset → `npm ci`
  → build → `pm2 restart` → `/live`. No DB rollback (additive migrations).
  Two non-obvious details baked in: the script sources `~/.nvm/nvm.sh` (a
  non-interactive SSH shell never reads the login profile, so an nvm-installed
  node is otherwise off PATH), and it hard-fails if the box's Node major is not
  22 — which is CD-02(d). Secrets required, none of them application secrets:
  `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY`, `EC2_PATH`.
  **CD-02 — `.github/workflows/ci.yml`.** (a) `npx prettier --check
"apps/**/*.ts" "libs/**/*.ts"` before lint — the repo mandates format-on-change
  but CI only linted (verified locally: already clean). (b) audit gate, SPLIT
  from the original single-step plan because the assumption behind it had gone
  stale: a blanket `npm audit --audit-level=high` was **red**, not green — three
  new highs had landed since DEP-01 (`js-yaml` GHSA-pm4m-ph32-ghv5 via
  `@nestjs/swagger`, `brace-expansion` GHSA-mh99-v99m-4gvg via `typeorm` and
  several dev tools). Shipped instead: `npm audit --omit=dev --audit-level=high`
  as the BLOCKING gate (production dependencies, a real alarm) and the all-deps
  `--audit-level=high` run as `continue-on-error` reporting, so the permanently
  red `@nestjs/cli → @swc/cli → @xhmikosr` build-tool chain cannot fail an
  unrelated PR. To make the blocking gate green, two SCOPED `overrides` were
  added to `package.json` — `@nestjs/swagger` → `js-yaml 5.2.3` and `typeorm` →
  `brace-expansion ^2.1.3`. Scoped, not global, on purpose: `@nestjs/swagger`
  pins `js-yaml` to exactly `5.2.1` and its latest release (11.4.6, already
  installed) still does, so there is no upstream fix to wait for; and a global
  `brace-expansion` override would force v2 onto `minimatch@3` consumers. Result:
  production-scope high findings 1 → 0, total report 13 → 11 (10 moderate + 1
  dev-only high). (c) `actions/upload-artifact@v4` of `dist/` keyed by
  `github.sha` (7-day retention, `if-no-files-found: error`) so CD-03 can later
  ship the exact validated bits.
  **Validation.** Both YAML files parse (`js-yaml`), both embedded deploy scripts
  pass `bash -n`, and every CI step was executed locally against the new
  dependency tree: prettier check clean, `eslint` 0 errors (7 pre-existing
  warnings), `tsc --noEmit` 0, Jest **187/187 in 26 suites**, `npm run build`
  green with all 10 `dist/apps/<svc>/main.js` emitted, `node -c
ecosystem.config.js` OK, `npm audit --omit=dev --audit-level=high` exit 0.
  The override leg the build does NOT exercise was smoke-tested directly:
  `@nestjs/swagger` loads, resolves `js-yaml` **5.2.3** from its nested folder,
  and dump/load roundtrips an OpenAPI fragment; `typeorm` resolves
  `brace-expansion` **2.1.4**.
  **Change-impact review found one real gap, fixed before closing:** the
  `if: failure()` rollback originally read `~/.trybuy-deploy-prev-sha` that the
  deploy step wrote *after* the Node-major assertion — so a failure before that
  write (or a failed `cd`) would have rolled the box back to a **stale sha from
  an earlier deploy**. The marker is now `rm -f`'d before `cd` and written
  immediately after it, so an early failure leaves no marker and the rollback
  step aborts loudly ("no recorded previous sha") instead of resetting to the
  wrong commit. A second suspicion — that `[ -s nvm.sh ] && . nvm.sh` under
  `set -euo pipefail` would abort when nvm is absent — was tested and is NOT a
  bug (bash exempts the non-final command of an `&&` list); the script uses the
  explicit `if` form anyway for readability.
  **Not runtime-verified, and cannot be from here:** the deploy workflow has
  never executed. It needs the 4 repository secrets and the `production`
  Environment, and `workflow_run` only ever runs the copy of the file on the
  default branch — so the first real deploy happens after this merges to `main`.
  Recorded as such in `snapshot.md` Ops/Runtime. No application code, endpoint,
  or DB change — no FE impact, no handoff entry.

- BUG-404-01 — `GET /api/order/:id` returned **500 instead of 404** for an
  unknown-but-well-formed `ord_…` id. Fixed 2026-08-02 (`/sweep`, top 🔴 item).
  Root cause: `fetchOwnedOrder` (`apps/gateway/src/order/order.service.ts`) awaited
  its `firstValueFrom(GET_ORDER_BY_ID)` with **no** `MicroserviceErrorHandler`
  wrapper, so the orders-service `NotFoundException` thrown by `resolveOrderId`
  (`apps/orders/src/orders.service.ts:1914`, reached via the TCP handler at
  `apps/orders/src/orders.controller.ts:265`) arrived at Nest as a raw
  RpcException and was mapped to 500. Both callers were affected —
  `getOrderById` and `getPaymentUrl` (which calls the helper OUTSIDE its own
  try/catch). Fix: the `firstValueFrom` now sits in a try/catch whose catch calls
  `MicroserviceErrorHandler.handleError(error, "get order", "Orders Service")`
  (declared `: never`, so the `let order` stays definitely-assigned); the local
  `NotFound`/`Forbidden` throws deliberately stay OUTSIDE the catch so they are
  not re-wrapped. Minimal diff, no contract change beyond the status code.
  **Self-test 8/8** — run against PROD (still the pre-fix build = "before") and
  the fixed local build ("after") in one pass: PROD unknown order **500**, PROD
  unknown payment-url **500**; local unknown order **404** `"Order
ord_aaaaaaaaaaaaaaaa not found"`, local unknown payment-url **404** (same
  message), numeric id still **400** at `ParsePublicIdPipe`, own order list 200,
  own order detail 200 (payload intact), own payment-url 200, foreign order still
  **403**, unknown order as a second user **404**. tsc 0 errors, eslint clean.
  **Deployed and re-verified on PROD 2026-08-02** (commit `2cb3fbb`, build +
  `pm2 restart`): unknown order **404** `"Order ord_aaaaaaaaaaaaaaaa not found"`,
  unknown payment-url **404**, numeric id **400**, own order list 200, own order
  detail 200, and the admin branch intact (admin on an unknown id **404**, admin
  reading another user's order **200**). FE handoff written (storefront: 500→404
  on the two routes).

- Product optimistic locking — **runtime-verified on PROD 2026-08-02** after the
  deploy of the concurrent-`PATCH` fix below. Migration
  `nodeA-20260802-001-add-version-to-products` was applied to prod Aiven Node A
  through the manifest runner BEFORE the code deploy (prod forces
  `synchronize:false`); dev had auto-created the column via `synchronize:true`, so
  `db:migrate:status` still lists it `[pending]` on the DEV database — a cosmetic
  ledger gap only, the two Aiven databases are separate. Prod evidence (5/5 on
  `prod_J4m6khjmFy0s31xx`, all writes replayed the product's existing values so
  the final state matches the initial one apart from the expected `version`
  increments): detail read exposes `version`; a PATCH carrying the matching
  version → 200 and `version` advances; two concurrent `categoryIds` PATCHes →
  200 + 200 (the InnoDB S→X deadlock that used to surface as 502 is gone); a
  stale-but-DTO-valid `version` → **409** `"Product was modified by someone else
— reload it and apply your changes again"`; two racing writers sharing one read
  version → 200 + 409. Note `version` has `@Min(1)`, so `version - 1` on a
  version-1 product is a 400 (DTO bound), not a 409 — test against a product whose
  version has already grown.

- Concurrent `PATCH /api/products/:id` — races found and fixed 2026-08-02,
  runtime-verified (migration `nodeA-20260802-001-add-version-to-products`).
  **Investigation first:** local probe scripts (kept outside the repo in
  `C:\tmp\`: `lost-update-test.mjs`, `m2m-race.mjs`, `sku-race.mjs`,
  `innodb-status.mjs`) fired concurrent PATCHes at one product. `updateProduct`
  was an unguarded read-modify-write (`findProductById` → `Object.assign` →
  `save`) with no row lock, no version column and no transaction. Findings:
  - **No cross-field loss** — 7 parallel PATCHes each touching a DIFFERENT field
    all persisted, because TypeORM `save()` emits a diff-only `UPDATE`. This is
    why the bug stayed invisible in normal use.
  - **Lost update IS real when the client sends the whole form** — two racing
    full-payload saves (tab A edits price, tab B edits stock) → A's row wins
    entirely and B's edit vanishes behind an HTTP 200.
  - **Stale success bodies** — 8 concurrent PATCHes of the same field: 7/8
    callers got a 200 whose body echoes a price that is not the persisted one.
  - 🔴 **`categoryIds` races deadlocked InnoDB (5/5 rounds)** — writing the
    `product_categories` junction takes a shared FK lock on the parent `products`
    row, and the entity UPDATE that follows needs an exclusive one; two edits
    deadlocked on that S→X upgrade (`SHOW ENGINE INNODB STATUS` confirmed
    `WE ROLL BACK TRANSACTION (2)`). `ER_LOCK_DEADLOCK` escaped as **502**, and
    the surviving category set could be a merge nobody requested (callers sent
    `[17]`, `[20,21]`, `[15]`, `[17,20]` → DB ended `[15,17]`).
  - 🔴 **Unique-`sku` check-then-act race (3/3 rounds)** — two products claiming
    the same new sku concurrently both passed the `findOne({where:{sku}})` guard;
    the loser hit the unique index and got **502** instead of the intended 409.
    DB integrity itself was never at risk.
  **Fix** (`apps/product/src/product.service.ts`): `updateProduct` split into a
  transactional `applyProductUpdate` plus post-commit side effects. The
  transaction opens with `SELECT product.id … FOR UPDATE` (id-only projection so
  the eager `categories` relation is not locked) BEFORE the entity load, which
  serialises every writer of the row and converts the S→X deadlock into a plain
  wait; all validation (version, `approvalBlocked`, sku, brand, categories) and
  the save now run inside it against the same `manager`. `runProductUpdate`
  retries once on `ER_LOCK_DEADLOCK` (InnoDB can still pick us as the victim
  against an unrelated writer), and `isDuplicateEntryFor` maps `ER_DUP_ENTRY`
  naming the submitted sku to `ConflictException` — the message is checked so
  other unique indexes keep their own error. `upsertSkus`, `invalidateSearchCache`,
  `destroyDroppedImages` and `scheduleRiskRescore` deliberately stay outside the
  transaction (the first opens its own tx and does a TCP round-trip).
  **Optimistic locking:** `products.version` `@VersionColumn` on the entity + an
  optional `version` field on both the gateway and microservice update DTOs. Send
  it and a stale edit is rejected with 409
  `PRODUCT_MESSAGE.VERSION_CONFLICT`; omit it and the endpoint keeps its previous
  last-writer-wins behaviour, so the change is backward compatible.
  **Non-obvious detail worth keeping:** the old post-commit
  `productRepository.update(id, {riskScoringStatus:"pending", …})` had to be
  folded INTO the transactional save — TypeORM's `UpdateQueryBuilder`
  unconditionally appends `version = version + 1` to every entity UPDATE, so the
  separate risk reset bumped the version a second time and made the `version`
  returned to the caller instantly stale (isolated with a dedicated probe).
  Conversely `save()` never enforces a version WHERE guard (optimistic mismatch
  only comes from an explicit `setLock("optimistic")` on a SelectQueryBuilder),
  so adding the column cannot break any other writer — confirmed by reading
  `node_modules/typeorm/query-builder/UpdateQueryBuilder.js` +
  `persistence/SubjectExecutor.js`.
  **Verification:** tsc 0 errors, eslint 0 errors, prettier clean, Jest 26 suites
  / 187 tests green. Runtime: `m2m-race.mjs` 5 rounds × 4 concurrent PATCHes →
  20/20 HTTP 200 with the persisted category set always exactly one caller's
  request (was 502 in 5/5 rounds, plus phantom merges); `sku-race.mjs` 3/3 rounds
  → 409 + 200 (was 200 + 502); `version-race.mjs` → one 200 + one 409 per round
  with `version` sent, 409 on a stale replay, and 200|200 with the field omitted;
  the original `lost-update-test.mjs` re-run reports "junction consistent; price
  survived". Edge legs re-checked afterwards: unknown id 404, numeric id 400,
  `version:0` 400, unknown brand 404, unknown category 404, matching version 200
  with the incremented version echoed back, risk-relevant edit still returns
  `riskScoringStatus:"pending"` and the rescore worker still completes to
  `ready`. Test products restored.
- VNPay IPN response codes — fixed 2026-08-02, verified locally (`cef4981`, NO
  migration). Found while diagnosing PROD-PAY-02: the VNPay merchant portal's
  "Test call IPN" button kept answering `{"RspCode":"97","Message":"Checksum
  failed"}` even though the endpoint itself was healthy. The first hypothesis —
  the portal's `Kiểu mã hóa` dropdown (MD5) mismatching the SDK's SHA512 default
  — was **falsified**: the user switched it to SHA256 and 97 persisted. The real
  cause was in our code. `VNPayStrategy.verifyCallback` returned a single
  `success: result.isVerified && result.isSuccess`, collapsing two unrelated
  facts: whether the secure hash matched, and whether the transaction itself
  succeeded (`isSuccess` is just `vnp_ResponseCode === "00"` — confirmed by
  reading `node_modules/vnpay/dist/chunk-L7CUEWUR.cjs`). `handleVNPayCallback`
  then reported any declined transaction as a checksum failure. That is a spec
  deviation with a real consequence: VNPay treats every RspCode other than "00"
  as an undelivered notification and **retries the IPN**, so each failed payment
  produced a retry storm.
  **Fix:** `verifyCallback` now returns `isVerified` and `isSuccess` alongside
  the combined `success`, which is deliberately kept — the browser-return leg
  (`completeVNPayReturn`, `payments.controller.ts:164`) still wants the combined
  value, because for a user-facing result page a declined transaction genuinely
  is a failure. `handleVNPayCallback` answers `97` only on a hash mismatch, and
  logs + acknowledges a verified-but-declined callback with `00 Confirm Success`;
  nothing is persisted, so the order stays PENDING and the stale-reservation
  sweeper releases it. Blast radius is contained: all three inbound paths (gateway
  TCP, direct `POST`, direct `GET`) funnel through the same
  `handleVNPayCallback`, and the ZaloPay strategy has no equivalent conflation
  (its `success` is mac validity only — ZaloPay only calls back on success).
  **Verification:** tsc 0 errors, eslint clean, `jest apps/payments` 23/23
  (4 new callback-branch tests). Runtime-tested against the running local stack
  with payloads signed using the SDK's own algorithm: valid-signature/declined
  (`vnp_ResponseCode=24`) → `00` on gateway `GET`, gateway `POST`, and payments
  `:3007` `GET`/`POST` (this case returned `97` before the fix); tampered hash →
  `97`; valid+successful with an unknown `vnp_TxnRef` → `01 Order not found or DB
  error`. Not yet deployed to EC2 — see PROD-PAY-02 in `snapshot.md`.

- PROD-PAY-01 — CLOSED 2026-08-01, runtime-verified on prod (fix, NO migration).
  After the mitigation below was deployed, prod issued URLs again but VNPay
  rejected them: `vnp_ReturnUrl` was
  `http://localhost:5173/payment-result?order=N&method=vnpay`, which fails VNPay's
  merchant-domain check. So the mitigation's _predicted_ root cause was wrong in an
  instructive way — `buildFrontendPaymentResultUrl` was not throwing on an invalid
  `FRONTEND_URL`, it was reading the variable as **empty** and taking the silent
  `http://localhost:5173` default. **Why the env investigation dead-ended:** every
  probe contradicted the next. `VNP_TMN_CODE` from `local/nodeB/.env` provably
  reached the live process (an edited TmnCode showed up in generated URLs);
  `dotenv.parse` on that same file yielded the right `FRONTEND_URL`; a ConfigModule
  repro run from `/opt/trybuy/api` printed the correct value; the pm2 logs proved
  which PID served the request — yet `configuredOrigin` was falsy at runtime.
  `/proc/<pid>/environ` showed neither key, which is expected and therefore proves
  nothing (it only records spawn-time env, not what ConfigModule assigns later).
  Two hypotheses were falsified by reading code rather than guessing: webpack
  inlining `process.env.FRONTEND_URL` (the local bundle still contains the literal
  expression) and a second `ConfigModule.forRoot` pointing at a different env file
  (`libs/database/src/postgres-database.module.ts` uses the same
  `./local/nodeB/.env`). One lead was never resolved: the EC2 bundle was 122,551
  bytes against 139,257 locally for the same commit. **Fix shipped (`5387a63`)
  is correct under every surviving hypothesis:** (1) `ecosystem.config.js` injects
  `FRONTEND_URL` into the `payments` app's pm2 `env` — pm2-injected env wins
  structurally, because both `dotenv` and `@nestjs/config` only assign keys NOT
  already present in `process.env`, and unlike a `.env` file it is verifiable in
  `/proc/<pid>/environ`; (2) the localhost fallback now logs a `warn` on both the
  empty and the invalid-origin branch, so this failure can never again be silent.
  Validated: `tsc --noEmit` 0, eslint 0, `npx jest apps/payments` 3 suites /
  19 tests. **Prod self-test 2026-08-01, all green:** fresh VNPay order
  `ord_iwL4MdBlvXb8Ckm2` → `payment-url` 200 with
  `vnp_ReturnUrl=https://<PROD_API_DOMAIN>/payment-result?order=19&method=vnpay`
  (was localhost); fresh ZaloPay order `ord_l9caYNZDCGs6kl03` → 200 with a
  `qcgateway.zalopay.vn/openinapp?...` URL. Note `getPaymentUrl` returns the
  **stored** `orderUrl` once one exists, so every re-test of this needs a brand-new
  order. Cleanup: the 7 stale prod probe orders were canceled; the 2 fresh ones
  were left payable for the demo. Ops consequence recorded in `snapshot.md`:
  changing `FRONTEND_URL` now requires `pm2 delete payments` + `pm2 start`, since
  `pm2 restart` does not refresh the stored env snapshot. **Still unverified and
  tracked separately as PROD-PAY-02:** the inbound callback leg — whether a
  completed payment actually advances the order out of `pending` depends on
  `VNPAY_IPN_URL` being publicly reachable.
- PROD-PAY-01/mitigation — payment-URL issuance made non-fatal and self-healing
  (2026-07-31, fix, NO migration). Prod produced no gateway URL for EITHER
  provider: order create 201, but `GET /api/order/:id/payment-url` →
  `{"orderUrl":null,"status":"pending"}` forever, because `processPayment` threw
  between the row `save` and the `orderUrl` UPDATE, and every RabbitMQ redelivery
  then short-circuited on the duplicate guard and acked. Root cause narrowed
  **black-box, without SSH or log access**, by two probes that read config
  indirectly: a forged ZaloPay return (`GET /api/gateway/payment-result` → 200
  `{"gateway":"zalopay","status":"failed"}`) proved `ZALOPAY_*` are present, since
  `verifyZaloPayReturn` reads `getZaloPayConfig().key2` unguarded — which also
  proves `local/nodeB/.env` is loaded; and `VNPayStrategy` reading `getVNPayConfig()`
  in its **constructor** means the service could not have booted with `VNP_*`
  missing. With both env blocks and the factory/UPDATE eliminated, and VNPay's
  `createPayment` making no network call, the only throw site shared by both
  providers was `buildFrontendPaymentResultUrl`: `new URL("/payment-result", "")`
  raises `ERR_INVALID_URL` when `FRONTEND_URL` is empty or scheme-less (the `??`
  default only covered _undefined_). Changes, all in the payments service plus one
  gateway field: (1) the URL builder catches and falls back to a default origin
  with a warn — a misconfigured `FRONTEND_URL` can no longer abort payment
  creation; (2) `issueGatewayPaymentUrl` extracted from `processPayment` so the
  create→persist step is replayable; (3) the duplicate branch regenerates when the
  existing row has no `orderUrl` (it used to return `paymentUrl:""`, making the
  order permanently unpayable); (4) `getPaymentUrl(orderId, paymentMethod?)`
  re-issues on read for a PENDING row with no URL — this repairs orders already
  broken in production AND makes any other root cause surface synchronously in the
  HTTP body through `MicroserviceErrorHandler` instead of staying silent;
  (5) the gateway passes `order.paymentMethod` on the `get_payment_url` send
  (`OrderResponse.paymentMethod` added), since the payments row carries no method
  column. Multi-order rows (`order_id NULL`) are untouched — the JSONB fallback
  runs only when no single-order row matched, so they never enter the retry path.
  **FE contract change:** a genuine issuance failure now returns an error status
  instead of a silent 200 `{"orderUrl":null}`; COD still legitimately returns
  `{"orderUrl":null,"status":null}` (no payment row → no retry). Validated:
  `tsc --noEmit` 0, eslint 0, Jest **183/183** (3 new payments tests: fallback
  origin for `""` and a scheme-less host, retry-on-read issuing + persisting,
  stored-URL short-circuit). Prod env fix (`FRONTEND_URL` + `VNP_RETURN_URL`/
  `ZALOPAY_REDIRECT_URL`/`VNPAY_IPN_URL` in `local/nodeB/.env`) and the EC2 deploy
  remain with the user — tracked in `snapshot.md`. Cleanup: all 10 prod probe
  orders were canceled, so prod holds no leftover test data.
- DEPLOY-VERIFY-01 — 2026-07-30 prod deploy verified, after resolving PROD-INC-01
  (ops + one prod incident, NO code change). Commits `3f6e212..4d039cc` were
  verified live against `https://<PROD_API_DOMAIN>`.
  **PROD-INC-01 (prod outage, found + fixed same day):** right after the deploy every
  request that SELECTs the full `orders` entity failed — `GET /api/order/seller` 502,
  `GET /api/order/user/:id` 500, `POST /api/order` 502 — while partial-select routes
  stayed 200 (`status-counts` selects only `order.status`, `analytics` uses raw
  aggregates, `return-requests/mine` hits another table). Root cause: the prod
  `orders` table did not actually have `to_district_id`/`to_ward_code`, the only
  columns this deploy added, and prod runs `synchronize:false`. The PROD-01 entry
  below recorded the migration as applied, but that apply ran against the DEV Aiven
  MySQL — `scripts/migrate-database.mjs` resolves credentials from `local/nodeA/.env`
  RELATIVE TO THE MACHINE IT RUNS ON, and it was run from the dev workstation, not
  EC2. Fixed by executing the guarded SQL on EC2 against the service's own env
  (`INFORMATION_SCHEMA`-guarded, idempotent, additive) → both columns present in
  `defaultdb`; no pm2 restart needed and all failing routes recovered immediately.
  **V1 (5/5 PASS):** `/api/user/me`, `/api/order/user/:id/status-counts`,
  `/api/order/seller/analytics`, `/api/order/seller`, `/api/order/user/:publicId` all 200.
  **V2 (4/4 PASS — closes the GHN-ADDR-01 pending runtime test):** COD order with
  garbage free-text ward/district/province + `toDistrictId:3440`/`toWardCode:"13010"`
  → 201, `ghnOrderCode:"LARQ44"`, `shippingFee:46207`, ids persisted; the identical
  garbage address WITHOUT ids → 201 but `ghnOrderCode:null`/`shippingFee:0`, proving
  the waybill was built from the exact ids and not from name resolution;
  `PATCH /:id/ready-to-ship` → `processing` with the waybill intact; numeric-string
  `toDistrictId:"3440"` → 400 (`@IsInt()` without `@Type`, the documented FE contract).
  Both test orders were canceled afterwards (admin GHN cancel + buyer cancel) so prod
  holds no leftover test data. **V3 (4/4 PASS):** malformed VNPay callback POST and GET
  → 200 `{"RspCode":"99"}` (gateway shape guard), well-formed-bad-hash → 200
  `{"RspCode":"97"}` (payments TCP leg alive), malformed ZaloPay → 200
  `{"return_code":-1}`; no 502 on any form.
  **Found during verification, left open as BUG-404-01 in `snapshot.md`:**
  `GET /api/order/:id` answers 500 instead of 404 for an unknown order, because
  `fetchOwnedOrder` rethrows the raw RpcException without `MicroserviceErrorHandler`.
  **Prevention:** a pre-deploy migration smoke must hit a route that selects the FULL
  entity being altered (e.g. `GET /api/order/<well-formed id>` expecting 404), never
  only count/aggregate routes; and any migration apply must be run ON the target host,
  since the env file is resolved locally.
- PROD-01 — prod migration applied + catalog purge (2026-07-30, ops, NO code
  change): `nodeA-20260723-001-add-ghn-ids-to-orders` applied to the prod Aiven
  Node A ahead of the GHN-ADDR-01 code deploy. Order matters: prod forces
  `synchronize:false` (`resolveTypeOrmSynchronize`, `NODE_ENV=production`), so the
  columns can never auto-appear there; and because they are extra NULLABLE columns
  they are inert to the currently-deployed code, which makes migration-before-deploy
  a zero-downtime, no-restart step. Verified via the manifest runner: status
  `[pending]` (18 `[baseline-absorbed]` rows) → dry-run `runnable=1 blocked=0`
  (baseline sha256 `d71c77af…`, candidate `907f2f45…`) → apply → re-status
  `[applied]`. Post-migration smoke on prod: 4/4 order read paths 200
  (`GET /api/order/seller`, `/api/order/user/:id`, `/api/order/user/:id/status-counts`,
  `/api/order/seller/analytics`) — old code still SELECTs fine with the new columns
  present. Node B needed nothing: the manifest holds exactly ONE post-cutoff
  migration and it targets nodeA (verified statically, no DB connection needed —
  the dev Aiven PG host was un-resolvable at the time because the free-tier service
  had been powered off for days). Also completed the SEED-02 `--prune` cleanup by
  hard-deleting the two off-catalog leftovers (`prod_AGAo3Vq7gI6izTz1` "Nồi chiên
  không dầu TryBuy 5L", `prod_FOGcwfJmnx8PKO4A` "Áo thun TryBuy Basic") — hard
  DELETE was required because a rejected category only sets `isActive:false` and
  the product list still returns deactivated rows (see snapshot Known Issues);
  order history survives via the P2-02 order-item snapshot. Prod catalog is now 20
  products, all `active=true`, all tech, 0 `isActive:false` rows.

- VNPAY-IPN-01 — malformed VNPay callback returns a response code, not 502
  (2026-07-30, fix): `VNPayStrategy.verifyCallback` called
  `this.vnpay.verifyIpnCall(payload)` unguarded, and the SDK THROWS on a malformed
  payload (missing/garbled `vnp_*` fields) rather than returning
  `isVerified:false`. That throw propagated out of all three callers — the POST
  callback, the GET IPN, and the TCP return-url path — so a garbage or truncated
  provider callback surfaced as a 5xx. A provider callback must always answer with
  a response code, so the call is now wrapped: a throw is logged
  (`Logger.warn`) and reported as `{orderId:"", success:false}`, which the existing
  callback controller already maps to `RspCode 97` (checksum failed). No contract,
  schema, or happy-path change — a genuinely valid callback still verifies exactly
  as before. New `apps/payments/src/vnpay/vnpay.service.spec.ts` (3 tests) runs
  against the REAL SDK, not a mock, so a future SDK upgrade that throws on a new
  class of bad input still cannot turn a callback into a 5xx: no-`vnp_`-fields
  payload, `undefined` payload, and a well-shaped payload with a bad
  `vnp_SecureHash`. Validated: tsc 0 errors, `jest apps/payments` 3 suites / 15
  tests green (the run's own `WARN [VNPayStrategy] VNPay callback payload
rejected: …` lines prove the guard executes instead of throwing).

- SCALE-05b — timeout the three untimed inventory TCP calls (2026-07-30, fix):
  SCALE-05 reclassified all 172 gateway `timeout(10000)` sites into
  `TCP_TIMEOUT_MS.READ`/`WRITE`, but three inventory sends in
  `apps/gateway/src/product/product.service.ts` had NO timeout operator at all and
  were therefore missed — `INVENTORY_FIND_BY_PRODUCT_ID` (product detail),
  `INVENTORY_GET_BY_PRODUCT_IDS` (the `getAllProductsWithInventory` batch), and
  `INVENTORY_CHECK_STOCK`. Without one, a hung inventory service holds the gateway
  request open indefinitely instead of failing fast, which is precisely the
  overload failure mode SCALE-05 exists to bound. All three now
  `.pipe(timeout(TCP_TIMEOUT_MS.READ))` (5s — all are pure reads). Existing error
  semantics are unchanged: the detail call keeps its `.catch` → warn + `inventory:
null` fallback, the batch stays inside its try/catch that logs and rethrows, and
  check-stock keeps its `logger.error` path.

- SEED-02 — tech-only catalog (2026-07-30, tooling only, NO code/schema change):
  product decision — TryBuy sells consumer electronics plus the accessories and
  desk furniture around them (ốp lưng, lót chuột, bàn nâng hạ, ghế công thái học);
  no fashion/groceries/household. `scripts/seed/seed-products.mjs` now encodes
  that: `CATEGORY_SEED` = 9 tech categories (Điện thoại, Laptop, PC & Linh kiện,
  Phụ kiện, Gaming Gear, Bàn ghế Setup, Âm thanh, Thiết bị mạng, Thiết bị thông
  minh) and `PRODUCT_SEED` = 20 tech products. Script changes: `ensureCategories`
  no longer early-returns when active categories exist — it submits+approves any
  MISSING seed category, and only approves pending rows whose name is in the seed
  list (someone else's pending proposal is left alone); new `--prune` flag rejects
  every ACTIVE category absent from `CATEGORY_SEED` via
  `PATCH /api/products/categories/:id/review {action:"reject"}`, which cascades
  `approvalBlocked:true, isActive:false` onto that category's products — nothing
  is deleted, so re-approving the category restores them; `createProducts` now
  skips names already in the catalog (re-run tops up instead of duplicating) and
  `--count` defaults to the full seed list. Runtime-verified against prod
  2026-07-30: "Thời trang"(4) + "Gia dụng"(5) retired (their 2 products →
  `isActive:false, approvalBlocked:true`), 6 tech categories approved (ids 6–11),
  14 products created at stock 500, 6 skipped as existing, load-test prerequisite
  green. **Found during verification** → new Known Issue: the product list applies
  `isActive` only when the caller passes it, so deactivated/risk-blocked products
  are still returned by `GET /api/products` and
  `GET /api/products/with-inventory/all` (see snapshot Known Issues — a default
  flip needs a paired storefront ShopPage change).

- SEED-01 — catalog bootstrap script for a fresh environment (2026-07-29, tooling
  only, NO code/schema change): `scripts/seed/seed-products.mjs` unblocks
  `scripts/load/baseline.mjs`, which aborts with `No prod_ product found via
GET /api/products` on an empty catalog. Root cause chain on a fresh DB: the prod
  baseline SQL (`database/prod-baseline-20260717/nodeA-mysql-baseline.sql`) seeds
  only `resources` + `roles` — **no categories** — while `createProduct` rejects
  unknown categories (404 `CATEGORIES_NOT_FOUND`) and non-`active` ones (400
  `CATEGORIES_NOT_APPROVED`), and `createCategory` always saves `status:"pending"`.
  So a shop account alone cannot bootstrap a catalog; an admin must approve the
  categories first. The script does the whole chain: shop+admin login → POST 5
  categories (tolerates 409 duplicates) → admin `PATCH /api/products/categories/:id/review
{action:"approve"}` → POST N simple products (no `skuList`, so the gateway's
  create saga also creates the inventory row with `stockQuantity`) → re-runs
  `baseline.mjs`'s own `pickProduct` logic as a self-check. Products are created
  WITHOUT `imageUrls` — attaching images needs a real Cloudinary signed upload
  (`@IsCloudinaryUrl` + `assertCloudinaryUrlsOwnedBy`), so images are deferred to
  `PATCH /api/products/:id`. Credentials come from a gitignored `api/.env.seed`
  (template `.env.seed.example` is committed) via a dependency-free KEY=VALUE
  loader — real env vars win over the file and passwords are never logged.
  Flags: `--base` (overrides `SEED_BASE`), `--count` (≤10), `--dry-run`.
  Runtime-verified against prod 2026-07-29: 5 categories approved, 8 products
  created with stock 500, then a full `--profile smoke` baseline run passed 5/5
  scenarios incl. a 201 checkout probe.

- GHN-ADDR-01 — durable GHN address ids at checkout (2026-07-23, sweep): fixes the
  long-standing Known Issue where GHN free-text ward/district/province names could
  resolve to a wrong-but-valid GHN location (short master-data names match many
  free-text parts by containment). Root fix: capture the exact GHN ids at checkout
  instead of resolving free-text at ship time. **Contract (additive, backward-
  compatible):** `POST /api/order` and `POST /api/order/shipping-fee` now accept
  optional `toDistrictId` (GHN DistrictID, int ≥1) + `toWardCode` (GHN WardCode,
  string ≤20) — both picked from the existing `GET /api/shipping/districts|wards`
  proxy. When BOTH are present the waybill create + fee preview use the exact ids
  and skip `resolveAddressToGhnIds` name resolution entirely; a partial pair (one
  missing) is treated as absent → legacy free-text fallback, so existing callers
  are unaffected. **Wiring:** gateway DTOs `CreateOrderDto`/`ShippingFeeDto` →
  gateway `order.service.ts` forwards the two fields on all three TCP sends
  (`CREATE_ORDER`, `CREATE_MULTI_SELLER_ORDER`, `CALCULATE_SHIPPING_FEE`) →
  `orders.controller.ts` `toGhnResolvedAddress` guard builds a `GhnResolvedAddress`
  → `OrdersService.placeOrder`/`placeMultiSellerOrder` persist `orders.to_district_id`
  /`to_ward_code` and forward the resolved pair into the fee preview →
  `GhnService.buildShippingOrderBody`/`previewShippingFee`/`createShippingOrder`
  consume it (new optional `resolvedIds?: GhnResolvedAddress` param + `toResolvedAddress`
  entity→resolved guard). New `GhnResolvedAddress` interface in `ghn.types.ts`;
  new nullable columns on `order.entity.ts`. **Migration:**
  `database/migrations/nodeA/20260723-001-add-ghn-ids-to-orders.sql`
  (`nodeA-20260723-001-add-ghn-ids-to-orders` in the manifest — idempotent,
  INFORMATION_SCHEMA-guarded; orders runs `synchronize:true` so dev auto-adds the
  columns, SQL is for fresh/`synchronize:false` DBs). Validated: tsc 0, eslint 0,
  prettier clean; `db:migrate:dry-run --target=nodeA` lists it as the sole runnable
  candidate. **Runtime self-test (live gateway, user `canceltest1779978329`):**
  fee preview with valid ids → 201 (GHN responded); valid free-text no ids → 201
  (legacy path intact); **real street + GARBAGE ward/district/province names +
  valid ids → 201 (name resolution bypassed — the fix)**; SAME garbage names, no
  ids → 400 (`Cannot resolve province "wwwww"`); partial pair (district only) →
  201 free-text fallback; `toDistrictId:"abc"` → 400 validation. Full order-create
  persistence leg reached the authoritative stock-reserve step (new fields accepted
  - validated) but could not complete a 201 because this dev env's PG inventory has
    0 availableStock for all products (pre-existing seed gap, unrelated) — the GHN
    build-body core it would exercise at ship time is already proven by the fee-preview
    bypass test. FE handoff (storefront checkout) written to `frontend-handoff.md`.
    Follow-up (not scheduled): the GHN admin `update-receiver` path still rewrites
    only the free-text head and does not update the persisted ids.

- SCALE-07 — gateway inventory-read TCP timeouts (2026-07-22): added the missing
  `.pipe(timeout(TCP_TIMEOUT_MS.READ))` (5s, pure reads) to the three
  `inventoryClient.send(...)` calls in `apps/gateway/src/product/product.service.ts`
  that were shipped uncapped: `getProductWithInventoryById`
  (`INVENTORY_FIND_BY_PRODUCT_ID`, keeps its existing `.catch()` degradation),
  `getAllProductsWithInventory` (`INVENTORY_GET_BY_PRODUCT_IDS`), and
  `checkProductStock` (`INVENTORY_CHECK_STOCK`). These three were missed by
  SCALE-05's "all 172 timeout sites reclassified" pass because they never had a
  `timeout(10000)` to reclassify — a half-open / GC-stalled / deadlocked Node B
  inventory service (which never rejects, unlike a crash's fast ECONNREFUSED)
  would hang product-detail-with-inventory, product-list-with-inventory, and the
  checkout stock check with no cap, pinning the single gateway process under
  load. Audit-confirmed the other 4 inventory sends in the file (2 write-path
  `INVENTORY_CREATE`/`INVENTORY_REMOVE_BY_PRODUCT` → WRITE 10s, 2 other read
  batches) were already piped; all 7 inventory sends now carry a timeout.
  Single-file, no contract/response-shape change, no migration. Validated: tsc 0,
  eslint 0, prettier clean. Runtime self-tested 3/3 on the live stack —
  `GET /api/products/with-inventory/all?limit=2` → 200 (rows carry `inventory`),
  `GET /api/products/prod_ffc802c681d211f1/with-inventory` → 200,
  `GET /api/products/prod_ffc802c681d211f1/stock-check?quantity=1` → 200
  (`available:true, availableStock:99`) — happy-path behavior unchanged. No FE
  impact (internal resilience only).

- Snapshot hygiene (2026-07-22): closed the stale "database.md index/entity info
  is out of date" Known Issue (originally logged 2026-07-02). Verification —
  cross-checked all 33 live `@Entity` table names against the entity/service map
  in `ai-docs/agent-context/database.md`: 100% match, including the post-note
  additions (`order_return_requests`, `vouchers`, `voucher_redemptions`,
  `wishlist_items`, `product_risk_feedback`, `user_addresses`). The doc was
  rewritten lean at the 2026-07-17 baseline cutoff and no longer carries any
  index/uniques claims, so the "out of date" note no longer applied. No doc edit
  needed; removed the note from snapshot Known Issues.

- DEP-01 — npm audit triage + safe remediation (2026-07-22): swept the
  dependency-vulnerability backlog. Baseline `npm audit` = 28 findings (2
  critical, 12 high, 12 moderate, 2 low). Every finding was mapped to
  direct-vs-transitive and runtime-vs-dev exposure, then remediated with a
  plain `npm audit fix` (NON-force — only semver-compatible upgrades, 44
  packages changed, 6 added). Result: **28 → 10 findings; all 2 critical + 12
  high eliminated.** Runtime-exposed packages cleared: axios (prod HTTP client
  to GHN/ZaloPay/VNPay), typeorm 0.3.28→0.3.31 (SQL injection in
  UpdateQueryBuilder/SoftDeleteQueryBuilder `orderBy` on MySQL — directly
  relevant), ws 8.20.1→8.21.1 + engine.io/engine.io-client/socket.io-adapter
  (WS memory-DoS on chat/notification namespaces), form-data (CRLF injection),
  multer + @nestjs/platform-express 11.1.19→11.1.28 (upload DoS), @nestjs/swagger
  11.4.2→11.4.6 + js-yaml (merge-key DoS), qs + body-parser (express query/body
  DoS), fast-uri (path traversal), brace-expansion (DoS). Dev/build-only cleared:
  @babel/core, shell-quote (critical, under `concurrently`), and the critical
  `@xhmikosr/decompress` (zip-slip) + high `piscina` (prototype-pollution→RCE).
  Validation all green post-upgrade: `tsc --noEmit` 0 errors, `npm run build`
  10/10 services (webpack), `npm run lint` 0 errors (7 pre-existing e2e
  warnings), `npm test` 24 suites / 176 tests passed. Also removed the redundant
  direct `@swc/cli` devDependency (it duplicated the copy already pulled in
  transitively by `@nestjs/cli`). **Accepted residual (10 moderate):** all are
  `file-type`/`@xhmikosr/*` DoS reachable ONLY through the build chain
  `@nestjs/cli@11.0.21 → @swc/cli@0.6.0 → @xhmikosr/*` — build-time only, zero
  production runtime exposure. `npm audit fix --force` (which would force the
  breaking `@swc/cli@0.8.1` under @nestjs/cli's 0.6.x range and probably break
  `nest build`) was deliberately NOT run; these clear upstream when @nestjs/cli
  bumps @swc/cli. No API/response/contract change → no FE handoff. Execution note:
  the agent is denied npm install/uninstall/audit-fix, so the user ran the
  mutating commands via `!` while the agent did the triage, validation, and
  bookkeeping.

- SCALE-03 — nginx load-absorption layer (2026-07-20): rewrote
  `nginx/trybuy.conf` (+ `nginx/trybuy-local.conf` docker mirror pointing at
  `host.docker.internal:3000`). **(a) Rate limiting** — http-level
  `limit_req_zone` 30r/s per `$binary_remote_addr` (10m zone) applied with
  `burst=60 nodelay` on the API locations, `limit_conn 32`, both returning 429;
  `/zalopay/callback`, `/vnpay/callback`, and `/socket.io/` are exempt
  (providers retry on their own schedule; sockets are long-lived). **(b)
  Upstream keepalive** — `upstream trybuy_gateway { server 127.0.0.1:3000;
keepalive 32; }` + `proxy_http_version 1.1` + `Connection ""` on non-WS
  locations (the old conf forced `Connection "upgrade"` on `/`, which killed
  reuse); `/socket.io/` keeps upgrade headers + 300s read timeout. **(c)
  gzip** — JSON/text types, level 5, min 1024, `gzip_vary` (no Node
  compression middleware needed). **(d) 5s micro-cache** — `proxy_cache_path
/var/cache/nginx/trybuy` (10m keys, 100m max) with `proxy_cache_lock on`
  (stampede guard) + `proxy_cache_use_stale updating` on a regex matching
  EXACTLY the four @Public user-invariant catalog GETs: `GET /api/products`,
  `/api/products/prod_<id>`, `/api/products/brands`, `/api/products/categories`
  (verified all four are `@Public()` in `product.controller.ts` — never widen
  the regex to authenticated routes or nginx serves one user's response to
  everyone; POSTs on the same paths pass through since only GET/HEAD is
  cached, and Set-Cookie responses are never stored). `X-Cache-Status` header
  exposed. **(e) SCALE-05 remainder** — gateway
  `CustomRateLimitGuard` now supports `RATE_LIMIT_SKIP_PUBLIC_GET=true`
  (default off): skips the Redis counter for `@Public` GET/HEAD routes with NO
  explicit `@RateLimit` decorator (explicit limits like login/webhook always
  still enforced) — set ONLY in prod behind nginx `limit_req`; added to
  `local/nodeA/.env.production.example`. 5 new unit tests
  (`rate-limit.guard.spec.ts`). Verified: `nginx -t` green on the prod conf in
  a docker nginx:alpine (dummy certs mounted at the letsencrypt path); live
  docker nginx on :8088 against the running gateway → list MISS→HIT→HIT within
  TTL, `EXPIRED` after 5s, categories cached, gzip `Content-Encoding: gzip`,
  `/api/user/me` passes through uncached (401, no cache header), burst of 150
  concurrent → 65×200 / 85×429 served at nginx before Node. tsc/eslint clean.
  Deploy notes: `mkdir -p /var/cache/nginx/trybuy` (step added to conf
  header); tune rate/burst upward if legit FE fan-out trips 429 (OQ-6).
  Throughput attribution on the target VPS stays with SCALE-06.
- SCALE-05 — overload failure-mode tuning: timeout split + atomic throttle +
  backpressure shed (2026-07-19): three parts. **(a) TCP timeout split** —
  new `TCP_TIMEOUT_MS = { READ: 5000, WRITE: 10000 }` in
  `libs/constant/tcp-timeout.constant.ts`; a codemod reclassified all 172
  gateway `timeout(10000)` sites by enclosing method: read-only queries
  (get/find/list/search/check/resolve/validate…) → 5s so a slow service sheds
  stuck reads instead of parking sockets 10s; mutations AND any call whose
  downstream leg hits an external API (GHN admin/sync/webhook, shipping
  master-data, ZaloPay/VNPay callbacks + payment-url, invoice PDF) keep 10s.
  Ambiguous read-shaped helpers (enrichment/expose batch lookups) were left
  conservatively at WRITE. **(b) Atomic rate-limit window** — new
  `CachedService.incrementWithWindow(key, ttl)` (Lua: `INCR` + `EXPIRE` iff
  `TTL < 0`, one atomic script) replaces the guard's non-atomic
  `incr` → `expire if count===1` pair in
  `apps/gateway/src/common/guards/rate-limit.guard.ts`. Fixes the Known Issue
  where concurrent load lost the EXPIRE and left `throttle:*` keys at TTL -1
  → permanent 429; the TTL<0 condition also self-heals keys already stuck.
  Runtime-verified: seeded a TTL -1 key → one request re-armed it (TTL 59);
  10 rapid requests → 6×200 then 4×429 with TTL still positive. **(c)
  Backpressure shed** — `apps/gateway/src/common/backpressure.ts`
  (`monitorEventLoopDelay`, mean sampled each
  `BACKPRESSURE_SAMPLE_INTERVAL_MS`=1000) registered in `main.ts` right after
  security headers, BEFORE body parsing: when mean event-loop delay exceeds
  `BACKPRESSURE_MAX_EVENT_LOOP_DELAY_MS` (default 500) it answers 503 +
  `Retry-After` (default 2s) in the standard error envelope instead of letting
  every queued request time out at once. Exempt: `/zalopay/callback`,
  `/vnpay/callback`, `/ghn/webhook`, `/api/ghn/webhook`, `/live`, `/ready`,
  `/health` (providers retry on their own schedule; a shed callback could lose
  a payment confirmation). Kill switch `BACKPRESSURE_ENABLED=false`. 4/4 unit
  tests (`backpressure.spec.ts`: pass-through, shed shape, exemptions, sample
  caching). tsc/eslint clean; anon + auth reads (products list, cart, buyer
  order list) still 200 on the dev stack. Left for SCALE-03: skip the Redis
  rate-limit guard on `@Public` cacheable GETs once nginx `limit_req` owns L7
  flood control.

- SCALE-01b — env-gated gateway pm2 cluster mode (2026-07-19): closes SCALE-01
  (part a = Redis Socket.IO adapter, shipped earlier same week). Change:
  `ecosystem.config.js` gateway entry now reads `GATEWAY_INSTANCES` (default 1
  → fork, identical to before); >1 switches `exec_mode:"cluster"` with that
  instance count — `GATEWAY_INSTANCES=4 pm2 start ecosystem.config.js --env
production`. Safe because gateway HTTP is stateless (JWT cookie) and WS
  broadcast is cross-instance via the SCALE-01a Redis adapter; the gateway
  holds no SQL pool so the SCALE-02 per-service budget is unaffected.
  Verified with ×4 on the prod build: 4 workers online, 0 restarts, 0 non-2xx
  across all load probes, and a Socket.IO smoke (8/8 connects to `/chat`,
  `transports:["websocket"]`, token auth) proving websocket-only needs no
  sticky sessions across workers. Measurement (4th "Recorded baselines" entry
  in `scripts/load/baseline.mjs`; raw `scripts/load/results/2026-07-19-scale01b-*`):
  on the shared dev machine throughput showed NO stable gain (anon list
  428–923 req/s noisy vs 790 stable single-instance; auth cart ~92.6 vs 101.7
  req/s — DB-bound, unchanged as expected) because the load generator + 13
  Node processes + Redis share the same 12 cores. Decision: keep default 1;
  prod may raise it ONLY after (1) FE ships websocket-only transport on
  `/chat` + `/notifications` (storefront handoff entry written) and (2) a
  re-measure on the target VPS with an external load source shows a gain.

- SCALE-04 — gateway micro-cache for hot @Public product reads (2026-07-19):
  full-response Redis cache-aside (TTL 10s) added in
  `apps/gateway/src/product/product.service.ts` (+ `CachedModule` in
  `product.module.ts`) for `GET /api/products` (key
  `gw:products:list:<stable-sorted-query-json>`, same stable-key technique as
  the product service's `buildSearchCacheKey`) and `GET /api/products/:id`
  (key `gw:products:detail:<publicId>`). Rationale: the post-SCALE-02 61 req/s
  ceiling persisted on an identical URL even though the product service list is
  already cached 5s — the binding leg was the gateway's uncached per-request
  user-enrichment TCP (`GET_USERS_BY_IDS` → user MySQL, pool 16 ≈ 64 rps).
  Both routes are user-invariant (no `req.user` in the response), so caching
  the FINAL exposed payload (public ids applied) is safe and collapses product
  TCP + user TCP + expose into one local Redis GET. Details: warn-and-continue
  on any Redis failure (cache down ≠ request fails); not-found detail responses
  are never cached; `updateProduct`/`deleteProduct` best-effort invalidate the
  detail key + all list keys (10s TTL bounds staleness regardless). Validation:
  tsc/eslint clean; ownership spec 7/7 (mock gained a CachedService stub).
  Runtime self-test (dev stack): list cold 200/0.95s → warm 200/0.22s, detail
  cold 200/1.17s → warm 200/0.22s, bodies byte-identical except the per-request
  envelope `timestamp`; `gw:products:detail:*` key observed then expired ≤10s.
  No FE impact (response shape unchanged). Found during self-test: stale
  `throttle:*` Redis key with TTL -1 caused a permanent 429 — recorded in
  snapshot Known Issues (fix scoped to SCALE-05b). Prod-build re-measure done
  same day (3rd "Recorded baselines" entry in `scripts/load/baseline.mjs`;
  raw JSON in `scripts/load/results/2026-07-19-scale04-*.json`): anon product
  list 61 → 798 req/s at c=50 (p50 766ms → 51ms), detail 1692 req/s, and
  c=500 — previously total collapse — now completes 15132×2xx at 757 req/s
  with ~3.6% err/timeout; zero 500s, zero pm2 restarts. Cached anon reads are
  now bound by the single gateway Node process (SCALE-01b is the next lever);
  uncached auth paths keep their ~102 req/s ceiling from the SCALE-02 run.

- SCALE-02 — per-service DB pool budget under the Aiven-free connection caps
  (2026-07-19): `ecosystem.config.js` now sets `MYSQL_POOL_SIZE`/`PG_POOL_SIZE`
  per pm2 app (dotenv never overrides already-set env, so pm2 wins over the
  shared `local/node{A,B}/.env`). Budget: MySQL product 20 / user 16 / orders
  16 / social 6 / notification 4 / chat 6 = 68 < `max_connections` 76 (measured
  live on Aiven free); PG inventory 5 / payments 4 / rewards 3 = 12 < 20 (11
  already in use when measured). Why a budget instead of one big number: the
  user's flat `MYSQL_POOL_SIZE=50` across all 6 MySQL services exceeded the 76
  cap under load → ~35% of responses were HTTP 500 "Too many connections"
  (probe c=50: 1558×200 + 834×500). With the budget: zero 500s at c=50–500.
  Measured gains vs the pool=10 baseline (same prod build + pm2, Aiven India
  ~250ms roundtrip; full numbers in `scripts/load/baseline.mjs` header +
  `scripts/load/results/2026-07-19T11-23-51-388Z-500.json`): anon product-list
  ceiling 40 → 61 req/s (bound by the 16-conn user-enrichment pool ≈ 64 req/s
  theoretical); auth cart 59.6 → 101.7 req/s (0 err at c=500, 3051 completed
  vs 0 before); 500-profile completed responses S1 213→1314, S2 0→1389;
  order list (S4) still saturates at c=500 (client timeouts only, no non2xx).
  Verdict: ~200–300 concurrent degraded (was ≲100–150). Structural note:
  Aiven free's 76 conns × ~250ms ≈ 300 req/s TOTAL across all services —
  bigger pools cannot pass this wall; next levers are SCALE-01b (gateway
  cluster, divide pool budget by instances) and SCALE-03/04 (caching).
  Ops follow-up for the user: lower `.env` `MYSQL_POOL_SIZE` to ~10 and
  `PG_POOL_SIZE` to ~5 (dev watch mode reads `.env` directly; the pm2
  override only protects prod runs).

- SCALE-06 (evidence half) — official concurrency baseline recorded
  (2026-07-19): ran against a REAL prod build (`npm run build` + pm2 fork ×1
  per service on the dev machine, Aiven remote DBs, `RATE_LIMIT_DEFAULT_LIMIT`
  raised to 100000 by the user). Result: **500 concurrent = collapse** — S1
  completed 213/2000 (p50 9004ms), S2/S3/S4 completed ZERO requests; all
  failures were client-side connect/timeout errors (zero non2xx, zero
  service crashes — all 10 pm2 apps stayed online). Capacity probes found a
  hard **~40 req/s throughput ceiling** on the anon product-list path
  (identical at c=50/100/200 while p50 grew 1166→2338→4684ms — pure queue
  saturation), matching `MYSQL_POOL_SIZE=10` × ~250ms Aiven roundtrip; the
  auth cart path did ~60 req/s (p50 826ms, 0 err at c=50). Verdict recorded
  in the script header: current stack handles ≲100–150 concurrent with
  degraded latency; 1k/5k runs skipped as moot. Data directly implicates
  SCALE-02 (DB pool size) as the first lever, then SCALE-01b (gateway
  cluster). Raw JSON: `scripts/load/results/2026-07-19T09-53-45-278Z-500.json`.
  Checkout load (`--write`) intentionally not exercised (would flood Aiven
  with real orders); contract probe only.

- SCALE-06 (script half) — load-test baseline runner (2026-07-19, sweep): new
  `scripts/load/baseline.mjs`, an autocannon-based runner (autocannon CLI is
  the tool actually installed globally; k6 is not). Scenarios: S1 anon
  `GET /api/products?page=1&limit=20`, S2 anon product detail, S3 auth
  `GET /api/cart`, S4 auth `GET /api/order/user/:usrId` (cookie JWT from
  `LOAD_USER`/`LOAD_PASS` env — credentials never hardcoded), S5
  `POST /api/order` checkout (full load only under `--write`, which creates
  real COD orders auto-swept by the 24h stale-reservation sweeper; without
  `--write` a single contract probe runs). Profiles `smoke|500|1k|5k`; summary
  table (req/s, p50/p95/p99, error %, 429 count) + raw autocannon JSON saved
  to `scripts/load/results/`. Implementation notes: spawns the autocannon CLI
  via `node <resolved cli.js>` with NO shell — on Windows `shell:true` mangled
  the `-H "Cookie: …"` quoting and every auth request 401'd; error % =
  `(non2xx + socketErrors) / (completed + socketErrors)` since autocannon's
  `errors` counter is socket-level and can exceed `requests.total`; the
  checkout product is picked by scanning page 1 for the first product with
  `availableStock ≥ 1` via `GET /api/inventory/product/:id` (first listed
  product had no inventory row → "Unable to reserve stock" 400). Smoke-verified
  2026-07-19: 5/5 scenarios valid (S1/S2/S4 0% err, S3 one transient 502,
  checkout probe 201 `ord_yUc1wnH80EpxYkaF`). Smoke numbers are explicitly NOT
  recordable baselines (dev `nest --watch` target, 15 req/s cap). REMAINING:
  official 500→1k→5k runs against a prod build (pm2 + raised
  `RATE_LIMIT_DEFAULT_LIMIT`) — user-coordinated; record results in the script
  header. No FE impact, no migration, no runtime code touched.

- SCALE-01a — Socket.IO Redis adapter on the gateway (2026-07-19, sweep): new
  `RedisIoAdapter` (`apps/gateway/src/common/redis-io.adapter.ts`) extends
  NestJS `IoAdapter` and attaches `@socket.io/redis-adapter` (new dep,
  user-installed) built on two ioredis pub/sub clients using the same
  `REDIS_HOST/PORT/PASSWORD` env as `@app/cached`. Wired server-wide in gateway
  `main.ts` (`useWebSocketAdapter` before `listen`), so BOTH WS namespaces
  (`/chat`, `/notifications`) broadcast through Redis — prerequisite for
  multi-instance gateway (SCALE-01b). Boot behavior: 3s connect probe; if Redis
  is unreachable the adapter logs a warn and falls back to the default
  in-memory adapter (single-instance WS keeps working, gateway never fails to
  start because of Redis). Both clients carry `error` listeners so an idle
  Redis drop can't become an uncaught exception (nodeB-crash lesson); ioredis
  auto-reconnects after boot. No contract change for FE (same origin/port/
  namespaces/auth). Verified: `tsc --noEmit` + eslint clean; Redis
  `PUBSUB CHANNELS` shows `socket.io-request/response#/chat#` +
  `#/notifications#` subscriptions (adapter live); runtime self-test 6/6 —
  login×2, `POST /api/chat/conversations` (conv\_...), WS connect both
  namespaces, chat round-trip A→B via room broadcast (`msg_...` received),
  `/notifications` stays connected.

- Port-bind architecture alignment (2026-07-18): VPS `ss -lntp` audit showed two
  binds violating the "only Nginx is public" rule. (1) chat hardcoded
  `host: "0.0.0.0"` on TCP 3012 → now `TCP_HOST` (`127.0.0.1`) like every other
  internal service. (2) product had a stray HTTP `app.listen(PRODUCT_TCP_PORT +
100)` (= 3106, all interfaces, zero HTTP routes) → removed, replaced with
  `app.init()` (same fix as inventory 3002 below). (3) gateway `app.listen(port)`
  bound all interfaces → now `app.listen(port, process.env.GATEWAY_HOST ||
"0.0.0.0")`; dev behavior unchanged, VPS must set `GATEWAY_HOST=127.0.0.1`.
  Note: no listener on 3004 is CORRECT — rewards is RMQ-only, no TCP server.
  tsc/eslint clean; runtime-verified locally (chat on `127.0.0.1:3012`, 3106
  gone, gateway → product HTTP 200). No FE impact, no migration.

- Inventory double-bind on port 3002 fixed (2026-07-18): `apps/inventory/src/main.ts`
  bound port 3002 twice in the same process — the TCP microservice on
  `TCP_HOST:3002` and then an HTTP `app.listen(3002)`. Windows dev tolerated the
  specific+wildcard coexistence, but on the Linux PM2 deploy the HTTP bind hit
  EADDRINUSE while PM2 still showed the service online. Inventory has zero HTTP
  routes (controller is `@MessagePattern`/`@EventPattern` only), so the fix
  removes the HTTP listener entirely (`startAllMicroservices()` + `app.init()`,
  same pattern as rewards) instead of moving it to another port. tsc/eslint
  clean; runtime-verified locally: netstat shows a single `127.0.0.1:3002`
  listener, and gateway → TCP inventory reads return 200/404 correctly. No FE
  impact, no migration.

- UP-08 upload-signature PUBID compatibility (2026-07-17, sweep): the deprecated
  `userId` query param on `POST /api/upload/signature` no longer requires an
  integer — it is now an optional free-form string (still ignored; the JWT user
  is authoritative), so a client sending the opaque `usr_...` id can never break
  uploads with `400 "userId must be an integer number"` again. Swagger for
  `publicId` now states the numeric-owner-prefix contract (`<internalId>_...`,
  `usr_...` prefixes rejected 403, omit to get a server-generated id). No service
  logic change. 3 new DTO-validation unit tests (upload suites 22/22), tsc/eslint
  clean; runtime-verified 5/5 (usr* userId → 201, param-less → 201 with `20*...`
  id, foreign numeric userId ignored, usr\_-prefixed publicId → 403, unauth → 401).

- GHN shipping-history public-id boundary fix (2026-07-17):
  `GET /api/order/admin/ghn/orders/:orderId/history` now projects the validated
  `ord_...` path id onto every response row instead of exposing the raw numeric
  `shipping_history.order_id` bigint value. The Orders service and database keep
  numeric IDs internally. Added a gateway regression test for the former
  `"120"` leak. Prettier, ESLint, TypeScript, gateway build, and the targeted
  Jest suite (10/10) passed. Authenticated runtime checks returned 200 for GHN
  list/history; the first 20 local orders had no history rows, so the non-empty
  payload assertion is covered by the regression test.

- Database migration-history squash (2026-07-17): established the production
  baseline as the release cutoff, removed 74 standalone root/app-local/unused
  Docker-init SQL files whose final schema is already represented by the Node
  A/Node B baseline, removed 3 destructive/demo inventory setup scripts, and
  reset the incremental manifest to zero post-cutoff migrations. Manifest v2 now
  validates baseline hashes and classifies the 18 Node A / 3 Node B historical
  tracking IDs as `baseline-absorbed`, so existing databases keep their audit
  rows without requiring retired files. Updated database/deployment guidance;
  no Aiven connection or schema apply was performed.

- Production fresh-database baseline package (2026-07-17): audited the
  incremental-only migration manifest and generated reviewed, engine-specific
  schema imports for empty Aiven Node A MySQL and Node B PostgreSQL databases
  under `database/prod-baseline-20260717/`. The package creates the full current
  TypeORM schema, seeds only required roles/resources/payment methods, and
  baselines enabled manifest entries in `schema_migrations` using their current
  checksums. Added import gates, post-import verification queries, known schema
  caveats, and package-level SHA-256 checksums. No production connection or
  database apply was performed.

- PUBID-00-07 full regression audit and stable historical product references
  (2026-07-17, migration
  `nodeA-20260717-007-snapshot-product-public-id-on-order-items` APPLIED to
  Aiven): cross-domain runtime coverage found one real PUBID-05 regression:
  hard-deleting a product made historical order `items[].productId` become
  `null`, because the gateway resolved the public id from the live product row.
  Order items now persist the checkout-time product public id and use that
  snapshot for storefront and GHN order responses; the internal snapshot field
  is stripped at the HTTP boundary. Existing rows were backfilled where the
  product still existed; already-deleted legacy rows cannot be reconstructed.
  Validation passed across all PUBID domains: 22/22 Jest suites (163/163 tests),
  TypeScript, lint (0 errors; 7 pre-existing scaffold warnings), all 10 app
  builds, 25/25 broad runtime checks, 10/10 numeric-id/DTO rejection and
  mutation checks, chat REST/WS 23/23, plus a full product -> inventory -> cart
  -> COD order -> cancel -> product deletion lifecycle proving the historical
  order still returns its `prod_...` reference.

- PUBID-07 — cross-reference sweep and contract lock (2026-07-17): converted
  remaining HTTP/WS references for already-public domains, including user ids
  in orders/GHN, products, cart, chat participants/messages, notifications,
  addresses, and social follow/admin payloads; product ids in inventory; and
  post/comment references in social/notification shapes. Catalog `userId`
  filtering now accepts `usr_...` and resolves it internally. Internal DB/TCP
  FKs remain numeric. Gateway routes/DTOs now reject numeric forms for converted
  references. Added the invariant to `$review` and documented the design in the
  root README/API context. No PUBID-07 schema migration was required. Runtime
  verification covered authenticated storefront/GHN lists, social create/read/
  delete, inventory lookup, numeric 400 cases, and chat REST/WS; regression
  suite 73/73, chat scripts 23/23, tsc and full build passed. Separate
  storefront and GHN-console handoffs were written.

- PUBID-06 — post and comment opaque public ids (2026-07-17, migration
  `nodeA-20260717-006-add-public-id-to-posts-comments` APPLIED to Aiven): posts
  now expose/accept `post_<16 alnum>` and comments/replies `cmt_<16 alnum>` on
  feed/detail/create/edit/delete/like/report, comment/reply trees, follow feed,
  and admin moderation routes. Notification social metadata now carries
  `post_...` and `usr_...`. The guarded migration adds/backfills unique
  `public_id` columns on `posts` and `comments`; owning-service TCP handlers
  resolve public ids while preserving numeric internal callers. Runtime tests
  covered public feeds, authenticated post/comment/reply lifecycle, opaque
  nested references, and numeric route rejection.

- PUBID-05 — product opaque public ids (2026-07-17, migration
  `nodeA-20260717-005-add-public-id-to-products` APPLIED to Aiven): BREAKING API
  change — catalog product `id` and every HTTP product reference now use
  `prod_<16 alnum>`. Numeric product route params are rejected with 400. Product
  references were converted across SKU payloads, wishlist/reviews, risk tools,
  cart/checkout DTOs, orders, social, inventory-enriched responses, and
  `GET /api/order/admin/ghn/orders/:id` local-order items. Internal TCP, DB FKs,
  inventory, cart, order, and social persistence remain numeric. Runtime checks
  covered catalog list/detail, numeric rejection, and GHN detail product refs.
  Storefront and GHN-console handoffs were written separately.

- PUBID-04 — address, notification, and return-request opaque public ids
  (2026-07-17, migration
  `nodeA-20260717-004-add-public-id-to-addresses-notifications-returns` APPLIED
  to Aiven): `addr_`, `ntf_`, and `rr_` replace numeric ids at HTTP/WS
  boundaries. Address mutation params, notification mark-read, and return-review
  params accept only their matching prefix (numeric refs return 400).
  Notification list/push `orderId` now uses the parent `ord_` id; return-request
  list/create/review shapes expose their own `rr_` plus parent `ord_`. Internal
  DB/TCP identifiers remain numeric. Runtime checks covered non-empty address,
  notification, and managed-return lists plus all three numeric-param failures.
  Storefront handoff was written.

- PUBID-03 — chat opaque public ids (2026-07-17, migration
  `nodeA-20260717-003-add-public-id-to-chat` APPLIED to Aiven BEFORE code —
  chat runs `synchronize:false`, so the guarded SQL
  (`database/add_public_id_to_chat.sql`: `conversations.public_id` +
  `messages.public_id` VARCHAR(32), `conv_`/`msg_` UUID-hex backfill, guarded
  unique indexes, INPLACE/LOCK=NONE) is REQUIRED on any fresh DB before this
  code runs): BREAKING API change — every HTTP/WS chat id is now opaque.
  Conversations: `id: conv_<16 alnum>` on `POST/GET /api/chat/conversations`
  (+ `lastMessage.id: msg_...`); route params `GET .../:id/messages` and
  `POST .../:id/read` take ONLY `conv_` ids (numeric → 400 via
  `ParsePublicIdPipe(conv_)`; unknown → 404; non-member → 403). Messages:
  `id`/`parentMessageId` are `msg_...`, `conversationId` in message rows is the
  `conv_` string. WS `/chat`: `join`/`send_message` payloads take
  `conv_`/`msg_` strings; `new_message` emits the identical exposed shape via
  shared `exposeChatMessage` (gateway `chat.types.ts` — `ChatMessageTcp`/
  `ChatConversationTcp` TCP shapes + `exposeChatConversation`). Chat service:
  `publicId` columns on both entities, `generatePublicId` on create,
  `lookupConversationId`/`resolveConversationId` (`number | string` — internal
  numeric callers keep working), batched parent-public-id attach in
  `getMessages` (one `In(parentIds)` query per page), `sendMessage` resolves
  `msg_` parent refs and NOW VALIDATES the parent exists in the same
  conversation (400 `INVALID_PARENT_MESSAGE` — previously any numeric parent
  was accepted unvalidated); `SendMessageDto` replaced by `SendMessagePayload`
  (dto file deleted). `otherUserId`, `user1Id`/`user2Id`, `senderId` stay
  numeric until PUBID-07. Test scripts `scripts/test-chat-{ws,reply}.mjs`
  updated to the new contract (WS on gateway :3000, conv* arg, msg* assertions,
  new invalid-parent negative test). Runtime-verified: 7 REST checks (create/
  list/messages/400/404/403/mark-read) + 14 WS checks (9 + 14 script totals)
  all pass. FE handoff entry written to `../.agent-local/frontend-handoff.md`.

- PUBID-02 — users opaque public ids (2026-07-17, migration
  `nodeA-20260717-002-add-public-id-to-users` APPLIED to Aiven — guarded
  `users.public_id VARCHAR(32)` add + `usr_` UUID-hex backfill + guarded unique
  index; user service also runs `synchronize:true` so dev auto-syncs):
  BREAKING API change — every HTTP user id is now `usr_<16 base62>` (hex for
  backfilled rows). Converted surfaces: `POST /api/user/{login,register}` user
  object, `GET /api/user/me`, `GET/PATCH /api/user/:id` (numeric → 400 via
  `ParsePublicIdPipe(usr_)`), admin `GET /api/user?page=&limit=`,
  `GET /api/user/featured-sellers`, and ALL user embeds: product list/detail
  `user{id,...}` (`enrichProductWithUserInfo`/`enrichProductsWithUserInfo`),
  social `author`/follow `user` (`fetchAuthorMap` → new `UserInfoTcp`/`UserInfo`
  split in `social.types.ts`), order admin `buyer` + GHN admin list/detail
  `buyer`/`seller` (`exposeUserSummary` in gateway order service). User service:
  `publicId` column on the entity, `generatePublicId(usr_)` on register,
  `resolveUserId(number|string)` (public id → PK, numbers pass through so
  internal numeric callers — orders invoice buyer lookup, notification
  `emailUser` — keep working; malformed/unknown `usr_` → 404); PATCH ownership
  moved from the gateway int-equality check into the user TCP handler
  (`targetId` resolved then compared to JWT `userId` → 403
  "Cannot update another user"). JWT payload unchanged (numeric `userId`;
  gateway signs the token from the raw TCP user before `exposeUser` swaps the
  id). Enrichment maps keep numeric keys (matching `product.userId`/
  `post.userId`/`order.userId` FKs); only stored values carry the exposed
  string id — those embedded numeric FK fields themselves are PUBID-07 scope.
  tsc/eslint clean; jest 36/36 (user + gateway order + product suites; 5 user
  spec select-shape assertions updated for `publicId`). Runtime-verified 11/11:
  login/me/profile usr* + no `publicId` leak, numeric id 400, PATCH own 200 /
  foreign usr* 403, unknown usr* 404, admin list + featured-sellers +
  product/social/order embeds all usr*, register generates base62 usr\_,
  invoice PDF still 200 (internal numeric GET_USER_INFO path intact). FE
  handoff entries written to BOTH storefront and GHN files (login/me shared;
  buyer/seller embeds GHN; author/seller embeds storefront).

- PUBID-01 — orders opaque public ids, pilot domain (2026-07-17, migration
  `nodeA-20260717-001-add-public-id-to-orders` APPLIED to Aiven — guarded
  `orders.public_id VARCHAR(32)` add + `ord_` backfill for existing rows +
  guarded unique index; orders also runs `synchronize:true` so dev auto-syncs):
  BREAKING API change — every HTTP order id is now `ord_<16 base62>`; numeric
  ids on order `:id` routes → 400 via new
  `apps/gateway/src/common/pipes/parse-public-id.pipe.ts`. Orders service
  generates `publicId` in the create tx and carries it alongside the numeric
  `id` over TCP; controller handlers accept `orderId: number | string` +
  `resolveOrderId()` (public id → PK; numeric passes through for internal
  callers like notification). Gateway strips at the HTTP boundary:
  `exposeOrder` (replaces `id` with `publicId ?? String(id)`, drops `publicId`
  - each item's numeric `orderId` FK) and `exposeReturnRequest` (rows'
    `orderId` → parent order public id via `orderPublicId` attach) in
    `apps/gateway/src/order/order.service.ts`; admin GHN mappers in
    `apps/orders/src/orders.service.ts` emit public-id `orderId` directly, and
    `toAdminGhnLocalOrder` now strips item `orderId` (leak found+fixed during
    self-test). Internals stay numeric: GHN client*order_code, invoice number
    `INV-YYYYMM-<int id>`, payments TCP (`GET_PAYMENT_URL` gets the resolved
    PK), RMQ events, shipping_history, notifications.order_id (until PUBID-04);
    return-request own ids + voucher ids + `user/:id` stay numeric (PUBID-04/02).
    tsc/eslint clean, jest 53/53 (gateway order + orders suites).
    Runtime-verified 2026-07-17: buyer list/detail/create/cancel/payment-url/
    invoice(PDF), return-request create + mine/list, seller list/detail/confirm,
    admin reject, GHN list/detail/history/sync — all `ord*...`; numeric
`GET /api/order/123` → 400. FE handoff entries written to BOTH storefront
    and GHN files (id contract change, supersedes SEC-L1 integer-id notes for
    order routes).

- PUBID-00 — public-id foundation (2026-07-17, NO migration, NO API change):
  groundwork for the Stripe-style opaque external-id rollout (see snapshot
  "Public-ID backlog"). New `generatePublicId(prefix)` (crypto.randomBytes →
  rejection-sampled base62, 16 chars after `<prefix>_`, ~95 bits entropy, fits
  VARCHAR(32)) and `isPublicId(prefix, value)` type guard in
  `libs/common/src/public-id/public-id.util.ts` (exported from `@app/common`);
  `PUBLIC_ID_PREFIXES` (usr/ord/prod/post/cmt/conv/msg/addr/rr/ntf) +
  `PUBLIC_ID_RANDOM_LENGTH` in `libs/constant/public-id.constant.ts`. No new
  dependencies. 9 unit tests (format, VARCHAR(32) fit, 10k-collision,
  guard accept/reject incl. legacy numeric string). tsc + eslint clean.
  Discrepancy noted: CLAUDE.md documents an `@app/constant` alias but tsconfig
  has none — followed the existing `libs/constant/...` import convention.

- Fix: post create/edit 400 on string `productId` (2026-07-16, NO migration):
  `POST /api/social/posts` rejected `{productId: "35"}` with 400
  "productId must be an integer number" because the gateway `CreatePostDto`
  had `@IsInt() @Min(1)` without `@Type(() => Number)` (global ValidationPipe
  runs `transform:true` but no implicit conversion). Added the `@Type`
  transform; `UpdatePostDto` inherits via `PartialType` so PATCH is fixed too.
  Runtime-verified 5/5: string "35" → 201, numeric 35 → 201, "abc" → 400,
  0 → 400, PATCH with "36" → 200. File:
  `apps/gateway/src/social/dto/create-post.dto.ts`. tsc/eslint clean.

- Product list seller province + province filter (2026-07-16, backend-handoff,
  NO migration): every product row on `GET /api/products` and
  `GET /api/products/with-inventory/all` now carries additive
  `sellerProvince: {id,name} | null`, sourced from the seller's DEFAULT GHN
  address (`user_addresses.is_default=1`; null when absent). Both endpoints
  accept a `provinceId` filter (single or repeated key; scalar→array
  `@Transform` guard like categoryIds; non-numeric → 400). Implementation:
  gateway `fetchProductsPage` resolves provinces → seller ids via new user TCP
  `{cmd: user.get_user_ids_by_province}` (DISTINCT default-address user_ids;
  resolution failure throws — never silently unfiltered; zero match
  short-circuits to an empty page without a product hop), then forwards
  `userIds` to the product service, whose `findAllProducts` gained a
  `product.userId IN (...)` filter (`userIds` in the microservice DTO; search
  cache key already serializes the full query, so cache-safe). Enrichment:
  `getUsersByIds` gained an opt-in `includeProvince` flag (one extra
  `user_addresses` batch query; other callers unaffected) and the gateway's
  batched enrichment now emits row-level `sellerProvince` while leaving
  `user {id,name,avatar}` unchanged. Files: `libs/constant/
message-pattern.constant.ts`, user `user.types.ts`/`user.service.ts`/
  `user.controller.ts`, gateway product `dto/get-products-query.dto.ts`/
  `product.types.ts`/`product.service.ts`, product `dto/get-products-query.dto.ts`/
  `product.service.ts`. Validation: prettier/eslint clean, `tsc --noEmit` zero
  errors; runtime-verified 7/7 self-tests (rows carry `{id:201,name:"Hà Nội"}`
  after seeding techstore_demo's default address; single + repeated-key filter
  return only province-201 sellers; unknown province → empty; with-inventory
  keeps pagination + inventory; `provinceId=abc` → 400; seller without default
  address → `sellerProvince:null`). FE handoff entry written to
  `frontend-handoff.md` (storefront) same date.
- AI-02 follow-up hardening F1–F4 (2026-07-16): replaced product-risk
  fire-and-forget scoring with durable DB state (`pending|ready|failed`, scored
  timestamp, bounded attempts/backoff, next retry, safe last error) and a
  concurrency-3 cron worker. Create/update enqueue without blocking catalog
  mutations; admin risk reads opt into state metadata while public reads do not
  expose it. Added resumable admin batch enqueue
  `POST /api/products/admin/risk/backfill {cursor?,limit?}` (202), rate-limited
  seller advisory `POST /api/products/risk/duplicate-check {imageUrl}` with
  Cloudinary ownership enforcement and no hash leakage, and moderator audit
  `POST /api/products/admin/risk/:id/feedback` for
  `confirmed_duplicate|dismissed`. Duplicate-image scoring now requires an exact
  match or multiple near-match evidence pairs; it remains advisory and never
  auto-unlists. Added guarded migrations
  `add_product_risk_scoring_state.sql` and
  `create_product_risk_feedback_table.sql` to the enabled Node A manifest.
  Validation: targeted ESLint clean; `tsc --noEmit`; product Jest 21/21; full
  monorepo build; live backfill 202, risk state 200, duplicate owned/foreign
  200/403, feedback validation/auth 400/404/403. AI-02F5 remains evidence-gated
  near 10k catalog items.
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
user.get_user_info}` with `{userId, includeEmail:true}`, new USER*SERVICE
  TCP client in `notification.module.ts`) and never throws — TCP/mail failures
  log a warn so the RMQ ack/nack outcome of the triggering handler is
  unchanged. Handlers wired: NEW `order_created` consumer (queue was already
  bound to the orders fanout exchange; saves an in-app `order_created`
  notification for the buyer + emails), plus email mirrors on the existing
  `payment_completed` (buyer), `order_canceled` (buyer),
  `order.return_requested` (seller), `order.return_approved` /
  `order.return_rejected` (buyer) handlers. SMTP*\* unset → MailerService dev
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
  (techstore_demo) → 200 `[]` (empty path intact); user role → 403; unauth → 401. FE handoff entry written (storefront `frontend-handoff.md`) — FE can
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
  order → `processing` (payment*completed consumed); identical callback #2 →
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
  query — deliberate: VNPay signature verification hashes ALL `vnp*\*`params, so
a whitelisted DTO would strip unknown fields and break the checksum — but now
bounds it via`assertBoundedPaymentQuery` (`apps/gateway/src/gateway.controller.ts`):
max 40 keys, max 512 chars per value, string-only values (rejects Express
repeated-key arrays). All violations → 400. Validation: tsc/prettier/eslint
clean. Runtime self-test 8/8 on the live gateway: reviews `?page=1&limit=10`→
200, no params → 200 (defaults, paginated shape),`?limit=100000`→ 400
"limit must not be greater than 100",`?limit=0`→ 400,`?page=abc` → 400;
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
