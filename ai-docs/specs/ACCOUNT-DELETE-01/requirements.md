# ACCOUNT-DELETE-01 — Requirements

## Problem

A user has no way to delete their own account. Roadmap item F12 (`/sweep
propose` 2026-10-01): self-service deletion that anonymizes PII across the
MySQL services while keeping orders for accounting (Decree 13/2023/ND-CP).

## Decisions (user, 2026-10-01)

1. Authored content (posts, comments, reviews, chat messages) is KEPT and
   anonymized: the author renders as the scrubbed user, so threads, product
   ratings and the counterparty's chat history stay intact.
2. Open orders do not block the deletion. Every order the user can still
   cancel — as buyer OR seller — is auto-canceled.
3. Immediate and irreversible: password re-entry, scrub at once, revoke every
   session. No grace period, no restore, no cron.

## Scope

- `DELETE /api/user/me` with `{ currentPassword }`.
- Scrub the `users` row in place (the id stays — orders, reviews, posts and
  messages reference it); delete addresses, cart, wishlist, follows and the
  user's notifications; deactivate the user's product listings.
- Out of scope: payments/rewards rows (PostgreSQL, accounting), refunds of a
  paid order the auto-cancel touches (same manual path as a buyer cancel
  today), chat messages, order address snapshots.

## Acceptance criteria

- [AC-1] A missing `currentPassword` is a 400; a wrong one is a 401 with
  `errorCode: INVALID_CURRENT_PASSWORD` and changes nothing.
- [AC-2] An admin account cannot delete itself (403) — it would orphan the
  admin console with no recovery path.
- [AC-3] On success every order where the user is buyer or seller and status
  is PENDING/CONFIRMED/PROCESSING is CANCELED through the normal cancel flow
  (stock released, voucher returned, GHN cancel, `order_canceled` published).
  SHIPPED/DELIVERING/RETURN_REQUESTED orders are left to finish.
- [AC-4] The `users` row afterwards: username `deleted_<publicId>`, email
  `deleted+<publicId>@deleted.invalid`, `name`/`avatar` null, an unusable
  random password, `isActive=false`. The old username and email are free to
  register again.
- [AC-5] Addresses, cart, wishlist items, follows (both directions) and the
  user's notifications are deleted; the user's products are `isActive=false`.
- [AC-6] Every existing JWT of the user is revoked and the caller's cookie is
  cleared; logging in with the old credentials fails.
- [AC-7] A failure in any cleanup leg is an error response with the account
  NOT scrubbed, and retrying is safe (every leg is idempotent).
