<!-- spec: id=ACCOUNT-DELETE-01; files=apps/gateway/src/user/user.service.ts,apps/user/src/user.service.ts,apps/orders/src/orders.service.ts,apps/product/src/product.service.ts,apps/social/src/social.service.ts,apps/notification/src/notification.service.ts; keys=account deletion,delete account,xoa tai khoan,anonymize; status=done -->
# ACCOUNT-DELETE-01 — Design

## Existing behaviour inventory

- `users.username` / `users.email` are UNIQUE NOT NULL; `name`/`avatar`
  nullable; `isActive` defaults true and nothing writes false today. Search
  and featured sellers already filter `isActive = true`.
- `orders.user_id` (buyer) and `orders.seller_id` are both indexed.
  `cancelOrder` accepts PENDING/CONFIRMED/PROCESSING and runs
  `finalizeCancellation` (status, stock release, voucher release, detached GHN
  cancel, `order_canceled`). Payments does not consume `order_canceled`, so a
  paid order canceled this way is refunded manually — exactly as a buyer
  cancel is today.
- SESSION-REVOKE-01: `user.service#revokeAllSessions` bumps `validAfter`
  (best-effort, logs on Redis failure).
- MAIL-BOUNCE-01 drops RFC-reserved recipients before SMTP, so a `.invalid`
  email can never be mailed.
- Return requests are reviewable by an admin, so a RETURN_REQUESTED order of a
  deleted seller is not stranded.

## Flow (gateway orchestrates over TCP, scrub LAST)

1. user `{cmd: user.verify_account_deletion}` — password check + admin guard.
2. orders `order.cancel_open_orders_for_user` → `{ canceledOrderCount }`.
3. orders `cart.clear` (existing).
4. product `product.purge_user_data` → deactivate listings, delete wishlist.
5. social `social_purge_user_data` → delete follows both ways.
6. notification `notification.purge_user_data` → delete the inbox.
7. user `{cmd: user.delete_account}` — re-verifies the password, scrubs the
   row and deletes addresses in one transaction, drops reset keys, revokes
   sessions.
8. gateway clears the cookie.

Steps 2–6 run BEFORE the scrub on purpose: if one fails the user can still
log in and retry, and each step is idempotent. Scrubbing first would leave a
half-cleaned account nobody can log into.

## Contract

`DELETE /api/user/me` body `{ currentPassword: string }`, throttled 5/min.
200 `{ success: true, canceledOrderCount: number }`, cookie cleared.
400 missing password · 401 wrong password (INVALID_CURRENT_PASSWORD, cookie
kept) · 403 admin · 5xx a leg failed (nothing scrubbed).

Release class **B** — new route, no existing field changes. The user embed of
a deleted author becomes `username: "deleted_usr_..."`, `name: null`,
`avatar: null`; FE should render it as "Deleted user" (prefix check).

## Migration

None. `isActive=false` + the `deleted_` username prefix mark the row; no
column is added.

## Landmines

- Order rows keep `user_id`/`seller_id` and the shipping address snapshot —
  required for accounting; this is the documented retention.
- `order_canceled` consumers (notification mail) may run after the scrub; mail
  to the `.invalid` address is dropped, and a notification row created after
  step 6 survives as an unreachable orphan.
- Session revocation fails OPEN on a Redis error; the scrubbed username and
  random password still prevent any new login.
