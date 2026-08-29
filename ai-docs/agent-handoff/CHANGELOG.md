# CHANGELOG — TryBuy Backend

> Historical record of completed work. **NOT auto-loaded** by any agent entry point.
> Read on demand only when you need the history/rationale of a past change.
> Current state (overview, active tasks, known issues) lives in `snapshot.md`.

## Completed Milestones

- **CHG-PW-01 — `POST /api/user/change-password`, the logged-in password change
  (2026-08-29). New endpoint, no migration, release class B.** Filed by the FE
  agent in `backend-handoff.md`: a logged-in user had no way to change their
  password at all. Neither existing path could be widened —
  `PATCH /api/user/:id` whitelists `name`/`email`/`avatar` and its
  `Object.assign(user, dto)` + `save` would have written the password
  **unhashed**, breaking `bcrypt.compare` on the next login; `POST
  /api/user/reset-password` hashes correctly but demands a 6-digit emailed code,
  which is the wrong ceremony for someone who knows their old password.
  - **Contract:** `POST /api/user/change-password`, `JwtAuthGuard`,
    `@RateLimit({limit:5, ttl:60})`. Body `{currentPassword, newPassword}` —
    no email, no id; the cookie identifies the account. `201 {"success":true}`.
    `401` wrong `currentPassword` · `400` `newPassword` < 6 chars, equal to
    `currentPassword`, `null`, or an extra field (global
    `forbidNonWhitelisted`) · `429` rate limit (keyed `user:<id>`, so it is
    per-account, not per-IP).
  - **Files:** `libs/constant/message-pattern.constant.ts` (+`CHANGE_PASSWORD`),
    `libs/constant/response-message.constant.ts` (+2 messages),
    `apps/gateway/src/user/dto/user.dto.ts` (`ChangePasswordDto`),
    `apps/gateway/src/user/user.controller.ts`,
    `apps/gateway/src/user/user.service.ts`,
    `apps/user/src/user.controller.ts`, `apps/user/src/user.service.ts`.
  - **The two questions the FE asked, answered in code:** (1) the session is
    **not** touched — no rotation, no revocation. The JWT is stateless with no
    denylist, so issuing a fresh cookie would refresh only the calling device
    while every other one keeps its old token until expiry; that is a false
    "logged out everywhere", so it was left alone deliberately. FE keeps its
    assumption: no logout, no redirect. (2) `401` **is** kept for a wrong
    `currentPassword`, so FE's `skipUnauthorizedRedirect` stays; it is
    distinguishable from a session 401 by `message` only ("Current password is
    incorrect" vs the guard's "Access token is required" / "Unauthorized").
  - **One thing added beyond the request:** a successful change deletes the
    pending `user:pwreset:code:<id>` / `user:pwreset:attempts:<id>` Redis keys,
    so a reset code emailed minutes earlier cannot be replayed against the new
    password.
  - **Verified** (10 curl assertions, local gateway, account `chgpw_test`):
    `201 {"success":true}` happy path · `401 "Current password is incorrect"` ·
    `400` for a 3-char `newPassword`, for `newPassword === currentPassword`, for
    `currentPassword: null` (SHAPE-01 rule 3 — a 4xx, not a 500), and for an
    extra `confirmPassword` field · `429` on the 6th attempt in a minute ·
    `GET /api/user/me` still `200` on the SAME cookie after the change (session
    survives) · login with the old password `401`, with the new one `201`.

- **SCALE-06 — closed as WILL NOT DO (2026-08-29). No code change.** The
  remaining half was never code, it was measurement: re-run
  `scripts/load/baseline.mjs` behind nginx on the target VPS to attribute the
  SCALE-03 gains, and re-measure `GATEWAY_INSTANCES>1` there because the
  dev-machine cluster probe was noisy with no stable gain. Both require a bigger
  VPS and a paid Aiven tier; the user has decided the project stays on the free
  tier, so the evidence cannot be produced and the item is dropped rather than
  left open forever.
  - **Kept:** the runner itself (`scripts/load/baseline.mjs`, profiles
    `smoke|500|1k|5k`, scenarios S1–S5) and the 16 result files under
    `scripts/load/results/`. Still usable for local smoke runs; nothing was
    deleted.
  - **The numbers that stand as final** (post-SCALE-04, dev machine, in the
    script header): anon product list 798 req/s, product detail 1692 req/s,
    c=500 survives at ~3.6% error, authenticated ~102 req/s.
  - **The ceiling that matters:** Aiven free ≈ 76 connections ≈ 300 req/s
    across ALL ten services. Any "handles N concurrent" claim above that is
    unfounded for this deployment — the gate rule in the script header still
    applies to whatever is claimed.
  - Re-open only if the infrastructure budget changes.

- **BATCH-STATUS-01 — the batch product read no longer lets a keyword matcher
  guess a 404 out of an infrastructure failure (2026-08-28). Release class B, no
  migration.** Closes the `backend-handoff.md` hậu kiểm the FE filed on
  BATCH-FAIL-01: they confirmed the fix by reading the diff, and found one back
  door left open plus one wrong claim in my write-up.
  - **The back door.** `MicroserviceErrorHandler.extractStatusCode` infers a
    status from words in the error TEXT when the microservice declared none, and
    `"not found"` / `"does not exist"` map to **404**. The FE reads a 404 on this
    endpoint as "the whole batch is gone", fans out one call per id, watches
    every sub-call fail the same way, and `Promise.allSettled` filters them all —
    so a DB error whose text happens to contain those two words walked straight
    back to the empty list BATCH-FAIL-01 had just closed. Low probability
    (SHAPE-01 removed the product service's own 404 branch), but the same lie
    through a different door.
  - **Fix: `MicroserviceErrorOptions.guessStatusFromMessage`.** New optional 4th
    arg on `handleError`. When `false`, the status comes ONLY from what the
    failing side declared — a numeric `statusCode`/`status` or a known exception
    name — and anything undeclared becomes a `502` whose text is logged, not
    reported. `getProductsWithInventory` is the only call site that passes it;
    the default keeps all ~200 other call sites byte-identical. A declared
    business status (400/403/404 the product service really threw) still passes
    through untouched.
  - **Correction the FE was right about: a timeout is `408`, not `502`.** The
    BATCH-FAIL-01 entry generalized from the `kill PID 3006` case (ECONNREFUSED
    ⇒ `isTransportError` ⇒ 502) to "every failure ⇒ 502". An rxjs `TimeoutError`
    carries no `code` and its message matches none of the four constants in
    `transport-error.ts`, so it fell through to the keyword matcher and came out
    408. Still a real error, still catchable, goal still met — but the entry
    would have sent the next reader hunting for a 502 that was never logged. The
    entry is amended, and `"TimeoutError"` is now a **named** case in the
    declared-status switch (same 408, no longer an accident of wording — which
    is also what keeps a timeout from being flattened into 502 on the new
    strict branch).
  - **Not done, deliberately:** the strict mode was not swept across other call
    sites. Everywhere else the keyword guess is the best signal available and a
    wrong guess is merely imprecise; here it was actively harmful because the FE
    branches on the status. Turning other endpoints' 404s into 502s would be
    class C for no reported benefit.
  - **Verified:** `tsc --noEmit` clean, eslint clean, full `npx jest` 38 suites /
    **398** tests (3 new: a `"does not exist"` DB error ⇒ 502, a declared 400 ⇒
    400, a `TimeoutError` ⇒ 408). The failure branch cannot be induced against
    prod, so there is no live curl for it — the happy paths of the same endpoint
    were verified on prod after the 2026-08-28 deploy (1 live + 1 stale id →
    `200` with exactly 1 row).

- **ENRICH-FAIL-01 — a user-service outage no longer renders as "this shop does
  not exist" (2026-08-28). Release class B, no migration.** Closes the
  `backend-handoff.md` entry the FE filed 2026-08-27 after scanning
  `apps/gateway/src` for the BATCH-FAIL-01 class. The FE found exactly three
  sites where a gateway read downgraded a **microservice error** into data the
  client cannot tell apart from "there was never anything there". All three are
  now fixed — by removing the swallow, not by adding a flag.
  - **`social.service.ts` `fetchAuthorMap` — the worst of the three, and the one
    the FE could not see from outside.** It ended in a bare
    `catch { return new Map(); }` with **no log at all**. That is not a degraded
    embed: `exposeReferences` resolves EVERY user reference — `userId`,
    `actorId`, `reporterId`, `followerId`, `resolvedBy`, 16 keys — through this
    same map (`exposed[key] = summary?.id ?? null`), so an empty map nulled every
    user id in a `200` response. `getFollowers`/`getFollowing` drop the id key
    entirely and embed `user`, so an outage rendered a follower list where every
    row was `user: null`. It now warns and throws, which also makes it consistent
    with the post-id and comment-id legs of the same `Promise.all`, which never
    swallowed theirs.
  - **`product.service.ts` `enrichProductWithUserInfo` /
    `enrichProductsWithUserInfo`** dropped their inner `catchError(() => of(null))`
    / `of([])` and their outer `return product(s)`, and route the failure through
    `MicroserviceErrorHandler.handleError` instead. The batch variant is the one
    that mattered: one failed leg blanked the seller on the WHOLE list at once,
    which is never "each of these sellers happens to be deleted".
  - **Throwing costs no availability that was not already lost — and this
    corrects the FE's premise.** The FE assumed a user-service outage currently
    yields "Shop Official" on every card. It does not: every enrichment caller
    then runs `exposeProductReferences` → `exposeUserReferences`, which hits the
    SAME user service with no catch, so a real outage already answered 502.
    Verified by killing `dist/apps/user/main` — the pre-fix build 502'd too. The
    swallow only made the FLAKY case (one leg times out, the other does not)
    answer 200 with a silently missing seller, which is the harder bug to notice.
  - **The three FE asks, answered:** (1) "#3 must at least log" — done, it warns
    with the ids and the error; (2) "give us an `authorsUnavailable` /
    `sellersUnavailable` flag" — declined, an honest error status needs no new
    response field and no FE branch, and a flag would have to be threaded through
    every one of the 13 `fetchAuthorMap` call sites; (3) "consider actually
    throwing on #2" — accepted, and extended to #1 and #3 for the reasons above.
  - **A missing user is still `null`, and that is load-bearing.** Checked in
    `apps/user/src`: `getInfo` returns `null` for an unknown id and
    `getUsersByIds` filters the row — neither throws — so the catch branch is
    purely an infrastructure branch. Removing the swallow cannot turn "seller
    deleted" into a 404. `exposeSubmittedBy` keeps its catch on purpose
    (moderation-queue decoration, not the answer) and its test still passes.
  - **Verified live** (`tsc --noEmit` clean, eslint clean, jest 18/18 — 3 new
    tests in `product.service.spec.ts` + a new `social.service.spec.ts`): happy
    paths unchanged — `GET /api/products` 200 with `user`, `GET /api/products/:id`
    200, `POST /products/with-inventory/multiple` 200 (stale id still skipped),
    `GET /api/social/posts` + `/comments` 200 with `author`, `GET
    /api/products/wishlist` 200. With `dist/apps/user/main` killed, all three
    now answer `502 {"error":"Bad Gateway","message":"Service unavailable"}`
    where the social feed previously answered 200 with every `userId: null`.
    User service restarted and re-verified (login 201, `/api/user/me` 200).
  - **CI caught one stale assertion the targeted local run did not** (2026-08-28,
    commit `21ea1dc`): `social-comment-author.service.spec.ts` (SOCIAL-AUTHOR-01,
    `237f710`) encoded the OLD contract — "degrades to author:null when the user
    service is unreachable" — so reversing that contract turned it red. Split
    into two tests that keep the distinction explicit: an outage rejects with
    502, a commenter who no longer exists still renders `author: null`. Lesson
    for the next contract reversal: run the FULL `npx jest`, not the specs you
    touched — a deliberate behaviour change is exactly what an OLDER spec is
    most likely to assert the opposite of. Full suite now 38/38, 395 tests.
  - Residual recorded in `snapshot.md` Known Issues: a social **write** exposed
    through `exposeReferences` now 502s on a user-service outage even though the
    write committed — pre-existing for the post-id leg, accepted for this one.
  - FE-facing note in `frontend-handoff.md`: the fabricated `'Shop Official'`
    fallback (`ProductDetail.tsx:118`, `useProducts.ts:30`) can go — a blank
    seller now means the seller is genuinely gone.

- **BATCH-FAIL-01 — a product-service outage no longer answers "your cart is
  empty" (2026-08-27). Release class B, no migration.** Closes the
  `backend-handoff.md` entry the FE filed the same day, which itself came out of
  correction #1 in the SHAPE-01 hậu kiểm: the gateway's batch product read wrapped
  its TCP call in `.catch(() => [])`, so **every** product-service failure —
  process down, timeout, DB error, a new 500 — reached the client as `200` with
  `data: []`. To a buyer, an infrastructure incident rendered as an empty cart:
  not an error, but a false statement about their own data, and nothing for the
  FE to `catch`.
  - **The fix is one leg, not both.** `getProductsWithInventory`
    (`apps/gateway/src/product/product.service.ts`) now routes the product call
    through `MicroserviceErrorHandler.handleError(...)` like every other gateway
    read, so an outage surfaces as `502 {"statusCode":502,"error":"Bad
    Gateway","message":"Service unavailable"}` — but do NOT go looking for a 502
    for every failure: a **timeout** answers `408` (correction from the FE's hậu
    kiểm, see BATCH-STATUS-01 above; rxjs `TimeoutError` is not a transport
    error). The **inventory** call keeps its
    `.catch(() => [])` on purpose — SHAPE-01 rule 1: the product rows are the
    answer, stock is an enrichment, and `inventory: null` is already a declared
    part of the shape. Degrading there loses nothing the caller can't branch on;
    degrading on the product leg destroys the answer itself.
  - **Why this is the load-bearing half of SHAPE-01 rule 4.** "A batch read
    skips an id that no longer resolves" is only safe while an empty answer
    means *the catalog says these are gone*. While any failure could also
    produce `[]`, the two were indistinguishable and the rule had no ground to
    stand on. `61670ff` made the product service partial-tolerant; this makes
    the gateway honest about the difference between "gone" and "unreachable".
  - **A latent raw-500 closed on the way past.** The `Array.isArray(products)`
    guard sat *below* a `products.map(...)`, so a malformed batch response threw
    a `TypeError` into the outer catch and came back as an unmapped 500. The
    normalization now happens once, before anything indexes into the list. Same
    change skips a pointless inventory round-trip when nothing resolved.
  - **Verified live** (`tsc --noEmit` clean, eslint clean, jest 11/11 including
    4 new failure-mode tests in `product.service.spec.ts`): happy path `200` /
    2 items; 1 live + 1 stale id → `200` / 1 item; all ids stale → `200` `[]`;
    **product service killed → `502`**, where the pre-fix build answered
    `200 []`. The kill test also confirmed inventory is never asked when the
    product leg fails.
  - **Deliberately NOT done:** sorting the response into request order. All four
    FE consumers key by id (the FE checked and said so explicitly in the same
    entry), so the endpoint still answers in DB order — `findProductsByIds` is a
    bare `IN` with no `ORDER BY`. Documented, not silently changed.
  - FE-facing note in `frontend-handoff.md`; the FE's `fetchBatchTolerant`
    trigger-2 rationale changes as a result — an empty array is now the
    catalog's honest answer and no longer needs a verification fan-out.

- **SHAPE-01 hậu kiểm — the FE read the diff, and both of its two asks were
  real (2026-08-27). Release class B, no migration.** Closes the
  `backend-handoff.md` entry the FE filed after reviewing the uncommitted
  SHAPE-01 working tree. Two code fixes, one latent defect of the same class
  found by re-reading my own diff, and three documentation claims corrected
  after being measured instead of assumed.
  - **The empty-cart shape was one endpoint with two key sets — the thing rule 2
    bans.** A real cart carries `createdAt`/`updatedAt`; the empty shape omitted
    them ("the row does not exist yet"). `EmptyCart` now declares
    `createdAt: null` and `updatedAt: null`, so `GET /api/cart` answers the same
    five keys either way. Verified: empty →
    `{"id":null,"userId":"usr_…","createdAt":null,"updatedAt":null,"items":[]}`,
    populated → the same keys with real values.
  - **`CartService.addItem` still had the null hole SHAPE-01 exists to close.**
    It ended with `findOne(...) as Promise<Cart>` — a cast, not a guarantee. If
    a concurrent clear/remove-last-item deletes the row between the write and
    the re-read, that resolves `null` and `POST /api/cart` answers `data: null`,
    the exact crash shape fixed on the read path. Now returns
    `Cart | EmptyCart` via the shared `emptyCart()` helper. Found by re-reading
    the diff's neighbourhood, not by the self-test — the race is not reachable
    from a single-client curl.
  - **`resolveProductIds` order is now part of the contract.** The first cut
    partitioned numeric/public ids and appended the DB's row order, so the
    result no longer followed the input. Harmless today (the one caller keys by
    id) and a trap for the next one. It now resolves public ids through a
    `Map` and rebuilds the list in INPUT order. Measured consequence, stated so
    nobody re-derives it: the *endpoint* still answers in DB order, because
    `findProductsByIds` is a bare `IN` with no `ORDER BY` — requesting
    `[charger, earbuds, redmi]` returns `[redmi, earbuds, charger]`. Documented
    on both functions rather than silently sorted at the gateway.
  - **Three claims corrected in the SHAPE-01 entry above and in both handoff
    files.** (1) The pre-fix batch failure was **`200` with `data: []`**, not a
    404 — proved by stashing the fix and re-polling; the product service's 404
    was swallowed by the gateway's pre-existing `.catch()` that degrades to an
    empty list, which is *worse* than a 404 because the FE had no error to
    catch. (2) A **malformed** `prod_` id was never part of what the fix
    changed: `@IsPublicId(…, {each:true})` 400s it at the gateway DTO
    (`"productIds must match prod_<16 alphanumeric characters>"`). Only
    well-formed-but-unknown ids are skipped. (3) "`resolveProductIds` has
    exactly one caller" was true of the method but not of the pattern —
    `PRODUCT_FIND_BY_IDS` has 7 call sites, six of which pass `Number(...)`-ed
    ids and take the numeric path.
  - **FE confirmations accepted, no work:** the inventory/address
    `@IsOptionalNotNull()` tightening is zero-impact (the FE has no inventory
    write path, and the address form never sends `null`), and
    `EmptyCart.userId: number` does not leak an internal id — the gateway's
    `exposeUserIds` maps both cart branches, confirmed live (`usr_…` on the
    empty shape).
  - **Verified live on localhost:3000** (admin account): empty cart key-set,
    add-item → 201 with matching keys, remove-last-item → empty shape again;
    batch 1 live + 1 well-formed-dead → **200** with just the live row, all-dead
    → **200 `[]`**, malformed → **400**; `GET /api/products/:id/stock-check` →
    200 (a second `PRODUCT_FIND_BY_IDS` consumer, unaffected). `tsc --noEmit`
    clean, eslint clean.

- **SHAPE-01 — data-shape hygiene at the response/request boundary
  (2026-08-26). Release class B, no migration.** Answers the FE's four
  commitments filed in `backend-handoff.md` ("6 dạng response đã làm FE trắng
  trang"). Three of the four asks were accepted as stated, one was accepted only
  in half; the durable half of the work is the rule now living in
  `conventions.md` → **Backend: Data-Shape Hygiene**, which is auto-loaded every
  session so the next endpoint does not re-create the class.
  - **Ask 1 — a collection is never `null`. ACCEPTED for arrays, DECLINED for
    the "empty object ⇒ `{}`" half.** `GET /api/cart` answered `data: null`
    after the last item was removed, because `removeItem`/`updateItem` delete
    the cart row when it empties — so `data.items.length` was a TypeError for
    any caller that did not guard. `CartService.getCart`
    (`apps/orders/src/cart.service.ts`) now returns `cart ?? { id: null, userId,
    items: [] }` (exported `EmptyCart` interface; `id` is null while no row
    exists, and the non-empty response is unchanged). The object half is
    declined on purpose: this codebase uses `null` for a missing single relation
    (`inventory: null`, `brand: null`, `author: null`), and `{}` makes "absent"
    indistinguishable from "present but blank" while `{}.name` is `undefined`,
    which renders empty instead of tripping the caller's guard. Ask 2 covers
    that case correctly instead.
  - **Ask 2 — `required` never means `null`; nullability is declared up front.
    ACCEPTED as a rule, no code change.** It is already the release-gate
    process: re-typing or removing a shipped response field (number ⇔ string id
    included) is class **C** and holds in `../.agent-local/release-gate.md`;
    adding an optional field is class B. Written down in `conventions.md` so it
    is not re-litigated per endpoint.
  - **Ask 3 — bad input is a 4xx, never a 500. ACCEPTED, applied where `null`
    provably 500s today.** Same `@IsOptional()` trap as VOUCHER-NULL-01, so the
    primitive already existed: `@IsOptionalNotNull()`. Swapped in
    `UpdateUserAddressDto` (all 10 fields — every column on `user_addresses` is
    NOT NULL and `updateAddress` does `Object.assign(address, dto)`),
    `UpdateInventoryDto` (`sku`, `availableStock`, `reservedStock`,
    `minimumStock`, `isActive`; `location` is the only nullable column and stays
    `@IsOptional()`), and `CreateInventoryDto.minimumStock` (NOT NULL with a DB
    default — `repository.create()` inserts an explicit `null` rather than
    falling back to the default). **A blanket sweep was declined**: ~140
    `@IsOptional()` fields across 31 gateway DTO files are declared non-nullable,
    and tightening one that currently answers 200 turns a succeeding call into a
    400 — class C, for no reported benefit.
  - **Ask 4 — batch endpoints are partial-tolerant. ACCEPTED for READS,
    qualified for WRITES.** `resolveProductIds`
    (`apps/product/src/product.service.ts`) was
    `Promise.all(ids.map(resolveProductId))`, and the singular resolver throws
    `NotFoundException` on an unknown or malformed public id — so one product
    deleted after the client cached its id blanked the entire
    `POST /api/products/with-inventory/multiple` response and the FE got nothing
    instead of the rows that still exist. **Measured, not assumed (hậu kiểm
    2026-08-26): the old failure was `200` with `data: []`, NOT a 404** — the
    thrown 404 was swallowed by the pre-existing `.catch()` in
    `getProductsWithInventory` (`apps/gateway/src/product/product.service.ts`)
    that degrades a product-service failure to an empty list. Worse than a 404
    for the caller, since there was no error to catch. It now partitions numeric vs public
    ids, resolves the public half in **one `IN` query** (was N queries), and
    skips what does not resolve — matching `findProductsByIds`, which already
    dropped missing numeric ids. Batch WRITES deliberately stay all-or-nothing
    with a 400 naming the offending ids: silent partial success on a write is
    worse than a clean failure, because the caller cannot tell what landed and a
    retry double-applies the half that did.
  - **Change-impact review caught one class-C regression before it shipped.**
    `CreateUserAddressDto.isDefault` was tightened in the first pass, but
    `createAddress` computes the flag (`existingCount === 0 || dto.isDefault ===
    true`) and overwrites whatever arrives, so `isDefault: null` had always
    answered **201**. Reverted to `@IsOptional()` with the reason in-file — same
    create-vs-update asymmetry as VOUCHER-NULL-01. Blast radius otherwise clear:
    `resolveProductIds` has exactly one caller (`PRODUCT_FIND_BY_IDS` →
    `findProductsByIds`, which looks up by `IN` and is order-independent, so the
    new result ordering is inert), and `CartService.getCart` has exactly one
    consumer (gateway `exposeProductIds`, which handles the empty shape).
    **Re-checked in hậu kiểm and stated more precisely:** the *pattern*
    `PRODUCT_FIND_BY_IDS` has **7 call sites**, not one — `cart/cart.service.ts:104`,
    `inventory/inventory.service.ts:78` and `:273`, `order/order.service.ts:1915`,
    `product/product.service.ts:324` and `:1477`, plus the product controller. Six
    of them pass ids they already coerced with `Number(...)`, so they take the
    numeric fast path and cannot observe the change; only the gateway batch route
    (`:1477`) sends `prod_` strings. The "one caller" claim was true of the
    *method*, not of the pattern.
  - **Verified live on localhost:3000** (admin account): `PATCH
    /api/user/me/addresses/:id {"recipientName":null}` → **400** naming the field
    (was 500); `PUT /api/inventory/9 {"availableStock":null}` → **400** (was
    500) while `{"location":null}` still → **200** (nullable carve-out intact);
    `POST /api/products/with-inventory/multiple` with one live + one dead
    `prod_` id → **200** returning just the live product, all-dead → **200
    `[]`** (before the fix the same request answered **200 with `data: []`** —
    measured by stashing the fix and re-polling, so the live row was being
    silently dropped, not 404'd); `GET /api/cart` with no cart row → **200
    `{"id":null,"userId":"usr_…","items":[]}`** (was `data: null`), and the
    non-empty cart response is byte-identical to before; `POST
    /api/user/me/addresses {"isDefault":null}` → **201** (regression leg, after
    the revert). `tsc --noEmit` clean, eslint clean.

- **VOUCHER-NULL-01 — a `null` on a voucher edit is a 400, not a 500
  (2026-08-26). Release class B, no migration.** Closes the voucher entry the FE
  filed in `backend-handoff.md`: `PATCH /api/order/admin/vouchers/:id` with
  `{"minOrderAmount": null}` answered `500 Internal Server Error` with nothing
  the caller could act on. The FE had already shipped a mitigation
  (`diffMinOrderAmount()` in `frontend/src/features/admin/voucherAdmin.ts` never
  sends `null`), so this is pure robustness for any other client.
  - **Root cause was at the pipe, not in the service.** class-validator's
    `@IsOptional()` skips every other validator when the value is `undefined`
    **or `null`**, so `null` passed the gateway `ValidationPipe` untouched. It
    then surfaced three different ways: percent voucher →
    `input.minOrderAmount.toFixed(2)` → `TypeError` → 500; **fixed** voucher →
    the VOUCHER-GUARD-01 comparison coerced `null` to 0 and returned a
    *misleading* 400 `FIXED_VALUE_EXCEEDS_MIN_ORDER`; `isActive: null` → NOT
    NULL column → driver error → 500. One honest 400 now covers all three.
  - **The fix is one small decorator, reusable.**
    `@IsOptionalNotNull()` (`apps/gateway/src/common/validators/is-optional-not-null.validator.ts`)
    is `ValidateIf((_, value) => value !== undefined)` — identical to
    `@IsOptional()` on `undefined`, but `null` falls through to
    `@IsNumber()`/`@IsBoolean()` and produces a validation message. Applied to
    exactly the two `UpdateVoucherDto` fields backed by NOT NULL columns
    (`minOrderAmount`, `isActive`); the other six stay `@IsOptional()` because
    `null` there genuinely means "clear it". No service change — the orders
    input type already says `number | undefined`, and the gateway is its only
    caller.
  - **`CreateVoucherDto` deliberately untouched** — `createVoucher` coerces with
    `?? 0` / `?? true`, so a `null` there is a harmless 201. Tightening it would
    flip a succeeding call to a 400 (class C) for no reported benefit. See
    `known-behaviors.md` → VOUCHER-NULL-01.
  - **Verified live on localhost:3000**, admin + shop routes: the reported bug
    `{"minOrderAmount":null}` → **400** `"minOrderAmount must not be less than
    0, minOrderAmount must be a number — send 0 to remove the threshold, not
    null"` (was 500); `{"isActive":null}` → **400** `"isActive must be a boolean
    — true or false, not null"`; regression legs all unchanged —
    `{"minOrderAmount":0}` → 200, `{"isActive":false}` → 200, all six nullables
    to `null` + reactivate → 200, `{}` → 200 no-op, string-for-number still 400,
    `POST` with `minOrderAmount:null` still **201** (coerced to 0). Unit tests:
    `apps/gateway/src/common/validators` 2 suites / 14 tests green;
    `orders.service.spec.ts -t "oucher"` 31 passed.

- **GHN-WARD-01 — stop offering wards GHN refuses to deliver to (2026-08-26).
  Release class B, no migration.** Closes the first half of PRODTEST-0806 defect
  #3, which the prod voucher sweep re-opened: of the 19 wards
  `GET /api/shipping/wards?districtId=1450` returned for Quận 8, only 7 could
  actually be quoted, so the storefront dropdown could hand a buyer an address
  that 400s at checkout with a Vietnamese GHN message and no way to tell which
  ward was at fault.
  - **The signal was already in the payload.** Vietnam's 2025 ward merger left
    GHN's master data carrying both generations: the merged wards `910374`
    (Xóm Củi), `910375` (Hưng Phú), `910376` (Rạch Ông) come back with
    `Status: 3, SupportType: 0` while every legacy ward is `Status: 1,
    SupportType: 3`. We were discarding both fields. `GhnWard.Status?: number`
    (optional — only `/master-data/ward` carries it) plus
    `GhnService.isDeliverableWard()` is the whole fix; no preview probe, no
    cache, no extra GHN call, and the 24h master-data cache is untouched.
  - **Three call sites, three different treatments — deliberate.**
    `listWards()` filters (the dropdown must not offer a dead ward);
    `resolveAddressToGhnIds()` filters its candidate list (resolving free text
    onto a retired ward would just hand back an id that fails later);
    `assertLocationExists()` still matches against the RAW list, so it can tell
    "not in this district" apart from "retired" and throw the new
    `GHN_MESSAGE.WARD_INACTIVE` instead of the misleading `WARD_NOT_IN_DISTRICT`.
    That branch is reachable via an address saved before the ward was retired,
    since the dropdown no longer offers one.
  - **Fail-open on a missing field:** if GHN ever stops sending `Status`, every
    ward is kept. Emptying a district's dropdown is worse than showing one bad
    ward.
  - **Verified locally** (all four legs, dev GHN sandbox): wards for 1450 → 16
    rows, no `9103xx`; `POST /api/order/shipping-fee` with ward `910376` → 400
    "GHN no longer delivers to ward 910376"; ward `20816` → 201 with an ETA;
    ward `1A0807` (district 1490) → 400 `WARD_NOT_IN_DISTRICT` (unchanged);
    free-text "Phuong 16, Quan 8" → 201; free-text "Phuong Rach Ong, Quan 8" →
    400 `ADDRESS_UNRESOLVED`; `POST /api/order` on ward `910376` → 400 with no
    order created (GHN-CREATE-01 propagation intact).
  - **NOT fixed, and not ours:** the other nine failing wards (`20801`-`20803`,
    `20808`-`20813`) answer `Lỗi hệ thống - không lấy được thông tin kho` while
    being `Status: 1` — indistinguishable from a good ward in master data. See
    GHN-MSG-01 below for what was done about them instead, and
    `known-behaviors.md` for the evidence that they are GHN's problem.

- **GHN-MSG-01 — an unserviceable destination no longer surfaces as GHN's
  internal system error (2026-08-26). Release class B, no migration.** The nine
  wards GHN-WARD-01 could not filter answer `GHN preview error: Lỗi hệ thống -
  không lấy được thông tin kho`. A buyer picking one at checkout reads that as
  OUR site being broken, and it names nothing they can act on.
  - **Re-probed before deciding, and the earlier "sandbox coverage gap" reading
    was only half right.** Prod and local both point at
    `dev-online-gateway.ghn.vn` shop `200481` (the `shippingFee: 0` on every
    quote is that gateway's signature), so this hits REAL prod buyers today —
    12 of 19 Quận 8 wards cannot be ordered to. What is dev-only is GHN's side:
    the shop's demo warehouse, not our code.
  - **Everything that could have been our bug was ruled out** by calling GHN
    directly: `service_type_id` 2 and 5, an explicit `from_district_id`/
    `from_ward_code`, and a 5kg parcel all fail identically, while the shop
    record itself is `status: 1` and `available-services` offers both services
    for the lane. `/shipping-order/fee` and `/leadtime` DO answer 200 for those
    wards — tempting, but `/shipping-order/create` fails with the same warehouse
    error, so quoting from `/fee` would book an order GHN cannot turn into a
    waybill. That is exactly the failure GHN-CREATE-01 exists to prevent, so the
    400 stays.
  - **What changed:** `GhnService.toGhnDomainError()` classifies GHN's own
    wording and returns the stable `GHN_MESSAGE.DESTINATION_NOT_SERVICEABLE`
    instead of echoing it. Signatures are deliberately narrow —
    `"không lấy được thông tin kho"` and `"người nhận không còn hoạt động"`, not
    a bare `"không còn hoạt động"`, because the same function serves the admin
    waybill actions and would otherwise swallow an order-state refusal.
  - **Order of checks matters:** the outage branch runs FIRST, so an unreachable
    GHN stays a 503 whatever text it echoed. Collapsing it into a 400 would send
    a buyer off to edit an address that was never the problem.
  - The raw GHN wording is logged at `warn` before it is dropped — it is the only
    clue to which destination rule GHN applied.
  - **Verified locally, 6 legs:** good ward → 201; warehouse-gap ward `20801` →
    400 with the new message; retired ward `910376` → still 400
    `WARD_INACTIVE` (our own earlier guard, unaffected); ward of another
    district → 400 `WARD_NOT_IN_DISTRICT`; unknown district → 400
    `DISTRICT_NOT_FOUND`; and a NON-destination GHN refusal (invalid phone)
    still passes GHN's own text through unchanged — proof the mapping does not
    over-swallow.

- **VOUCHER-CANCEL-01 — cancelling an order gives the voucher redemption back
  (2026-08-26). Release class A, no migration.** Found during the prod voucher
  sweep: `releaseVoucherQuota()` only ran when the checkout itself failed, so
  the `voucher_redemptions` row and `used_count` outlived every cancellation.
  A buyer who placed and cancelled twice on a `perUserLimit: 2` code was locked
  out of it forever, and each cancelled order permanently burned one of
  `usage_limit` — verified live on prod, where 3 cancelled orders had left
  `used_count` at 2 and 1.
  - **`OrdersService.releaseVoucherRedemption(order)`** deletes the redemption
    row, decrements `used_count` with `GREATEST(used_count - 1, 0)` in one
    transaction, then drops the VOUCHER-CONC-01 Redis quota key so the next
    claim re-seeds instead of enforcing the stale cap for up to 300s.
  - **The DELETE's `affected` count is the concurrency guard** — no new column,
    no Redis key, no status check. Two racing cancels both read the row but only
    one delete reports `affected: 1`, so `used_count` cannot be decremented
    twice for one order, and a redelivered GHN cancel webhook arriving after a
    buyer cancel is a no-op for the same reason.
  - **Wired into all three cancellation paths:** `finalizeCancellation` (buyer
    cancel + the hourly stale-reservation sweep), `finalizeGhnCancellation`
    (GHN cancel/return, webhook + manual sync + demo-status), and
    `cancelOrderAfterPaymentInitializationFailure` — the last of which also
    closes the previously-recorded residual "a payment-init failure after commit
    cancels the order but does NOT give the redemption back".
  - **Non-fatal by design:** a cancel must not fail because voucher bookkeeping
    did. On error it logs and the counter stays pessimistically high, which is
    the state VOUCHER-CONC-01 already tolerates.
  - **Verified locally end-to-end** on a platform voucher (`usageLimit: 2`,
    `perUserLimit: 1`): order → `usedCount 1`; second order → 400 "already used
    the maximum number of times"; cancel → `usedCount 0`; re-cancel → 400 "Order
    cannot be canceled" and `usedCount` still 0 (no double-decrement); re-order
    with the same code → 201 with the discount applied, `usedCount 1` again.

- **Released to production 2026-08-26 (`ccb8f9a..e10506f`)** — VOUCHER-SHOP-01
  phase 1, VOUCHER-GUARD-01 and VOUCHER-EDIT-01, all release class B. The CD run
  applied both owed voucher migrations (`nodeA-20260818-001-add-voucher-indexes`,
  `nodeA-20260825-001-add-voucher-seller-id`) before restarting pm2; the indexes
  one ABORTS on duplicates, so its exiting 0 also proves prod held no duplicate
  `vouchers.code` and no duplicate `(voucher_id, order_id)`. Verified live on
  prod as `shop1`: `GET /api/order/vouchers/mine` → 200 (empty, and a
  `seller_id` filter would have 500'd on a missing column); `POST
  /api/order/vouchers/available` for a 498,000₫ basket returns the seeded
  `TRYBUY10` with `sellerId: null`, `scope: "platform"`, `isEligible: true`,
  `discountAmount: 49800` (10%, under the 50,000₫ cap) — i.e. pre-existing rows
  behave exactly as before the column was added. Both negative paths confirmed
  on prod without writing any row: a fixed voucher with `discountValue ==
  minOrderAmount` → 400 `FIXED_VALUE_EXCEEDS_MIN_ORDER`, and a shop passing an
  explicit `sellerId` → 400 `SELLER_NOT_ASSIGNABLE`. Note for a future session:
  on the shop route a *numeric* `sellerId` is rejected earlier, by the `usr_`
  public-id validator, so the message differs from the one above — both are 400.

- **VOUCHER-EDIT-01 — a voucher can be edited, and a deactivated one switched
  back on (2026-08-26). Release class B, no migration.** Closes the last **Open**
  entry in `backend-handoff.md` (2026-08-18, "voucher admin: không có route sửa
  và không có route bật lại"): `deactivate` was one-way and nothing was mutable,
  so a wrong `expiresAt` meant burning the code and reissuing.
  - **Routes:** `PATCH /api/order/vouchers/:id` (`@CheckPermission("voucher",
    "update:own")`, scoped to the caller's own vouchers) and `PATCH
    /api/order/admin/vouchers/:id` (`@CheckPermission("order", "update:any")`,
    any voucher). Numeric id — vouchers are deliberately not a PUBID domain.
    New TCP pattern `ORDER_MESSAGE_PATTERN.VOUCHER_UPDATE = "order.voucher_update"`;
    both routes funnel into one `OrdersService.updateVoucher(id, changes,
    sellerId)`, where a non-null `sellerId` is what makes the shop route
    ownership-checked — so admin and shop cannot drift apart in behaviour.
  - **Immutable by omission, not by guard:** `code`, `discountType` and
    `discountValue` are simply absent from `UpdateVoucherDto`, so the gateway's
    `forbidNonWhitelisted` 400s them ("property discountValue should not exist")
    before the orders service is reached. A `VOUCHER_MESSAGE.IMMUTABLE_FIELDS`
    constant was written and then deleted for exactly this reason — it was
    unreachable. Rationale: orders already priced against a voucher cannot be
    re-priced; changing the money is a deactivate-and-reissue.
  - **Loosen-only once redeemed.** With `usedCount > 0`, raising
    `minOrderAmount` or tightening any of `maxDiscountAmount` / `usageLimit` /
    `perUserLimit` is a 400 (`CANNOT_TIGHTEN_AFTER_USE`); loosening or clearing
    to `null` is always allowed, and an unredeemed voucher edits freely in either
    direction. "Tighter" for a nullable cap is decided by the module-level
    `isStricterCap(current, next)` where `null` means no limit — introducing a
    limit that did not exist counts as tightening. Independent of redemptions,
    `usageLimit < usedCount` is always a 400 (it would make `used_count >
    usage_limit`, which is simply incoherent).
  - **VOUCHER-GUARD-01 re-checked against the merged state**, not just at
    creation: lowering an existing FIXED voucher's `minOrderAmount` below its own
    `discountValue` re-opens the exact footgun `createVoucher` closes, so it 400s
    the same way.
  - **Redis quota coherence:** changing `usageLimit` deletes
    `voucher:quota:<id>` so the next claim re-seeds from SQL, instead of the
    VOUCHER-CONC-01 mirror enforcing the OLD cap for up to its 300s TTL. Guarded
    by an `isUsageLimitChanged` check (a description-only edit leaves the counter
    alone — verified) and wrapped in try/catch: a Redis failure warns and lets
    the counter self-heal on expiry rather than failing the edit.
  - **`sellerId: null` on create fixed in the same pass.** An admin form leaving
    the shop field empty sent `"sellerId": null`, and the gateway passed it to
    `resolveUserId()` → `404 "User not found"`. `null` now means what it reads
    as (no owner ⇒ platform voucher). Probed while writing the FE handoff: every
    OTHER optional create field already accepted `null` — `@IsOptional()` skips
    both `undefined` and `null` — so the FE's long-standing belief that "optional
    fields must be absent on create" came from this single field and was wrong
    in general. Corrected in `backend-handoff.md` rather than left standing.
  - **Self-tested** on local dev with real accounts (admin / shop / buyer), 14
    cases: happy-path edit, immutable-field 400 naming both properties,
    deactivate→reactivate, the FIXED-vs-threshold guard both directions, three
    tightening refusals + one loosening success, cross-shop 403 (no code echoed),
    404 unknown id, 400 non-numeric id, 403 buyer role on both routes, the two
    Redis-key assertions, and a read-back through the APPLY path proving an
    edited cap really changes `discountAmount` and that clearing `expiresAt`
    makes an expired voucher usable again.
  - **Unit tests:** +12 in `apps/orders/src/orders.service.spec.ts`
    (`VOUCHER-EDIT-01` describe) covering partial edit, `null` clearing,
    reactivate, cross-shop 403, three tightening refusals, a loosening success,
    `usageLimit < usedCount`, the re-checked FIXED guard, and all three
    quota-mirror cases (dropped / untouched / Redis failure survived). Suite:
    92 passed.
  - **Residual (in snapshot Known Issues):** a loosening edit on a redeemed
    voucher is not reversible through the API, since the reverse is a tightening.
  - Files: `apps/gateway/src/order/{order.controller.ts,order.service.ts,
    dto/voucher.dto.ts}`, `apps/orders/src/{orders.controller.ts,
    orders.service.ts}`, `libs/constant/{message-pattern,response-message}.constant.ts`.

- **VOUCHER-SHOP-01 phase 1 + VOUCHER-GUARD-01 — per-shop vouchers, basket
  eligibility list, and a fixed-value sanity guard (2026-08-25). Release class
  B.** Implemented from the design settled in snapshot.md (owner = both shop and
  admin; Shopee threshold semantics; list shows ineligible vouchers greyed out
  but still rejects them on apply). One additive migration,
  `nodeA-20260825-001-add-voucher-seller-id` — applied on DEV, **owed on prod**.
  - **Schema:** `vouchers.seller_id INT NULL DEFAULT NULL` (`NULL` = platform
    voucher, set = that shop's) + `idx_vouchers_seller_active
    (seller_id, is_active)`, which is what the basket list query needs
    ("platform vouchers + the vouchers of the sellers in this cart") on every
    checkout page view. INT to match `users.id`; no FK, deliberately — orders
    and user are separate services on the same MySQL and the codebase does not
    cross-service FK anywhere else.
  - **One rules engine, not two.** The stated trap in the design note was list
    and checkout drifting apart. Closed by extracting a pure, non-throwing
    `evaluateVoucher(voucher, context) → {isEligible, reason, discountAmount,
    amountToAdd}` in `apps/orders/src/orders.service.ts`. The list maps it
    straight to the response; `validateVoucherForCheckout` became "call it, then
    `voucherRejection()` maps the reason to the right exception". Runtime-proved
    symmetric: the same code the list flags `MIN_ORDER_NOT_MET` 400s on apply.
  - **Scope pricing (the Shopee mapping):** a shop voucher is priced against
    that seller's subtotal slice only — `min_order_amount` and
    `max_discount_amount` both apply to the slice — while a platform voucher
    keeps today's whole-goods-subtotal behaviour.
    `buildSubtotalBySellerId()` computes the slices once per request.
  - **New endpoints.** `POST /api/order/vouchers/available` (JwtAuthGuard, TCP
    `order.voucher_available`) takes the cart items, re-prices them through the
    existing `enrichOrderItems()` so the client cannot lie about prices, and
    returns each voucher with `{code, description, discountType, discountValue,
    minOrderAmount, maxDiscountAmount, sellerId, scope, isEligible,
    ineligibleReason, amountToAdd, discountAmount}`. `ineligibleReason` is a
    stable enum-ish string (`VOUCHER_INELIGIBLE_REASON` in
    `libs/constant/response-message.constant.ts`) — FE renders the copy, the
    backend sends no prose. Shop-facing CRUD: `POST /api/order/vouchers`,
    `GET /api/order/vouchers/mine`, `PATCH /api/order/vouchers/:id/deactivate`.
  - **RBAC:** new `voucher` resource in `apps/user/src/rbac/grants.ts` (shop
    `create/read/update:own`, admin `*:any`) rather than widening `order` —
    `shop` deliberately still has no `order: create:any`.
  - **PUBID:** `sellerId` crosses HTTP as `usr_…` in both directions —
    `resolveUserId()` inbound, `exposeUserReferences()` on every voucher
    response. A bogus owner id is a clean `404 User not found`; the id is only
    checked to exist, not to be a `shop`-role user (see snapshot Known Issues).
  - **VOUCHER-GUARD-01:** `createVoucher` now rejects a FIXED voucher whose
    `discountValue >= minOrderAmount` (and `<= 0`), closing the
    `fixed 500000 / minOrderAmount 0` footgun where `computeDiscount`'s
    `Math.min(discount, itemsTotal)` clamped every basket to zero goods cost.
    This TIGHTENS an admin-only endpoint that previously accepted the input —
    the batch stays class B because no FE change could make that 400 land any
    better (the remedy is an admin typing a different number, and the admin UI
    already renders the sibling `PERCENT_VALUE_INVALID` / `FIXED_VALUE_INVALID`
    400s).
  - **Leak found and fixed during self-test:** a shop deactivating someone
    else's voucher got `403 "Voucher SWEEPOTHER01 belongs to another shop"` —
    walking numeric voucher ids would have harvested platform and rival shop
    codes. `NOT_OWNED_BY_SELLER` is now a code-free constant.
  - **N+1 avoided:** per-user redemption counts come from ONE grouped
    QueryBuilder over `voucher_redemptions`, run only when some voucher in the
    list actually has a `perUserLimit`, and skipped entirely otherwise.
  - **Self-tested end to end on dev** (accounts from `test-accounts.md`): shop
    create → 201 with `sellerId:"usr_…"`; shop supplying a `sellerId` → 400
    `SELLER_NOT_ASSIGNABLE`; guard → 400; admin platform create → 201
    `sellerId:null`; admin create-for-shop → 201; multi-seller basket
    (`itemsTotal 35980`) → platform 3598, shop A 3196 on its 15980 slice, shop B
    2000 on its 20000 slice, plus `MIN_ORDER_NOT_MET` with
    `amountToAdd 4964020`; single-seller list excludes other shops; empty basket
    → platform-only, no crash; `USER_LIMIT_REACHED` / `FULLY_REDEEMED` both
    reproduced against real redemption rows; cross-shop deactivate → 403, own →
    200 and it drops out of the list; buyer and shop both 403 on the admin
    route; a real checkout with a shop voucher (`ord_lkKfhejmVcGGxM60`,
    discount 1598, `usedCount` → 1) then cancelled to release stock. Every
    pre-existing voucher row reports `scope:"platform"`, confirming the
    `?? null` normalization on legacy rows. `tsc --noEmit` clean, orders spec
    80/80 (13 new tests).

- **REPORT-TOTAL-01 — `total` on the moderation queue counted reports whose
  post no longer exists (2026-08-21). Release class B.** From the FE inbox
  (`backend-handoff.md`, 2026-08-21): on prod
  `GET /api/social/admin/reports?status=resolved` returned
  `{data: [], total: 1}`. The FE guessed `total` was being counted without the
  `status` filter — **that guess was wrong**, and checking it first is what
  found the real cause. Both query builders in
  `SocialService.listReportedPosts` (`apps/social/src/social.service.ts:878`,
  `:883`) have filtered by `status` since the moderation feature shipped
  (`f5d6400`, 2026-07-08).
  - **Real cause: orphaned report rows.** `deletePost`
    (`social.service.ts:559`) hard-removes the post via `postRepository.remove`
    and never touches `post_reports`; there is no FK and no cascade
    (`post-report.entity.ts` carries a plain `post_id` int). So a report can
    outlive its post. `total` was `COUNT(DISTINCT report.postId)` straight off
    `post_reports` and counted those orphans, while `data` dropped them in the
    `if (!post) return null` guard after the posts were fetched. Two different
    row sets, one of them reported as the size of the other.
  - **Fix:** both `groupedQb` and `totalQb` now
    `.innerJoin(Post, "post", "post.id = report.postId")`. `posts.id` is the PK
    so at most one row matches — `COUNT(report.id)` per group and
    `COUNT(DISTINCT report.postId)` are unaffected. The `if (!post)` guard stays
    as a type guard for the `Map.get()` and against a delete racing between the
    two queries.
  - **Second bug the same join fixes, which the FE report did not mention:** the
    page window (`.offset().limit()`) also ran over unjoined rows, so an orphan
    inside a page silently consumed a slot — a `limit=20` page could return 19
    entries with `hasNext: false`. `totalPages` was derived from the inflated
    count too, so paging past the real end yielded an empty page.
  - **Verified on dev with a purpose-built orphan**: created a post as user 17,
    reported it as user 18 (`pending` → `total: 1, count: 1` ✅), then deleted
    the post as its owner. Post-fix the endpoint returns
    `{total: 0, count: 0, totalPages: 1, hasNext: false}` for `pending`, and
    `resolved`/`dismissed` still return `{total: 1, count: 1}` — untouched.
    Ran both count variants directly against the dev MySQL to show what the old
    code would have answered: `pending` old (no join) = **2**, new (join) =
    **0**; `resolved` and `dismissed` identical at 1 either way. Two real orphan
    rows exist on dev (`post_reports.id` 1 → post 9, id 8 → post 29); they are
    now invisible over HTTP and were left in place as fixtures.
  - `tsc --noEmit` clean, eslint/prettier clean, jest **36 suites / 353 tests**
    green.
  - **Class B, not A:** the response shape is identical and no field changed
    type, but `total` is an FE-visible value that changes. Nothing breaks in the
    deploy gap — `ReportedPostsPage.tsx:229` deliberately does not render
    `total`, and the `totalPages`/`hasNext` it does read only get more correct.
  - **Deliberately NOT done: cleaning up orphan reports in `deletePost`.** The
    rows are the moderation audit trail for a post that was taken down, and
    deleting them is a product decision, not a bug fix. Recorded in
    `known-behaviors.md` instead — the read path no longer exposes them.

- **OVERFETCH-01 — gateway read payloads trimmed at the boundary: one security
  leak closed, five dead fields dropped, three user references hydrated
  (2026-08-20). Release class B.** Came from the FE agent's payload-cleanup
  request (`backend-handoff.md`), which was explicit that nothing was blocked
  and that its "BE returns extra" claims were **inferred from entity +
  serializer, not curled** — so every item below was first confirmed against a
  real response, then re-verified live after the cut. All seven parts are
  gateway-only: the changes live in the boundary serializers, so entities, TCP
  payloads and RMQ events are byte-identical and no microservice was touched.
  - **(1) `reservationKey` no longer ships to any client** (`exposeOrder`,
    `apps/gateway/src/order/order.service.ts`). It is the internal
    inventory-reservation handle; shipping it let a caller name another order's
    reservation. The only real security item in the batch. The admin GHN detail
    path was already immune — `toAdminGhnLocalOrder` projects explicit fields
    and never carried it.
  - **(2) One image key on order items, not two.** `productImage` is gone;
    `image` is the survivor. **Not a plain delete** — see the regression note
    below.
  - **(3) Nested `brand` / `categories[]` on product rows are trimmed to
    `{id, name, isActive}`** (`trimTaxonomyReferences` +
    `pickTaxonomySummary`, `apps/gateway/src/product/product.service.ts`),
    applied at both `exposeProductReferences` return points. It is recursive,
    so it covers list rows, detail, and nested product refs alike. Ordering
    rule that must hold: `attachCategoryIds` runs BEFORE the trim at all 9 call
    sites and only needs `id`.
  - **(4) Five fields dropped that no client ever read**: `user1LastReadAt` /
    `user2LastReadAt` (chat conversations — read cursors, server-side state),
    `followerId` / `followingId` (social follows — the row already carries the
    hydrated `user`), `previousOrderStatus` (return requests — it exists so the
    orders service can roll an order back on reject). **`toDistrictId` /
    `toWardCode` were deliberately KEPT** at FE's own request.
  - **(5) `role.slug` dropped, `role.name` kept** (`exposeRole`,
    `apps/gateway/src/user/user.service.ts`). `RoleName` is both a TS enum and
    a DB enum column; JWT generation and `CheckPermission` key off `rol_name`.
    `rol_slug` had exactly one reader in the whole workspace —
    `role.entity.ts:39`, its own declaration — and zero in either FE repo.
  - **(6) Every "please keep" field left alone.** No action, by design.
  - **(7) Three user references hydrated, additively**: `actor` on
    notifications, `reporter` on social reports, `reviewer` on return requests,
    each `{id, username, avatar}` next to the unchanged bare public id. The
    rows were already being fetched to map their public ids, so this costs no
    extra query. **`email` must never be added to these three** — the summary
    map is fetched with `includeEmail: true` for other callers, so the omission
    is deliberate and load-bearing.
  - **Regression caught by the Change-Impact Review, not by the self-test.**
    `POST /api/order` does not decorate its items (ORDER-SHAPE-01), so it
    carried `productImage` *alone* — an unconditional delete would have shipped
    a checkout response with no image key at all. `exposeOrder` now copies
    `productImage` into `image` when `image` is absent, then deletes it. Do not
    remove that fallback. The admin GHN console detail bypasses `exposeOrder`
    entirely and still receives `productImage` — a deliberate asymmetry,
    `web-flow-GHN/src/features/ghn-shipping/api/adapters.ts` reads it.
  - **Verified live** (dev, real accounts): order detail has no
    `reservationKey` and one `image` key; `POST /api/order` → 201 with `image`
    populated from the Cloudinary snapshot and no `productImage`; return
    requests carry `reviewer` and no `previousOrderStatus`; admin reports carry
    a hydrated `reporter`; admin role reads `{"id":1,"name":"admin"}`; the
    moderation queues (pending brands, categories) are untouched; GHN console
    detail still carries `productImage`. `tsc --noEmit` clean, eslint clean,
    36 jest suites / 353 tests green.
  - **Residual:** the product public read cache stores already-exposed payloads
    with a 10s TTL, so a pre-trim fat row can be served for up to 10 seconds
    after deploy. Self-healing; no action.
  - **Class B, not C:** every removed field appears in the FE repos only as a
    type declaration or not at all, and the one real consumer (`productImage`
    in the GHN console) sits on a route this change does not touch. Nothing a
    user sees breaks in the gap between a BE and an FE deploy.
  - **Follow-up the same day, from the FE's post-check: the three embeds did
    not have one shape.** `reviewer` and `reporter` are both built from
    `UserInfo` (`id: string`, `username: string`, `avatar: string | null`), but
    `actor` was hand-built in `notification.service.ts` as `publicId ?? null` /
    `username ?? null` — all three keys nullable. One concept, two shapes, and
    an FE `UserSummary` typed non-null was lying on the notification path.
    Fixed: `actor` is now emitted only for a row that has a public id, so the
    embed is **complete or `null`**, never half-populated. Deliberately NOT the
    `String(user.id)` fallback order/social use — the sibling `actorId` on this
    path is already `publicId ?? null`, and a numeric fallback would put an
    internal id on the wire. Neither branch is reachable in practice
    (`username` is NOT NULL, `publicId` is assigned at registration). The shape
    is now declared, not implicit: `NotificationActor` in
    `notification.types.ts`, with `actor` added to `NotificationItem`.
    Verified live on `GET /api/notifications` **and** over a real socket — the
    `notification` event on WS `/notifications` runs the same `exposeReferences`
    and carries the identical embed, which the first entry did not mention.

- **VOUCHER-CONC-01 — a flash voucher is now safe under a burst: indexes, an
  honest per-user cap, a Redis admission gate, and a shorter lock hold
  (2026-08-18). Release class A.** Came out of the question "is high concurrency
  OK if we run a flash voucher?" — the answer was no, for three separable
  reasons, all three fixed here.
  - **1. The voucher tables shipped with nothing but their primary keys.**
    Migration `nodeA-20260818-001-add-voucher-indexes` adds `uq_vouchers_code`
    (every checkout and every `/voucher/validate` full-scanned `vouchers`, and
    the duplicate check in `createVoucher` was a check-then-act that could seat
    two rows with the same code), `uq_voucher_redemptions_voucher_order` (the
    entity's own comment called that pair the thing that makes recording a
    redemption idempotent — the guarantee existed only in the comment), and
    `idx_voucher_redemptions_voucher_user` (backs the per-user count). Additive
    and guarded; the UNIQUE ones abort loudly rather than skip if duplicates
    already exist. `createVoucher` now maps the `ER_DUP_ENTRY` the index
    produces to the same 409 the lookup would have, so the race loser does not
    get a 500.
  - **2. The per-user limit was a check-then-act.** `validateVoucherForCheckout`
    counts redemptions long before the order commits, so two tabs from one buyer
    (two idempotency keys → two real checkouts) both passed it and both redeemed
    a one-per-user code. The count is now re-run inside `redeemVoucher`, after
    the conditional UPDATE has taken the voucher row's exclusive lock — the one
    place where concurrent redemptions are serialized. It must be a **locking
    read**: under REPEATABLE READ a plain SELECT still answers from the snapshot
    taken before the UPDATE, which cannot see the row committed by the
    transaction we just queued behind. `pessimistic_write` reads the latest
    committed version. Lock order (voucher → redemptions) is identical in every
    caller, so it cannot deadlock.
  - **3. Losers paid full price before being rejected.** The DB cap only rejects
    at the very end, so every loser had already burnt an outbound GHN preview
    and a stock reservation that then had to be compensated. New Redis counter
    `voucher:quota:<id>` (`claimFromSeededQuota` / `releaseToSeededQuota` in
    `CachedService`, one Lua script each) is claimed BEFORE the GHN round trip
    and before any reservation; the losers now cost one round trip. Seed, bound
    check and decrement are one atomic step — a GET-then-DECR pair lets N
    callers all read the last unit and all claim it. TTL 300s makes the counter
    self-healing: every lapse re-seeds from `usage_limit - used_count`, so drift
    cannot accumulate, and `releaseToSeededQuota` deliberately does NOT
    resurrect an expired key (a plain INCR would leave a TTL-less counter stuck
    at "1 left" forever). **Fails OPEN** — Redis unreachable means the checkout
    proceeds and the conditional UPDATE still enforces the cap. SQL stays the
    source of truth; this is an admission gate, never an authority.
  - **4. The lock hold got shorter.** `redeemVoucher` is now the last statement
    before commit. It used to run before the order-items insert and the outbox
    insert, so the voucher row's exclusive lock — which every concurrent
    checkout of that code queues behind — was held across both. On a hot code
    that statement's position is what decides the endpoint's throughput.
  - **Compensation.** `placeOrder` has one try/catch covering the fee preview,
    the reservation and the transaction; `reservedKey` is assigned only after a
    successful reserve (a failing reserve already rolls back its own partial
    holds), and the claimed quota slot is handed back on any failure. The
    post-commit payment-init cancel path deliberately does NOT refund the slot —
    `used_count` is not decremented there either, so the mirror stays consistent
    with SQL. (Pre-existing and unchanged: a payment-init failure burns the
    buyer's redemption.)
  - **Verified on the running dev stack.** 4 concurrent checkouts on a 1-use
    code → 2 rejected at the Redis gate with 409 before GHN was called, counter
    back to 1 after the refund; the winner got 201 with the counter at 0; a
    later attempt got the unchanged 400 `FULLY_REDEEMED`. 4 concurrent checkouts
    on a `perUserLimit:1` code → exactly one 201 and three 400
    `USER_LIMIT_REACHED` (all four used to get through). DB after: `used_count`
    1 on both codes, exactly one redemption row each, no phantom increments. 6
    concurrent admin creates of one code → one 201 and five 409s, one row, no
    500. Inventory ledger after: 2 `reserved` (the two live orders), 3
    `released` (the rolled-back ones), and the gate-rejected requests created no
    reservation row at all. Plus 6 new unit tests (gate rejection short-circuits
    GHN + reserve, refund on downstream failure, no refund on success, fail-open
    on a Redis error, uncapped voucher never touches the counter, `ER_DUP_ENTRY`
    → 409): 36 suites / 353 tests green, tsc + eslint clean.
  - **Class A**: the HTTP contract is unchanged — the gate returns the same 409
    `JUST_FULLY_REDEEMED` the DB-level race loser already returned, and every
    other status/message is as before.

- **GHN-FAIL-01 — `delivery_fail` keeps the local status, and the timeline now
  says so instead of "Unhandled" (2026-08-16). Release class A.** Answers the
  GHN console's open question (`backend-handoff.md`, `risks.md` item 6) with
  option (b) — deliberately do not map — plus the observability fix that makes
  (b) readable.
  - **The decision.** `delivery_fail` is a failed delivery ATTEMPT, not a failed
    delivery: GHN retries on its own and only then moves to the return family,
    which already maps to CANCELED. Canceling on the first miss would release
    reserved stock for a parcel still out for redelivery, and there is no local
    status between DELIVERING and CANCELED to move to — inventing one means a
    new `orders.status` enum value (migration + a contract change for both
    frontends) for a state the buyer already sees on the GHN badge.
  - **The real defect was the message, not the mapping.** `applyGhnStatus`
    labelled every unmapped status `Unhandled GHN status "<x>"`, and that string
    is persisted to `shipping_history.message` and rendered verbatim in the
    console timeline — so a legitimate, expected GHN status read as a backend
    bug next to a GHN badge that had visibly moved.
  - **What changed.** New `GHN_STATUSES_WITHOUT_LOCAL_STATUS` +
    `isGhnStatusWithoutLocalStatus()` in `libs/constant/shipping.constant.ts`
    lists the ten GHN statuses we recognise and deliberately do not map
    (`ready_to_pick`, the five in-transit legs, `delivery_fail`, `exception`,
    `damage`, `lost`), each with the reason in the doc comment. The null branch
    of `applyGhnStatus` splits on it: recognised → `GHN status "<x>"
    acknowledged; no local equivalent, order stays <status>` at `log` level;
    anything else → the old `Unhandled GHN status "<x>"`, now at **warn**, so a
    new GHN vocabulary word is loud instead of buried. Return value is
    untouched (`changed: false`, status unchanged), so no behaviour moved.
  - **`exception` / `damage` / `lost` are held for a second reason** beyond "no
    local status": mapping them to CANCELED would restock goods that no longer
    physically exist. They stay visible and unmapped for an operator.
  - **Verified on the running dev stack, all three entry points** (they share
    `applyGhnStatus`): demo-status `delivery_fail` on
    `ord_YzPpdMWzrvxxk7eb` (`processing` → demo `delivering` → `delivery_fail`)
    → `201`, `previousStatus == newStatus == "delivering"`, history row 42 reads
    "acknowledged; no local equivalent"; the same status over the real webhook
    (`POST /api/ghn/webhook`, `L89XNE`) → row 43, same text; an invented
    `teleported` over the webhook → row 44 still reads `Unhandled GHN status
    "teleported"`. Plus 2 unit tests in `orders.service.spec.ts` (61 pass).
  - **Forward-only.** Rows written before this change keep the old text — same
    call as GHN-HIST-01, no backfill.
  - **Left open on purpose (product, not backend):** whether a failed delivery
    attempt should notify the buyer. Nothing notifies today.
  - Files: `apps/orders/src/orders.service.ts`,
    `libs/constant/shipping.constant.ts`,
    `libs/constant/response-message.constant.ts`,
    `apps/orders/src/orders.service.spec.ts`, `ops-runtime.md`,
    `known-behaviors.md`.

- **IDLEAK-02 — the last two numeric internal ids on PUBID domains are gone
  (2026-08-15). Release class C: IMPLEMENTED AND VERIFIED, BUT HELD — NOT
  DEPLOYED.** Closes the two sub-items that `PRODTEST-0806 #4` had deliberately
  deferred on 2026-08-13 because each has a live FE consumer typed `number`.
  The hold lives in `../.agent-local/release-gate.md` → IDLEAK-02; the whole
  `api` working tree is held with it (a tree takes the highest class present),
  so the class-A UP-03(i) and OUTBOX-SCOPE-01 work sitting alongside it is held
  too — isolate them on their own branch if they ever need to ship first.
  - **`submittedBy` on the moderation queues → `usr_` public id.**
    `GET /api/products/brands/pending` and `/categories/pending` were returning
    the submitting seller's raw PK. The root cause was not missing id logic:
    `exposeUserReferences()` already knew the `submittedBy` key, but those two
    methods returned the raw TCP payload without passing through any exposure
    helper. They now do.
  - **`submittedBy` is DROPPED from every other brand/category read** —
    `createBrand`, `getAllBrands`, `getBrandById`, `reviewBrand` and the four
    category equivalents run the payload through the new
    `hideSubmittedBy()` (recursive key strip). Dropping rather than resolving is
    deliberate: only the moderation queue renders the field, these are hot
    public catalog reads, and `exposeUserReferences` needs a user-service round
    trip that would make a cached read depend on another service being up.
    Class B on its own (nothing reads the field), folded into this batch.
  - **Fail-soft on the queue.** Found by the Change-Impact Review, not by the
    self-test: routing the queues through `exposeUserReferences` made them
    **500 during a user-service outage**, since that helper throws. New
    `exposeSubmittedBy()` wraps it — resolve normally, and on throw log a warn
    and fall back to `hideSubmittedBy()`. A moderator can approve/reject without
    knowing who submitted, so the field disappearing beats the queue dying.
    Consumers must therefore treat `submittedBy` as `string | null | absent`.
  - **`topProducts[].productId` on analytics → `prod_` public id.** New
    `exposeAnalyticsProductIds()` in the gateway order service, applied inside
    `fetchAnalytics` so it covers BOTH `getSellerAnalytics` and
    `getShippingAnalytics` (including the revenue-stripped RBAC branch, which
    copies `productId` through verbatim) and stays inside the existing
    `MicroserviceErrorHandler` try. It reuses `buildProductMap`, which degrades
    to an empty map on a product-service failure, so an unresolvable id becomes
    **`null`, never the number** — a deleted product and a dead product service
    look the same to the client, which is the correct trade here.
    `order.types.ts` widens `topProducts[].productId` to
    `number | string | null`.
  - **Deliberately NOT touched:** brand/category `id` itself stays numeric
    (these are not PUBID domains — only the *user reference* on them was the
    leak). And the brand/category objects nested inside the product payload keep
    their `submittedBy`, because `exposeUserReferences` already runs over the
    whole product payload in the same batched call, so it comes out as `usr_…`
    — PUBID-safe, merely inconsistent with the standalone reads. Not worth
    touching a hot path for a cosmetic difference.
  - Files: `apps/gateway/src/product/product.service.ts`,
    `apps/gateway/src/order/order.service.ts`,
    `apps/gateway/src/order/order.types.ts`. No migration, no new endpoint, no
    microservice change. `tsc --noEmit` clean, eslint/prettier clean, jest
    **36 suites / 345 tests** green (new `product.service.spec.ts` +7, including
    the user-service-outage degradation; `order.service.spec.ts` +3, including
    the all-null product-service-down branch).
  - Runtime-verified on local dev (`testadmin` + shop `test1`): pending brands
    and pending categories return `submittedBy: "usr_60ccb7b981c411f1"` /
    `"usr_60ccb8d381c411f1"` (5 rows each); `GET /api/products/brands` and
    `/categories` carry no `submittedBy` key; admin analytics `topProducts` →
    `[null, null, "prod_ffc7fc2281d211f1", null, "prod_ffc4fcfc81d211f1"]`;
    seller analytics → `[null, null, "prod_ffc4fcfc81d211f1"]`.
  - FE handoff written to both inboxes: `frontend-handoff.md` (storefront —
    `catalog.ts:14,29` type flip + drop the `#` prefix in
    `PendingBrandsPage.tsx:101` / `PendingCategoriesPage.tsx:101`) and
    `frontend-handoff-ghn.md` (console — `analytics.ts:76` type flip and,
    critically, `AnalyticsPanel.tsx:369` must stop using `productId` as the
    React key, since several deleted products now yield duplicate `null` keys).
    The storefront needs **no** analytics change: `TopProductStat.productId` is
    already typed `string` there and the dashboard charts by `productName`.

- **PROD-PAY-01 — CLOSED 2026-08-15 by owner confirmation, no code change.** The
  ZaloPay callback leg was tracked as "never exercised by a real sandbox
  payment". The owner confirmed it is working and does not need a verification
  run, so the item was removed from `snapshot.md` Active Tasks. The handler is
  unchanged; nothing was tested or modified by this entry — it records WHY the
  item disappeared so a future session does not re-open it as an untested leg.
  (VNPay IPN was already closed by PROD-PAY-02 on 2026-08-13.)

- **UP-03(i) — product `description` images are now garbage-collected, and all
  product media cleanup is reference-counted (2026-08-15).** Release class **A**
  (no contract change: same routes, same request and response shapes; only
  storage GC behaviour changed). Two real defects closed at once.
  - **Defect 1 — description images were orphaned forever.** `imageUrls` was
    the only column diffed on edit/delete, so every image the seller embedded
    in the rich-text `description` through the same signed upload flow stayed
    on Cloudinary after the product was edited or deleted. New shared util
    `libs/common/src/cloudinary/cloudinary-html.util.ts` →
    `extractCloudinaryUrlsFromHtml()` pulls our-cloud URLs out of the HTML
    (host-matched against `CLOUDINARY_DELIVERY_HOST`, strips trailing prose
    punctuation, de-duplicated); `collectProductMediaUrls()` unions it with
    `imageUrls`, and `applyProductUpdate` now also captures
    `previousDescription` before `Object.assign` overwrites it.
  - **Defect 2 — product cleanup had no reference counting.** The same uploaded
    URL can legitimately sit on several rows (a re-used photo) *and* in two
    columns of one row (gallery image also embedded in the description).
    Destroying on the first edit/delete 404'd the image everywhere else it was
    still displayed. `destroyUnreferencedImages()` now asks per URL whether ANY
    product row still cites it —
    `JSON_CONTAINS(product.image_urls, JSON_QUOTE(:url))` OR
    `LOCATE(:url, product.description) > 0` — and destroys only the ones nobody
    references. `LOCATE`, not `LIKE`: Cloudinary leaf names contain `_`, which
    `LIKE` reads as a single-char wildcard. Same shape as the post-media
    cleanup already in `social.service.ts`. It runs AFTER the caller's commit,
    so the edited/deleted row can no longer match itself; a failed reference
    check destroys nothing and only warns (best-effort, never fails the
    mutation).
  - Verified end-to-end on the live stack with two real assets uploaded through
    the real signed flow into two products: removing an image from a
    description destroyed exactly that asset (404) and left the other one
    (200); clearing `imageUrls` did NOT destroy an asset a second product's
    description still cited (200); deleting that second product finally
    destroyed it (404). Plus 4 new unit tests in `product.service.spec.ts` and
    7 in `cloudinary-html.util.spec.ts`.
  - Known limit (accepted): the reference check only scans `products`. A
    product image URL pasted into a social post or used as an avatar is not
    seen — the upload folders differ (`trybuy/products` vs `trybuy/posts`), so
    it takes deliberate cross-pasting to hit. Concurrent deletes of two rows
    sharing a URL can also both see the other still present and leak the asset;
    that is the safe direction (leak, never a broken image).

- **OUTBOX-SCOPE-01 — every RMQ publish site now detects a dead broker instead
  of silently dropping the event (2026-08-15).** Release class **A**
  (observability + logging only; no contract or behaviour change while RabbitMQ
  is up). `RmqModule.registerDirectPublisher()` hands out a self-healing PROXY,
  not a raw channel: during an outage it stays truthy, `publish()` no-ops
  returning `false`, and every other property reads `undefined`. So the
  ubiquitous `if (this.fanoutChannel)` guard passed happily while the event went
  nowhere, with no log, no nack, no dead-letter. The honest signal —
  `channel.connection` — was already known and used by RESIL-02's outbox, but
  only there.
  - Extracted it into the shared `isRmqPublisherLive()`
    (`libs/common/src/rmq/rmq-publisher.util.ts`, exported from `@app/common`,
    3 unit tests) and applied it to **all 11 remaining publish sites across 6
    services**: orders (`order_canceled`, COD `payment_completed`,
    `order.status_changed`, order-return events — `isFanoutChannelLive()` now
    delegates to the shared util), payments (`payment_completed`), product
    (`sku_upserted`, `brand_reviewed`, `category_reviewed`), social
    (`comment_created`, `reply_created`), notification (WS push), inventory
    (`stock_changed`).
  - **Payments was the worst case: it had NO guard at all** and its
    `fanoutChannel` was typed non-null even though the factory returns `null`
    when the broker is down at startup. A completed payment could therefore
    silently never flip its order. It now logs at **error** level naming the
    order id and amount, because the money IS recorded and only the order-side
    flip is owed — that order needs manual reconciliation.
  - **Deliberately NOT routed through the outbox** (do not re-propose): for all
    of these the state-critical work already happens synchronously before the
    publish (`markOrderPaid`, `releaseReservedItems`), and the
    `payment_completed` consumers in rewards/payments are empty stubs — the
    events are notification-grade. Making them durable would risk duplicate
    notifications, since `order.status_changed` carries no idempotency key.
    `order_created` remains the only durable event.
  - Three payments specs had to gain `connection: {}` on their channel mocks;
    the pre-existing warn branches in the orders specs come from harnesses that
    pass `null` as the channel and are unchanged.

- **UPLOAD-SIZE-01 — the upload size limit is now server-owned, but it is a
  contract, not an enforcement (2026-08-15).** Release class **B** (additive:
  two new response fields the live FE's allow-list ignores, and one new
  OPTIONAL query param). FE asked for a size limit "inside the signed string"
  (`max_bytes`, or a signed preset with `max_file_size`) so the two sides could
  not drift. **That is not possible on Cloudinary, proven, not assumed** — three
  live probes: signing `max_file_size` returns `401 Invalid Signature` with
  Cloudinary echoing the param set it actually signs (size excluded); a *signed*
  preset with `max_file_size: 10240` still accepted a 40 KB file (HTTP 200,
  `bytes=40964`); and the Admin API silently dropped `max_file_size` from the
  preset entirely (`settings: {"folder":"trybuy/products"}`). All probe assets
  and presets were deleted. So the honest version shipped instead: the server
  owns the NUMBERS and hands them to the client.
  - `POST /api/upload/signature` now returns `maxBytes` (10 MB) and, for
    `trybuy/posts` only — the one folder whose `allowed_formats` admits mp4 —
    `maxVideoBytes` (100 MB). Those match the FE's own existing constants in
    `uploadValidation.ts`, so nothing about current behaviour changes; the FE
    just stops hardcoding them. camelCase deliberately, to mark them as OURS
    rather than a Cloudinary param to forward (harmless if forwarded anyway —
    verified HTTP 200; Cloudinary ignores names it does not recognize).
  - `?bytes=<n>` is a new optional query param. When present and over the
    folder's ceiling the signature is refused with 400 before it is ever issued.
    Advisory by construction: omit it or lie and you still get a signature.
  - The signed string is **byte-for-byte unchanged** — pinned by the pre-existing
    `paramsToSign` test plus a new one asserting the signature is identical with
    and without `bytes`.
  - Ceiling is per FOLDER, not per file type: the signature predates any byte,
    so an image into `trybuy/posts` is measured against the 100 MB video cap.
    Intended; see `known-behaviors.md`.
  - Verified live end-to-end against the real Cloudinary account: signature →
    multipart upload with exactly the fields the FE forwards → HTTP 200,
    `bytes=70` stored → deleted again through `DELETE /api/upload/media` →
    `{"result":"ok"}`. Plus route-level checks: products `maxBytes` only, posts
    both caps, at-cap 201, over-cap 400 on both image and video ceilings, and
    `bytes=abc` → 400 from the DTO.
  - Files: `apps/gateway/src/upload/{upload.constants,upload.types,upload.service,upload.controller}.ts`,
    `libs/constant/response-message.constant.ts`, plus both upload spec files
    (34 tests green).

- **TCP-RESIL-01 — the null-socket race is fixed at the transport instead of
  retried at 92 call sites (2026-08-15).** Release class **A** (internal
  resilience; no route, field, status code or event changed). SOCIAL-502 and its
  rollout treated the SYMPTOM with an rxjs retry, which by construction can only
  cover idempotent reads: rxjs cannot tell "never sent" from "sent, response
  lost". This closes the cause.
  - **New `libs/common/src/resilience/resilient-client-tcp.ts`
    (`ResilientClientTCP`)**, next to the RESIL-01 circuit breaker and exported
    from `@app/common`. All **35** client registrations in 16 module files now
    use `customClass: ResilientClientTCP` instead of `transport: Transport.TCP`
    (`ClientProxyFactory` does `new customClass(options)`, so the same
    `{host, port}` options object and the same DI token/`ClientProxy` type keep
    working). Server-side `createMicroservice({transport: Transport.TCP})` in
    each `main.ts` is untouched, and the RMQ registrations in `RmqModule` are
    untouched.
  - **Defect 1 — the race itself.** `publish()` now checks `this.socket` and,
    when it is null, awaits `connect()` and publishes the SAME packet. Nothing
    had been written when the race fires, so this is transparent **even for
    writes**. Scoped to `socket === null` on purpose: `handleClose()` has no
    socket-identity check, so forcing a reconnect over a still-live socket would
    let the old socket's late `'close'` null the new one.
  - **Defect 2 — a silently dropped write (previously unknown).**
    `ClientTCP.publish()` calls `sendMessage()` with no callback, so a send on
    an already-closed socket is dropped without a trace and the caller burns its
    whole `timeout(…)` budget — and an rxjs `TimeoutError` is deliberately never
    retried, so the user always ate that one. `sendPacket()` passes the callback
    and fails the packet immediately with `NetSocketClosedException`;
    `isTransportError()` learned that message so `retryOnTransportError()` can
    act on it.
  - **Layer A — half-open sockets.** `createSocket()` sets TCP keep-alive
    (`TCP_KEEP_ALIVE_DELAY_MS = 30_000`) on every socket it builds, including
    reconnects, so a peer killed without FIN surfaces as `ECONNRESET` instead of
    a writable-looking socket that swallows sends. Overriding `createSocket()`
    rather than passing a custom `socketClass` keeps the base class's
    `maxBufferSize` forwarding, which is guarded by a strict
    `socketClass === JsonSocket` check any subclass would fail.
  - **Unsubscribe safety.** If the caller's `timeout(…)` fires while the
    reconnect is in flight, the returned teardown cancels it and the packet is
    never written — a write is not applied after the caller gave up. Concurrent
    publishes share one reconnect (`connect()` caches `connectionPromise`), so
    there is no thundering herd.
  - **`retryOnTransportError()` stays.** It still covers a peer that is
    genuinely down or restarting (`ECONNREFUSED`, `"Connection closed"`) and is
    still reads-only. The two layers are complementary.
  - **Tests: 9 new specs** in `resilient-client-tcp.spec.ts` against a REAL
    `net` server speaking the NestJS `<len>#<json>` frame — two of them PIN the
    base-class bugs (null-socket `TypeError`; a send that hangs), so a future
    NestJS upgrade that fixes them upstream is detected. Reproducing the race
    requires issuing `send()` from a macrotask (`setImmediate`), as a real HTTP
    handler does: from inside an async function the microtask queue drains
    first and the far more benign `"Connection closed"` wins instead. Suite:
    **33 suites / 308 tests green** (was 32/298).
  - **How hard is it to ACTIVATE? Harder than "restart under load."** A probe
    driving sustained traffic through a peer that RSTs every connection every
    60ms produced **0 null-socket failures in 45,206 requests on the BASE
    client** — `publish()` normally wins, and the packet fails with the benign
    `"Connection closed"` that `handleClose()` hands to every in-flight
    callback. The TypeError needs `publish()` to LOSE to a nextTick-queued
    close. That is why prod (sockets die only on a deploy/restart) has never
    shown it while dev (watch-mode recompiles all day) surfaced it repeatedly.
    The same probe through a proxy in front of the real product service, with
    the request issued in the exact tick the peer is RST, lands on defect 2
    instead — the base client's write is dropped and only the peer's own close
    reports it.
  - **Tried and reverted: tearing the socket down from the send callback.**
    Failing fast means the dead socket is still installed for the few ms until
    its 'close' event runs, so an INSTANT retry hits it again (measured: base
    recovers on the immediate next call, this class needs ~one turn; the
    gateway's 100ms `TRANSPORT_RETRY_DELAY_MS` already covers it). Calling
    `handleClose()` there to close that window made things worse — it takes no
    socket argument, so the stale socket's late 'close' tore down the
    REPLACEMENT socket mid-connect and the next call died with `TypeError:
    Cannot read properties of null (reading 'on')`. Reverted; the window is
    documented in `known-behaviors.md` instead. Do not retry this.
  - **Runtime evidence.** A probe against the LIVE product service on :3006:
    base `ClientTCP` → `REJECTED: Cannot read properties of null (reading
    'sendMessage')`; `ResilientClientTCP` → resolved 20 brands, and the
    follow-up call on the reconnected socket also resolved. Gateway reads
    re-verified end-to-end after the restart (`/api/user/me`, `/api/products`,
    `/api/social/posts`, `/api/notifications`, `/api/order/seller` → 200) plus a
    write round-trip (`POST /api/cart` 201 → `DELETE /api/cart/items/:id` 200).
  - **Residual:** warnings log under the `[ClientTCP]` context (the base class's
    `readonly logger`); `dispatchEvent()` (TCP `emit()`) gets the same null-socket
    guard but keeps the base class's fire-and-forget drop on an already-closed
    socket — grep confirms no production caller emits over TCP today.

- **SOCIAL-502-ROLLOUT — the transport retry now covers every idempotent gateway
  read (2026-08-14).** Release class **A** (internal resilience; no route, field
  or status code changed). `retryOnTransportError()` had been wired to the 7
  social reads only, but the null-socket race it defends against
  (`ClientTCP.publish()` dereferencing a socket that `handleClose()` nulled on
  the nextTick queue before `connect()`'s cached promise resolved on the
  microtask queue) can hit ANY gateway TCP read. The sanitizing 502 branch in
  `MicroserviceErrorHandler` already covered all 14 services, so only the retry
  was missing.
  - **92 call sites** across `cart`, `chat`, `inventory`, `notification`,
    `order`, `payment-options`, `product`, `shipping`, `social`, `user`. The
    operator itself is unchanged — this is purely a rollout.
  - **Classification rule: message-pattern semantics, not the timeout
    constant.** Several pure id→publicId lookups use `TCP_TIMEOUT_MS.WRITE` and
    still qualify as reads; conversely nothing that creates, updates, deletes,
    reserves, releases or consumes carries the retry, since a retried write can
    apply twice. Ambiguous patterns (`INVENTORY_CHECK_STOCK`,
    `PRODUCT_PRICE_SUGGESTION`, `GET_ORDER_INVOICE`) were verified against the
    microservice handler to be side-effect-free before conversion.
  - **Deliberately skipped:** GHN and payment-provider legs (`ghn-webhook`,
    `payment-callback`) — those are writes and already have their own circuit
    breaker from RESIL-01 — and `PRODUCT_DUPLICATE_IMAGE_CHECK`, which downloads
    the image from Cloudinary and runs an O(catalog) pHash scan, far too
    expensive to retry. `SHIPPING_PROVINCES/DISTRICTS/WARDS` ARE included: they
    are cached, idempotent, side-effect-free master-data reads.
  - **Placement is enforced, not assumed** — a script over the whole gateway
    tree confirmed all 92 sites put `retryOnTransportError()` AFTER `timeout(…)`
    in the same `.pipe()`, so every attempt keeps its own budget and an rxjs
    `TimeoutError` is never retried. The only 3 sites without a preceding
    `timeout` are in `transport-error.spec.ts`, by design.
  - **No latency regression.** Transport errors fail fast, and `TimeoutError` is
    explicitly not retried, so a slow service still costs one budget, not two.
  - Two type casts (`order.service.ts` `GET_ORDER_BY_ID` →
    `OrderResponse | null`, `user.service.ts` `getUserPublicId` →
    `{ publicId?: string | null }`) were dropped during the mechanical
    conversion and restored — `send()` without a generic is `Observable<any>`,
    which trips `no-unsafe-assignment`/`no-unsafe-return`.
  - **Verified:** `tsc --noEmit` clean; eslint clean on all 9 files; jest 32
    suites / 298 tests pass, including the 16 pinning specs in
    `transport-error.spec.ts`; 26 endpoints curl-tested across all touched
    services as `shop` and `admin` — all expected 200s, and the business-error
    paths still answer correctly (`GET /api/inventory/product/:id` → a real 404,
    `GET /api/products/1` → 400 for a numeric id), proving the retry does not
    swallow or re-issue a non-transport failure.

- **RESIL-03 — Prometheus metrics on the gateway (2026-08-14).** Release class
  **A** (a new ops-only surface; no existing route, field or status code
  changed). Ten services on an Aiven free tier had `/live` + `/ready` and
  nothing else — and `/ready` reports `database:not_configured`, so it stays
  green whatever happens. There was no way to answer "which route is slow",
  "what is the error rate" or "how many requests are in flight".
  - `GET /metrics` (`apps/gateway/src/metrics/`, `prom-client`) renders a
    **dedicated** `Registry` — not the global one, so a second consumer cannot
    collide with it — carrying `collectDefaultMetrics()` (process CPU/RSS/heap,
    event-loop lag, handles) plus three HTTP series: `http_requests_total`
    (counter), `http_request_duration_seconds` (histogram, buckets 10ms→10s)
    and `http_requests_in_flight` (gauge).
  - **Labels are the matched route PATTERN**, read from `req.route.path` +
    `req.baseUrl` after the response finishes (`/api/products/:id`, never the
    concrete id), and anything that matched no route at all — 404s, scanner
    traffic — collapses into a single `route="unmatched"` series. Cardinality is
    therefore bounded by the route table, not by traffic.
  - The gauge is decremented on `finish` **or** `close` (client hang-up),
    guarded so it records exactly once; otherwise an aborted request would leak
    in-flight count forever.
  - **Access:** `@Public()` and excluded from the `api` global prefix
    (Prometheus convention is a bare `/metrics`). Open in dev. In production it
    is **404 unless `METRICS_TOKEN` is set** (fail-closed, and the 404 hides
    that the route exists at all); when set, the scrape must send
    `Authorization: Bearer <token>` and the comparison is `timingSafeEqual`
    with a length pre-check. `METRICS_TOKEN` is documented in both nodeA env
    examples. nginx's `location /` proxies `/metrics` too, so on prod the token
    is the only thing standing in front of it.
  - `/metrics` is exempt from the SCALE-05c backpressure shed (like `/live` and
    the payment callbacks): shedding the scrape would blind the dashboards
    exactly during the incident they exist for. It is also excluded from its own
    middleware — and that exclusion **must name the method**:
    `exclude("metrics")` defaults to `RequestMethod.ALL`, which does not match
    the `{ path: "metrics", method: GET }` entry in `setGlobalPrefix`'s exclude
    list, so Nest prefixed it to `/api/metrics` and the real `/metrics` stayed
    instrumented — caught at runtime because the gauge never read 0.
  - **Known limits (deliberate):** only the gateway is instrumented, the other 9
    services have no metrics surface; the registry is per-process, so
    `GATEWAY_INSTANCES>1` (pm2 cluster) would hand a scraper one random worker's
    numbers and needs `prom-client`'s cluster aggregator first. Default is 1.
  - Verified on the running dev stack: `200 text/plain; version=0.0.4`;
    `http_requests_total{route="/api/user/me",status_code="200"}` after an
    authenticated call, `route="unmatched"` for a bogus path, no `/metrics`
    series, `http_requests_in_flight 0` between scrapes. 32 suites / 298 tests.

- **Boot-time TCP warmup is best-effort now (2026-08-14, follow-up to
  RESIL-02).** Adding the missing `await app.init()` to orders also started
  running `OrdersService.onModuleInit()` for the first time, and it eagerly
  `await client.connect()`s inventory/user/product. An `ECONNREFUSED` there is
  an unhandled rejection → the process dies at boot. Product does the same thing
  towards orders, so the two deadlocked: whichever was down first kept the other
  from ever starting (seen live — both were down, and each crashed on the
  other's port). Both warmups are wrapped now: a failure logs a warn and the
  `ClientProxy` connects lazily on the first send, which is what it does anyway.
  This matters beyond dev — pm2 starts all 10 apps at once, and a repeated
  crash-on-boot can park an app in pm2's `errored` state.

- **PROD-PAY-02 — inbound VNPay IPN closed (2026-08-13).** Confirmed done by the
  user: the merchant portal was switched back to **SHA512** (the backend has
  always verified SHA512) and a sandbox payment completed end to end, so the
  order left `pending` from the IPN leg rather than the browser return. The
  `verifyCallback` fix (`cef4981`) was already deployed. No code change in this
  entry — it closes the last owed manual verification. The ZaloPay callback leg
  is still unverified end to end and is NOT covered by this.

- **RESIL-02 — transactional outbox for `order_created` (2026-08-13).** Release
  class **A** (nothing FE-visible). Publishing happened AFTER the create
  transaction committed and outside any transaction, so an RMQ outage dropped
  the event: a non-COD order was canceled (correct), but a **COD order only
  logged a warn** — the order existed while inventory, rewards and notification
  never heard about it. The multi-seller path was worse: it warned for EVERY
  payment method, so the two paths disagreed.
  - New `order_outbox` table (`nodeA-20260813-001-add-order-outbox`, additive +
    INFORMATION_SCHEMA-guarded) + `OrderOutbox` entity. The row is written with
    the caller's `EntityManager` **inside** the order transaction, so the order
    and the event it owes commit together or not at all.
  - After commit, `tryPublishOutboxRow()` publishes inline and marks the row
    delivered. A failure is no longer terminal — the row stays pending and
    `drainOrderOutbox()` (`@Cron` every 30s, batch 50, stops the tick on the
    first failure instead of hammering a down broker) delivers it. Delivered
    rows are pruned daily after 7 days. Consumers are idempotent by
    `orderId`/`reservationKey`, so a duplicate delivery is harmless; a lost
    event is not.
  - Single-seller **online payment keeps failing fast**: the client asks for
    `paymentUrl` immediately, so a poller retry 30s later is useless — that
    path still cancels the order, discards the owed row, and returns 503. Only
    the COD and multi-seller legs now defer to the poller.
  - **`publish()`'s return value cannot be trusted on its own.**
    `RmqModule.registerDirectPublisher()` hands back a self-healing Proxy that,
    while the broker is down, answers `publish()` with a no-op returning
    `false` and every other property with `undefined`. Marking rows published
    on that would have lost exactly the events the table exists to protect, so
    `isFanoutChannelLive()` probes `channel.connection` instead; a `false` from
    a *live* channel is amqplib back-pressure (frame buffered, still sent) and
    is only logged.
  - **`apps/orders/src/main.ts` never called `app.init()`** — the root cause
    found while the owed event refused to drain. Orders is TCP/RMQ-only and
    calls neither `listen()` nor `init()`, so the Nest lifecycle hooks never
    ran and `@nestjs/schedule` mounted **no** `@Cron` in this service: the new
    outbox drain, and the pre-existing hourly `sweepStaleReservations()`, were
    both dead. chat/inventory/notification/product already had the `init()`
    call; rewards/social also lack it but have no cron, so they were left
    alone.
  - Because the hourly sweep goes live with this deploy, it now has a backlog
    to work through (58 sweepable orders on DEV Aiven), so it is capped at
    **25 orders per tick** — each swept order costs an inventory release (TCP)
    plus a cancel event (RMQ), and the connection-capped Aiven tier should not
    take that as one burst.
  - Verified on the running dev stack, no process restart involved in the
    recovery: COD order → 201 with the outbox row committed and marked
    published; `docker stop rabbitmq` → order still 201, row `published_at
    NULL`, `attempts 1`, `last_error "RabbitMQ publisher unavailable"`;
    `docker start rabbitmq` → the poller delivered the same row ~60s later with
    `last_error` cleared. Orders suite 77 tests, full suite 31/288 green.

- **IDLEAK-01 / ENVELOPE-01 / ENUM-MSG-01 — the last three cosmetic-but-real
  defects from the prod sweep (2026-08-13).** One batch, three independent
  fixes, all release class **B** (no current FE reads any of the three).
  - **IDLEAK-01 (PRODTEST-0806 #4)** — four places still shipped an internal
    numeric row id on a PUBID domain. `GET /api/products/:id/stock-check`
    returned inventory's echo of the numeric `productId` it was queried with;
    it now returns the opaque id the caller asked about
    (`{...stock, productId}`, `product.service.ts`). Return-request
    `reviewedBy` and risk-feedback `moderatorId` were simply missing from the
    two `exposeUserReferences` key sets — the return-request column is
    `reviewedBy`, not the `reviewerId` that was listed, so adding one key fixed
    all four return-request paths at once (create / mine / managed / review).
    `SOCIAL_MESSAGE.POST_NOT_FOUND` and `COMMENT_NOT_FOUND` stopped being
    interpolating functions: the social service only ever sees the internal
    numeric id (the gateway resolves `post_…`/`cmt_…` before the TCP hop), so
    the id in the message text was a leak by construction and the text carries
    no id at all now (14 call sites). Two items on the snapshot list were
    verified already fixed and were stale, not re-fixed: review-create `userId`
    (REVIEW-ID-01) and the notification message text (`orderLabel` is
    publicId-safe). Two more — `submittedBy` on pending brands/categories and
    analytics `topProducts[].productId` — are **deliberately deferred**: both
    have a live FE consumer typed `number` (`PendingBrandsPage.tsx:101` renders
    `#{submittedBy}`), which makes them release class **C**, and shipping them
    inside this batch would have held the whole tree.
  - **ENVELOPE-01 (#5)** — `HttpExceptionFilter` fell back to
    `exception.constructor.name` for the envelope's `error` label. Because
    `MicroserviceErrorHandler` rebuilds a propagated error as a bare
    `new HttpException(message, status)`, every error crossing a TCP hop
    reported `"error":"HttpException"` while the identical gateway-local error
    reported `"Not Found"`. The filter now derives the label from the status
    itself (`HttpStatus[404]` → `NOT_FOUND` → `Not Found`) and accepts an
    upstream label only when it is already a reason phrase — a class name
    (`…Exception`/`…Error`) is an internal detail and gets dropped. The
    production 500 override was unified onto the same phrase so prod and dev no
    longer disagree (`"InternalServerError"` vs `"Internal Server Error"`); it
    had no consumer in either repo.
  - **ENUM-MSG-01 (#6)** — `@IsEnum(["approve","reject"])` on the brand and
    category review DTOs rendered `"action must be one of the following
    values: "` with an empty list, because `class-validator` reads enum
    *values* off an object, not an array literal. Swapped to `@IsIn([...])`.
  Verified at runtime against the local gateway (admin cookie): stock-check →
  `"productId":"prod_ffc802c681d211f1"`; `GET /api/order/return-requests` → all
  four rows `"reviewedBy":"usr_…"`; risk feedback → `"moderatorId":"usr_…"`;
  `GET /api/social/posts/post_0000000000000000` (and its `/comments`) →
  `"Post not found"`; propagated 404 → `"error":"Not Found"`, gateway-local 400
  → `"Bad Request"`, duplicate register → `"Conflict"`; brand review with
  `action:"bogus"` → `action must be one of the following values: approve,
  reject`. Change-impact review: `SOCIAL_MESSAGE` has no caller outside
  `social.service.ts`; `reviewedBy` exists only on return-requests and
  `moderatorId` only on risk feedback, so neither key-set addition can rewrite
  an unrelated field; `checkProductStock` has exactly one caller; the storefront
  API client reads only `message` + HTTP status from an error body and the GHN
  console never reads `error` either, so the filter change is invisible to both.
  `tsc --noEmit` clean, eslint clean, Jest 31 suites / 284 tests green.

- **GHN-CREATE-01 — order create no longer books an undeliverable address
  (2026-08-13).** Closes PRODTEST-0806 defect #2 and the hole GHN-DIST-01 left
  open on purpose. `POST /api/order` priced shipping through
  `getShippingFeeOrZero()` (`apps/orders/src/orders.service.ts`), which caught
  **every** GHN preview error and returned `0`. So an address GHN cannot deliver
  to produced a `201`: the buyer was charged no shipping, the COD
  `createShippingOrder` leg then failed into a swallowed `logger.error`
  (`ghnOrderCode: null`), and the seller's `ready-to-ship` — which runs the same
  `buildShippingOrderBody` validation — rejected that order forever. Cancel was
  the only exit, and the buyer only found out after paying attention to a stuck
  order. The fix is three lines: rethrow `BadRequestException`, keep swallowing
  everything else. That split is exactly the refusal/outage classification
  RESIL-01 already built into `toGhnDomainError` — a refusal (unknown district,
  ward from another district, unresolvable free-text, non-operational 4xx) is
  **deterministic**, because preview and waybill create share one body builder,
  so an address that fails here could never have produced a waybill; an outage
  (down, timeout, 5xx/401/403/429, circuit open → 503/500) says nothing about
  the order, so it stays fail-open at fee 0 and `readyToShip` cuts the waybill
  on retry (`if (!order.ghnOrderCode)` — that recovery path already existed,
  which is why only the create half needed fixing). Placement matters and was
  verified, not assumed: the fee is priced **before** `reserveOrderItems()` and
  before the order transaction on both the single-seller and the multi-seller
  path, so a rejected checkout leaves zero reserved stock and zero rows —
  nothing to compensate. Side effect worth having: `POST /api/order` and
  `POST /api/order/shipping-fee` now return the same status and the same message
  for the same address, instead of the fee endpoint 400ing while create answered
  201. Blast radius checked at runtime rather than reasoned about: free-text
  callers (ids omitted) can now 400 where they used to get a fee-0 order, but
  only when `resolveAddressToGhnIds` matches nothing — and that is unreachable
  from the storefront, since `user_addresses` carries NOT NULL `district_id` +
  `ward_code`, so checkout always sends ids; a *valid* free-text address still
  resolves, still gets quoted (real non-zero fee `46207`) and still gets a live
  waybill. **Verified (local, dev Aiven + live GHN sandbox):** unknown district
  `999999` → **400** `"GHN does not know district 999999 …"`; ward `20308` under
  district `1442` → **400** `"Ward 20308 does not belong to GHN district 1442 …"`;
  unresolvable free-text → **400** `"Cannot resolve province …"`; control
  `1442`/`20110` → **201** with `ghnOrderCode: "L8V7XL"`; valid free-text → **201**
  with `ghnOrderCode: "L8V7XF"` and `shippingFee: 46207`; multi-seller (2 sellers)
  with the bad district → **400**. Stock proves the no-compensation claim:
  115 → 113 across the batch, exactly the two successful orders, and the
  multi-seller products stayed at 98/30 after their rejection — no reservation
  leaked, no phantom order in the buyer's list. tsc/eslint clean, Jest **31
  suites / 284 tests** (+3: refusal aborts before reserve, outage still places
  the order, multi-seller refusal aborts before reserve). Class **B** — the
  current FE already handles a 400 at checkout and already gets one from the fee
  endpoint it calls first, so no deploy window shows a user anything wrong.
  Recorded in `frontend-handoff.md` (GHN-CREATE-01) and `known-behaviors.md`.

- **SOCIAL-AUTHOR-01 — comments and replies carry `author` (2026-08-13).**
  The FE agent reported that `GET /api/social/posts/:id/comments` and
  `GET /api/social/comments/:id/replies` returned only `userId`, so
  `CommentNode.tsx` rendered a literal `Người dùng #usr_xU2Q7pGhhFpduGWz` to real
  users while the post above it showed a proper username — and it could not fix
  this client-side without one profile fetch per comment. Posts already embed
  `author` in the gateway (`fetchAuthorMap()`), so the fix is to run the same
  embed over the comment payloads: new `attachCommentAuthors()` +
  `collectCommentAuthorIds()` / `decorateCommentNodes()` in
  `apps/gateway/src/social/social.service.ts`, wrapped around the TCP result of
  `createComment`, `getComments`, `createReply` and `getReplies` — before
  `exposeReferences`, so `author.id` comes out as the opaque `usr_` id like
  everywhere else. **One** user-service call covers the entire payload: the
  helper walks the whole reply tree collecting ids into a `Set`, then resolves
  them in a single batched `GET_USERS_BY_IDS`, so the cost is flat in the number
  of comments (the FE's explicit requirement). It handles all shapes the social
  service returns — the `PaginatedResponse` envelope (decorates `data[]`, leaves
  `total/page/limit/totalPages/hasNext` untouched), the nested tree from
  `findDescendantsTree` (recurses `children[]` to any depth), and a single
  freshly created node. Change-impact review found one gap the four self-test
  curls did not: a created reply embeds the `parent` comment it answers, which
  had the same missing `author` one level up — now decorated too (`CommentNode`
  in `social.types.ts` carries both `children?` and `parent?`). Degrades the way
  posts already do: `fetchAuthorMap` swallows a user-service failure and returns
  an empty Map, so an unreachable user service yields `author: null` rather than
  failing the comment read; a deleted author is `null` for the same reason.
  Verified live end-to-end (create comment 201, create reply 201, list 200,
  reply tree 200 with `author` on root + child + grandchild, and `parent.author`
  on a created reply), plus a new spec
  `apps/gateway/src/social/social-comment-author.service.spec.ts` (5 tests)
  pinning list/tree/parent decoration, the *fixed* call count, and the
  `author: null` degrade. Jest **31 suites / 281 tests**. Release class **B** —
  purely a new field on existing items; the current FE keeps working.

- **GHN-DIST-01 — an unknown district no longer prices as "free" (2026-08-13).**
  The FE agent reported `POST /api/order/shipping-fee` answering
  `201 { shippingFee: 0 }` for `toDistrictId: 999999`, and was explicit that this
  is not the closed `shippingFee: 0` question (GHN-ADDR-01) but the *status code*:
  with a 201 the storefront treats the address as shippable and lets the order
  through, and the failure only surfaces later at waybill create. Two direct GHN
  probes found the asymmetry that makes a fix cheap: `/v2/shipping-order/preview`
  answers `200 total_fee: 0` for `to_district_id: 999999` (lax), while
  `/master-data/ward?district_id=999999` answers `400 "District ID khong ton
  tai"` (strict). So GHN *can* validate our input — just not on the endpoint we
  were calling. New `assertLocationExists()` (`apps/orders/src/ghn/ghn.service.ts`)
  runs one ward lookup and maps an explicit GHN 400 → `DISTRICT_NOT_FOUND`, a
  ward missing from the district's list → `WARD_NOT_IN_DISTRICT` (both new in
  `libs/constant/response-message.constant.ts`, both `BadRequestException`). It is
  called from **one** place — the `resolvedIds` branch of
  `buildShippingOrderBody` — which is the shared body builder for BOTH
  `previewShippingFee` and `createShippingOrder`, so the fee quote and the waybill
  agree by construction; the free-text branch needs nothing because
  `resolveAddressToGhnIds` only ever yields ids GHN gave us. The lookup rides the
  existing 24h ward cache, so steady state costs zero extra GHN calls.
  **Deliberately fail-open**: only an explicit GHN 400 rejects — outage,
  circuit-open, timeout, or an empty ward list log a warn and let the quote
  through, because validation is an input check, not a health gate, and a GHN
  outage must never start rejecting addresses that worked yesterday. Verified on
  local runtime: bogus district → `400 "GHN does not know district 999999 — pick
  a district from GET /api/shipping/districts"`; valid `1442`/`20110` control →
  `201 {"shippingFee":0,"expectedDeliveryTime":"2026-08-13T16:59:59Z"}`;
  cross-district ward → `400 "Ward 20308 does not belong to GHN district 1442"`.
  tsc/eslint clean; jest 30 suites / 276 tests (+4: unknown district, cross-district
  ward, master-data down still quotes, empty ward list still quotes — the existing
  spec had to grow an `httpService.get` mock, since without it the new call throws
  a `TypeError` that `isGhnOutage()` counts toward the circuit breaker).
  **Change-impact review:** `assertLocationExists` also gates `createShippingOrder`
  at ready-to-ship, a leg no curl reached, so every stored pair was checked against
  GHN directly — 18 orders, 5 distinct pairs, 4 pass. The one rejecting pair
  (district `1485` + ward `1A0807`, orders 128/129) is bad synthetic data, not a
  false positive: both are `canceled` with `ghn_order_code: null`, created by a
  "Local Probe" address whose free text says *Hai Bà Trưng* while `1485` is *Cầu
  Giấy* and `1A0807` is *Phường Mai Động* in district `1490`. No live path
  re-validates a canceled order, and no real FE selection can produce that
  mismatch (the ward dropdown is scoped to the chosen district). Known asymmetry
  left alone on purpose: `getShippingFeeOrZero()` still swallows this 400 so
  `POST /api/order` books a bogus district at fee 0 — that is the pre-existing
  PRODTEST-0806 #2 gap, not this one. Release class **B**: the FE already speaks
  400 here (RESIL-01) and asked for it.

- **RET-NUM-01 — `refundAmount` is a number (2026-08-13).** The FE agent reported
  return requests serializing `"refundAmount": "45000.00"` while
  `src/types/order.ts:61` declares `refundAmount: number | null` — the type was
  lying, and the three render sites only looked right because each wraps
  `Number(...)`. Same root cause as ORDER-SHAPE-01's `items[].price`: mysql2
  hydrates `DECIMAL` as a string. Fix is one line —
  `transformer: decimalToNumber` (already in `@app/common`) on
  `OrderReturnRequest.refundAmount` (`apps/orders/src/entity/`) — which covers
  every read path at once, since they all hydrate the same entity. Verified on
  local runtime: `GET /api/order/return-requests` (admin) → `refundAmount 357
  number`, `/return-requests/mine` (buyer) → `6800 number`, pending/rejected rows
  still `null`. tsc/eslint clean. Release class **B**: `Number(45000)` and
  `Number("45000.00")` are the same value, so the FE's existing wrappers keep
  working through the deploy — nothing breaks in the window, and the FE can drop
  them whenever it likes.

- **ORD-RBAC-01 — the seller's manual ship/deliver/complete path is gone
  (2026-08-13).** The FE agent asked for a 403 on
  `PATCH /api/order/:id/{ship,deliver,complete}` for role `shop`. The open
  question was whether removing it would strand orders whose GHN webhook never
  fires — the reason the path existed. Reading `readyToShip` settled it: it
  refuses to leave CONFIRMED without a GHN waybill ("never advance to PROCESSING
  without a waybill — that strands the order"), so **every** order those three
  routes can reach already has one, and the previously-recorded suggestion to
  "gate the routes on `ghnOrderCode !== null` instead of on role" was a no-op —
  that condition is always true there. With the waybill guaranteed, the carrier
  is the only correct writer of the remaining statuses: a hand-set status makes
  the local order disagree with GHN, and a hand-set *terminal* status makes the
  order deaf to the webhook that follows (`applyGhnStatus` ignores terminal
  orders). It was also a money path — COD stamps `paidAt` in
  `finalizeOrderCompletion`, so a seller could certify collection without
  collecting, and start the buyer's return window early. `advanceOrderStatus`
  (`apps/orders/src/orders.service.ts`) now throws
  `ForbiddenException(ORDER_MESSAGE.SELLER_CANNOT_ADVANCE)` when `!isAdmin`,
  **before** loading the order (so a seller gets 403 even for a bad id — no
  existence oracle); the ownership lookup it replaced is dropped from this path
  only (`getSellerProductIds`/`verifySellerOwnsOrder` still serve
  `getSellerOrderDetail`, return review, and the seller order list).
  `SELLER_FORWARD_TRANSITIONS` → `ADMIN_FORWARD_TRANSITIONS` and the log line now
  says "manually by admin". Stranding is covered by the shipping console the GHN
  frontend already drives: `POST /api/order/admin/ghn/orders/:id/sync` and, in
  demo mode, `.../demo-status`. Blast radius checked: no other caller advances an
  order — the only other writer of COMPLETED is the GHN webhook path, untouched;
  the three ORD-GUARD-01 specs that exercised this path as a seller now pass
  `isAdmin: true` (they test the payment guard, not RBAC); `confirm` and
  `ready-to-ship` still accept `shop`. Verified on local runtime: shop `test1`
  → **403** on all three routes with the new message, admin `testadmin` → **200**
  `status:"shipped"` on the same order. tsc clean, eslint clean, jest 30 suites /
  272 tests (one new: "forbids a seller from advancing, without touching the
  order"). **Release class B, not C** — the rule table calls a guard that turns
  200 into 4xx class C, but no shipped frontend calls these routes: the storefront
  has three dead wrappers in `src/api/orders.ts` with zero call sites and its
  `SellerActionKind` is `'confirm' | 'ready-to-ship'`, and the GHN console only
  uses `/admin/ghn/*`. Recorded in `frontend-handoff.md` so the storefront deletes
  the dead wrappers.

- **PATCH-ATOMIC-01 — a failed stock edit no longer half-applies a product edit
  (2026-08-12).** The FE agent asked, as the open half of P0-03, whether
  `PATCH /api/products/:id` is a transaction when the inventory leg fails: if it
  is not, one bad save leaves a renamed/repriced product whose stock never moved,
  and the form silently disagrees with the DB. It is not, and it cannot be —
  products are MySQL, inventory is a different service on Postgres, so the two
  writes can never share a transaction. What could be fixed is *when* the
  inventory leg is allowed to fail. `updateProduct()`
  (`apps/gateway/src/product/product.service.ts`) now splits the old
  `syncInventoryStock()` into a read half (`resolveStockSyncTarget`) that runs
  **before** the product write and a write half (`applyStockSync`) that runs
  after. So the failures that actually happen in practice — inventory down,
  unreachable, no base row — abort the PATCH with nothing committed, instead of
  committing every product field and then answering 502. Only a failure of the
  inventory write itself can still half-apply, and that leg already restores the
  stock mirror. Behaviour otherwise identical: same status codes, same
  warn-and-skip for SKU-matrix/row-less products, same no-op when the stock is
  already in sync, same round-trip count.
  - **Verified live (dev, gateway 3000).** Happy path: `PATCH` with
    `{name, stockQuantity:73}` → 200, product 73 **and** inventory row 38 → 73.
    Abort path: inventory process killed → same PATCH with
    `{name:"MUST NOT PERSIST", stockQuantity:999}` → **502**, and `GET` still
    returned the previous name and `stockQuantity:73` — nothing written.
    Inventory restarted, values restored to `JBL Flip 6` / 70 on both sides.
    `tsc --noEmit` clean, eslint clean, jest **30 suites / 271 tests** green
    (+1 new regression test asserting the product write never fires when the
    pre-flight read throws).
  - The full failure matrix (which step leaves what behind, including the
    separate `skuList` transaction) is documented in `known-behaviors.md` →
    PATCH-ATOMIC-01. FE keeps its `onError` invalidate/refetch mitigation — a
    failed PATCH still does not mean "nothing changed".

- **BATCH-0811 + BATCH-0812 released to prod (2026-08-12).** Both sweep batches
  cleared the release gate once the storefront and GHN-console agents flipped
  their cells, and are now on `main` (`26762ca`) and deployed. Verified on prod:
  `GET /api/order/seller` returns joined `items` with `price` as a **number**
  and the new `paidAt` field. The `⏳ PENDING RUNTIME TEST (MEDIA-ORPHAN-01)`
  prod sweep is closed as a no-op — `GET /api/social/posts` on prod returns
  `total: 0`, so there are no Cloudinary URLs there to check.

- **GHN console batch: the shipping console can act again, and stops leaking
  what it should not (2026-08-12).** Five items the GHN-console FE agent filed
  after testing against prod (`../.agent-local/backend-handoff.md`). All five
  are verified on dev; the tree is class C and HELD behind the release gate.
  - **GHN-ACT-01 — every fresh order showed `availableActions:["read","history"]`,
    so the console was read-only in practice.** Two independent causes.
    (a) `getAvailableShippingActions()` (`apps/orders/src/orders.service.ts`
    ~:1909) never listed `PENDING`, but the waybill is bought *during checkout*
    — so a just-placed order sits at `pending` locally while GHN already holds
    it at `ready_to_pick`, which is the *widest* editable window there is.
    `PENDING` now counts everywhere `CONFIRMED` does: `cancel` and
    `update_cod`/`update_receiver`. `sync` was already available; `return`
    deliberately still starts at `SHIPPED`. (b) The list was role-blind, so a
    `logistics_operator` was advertised `sync`/`cancel` and then got a 403 from
    the guard. The gateway now narrows it per caller —
    `filterShippingActions()` in `apps/gateway/src/order/order.service.ts` keeps
    only `READ_ONLY_SHIPPING_ACTIONS` unless the caller holds
    `shipping update:any`. The orders service stays purely state-based; role is
    a gateway concern.
  - **GHN-RAW-01 — `ghnDetail.raw` forwarded GHN's ~123-key detail verbatim.**
    That put `shop_id`, `client_id`, every `*_warehouse_id`, `created_ip` /
    `updated_ip`, `created_employee` / `updated_employee`, `_id`, `soc_id`,
    `transaction_ids`, `internal_process`, `hub_designation_log`, `sort_code`,
    `seal_code`, `*_station_id` and the pricing-config ids on a
    browser-reachable response — `shop_id` in particular is half of what an
    attacker needs to talk to GHN as us. `sanitizeGhnRawDetail()`
    (`apps/orders/src/ghn/ghn.service.ts`) rebuilds `raw` from an **allow-list**
    (not a deny-list: GHN adds fields without notice, and a new one must not
    leak by default), and rebuilds nested `log[]`/`items[]` entry by entry
    because they carry warehouse ids of their own. Safe at source — grep
    confirms nothing internal reads `.raw`; the console-facing scalars
    (`totalFee`, `codAmount`, receiver fields) are mapped at the top level of
    `GhnOrderDetail` and untouched.
  - **GHN-HIST-01 — the console timeline showed numeric internal ids.**
    `actorId` now goes through the gateway's existing `exposeUserReferences`
    (→ `usr_…`), and every persisted GHN message names the order the way HTTP
    does (`NO_GHN_ORDER_CODE`, `GHN_ACTION_NOT_ALLOWED`,
    `GHN_STATUS_TERMINAL_IGNORED`, `GHN_STATUS_STALE_IGNORED`,
    `GHN_STATUS_CONCURRENT_SKIPPED` → `order.publicId ?? String(order.id)`).
    Rows written before this change keep their numeric text — the fix is
    forward-only, not a backfill. The 404 path needed nothing:
    `resolveOrderId()` already reports the public id it was given.
  - **GHN-ENUM-01 — a typo'd filter returned `200` + an empty list**, which the
    console cannot distinguish from "no such orders". `status` and `ghnStatus`
    on `AdminGhnOrdersQueryDto` were bare `@IsString()`; they are now `@IsIn`
    over `ORDER_STATUS_VALUES` and the new `GHN_STATUS_VALUES`
    (`libs/constant/shipping.constant.ts` — the gateway must not import from
    `apps/orders`). `GHN_STATUS_VALUES` is a superset of both `mapGhnStatus()`'s
    vocabulary and `DEMO_GHN_STATUSES`, so nothing the system can *record* is
    rejected as a filter.
  - **GHN-RBAC-01 — `logistics_operator` could read the money.** Option A
    (user's call): the route still answers `200` for every shipping role, but
    the monetary fields are **omitted** for callers holding neither
    `order read:any` (admin) nor `shipping update:any` (`shipping_manager`) —
    `summary.totalRevenue`, `summary.averageOrderValue`,
    `revenueOverTime[].revenue`, `topProducts[].revenue`. Omitted, not zeroed:
    a `0` is indistinguishable from "we really earned nothing" and the console
    would render it as fact. `stripRevenue()` rebuilds the payload field by
    field, so a money field added upstream later cannot leak by default. The
    non-throwing grant check is `hasPermission()`
    (`apps/gateway/src/common/rbac/has-permission.util.ts`), reusing the same
    `ac` grants object `RoleAuthGuard` already imports.
  - **Verified on dev** (`shipmgr_test` / `logistics_test` / `testadmin`; 50/50
    jest in `orders.service.spec.ts`; tsc + eslint clean): 7 `pending` orders
    with waybills now list `sync,cancel,update_cod,update_receiver` for a
    manager and `read,history` for an operator on the *same* rows;
    `POST …/update-cod` on a `pending` order → `201` (39 → 39, no value change)
    where it used to be a 400, and the same call as `logistics_operator` → 403,
    so the advertised list now matches enforcement; `POST …/cancel` on a
    `pending` order → `201` `pending → canceled` with an `action` history row,
    and the order correctly falls back to `read,history,sync`; `raw` returns 43
    allow-listed keys with **zero** of the 15 probed leak keys; a freshly
    written history row reads `"Ignored GHN status \"cancel\" for terminal order
    ord_516a8c3e816611f1"` with `actorId: usr_60ccc36681c411f1`;
    `?status=bogus` and `?ghnStatus=shiped` → `400` naming the accepted values
    while `?ghnStatus=ready_to_pick` still returns rows; analytics for
    `logistics_operator` has `summary` keys `completedOrders,totalOrders` and no
    `revenue` anywhere, while manager and admin keep the full payload.
  - **Not in scope, deliberately:** the seller manual ship/deliver/complete path
    (ORD-RBAC-01 — an open product decision, see `snapshot.md`), and
    `topProducts[].productId`, which is still numeric (PRODTEST-0806 defect #4).

- **MEDIA-ORPHAN-01: post media cleanup only destroys an asset no row still
  references, and the dead dev post URLs are gone (2026-08-11).** FE reported
  four post rows whose `imageUrls` pointed at Cloudinary assets that answer
  **404** — a broken image plus a wasted request and a console error on every
  feed load — and asked whether SEC-M7's orphan cleanup had destroyed assets
  that were still in use.
  - **Answer: no, SEC-M7 was not the cause.** The only destroy path is
    `destroyDroppedMedia()`, and it only ever passed URLs that the *saved or
    deleted row itself* no longer carried. Evidence: all five dead URLs were
    still referenced by their own live posts (so nothing had "dropped" them),
    and the Cloudinary Admin API listed exactly **one** asset under
    `trybuy/posts` — the dev cloud had been purged wholesale at some point. The
    URL shapes confirm it independently: `trybuy/posts/trybuy/posts/…` (doubled
    folder), `undefined_6OyymN8jZY.png`, and a hand-written `17_mine.jpg` are
    artifacts of an old FE upload bug and of manual seeding, not of a destroy.
    Nothing in `scripts/seed/` or `database/` references them.
  - **A real (narrow) hazard did exist, and is now closed.** `imageUrls` is
    client-supplied, so the same uploaded URL can legitimately sit on more than
    one post (a re-post, or the same photo attached twice). Editing or deleting
    *one* of those posts would have destroyed the asset out from under every
    other post still showing it. `apps/social/src/social.service.ts` now routes
    all three call sites (`editPost`, `deletePost`, moderation delete) through
    `destroyDroppedMedia()` → `destroyUnreferencedMedia()`, which re-queries
    `posts` for each dropped URL (`post.videoUrl = :url` OR
    `JSON_CONTAINS(post.image_urls, JSON_QUOTE(:url))`, `LIMIT 1`) and destroys
    only the URLs with **zero** remaining references. It runs after the caller's
    own commit, so the edited/deleted row can no longer match itself, and it is
    wrapped so a failed reference check logs a warn and destroys **nothing** —
    cleanup stays best-effort and can never surface on the mutation.
  - **Live proof of both branches** (real 1×1 PNG uploaded through the signed
    flow as user 17 → `trybuy/posts/17_OwtPJaTdAJ`, attached to two posts):
    delete the first post → delivery URL still **200** (shared asset preserved —
    this is the case that previously destroyed it); delete the second post →
    Cloudinary Admin API `404 Resource not found` (true orphan destroyed).
  - **Data half (DEV):** 5 dead URLs across posts 5, 6, 7 (two) and 14 were
    verified 404 one by one, then their `posts.image_urls` set to `NULL` (all
    four rows had no surviving image). Re-probe of every Cloudinary URL in the
    `posts` table now returns a single row — post 15's `20_4u4glh7.png`, **200**.
    No 404-bound post media remains on dev.
  - **Prod not swept** — the EC2 was in its stopped window and both `/live` and
    the posts endpoint timed out. Prod runs a separate Aiven DB, so it needs its
    own pass; recorded as `⏳ PENDING RUNTIME TEST (MEDIA-ORPHAN-01)` in
    `snapshot.md` with the exact steps.
  - Validation: `tsc --noEmit` clean, prettier + eslint clean, jest 30 suites /
    270 tests green.

- **ORDER-SHAPE-01: order items are the same shape on every path — `confirm`
  returns them, `price` is always a `number`, and the seller list stops
  reporting `items: []` (2026-08-11).** FE reported that
  `PATCH /api/order/:id/confirm` answered with `"items": []` on an order that
  had one item, while `PATCH /api/order/:id/ready-to-ship` returned
  `items[0].price` as the **string** `"15000.00"` where `POST /api/order`
  returned the **number** `15000` for the same row.
  - **`confirmOrder` now loads `relations: ["items"]`**
    (`apps/orders/src/orders.service.ts` ~:2728). It was the only lifecycle
    transition that did not — `readyToShip`, `advanceOrderStatus` and
    `getSellerOrderDetail` all did. An empty `items` array reads as "this order
    lost its items", which is worse than omitting the key.
  - **`OrderItem.price` got `transformer: decimalToNumber`**
    (`apps/orders/src/entity/order_item.entity.ts`). The order entity already
    used that transformer on `total`/`codAmount`/`shippingFee`/`discountAmount`;
    the item price was the one money column left raw, so mysql2 hydrated it as
    `"15000.00"` on **every** read path (GET order, buyer/seller list, seller
    detail, ready-to-ship) while `POST /api/order` — which returns the in-memory
    entity it just saved — returned a real number. One transformer fixes all of
    them at once. Writes are unaffected (`to` passes the value through) and the
    arithmetic callers were already `Number()`-guarded.
  - **The seller order list joins its items.** `getOrdersBySeller()` built its
    query without `leftJoinAndSelect("order.items")`, so `GET /api/order/seller`
    returned `items: []` for every row — and the gateway's product-image/SKU
    enrichment for that list (`buildProductMap` + `decorateItem`) was dead code.
    The buyer list (`getOrdersByUser`) always loaded items; this closes the
    asymmetry. Verified the join does not break pagination: 32 orders, 32 unique
    ids, 3 of them multi-item, `total` unchanged.
  - **`image` alongside `productImage` is deliberate, not a duplicate** — see
    `known-behaviors.md`. `productImage` is the raw purchase-time snapshot
    (null on pre-P2-02 orders); `image` is that snapshot with a live-product
    fallback, so they only *look* identical on recent orders.
  - Verified live: `POST /api/order` → `price: 299` (number) →
    `PATCH …/confirm` → 200 with one decorated item, `price` number →
    `PATCH …/ready-to-ship` → 200, `price` number, waybill `L89XNE`;
    `GET /api/order/:id`, `GET /api/order/seller/:id` and
    `GET /api/order/seller` all report `typeof price === "number"`.
    tsc + eslint clean, jest 30 suites / 270 tests green.

- **INV-CONTRACT-01: `PUT /api/inventory/:id` accepts `sku`, and the inventory
  error messages stop leaking the numeric product id (2026-08-11).** FE's
  product-listing flow issued three requests after `POST /products` and two of
  them failed: `POST /api/inventory` → 409 `"Inventory for product ID 30
  already exists"` and `PUT /api/inventory/:id {sku, availableStock}` → 400
  `"property sku should not exist"`. The seller saw "tạo thất bại" over a
  product that had in fact been created.
  - **`sku` is now an optional, updatable field** on `UpdateInventoryDto`
    (gateway DTO + `apps/inventory/src/inventory.types.ts`), `@IsNotEmpty`
    `@MaxLength(100)` to match the column. Rejecting the very field the
    resource's own `GET` returns was the defect; accepting it makes the
    read-modify-write round trip work. `inventory_v2.sku` is `unique`, so
    `update()` now catches the constraint violation and answers **409**
    `SKU_ALREADY_EXISTS` instead of letting the driver error surface as a 500.
  - **Numeric product id no longer leaks.** `INVENTORY_MESSAGE
    .ALREADY_EXISTS_FOR_PRODUCT` / `.NOT_FOUND_BY_PRODUCT` were widened to
    `number | string`, and the gateway's `hideInternalProductId()` re-renders
    exactly those two messages with the `prod_…` id the caller sent. It matches
    the **exact rendered string** rather than regex-replacing digits, so no
    other message — and no other number inside one — is touched. Applied to
    `create()` and `findByProductId()`, the two paths that resolve a public id
    to an internal one. The inventory service itself keeps building messages
    from the numeric id: it has no other id to use.
  - **Contract answer for FE (no code change):** `POST /api/products` **always**
    creates the base inventory row for a non-`skuList` product, and rolls the
    product back if that fails — so a 201 guarantees the row exists and FE's
    `POST /inventory` + `PUT /inventory` pair is pure overhead. A `skuList`
    product gets one row per SKU asynchronously via `sku_upserted`.
  - **Verified.** tsc/eslint clean; Jest 30 suites / 270 tests green. Live:
    `PUT /api/inventory/47 {sku:"SNY-WF1000XM5", availableStock:59}` → 200 (was
    400); rename to `SNY-WF1000XM5-TMP` → 200 with the new value, restored
    after; rename onto another row's sku → **409** `"Inventory with sku
    XM-RBUDS5-BLK already exists"`; `POST /api/inventory` on an existing
    product → **409** `"Inventory for product ID prod_ffc7fb1381d211f1 already
    exists"`; `GET /api/inventory/product/prod_ffc802c681d211f1` (product with
    no row) → **404** `"Inventory for product prod_ffc802c681d211f1 not
    found"`.

- **NOTIF-LIFECYCLE-01: sellers now hear about orders, buyers now hear about
  every status move, and all order notifications carry the public id
  (2026-08-11).** FE filed two 🔴/🟡 reports: a seller got NO notification when
  an order arrived or was canceled (the seller dashboard had nothing to react
  to), and a buyer got nothing between `order_created` and the terminal
  `payment_completed` — `confirm` and `ready-to-ship` were silent. A third
  report noted the message text embedded the internal `#38` while every other
  field on the payload was a `ord_` public id.
  - **New event** `EVENT.ORDER_STATUS_CHANGED_EVENT = "order.status_changed"`
    (`libs/common/src/constants/event.ts`). One generic event, not one per
    status — the consumer decides what is worth telling a user. Payload
    `{orderId, publicId, userId, sellerId, status, previousStatus}` carries
    everything the notification service needs, so it makes no TCP round trip
    back to orders. `ORDERS_EXCHANGE` is a **fanout**, so no binding change was
    needed; the three consumers with no matching `@EventPattern`
    (inventory/payments/rewards) nack no-requeue and discard, exactly as they
    already do for `order.return_requested` (verified: every queue
    ready=0/unacked=0 after the full lifecycle run).
  - **Emitted from the four transition choke points** (`orders.service.ts`
    `publishOrderStatusChangedEvent()`): `confirmOrder` (PENDING→CONFIRMED),
    `readyToShip` (CONFIRMED→PROCESSING), `advanceOrderStatus` (the manual
    seller path) and `applyGhnStatus` (the GHN webhook). Publish is
    best-effort — null-channel warn + try/catch — so a broker outage can never
    fail a transition that already committed. `applyGhnStatus` is guarded by
    `if (mappedStatus !== OrderStatus.CANCELED)` because
    `finalizeGhnCancellation` publishes `order_canceled` itself; without the
    guard a GHN cancel would notify the buyer twice. `advanceOrderStatus`
    publishes **after** `finalizeOrderCompletion`, matching the webhook path, so
    the buyer is never told "delivered" before the COD payment is recorded.
  - **Consumer** (`apps/notification/src/notification.controller.ts`).
    `handleOrderCreated` and `handleOrderCanceled` each gained a seller leg
    (`new_order` "Bạn có đơn hàng mới … cần xác nhận" / `order_canceled` "…
    không cần chuẩn bị hàng"), skipped when `sellerId === userId`. New
    `handleOrderStatusChanged` maps status → Vietnamese message for
    `confirmed|processing|shipped|delivering|completed` and returns `null` for
    anything else (unknown statuses ack and drop rather than dead-letter).
    Notification `type` is `order_<status>`, so the FE gets
    `order_confirmed`/`order_processing`/`order_shipped`/`order_delivering`/
    `order_completed` alongside the existing types. The gateway WS push
    controller has no type filter, so all of these push live with no FE change.
  - **Email volume** was the one thing the Change-Impact Review changed after
    the fact: mailing all five moves is spam. `EMAILED_STATUSES` gates email to
    `shipped|delivering|completed` — in-app + WS still fire for all five. That
    also closes the **F7 follow-up** (shipping-milestone emails), which was
    waiting on exactly these events.
  - **Public id in message text.** New `orderLabel(orderId, publicId)` renders
    `#${publicId ?? orderId}`; every order notification (`order_created`,
    `payment_completed`, `order_canceled`, the three return handlers and all
    five new ones) now emits `#ord_…`. The numeric fallback only applies if a
    pre-PUBID order somehow lacks a public id.
  - **Verified.** tsc/eslint clean; Jest 30 suites / 270 tests green — three
    `toHaveBeenCalledTimes(1)` publish assertions in `orders.service.spec.ts`
    were replaced with a `publishedEventNames()` helper asserting
    `[payment_completed, order.status_changed]` in order, which is what caught
    the pre-settlement ordering bug. Live on local: `ord_Gb1S3URe7EylR3Un`
    walked confirm → ready-to-ship → ship → deliver → complete (all 200) and
    produced, newest-first, `payment_completed`, `order_completed`,
    `order_delivering`, `order_shipped`, `order_processing`, `order_confirmed`,
    `order_created`, every message carrying `#ord_Gb1S3URe7EylR3Un`; a buyer
    cancel produced the seller "không cần chuẩn bị hàng" line and exactly ONE
    buyer `order_canceled` (proving the CANCELED guard).
  - Residual (deliberate) behaviour recorded in `known-behaviors.md`: if the
    seller leg throws, the requeue can re-deliver and duplicate the buyer
    notification.

- **STOCK-SYNC-01: `PATCH /products/:id` now propagates `stockQuantity` to
  inventory, and a direct inventory edit now refreshes the product mirror
  (2026-08-11).** FE reported a silent data loss: editing stock on a product
  returned `200 {stockQuantity:150}` while `inventory.availableStock` stayed at
  100, and the seller's number was then overwritten back to 100 by the next
  `inventory.stock_changed` fanout.
  - **Cause.** Inventory owns stock; `products.stock_quantity` is only a mirror
    that the fanout refreshes (one-way, inventory → product). `updateProduct`
    wrote the mirror and nothing else, so the write was doomed from the moment
    it succeeded. `createProduct` already pushed the other way (it creates the
    base inventory row), so the update path was the odd one out.
  - **Fix, gateway side** (`apps/gateway/src/product/product.service.ts`).
    After the product row is updated, `syncInventoryStock()` reads the product's
    inventory rows (`inventory.get_by_product_ids` — the non-throwing batch
    read), picks the **base row** (`productSkuId == null`, the single row a
    simple product owns), and issues `inventory.update
    {id, update:{availableStock}}` when the value actually differs. A
    SKU-matrix product has no base row: it is logged at warn and skipped, since
    its stock lives per SKU and is maintained by `sku_upserted`.
  - **Rollback on failure.** If inventory refuses or is unreachable, the product
    row already holds the new number — leaving it there would recreate the exact
    desync. `restoreProductStockMirror()` writes the pre-edit value back
    (best-effort, never rethrows) and the original error surfaces, so the seller
    is told the stock did not apply instead of getting a 200 over a split state.
    Propagation runs **after** the product update, not before: a validation
    failure (duplicate SKU 409) is far likelier than an inventory outage, and
    propagating first would move stock while the seller believes the PATCH
    failed. `assertProductMutationAccess()` now returns the `ProductData` it
    already fetched (was `Promise<number>`) so the pre-edit stock is available
    without a second round trip; `deleteProduct`, the only other caller, was
    adapted.
  - **Fix, reverse direction** (`apps/inventory/src/inventory.service.ts`
    `update()`). `PUT /api/inventory/:id` never emitted `stock_changed`, so a
    direct stock edit left the catalog showing the old quantity until an order
    happened to move stock. It now emits — base rows only (a SKU row's stock is
    one variant's, not the product total) and only when the value changed. The
    PG `bigint` `product_id` arrives as a string, so it is `Number()`-normalized
    to match every other emitter.
  - **`InventoryData.productSkuId`** added to `product.types.ts` — the field the
    base-row check needs.
  - **Verified.** tsc/eslint clean; Jest 30 suites / 270 tests green including 4
    new ones (push, skip-when-in-sync, SKU-matrix left alone, mirror restored on
    inventory failure). Live on local against dev Aiven: PATCH 150 →
    `availableStock:150` with `reservedStock:3` untouched; PATCH 0 →
    `OUT_OF_STOCK`; PATCH 77 → 77/77; a non-stock PATCH issues no inventory
    write; `PUT /inventory/47 {availableStock:155}` → product mirror 155, and
    the public `GET /api/products/:id` returned the new number on the first read
    (no stale micro-cache window); SKU-matrix PATCH → 200 with SKU stocks 5/7
    unchanged; foreign seller → 403; delete probe → 204 then 404.

- **FE-inbox batch: public-id leaks, batch-read status, order-code search
  (2026-08-11).** Four FE-reported contract defects fixed in one sweep, plus one
  answered question.
  - **WISHLIST-ID-01** — `GET /api/products/wishlist` was the only catalog list
    returning `{"id":"29","publicId":"prod_…","userId":"1"}`, so the FE rendered
    `/product/29` and the detail route 400'd on it. Cause was not a missing
    mapper but a branch that bypassed the existing one: `getWishlist`
    (`apps/gateway/src/product/product.service.ts` ~:1433) took an early return
    for the enriched `data` envelope and skipped `exposeProductReferences()` —
    the helper that swaps `id` for the public id, drops `publicId`, and maps
    `userId` → `usr_`. Both branches now go through it.
  - **REVIEW-ID-01** — `POST /api/products/:id/reviews` returned `userId` as the
    internal number while `GET` on the same row returned `usr_…`. Same class:
    the POST hand-built its response instead of exposing it. Now routed through
    `exposeProductReferences`; POST and GET are byte-identical in shape.
    `product_reviews.id` stays numeric — that domain is deliberately not
    PUBID-converted.
  - **Batch read answers 200, not 201** — `POST /products/with-inventory/multiple`
    is a batch lookup (POST only because the id list is too long for a query
    string); `@HttpCode(HttpStatus.OK)` added. Also resolved the FE's side note:
    an empty batch is NOT rejected — `{"productIds":[]}` → `200 []`. Their 400
    came from sending `{"ids":[]}`; the field is `productIds`
    (`GetProductsWithInventoryDto` has no `@ArrayNotEmpty`).
  - **Order-code search `?q=`** — `GET /api/order/user/:userId?q=` now filters
    server-side on `Order.publicId` with `Like(%term%)`, ANDed with `status`,
    with `total`/`totalPages`/`hasNext` describing the searched set. The `ord_`
    prefix is optional (substring match), matching is case-insensitive (MySQL
    `*_ci` collation), input is trimmed and capped at 32 chars, and a new
    module-level `escapeLikeTerm()` neutralizes `\ % _` so a buyer typing `%`
    gets zero rows instead of a full scan (TypeORM's `Like()` emits no `ESCAPE`
    clause; MySQL's default escape char is backslash, so this is sufficient).
  - **Found by the change-impact review, not the self-test:** `getAdminOrders`
    shares `GetOrdersByUserQueryDto`, so adding `q` there advertised a Swagger
    param that silently returned unfiltered rows. `q` is now wired through the
    admin path too (`GET_ALL_ORDERS` → `getAllOrders`), with the same helper.
  - **Social rate-limit question answered (no code change).** The FE's recorded
    "60 req/60s" was never the number. `GET /api/social/posts` carries no
    explicit `@RateLimit`, so it uses `RATE_LIMIT_DEFAULT_LIMIT` —
    120/60s in `.env.example` and in `local/nodeA/.env.production.example`. On
    **prod** the route is not counted at all: `RATE_LIMIT_SKIP_PUBLIC_GET=true`
    skips the Redis counter for `@Public` GETs without an explicit decorator, so
    only nginx `limit_req 30r/s burst 60` per IP applies. The 9-then-429 the FE
    measured is a **dev-box-only** artifact: `local/nodeA/.env` still carries
    `RATE_LIMIT_DEFAULT_LIMIT=10`, left over from a limiter test. The window is
    fixed (not sliding), which is why it stayed hot for the rest of the minute.
  - **Verified live** on local against dev Aiven: wishlist row returns
    `id: "prod_ffc802c681d211f1"` with no `publicId` and `userId: "usr_…"`;
    review POST returns `userId: "usr_60ccb4be81c411f1"` identical to the GET;
    batch read → 200 (and `[]` → 200); `?q=` on 73 orders → `c2AD`, `ord_c2AD`
    and `C2ad` each return exactly `ord_c2ADeae1qObLgh8I`, `%`/`_`/empty/blank
    return the unfiltered 73 or 0 correctly, 33 chars → 400, `q` + `status=pending`
    → 0 while `q` + `status=completed` → 1; admin list 142 → 1 with the same `q`.
    tsc/eslint clean, `orders.service.spec.ts` 50/50 green.

- **ORD-GUARD-01 — a seller could fulfil (and get refunded on) an order nobody
  paid for (2026-08-11).** Reported by FE from prod: a `vnpay` order the buyer
  abandoned at the gateway stayed `pending`, yet the seller could `confirm` →
  `ready-to-ship` → `ship` → `deliver` → `complete` it, the buyer could then
  request a return, and approving it "refunded" 90.000 đ that was never
  collected. The FE could not defend itself — the order payload carried no
  payment fact at all.
  - **Root cause:** orders owns no payment state. Payments lives on Node B and
    reaches orders only through the `payment_completed` fanout, which claims the
    row `PENDING|CONFIRMED → PROCESSING`. Every seller transition checked only
    `status`, and `status` alone cannot distinguish "paid, claimed, then
    advanced" from "seller clicked confirm on an unpaid order".
  - **Fix — one local fact, not a cross-node call.** New `orders.paid_at`
    (`DATETIME NULL`), stamped by `markOrderPaid()` — a conditional
    `UPDATE … WHERE paid_at IS NULL` so a replayed event never rewrites the
    original timestamp. Stamped from `handlePaymentCompleted` before any early
    return (money is in, whatever the order does next) and, for COD, inside
    `finalizeOrderCompletion` where the cash actually changes hands — deliberately
    NOT via the fanout it publishes there, so `paid_at` does not depend on RMQ
    being up. New `assertOnlinePaymentSettled()` (COD or `paidAt` ⇒ pass, else
    `400`) guards `confirmOrder`, `readyToShip` and `advanceOrderStatus`. A
    payments TCP call was rejected: orders has no payments client, it would be a
    cross-node hop, and the seller list would N+1 it.
  - **Same column answers the FE's ask.** `paidAt` is exposed on every order read
    (`exposeOrder` spreads the entity) so the FE can hide the seller's confirm
    button and keep showing "THANH TOÁN NGAY" without guessing. The transition
    responses mirror the fresh stamp onto the in-memory entity, so a completion
    response never reports `paidAt:null` while a refetch disagrees.
  - **Migration** `nodeA-20260811-001-add-paid-at-to-orders` (additive,
    INFORMATION_SCHEMA-guarded, NULL-only backfill: non-COD at
    processing/shipped/delivering/completed and COD at completed get
    `updated_at`). Known imprecision, deliberate: a row a seller had already
    hand-walked before the guard existed is indistinguishable from a genuinely
    paid one and is treated as paid — the alternative strands real paid orders
    mid-fulfilment.
  - **Verified.** `tsc --noEmit` clean; eslint/prettier clean on all 7 changed
    files; `orders.service.spec.ts` 50/50 green with 7 new cases (unpaid vnpay →
    400 on confirm/ready-to-ship/advance, no waybill bought; paid online passes;
    COD never blocked; conditional stamp; in-memory mirror). Runtime on local
    nodeA: unpaid `vnpay` `ord_UwCSkjSDvunAk1uC` → `confirm` **400** *"Order
    cannot be advanced — the vnpay payment has not completed yet"*, same on
    `ready-to-ship`; COD `ord_nenUbkIGHpCbCZuS` confirmed 200 and walked to
    `completed` with `paidAt` persisted; COD `ord_c2ADeae1qObLgh8I` returned
    `paidAt` on the completion response itself.
  - **Not changed, on purpose:** `PATCH /api/order/:id/{ship,deliver,complete}`
    still accepts role `shop` without a GHN waybill —
    `SELLER_FORWARD_TRANSITIONS` is a documented fallback for a delayed/absent
    GHN webhook. The money exploit the FE reported is closed by the payment
    guard regardless; whether the manual path should also be revoked is a
    product decision, recorded in `snapshot.md`.

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
  - **DEPLOYED AND VERIFIED ON PROD 2026-08-11** (commit `b2850ae`, pm2 restart
    220s after the push). Re-ran the whole flow on prod against the same product
    the FE reported (`prod_BWg2OVHUlmrlEfP5`, at 48): COD order
    `ord_cKieVt5oHu7ZmunL` (1 unit, waybill `L89XU8`) → 47 → confirm →
    ready-to-ship → ship → deliver → complete → `availableStock: 47,
    reservedStock: 0` (reservation consumed) → return `rr_oFXMsY9nPy9NdNS8` →
    approve → **48**; replay approve → `400 "already been reviewed"` with stock
    still 48; product mirror `stockQuantity: 48`; order `refunded`.
  - **The fix is not retroactive.** Stock lost before the deploy stays lost —
    those reservations are terminal CONSUMED. Survey of all 5 prod return
    requests found exactly 2 affected (both approved-from-COMPLETED, 0 from
    DELIVERING).
  - **Owed stock REPAIRED on prod 2026-08-11**, on the user's go-ahead:
    `prod_BWg2OVHUlmrlEfP5` (inv 31, PROD-29) 48 → **50** (+2, `rr_3Fxo2Qtmg5JiFQYn`)
    and `prod_BhLY42iIKZOFuxG8` (inv 29, E2E-PROD-0806-A) 23 → **24** (+1,
    `rr_hLfL6MpDTBqGCUyw`). Done through the API, two writes per product —
    `PUT /api/inventory/:id` then `PATCH /api/products/:publicId {stockQuantity}` —
    because `InventoryService.update()` emits no `stock_changed` fanout and would
    otherwise have left the MySQL mirror stale; the recipe and the reason it
    cannot double-credit are now in `known-behaviors.md`. Verified after the
    fact: Postgres `availableStock` == MySQL `stockQuantity` on both (50/50 and
    24/24), `reservedStock: 0`, and the cached catalog list serves 50.

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
