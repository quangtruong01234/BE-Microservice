# TryBuy API — Postman

Postman collection for the TryBuy gateway HTTP API (142 requests across 13 folders).
All microservices are TCP-only behind the gateway, so every HTTP route lives here.

## Files

| File | What it is |
|---|---|
| `TryBuy.postman_collection.json` | The full API reference collection — import this. |
| `TryBuy-E2E.postman_collection.json` | **Collection Runner automation** — one folder per role, click Run. |
| `TryBuy-local.postman_environment.json` | Environment pointing at `http://localhost:3000`. |
| `TryBuy-prod.postman_environment.json` | Environment template for prod — edit the host. |

## Import

1. Postman → **Import** → drop all three JSON files.
2. Top-right environment dropdown → pick **TryBuy Local** (or **TryBuy Prod**).

## Switch dev ↔ prod (the only change you need)

Two variables control the target host:

| Variable | Used by | Local default |
|---|---|---|
| `baseUrl` | prefixed routes (`/api/...`) | `http://localhost:3000/api` |
| `rootUrl` | un-prefixed routes (health, payment callbacks, GHN webhook) | `http://localhost:3000` |

For prod, edit `TryBuy-prod.postman_environment.json` (or the environment in Postman):

```
baseUrl = https://api.yourdomain.com/api
rootUrl = https://api.yourdomain.com
```

Everything else stays the same.

## Auth

Auth is a **HttpOnly cookie** (`access_token`), not a Bearer token.

1. Set the `username` / `password` variables to a real account.
2. Run **User / Auth → Login**. It sets the cookie; Postman's cookie jar stores it
   per host and sends it automatically on every following request.
3. To use prod, just switch the environment and log in again there.

> Cookies are per-host, so logging in against local does not authorize prod — log
> in once per environment.

## Path variables

ID placeholders are collection variables — fill in a real value before sending:

- Opaque public ids: `{{orderId}}` = `ord_...`, `{{productId}}` = `prod_...`,
  `{{userId}}` = `usr_...`, `{{postId}}` = `post_...`, `{{commentId}}` = `cmt_...`,
  `{{conversationId}}` = `conv_...`, `{{addressId}}` = `addr_...`,
  `{{notificationId}}` = `ntf_...`, `{{returnRequestId}}` = `rr_...`.
- Plain integers: `{{cartItemId}}`, `{{inventoryId}}`, `{{brandId}}`,
  `{{categoryId}}`, `{{reviewId}}`, `{{voucherId}}`.

## Notes

- Request bodies use the DTO example values from the gateway; adjust as needed.
- Role-gated routes are labelled in each request's description (admin / shop / shipping).
- The **Callbacks & Webhooks** folder is for external providers (ZaloPay, VNPay, GHN),
  not the frontend — included for completeness/testing.

## E2E automation (Collection Runner)

`TryBuy-E2E.postman_collection.json` turns the API into **runnable per-role
flows**. Each folder starts with a role Login and then chains a full end-to-end
journey — open a folder, click **Run**, and the Runner executes every step
top-to-bottom, capturing ids into collection variables and asserting each
response. It reuses the same `baseUrl` / `rootUrl`, so switching dev↔prod is the
same one change.

The 4 role flows (+ a combined one):

| Folder | Role | Journey |
|---|---|---|
| 🛒 Buyer flow | `user` | browse → cart → address → checkout (COD) → view → cancel |
| 🏪 Seller flow | `shop` | category → create product → view/update → shop stats → price suggestion → own orders → cleanup |
| 🛡️ Admin flow | `admin` | users → pending brands/categories → voucher CRUD → analytics → reported posts |
| 🚚 Shipping flow | `shipping_manager` | list GHN orders → detail → history → manual sync |
| 🔗 Full lifecycle | all 4 | seller creates → buyer orders → seller confirms/ships → shipping delivers → admin sees it → buyer reads final status |

**Before running — fill the 4 passwords (one-time):** the Login steps read
`buyerPassword`, `sellerPassword`, `adminPassword`, `shippingPassword`. These are
left **blank on purpose** — credentials live outside the repo in
`../.agent-local/test-accounts.md` and are never committed. Set them in Postman
(collection variables or the environment) once, then Run.

Usernames are pre-filled with the dev test accounts. For prod, point `baseUrl` /
`rootUrl` at the prod host and set the four passwords to real prod accounts with
the matching roles.

How to run: **Runner** → drag a flow folder in → Run. Or right-click the folder →
**Run folder**. Each folder is independent (its own Login); the 🔗 lifecycle
folder must run as a whole because later roles depend on earlier steps.

Notes:
- Core steps assert strict 2xx. GHN/demo steps (waybill create, `demo-status`,
  sync) are **lenient** — they accept the sandbox/env-gated responses so a GHN
  outage or `GHN_DEMO_ENDPOINTS_ENABLED=false` never reds the run.
- The buyer flow ends by cancelling its own order and the seller flow deletes its
  own product, so both are **repeatable**.
- Vouchers/SKUs use `Date.now()` in a pre-request script for uniqueness.

## Regenerating

The reference collection is generated from the gateway controllers by
`generate.mjs`; the E2E automation by `generate-e2e.mjs`. If routes change, edit
the relevant script and run `node postman/generate.mjs` /
`node postman/generate-e2e.mjs`, or edit the JSON directly.
