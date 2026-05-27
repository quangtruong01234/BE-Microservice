# TryBuy — Project Context (ARCHIVED 2026-05-26)

Source: `.claude/CONTEXT.md` — DEPRECATED, source of truth moved to `.claude/handoff/snapshot.md`

---

## AI Role

Senior developer experienced with AI-assisted coding (Claude Code, Cursor, Codex).
When writing prompts: break tasks into small pieces, do not write one long prompt for a large feature.
Do not suggest creating new files while writing a prompt.

---

## Stack

- Runtime: NestJS (TypeScript strict), Microservices
- Transport sync: TCP (ClientProxy.send)
- Transport async: RabbitMQ (emit / @EventPattern)
- DB: MySQL 8 (orders/user/product/payments/rewards) + PostgreSQL (inventory)
- Cache: Redis
- Docs: Swagger at /doc
- Base URL local: http://localhost:3000

## Modules

- `apps/gateway` — HTTP facade, auth, Swagger, rate limiting
- `apps/orders` — Create/query orders, emit order_created
- `apps/user` — Registration, login, profile, RBAC
- `apps/product` — Product/brand/category CRUD
- `apps/inventory` — Stock management (PostgreSQL)
- `apps/payments` — Payment processing
- `apps/rewards` — Loyalty points
- `libs/common` — MySQL/PostgreSQL/RabbitMQ modules
- `libs/constant` — Port numbers, service names, message patterns
- `libs/cached` — Redis caching module

---

## Purchase Flow

- Register/Login — User Service (TCP) — ✅
- Browse products — Product Service (TCP) — ✅
- Place order — Orders Service (TCP) + sync stock check — ✅
- Payment — Payments Service (RabbitMQ FANOUT) — ✅ ZaloPay sandbox
- Update stock — Inventory Service (RabbitMQ FANOUT) — ✅
- Award points — Rewards Service (RabbitMQ FANOUT) — ✅

---

## Progress

### ✅ Task 1 — Full RBAC

- [x] P1: Resource entity + Role entity + migration (`database/add_resources_roles_tables.sql`)
- [x] P2: User → ManyToOne Role (field `role_id` FK)
- [x] P3: grantList + `accesscontrol` library + `database/seed.sql`
- [x] P4: JWT payload contains real `role` + `grants` (no more hardcoded `["admin"]`)
- [x] P5: RoleAuthGuard permission check + `@CheckPermission` decorator
- [x] Fix: Register automatically assigns default role `'user'`
- [x] Fix: `@Public()` missing on GET /api/products
- [x] Fix: RoleAuthGuard was commented out in gateway.module.ts

**Test result `/test-rbac`:**
| Step | Description | Result |
|------|-------------|--------|
| 1 | Register → role 'user' | ✅ PASS |
| 2 | Login → token + cookie present | ✅ PASS |
| 3 | JWT payload: role='user', grants=4 | ✅ PASS |
| 4 | GET /api/products public → 200 | ✅ PASS |
| 5 | POST /api/products role=user → 403 | ✅ PASS |
| 6 | JWT_SECRET rotated | ✅ PASS |

### ✅ Task 2 — JWT_SECRET + environment variables

- [x] JWT_SECRET: generate 64-byte hex, set in `local/nodeA/.env`
- [x] Add `JWT_EXPIRES_IN=7d`, `FRONTEND_URL`, `NODE_ENV` to `.env`
- [x] Create `.env.example` at root
- [x] Remove hardcoded fallback `|| "your-secret-key"` in `gateway.module.ts`

### ✅ Task 3 — ZaloPay Payment Gateway

- [x] P1: zalopay.config.ts + zalopay.helper.ts (HmacSHA256)
- [x] P2: zalopay.service.ts → createOrder API, orderId in embed_data
- [x] P3: zalopay.callback.ts → verify MAC + extract orderId
- [x] P4: payments.service.ts removes setTimeout, uses real ZaloPayService
- [x] P4-fix: hybrid HTTP :3007 + TCP :3005
- [x] Async approach: save order_url to DB, GET /api/orders/:id/payment-url to poll
- [x] Fix: flatten RabbitMQ payload (data.data → order directly)
- [x] Fix: remove unused publisherChannel inject from payments.service.ts
- [x] Redirect: GET /api/gateway/payment-result

**Test result `/test-payment-zalopay`:**
| Step | Result |
|------|--------|
| POST /api/order → order created | ✅ PASS |
| RabbitMQ event → payments service | ✅ PASS |
| ZaloPay createOrder → order_url | ✅ PASS |
| GET /api/orders/:id/payment-url | ✅ PASS |
| Sandbox payment successful | ✅ PASS |

