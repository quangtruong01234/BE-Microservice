# ACCOUNT-DELETE-01 — Tests

## Unit tests

- [TC-1] user: wrong password ⇒ 401 INVALID_CURRENT_PASSWORD; admin ⇒ 403; nothing saved.
- [TC-2] user: `deleteAccount` scrubs username/email/name/avatar/password, sets isActive false, deletes addresses, revokes sessions.
- [TC-3] orders: only PENDING/CONFIRMED/PROCESSING orders where the user is buyer or seller are finalized as canceled.
- [TC-4] product: listings deactivated, wishlist deleted.
- [TC-5] gateway: legs run in order and the scrub is never called when a leg fails.
- [TC-6] gateway DTO: missing currentPassword ⇒ validation error.

## Runtime checks (self-test)

- [TC-7] Throwaway buyer with a PENDING order: wrong password ⇒ 401; correct ⇒ 200, order CANCELED, cookie cleared, old token 401, login 401.
- [TC-8] Deleted user's profile shows `deleted_usr_...`, name/avatar null; old username can be registered again.
- [TC-9] Admin self-delete ⇒ 403.
