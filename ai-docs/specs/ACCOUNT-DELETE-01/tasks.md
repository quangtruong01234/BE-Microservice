# ACCOUNT-DELETE-01 — Tasks

## Phase 1 — constants

- [x] message patterns (user ×2, orders, product, social, notification); response messages

## Phase 2 — services

- [x] user: `verifyAccountDeletion`, `deleteAccount` (scrub + addresses + revoke)
- [x] orders: `cancelOpenOrdersForUser`
- [x] product: `purgeUserData`
- [x] social: `purgeUserData`
- [x] notification: `purgeUserData`

## Phase 3 — gateway

- [x] `DELETE /api/user/me` + `DeleteAccountDto`; register product/social/notification clients in `UserModule`

## Phase 4 — tests, self-test, close-out

- [x] unit tests (TC-1..TC-6), self-test (TC-7..TC-9), docs, handoff