### ✅ Task 4 — Code cleanup

- [x] Remove commented-out emit() calls in orders.service.ts
- [x] console.log in role-auth.guard.ts and product.controller.ts already cleaned up

### ✅ Task 5 — VNPay strategy pattern

- [x] Add VNPay alongside ZaloPay, select gateway via PAYMENT_GATEWAY env

### ✅ Task 6 — Save app_trans_id to payments table

- [x] Add column + save from ZaloPayService, migration SQL applied

---

## Remaining Tasks

- #7 [TODO] Fix ZaloPay callback → update payment status + emit payment_completed | 🔴 CRITICAL | Items 1+2+3 must be fixed together
- #8 [TODO] Implement VNPay callback handler | 🔴 CRITICAL | Same pattern as ZaloPay callback
- #9 [TODO] Fix ZaloPay config hardcoded fallback keys | 🔴 CRITICAL | Throw if env missing, same as vnpay.config.ts
- #10 [TODO] Idempotency for payment processing | 🔴 CRITICAL | Check if order_id already processed before creating payment record
- #11 [TODO] Fix payment-result endpoint to support ZaloPay + VNPay | 🟡 IMPORTANT | transId field is currently ZaloPay-specific
- #12 [TODO] Rename zp_trans_token → transaction_id | 🟡 IMPORTANT | Column name is ZaloPay-specific and confusing
- #13 [TODO] GET /api/order/:id endpoint | 🟡 IMPORTANT | Gateway does not expose order detail yet
- #14 [TODO] Pagination for getOrdersByUser() | 🟡 IMPORTANT | Currently returns all orders

---

## Known Issues / Design Gaps

- #1 [payments] payment_completed event is never emitted — processPayment() saves URL then stops, no event emitted → orders stay PENDING
- #2 [gateway] payment-result only reads query["apptransid"] — ZaloPay field; VNPay uses vnp_TxnRef → returns undefined when gateway is vnpay
- #3 [orders+inventory] Race condition stock check → reserve — stock checked via TCP then event published, two concurrent orders can oversell
- #4 [product+inventory] Product stockQuantity not synced with Inventory — two separate data sources, frontend displays incorrect stock
- #5 [payments] zp_trans_token used for VNPay transaction ID as well — column name misleading

---

## Key Files

- `apps/user/src/rbac/grants.ts` — grantList + `ac = new AccessControl(grantList)`
- `apps/user/src/entity/role.entity.ts` — Role entity, enums RoleName/RoleStatus
- `apps/user/src/entity/resource.entity.ts` — Resource entity
- `apps/gateway/src/common/guards/role-auth.guard.ts` — Permission check via accesscontrol
- `apps/gateway/src/common/decorators/check-permission.decorator.ts` — `@CheckPermission(resource, action)`
- `database/add_resources_roles_tables.sql` — Migration to create roles + resources tables
- `database/seed.sql` — Seed 3 roles + 6 resources
- `.claude/commands/test-rbac.md` — Agent test — run `/test-rbac` in Claude Code
- `apps/payments/src/zalopay/` — ZaloPay integration (config, helper, service, callback)
- `apps/payments/src/entity/payment.entity.ts` — Added order_url + zp_trans_token columns
- `database/add_payment_url_columns.sql` — Migration to add 2 columns to payments table
- `.claude/commands/test-payment-zalopay.md` — Agent test ZaloPay end-to-end

---

## Conventions

- Each prompt handles 1 small task, reports which files were changed
- After each major task, run test command to verify
- Do not create new microservices unless the domain needs independent scaling
- Role/Resource lives in `apps/user` (not a separate service)
- PAYMENT_GATEWAY env var selects gateway: zalopay | vnpay
- **Payment gateway integration**: always use official libraries instead of implementing HMAC/signature manually — avoids encoding edge cases. Example: use `vnpay` package instead of writing custom crypto/HMAC for VNPay.

### PostToolUse Hook (disabled)

File: `api/.claude/settings.json`
Reason disabled: `$CLAUDE_TOOL_OUTPUT_FILE` does not point to the file being Write/Edit — runs format on wrong target.
Format/lint is currently handled by the rule in `CLAUDE.md`.

Hook content (for reference if re-enabling):

```json
{
  "matcher": "Write|Edit",
  "hooks": [
    {
      "type": "command",
      "command": "npx prettier --write \"$CLAUDE_TOOL_OUTPUT_FILE\" 2>/dev/null || true && npx eslint --fix \"$CLAUDE_TOOL_OUTPUT_FILE\" 2>/dev/null || true"
    }
  ]
}
```
