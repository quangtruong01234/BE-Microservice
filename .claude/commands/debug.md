# /debug — Debug Command

Use this command to diagnose a failing feature in TryBuy.

## How to invoke

```
/debug <symptom or error message>
```

Example: `/debug order creation returns 500`
Example: `/debug inventory stock not updating after order`
Example: `/debug port 3001 not listening, AggregateError`

---

## Known Issues — read BEFORE debugging

If the symptom matches either item below, this is a **known pre-existing bug** — report it immediately instead of running a full diagnostic.

### (a) MicroserviceErrorHandler maps wrong HTTP status

`BadRequestException` and `ForbiddenException` from TCP microservices are not correctly mapped to 400/403 — gateway falls back to **502**. Any 502 from the gateway where the business logic looks correct should be suspected as this cause.

### (b) Inventory not consuming `order_created` / `order_canceled`

If `inventory.main.ts` uses `getOptions("INVENTORY_SERVICE_QUEUE")` instead of `getOptionsTopic()` with `ORDERS_EXCHANGE`, the service subscribes to the wrong queue and receives no events from Orders. Check `apps/inventory/src/main.ts` first.

---

- If a file path is uncertain, glob/search for it; do not ask
- After every fix: run `npx tsc --noEmit` — never mark done if it has errors

---

## Phase 0 — Build a feedback loop first

Before running any diagnostic step, establish a reproducible pass/fail signal:

1. Failing curl command that reliably triggers the bug
2. tsc error output captured to file
3. RabbitMQ queue state visible at http://localhost:15672
4. DB state query that shows the wrong data

If you cannot reproduce the bug consistently → stop and report:
- What you tried
- What environment/log access is needed
- Do NOT hypothesise without a reproducible signal

Once reproduced, generate 2-3 ranked hypotheses before testing any.
State each as: "If X is the cause, then changing Y will fix it."

---

## Diagnostic Sequence

Environment: **Windows + PowerShell**. Default to Windows commands; only fall back to Linux/Mac variants if the Windows command does not exist.

Run ALL steps relevant to the symptom before forming any conclusion.

### Step 1 — Baseline, then map symptom to layer

Run these before anything else (~10 seconds):

```bash
netstat -ano | findstr "LISTENING" | findstr -E "300[0-9]"
npx tsc --noEmit 2>&1 | head -40
ls -lt api/dist/apps/
```

- Port missing → go to **Step 2** immediately
- tsc errors → fix them first; do not proceed until clean
- dist/ missing → rebuild before any other investigation

| Symptom | Start at |
|---|---|
| HTTP 4xx / 5xx from gateway | Step 3: Gateway layer |
| `AggregateError` / TCP timeout / empty message | Step 2: TCP checks |
| Wrong data returned | Message pattern constant + handler logic |
| Event not processed (stock / payments not updating) | Step 4: RabbitMQ checks |
| 401 Unauthorized | Step 6: Auth checks |
| Frontend fetch failing / CORS error | Step 5: Frontend checks |
| DB error / missing data in table | Step 7: Database checks |

---

### Step 2 — TCP microservice not responding

Read in this exact order — do not skip:

1. `package.json` → find the failing script → identify entry file
2. `apps/<service>/src/main.ts` → what port? TCP or HTTP bootstrap?
3. `apps/<service>/src/<service>.module.ts` → any import that could throw on init?
4. `api/libs/constant/` → find `PORT_TCP` constants — does `main.ts` use the right one?
5. `api/local/nodeA/.env` or `nodeB/.env` → does env var override the port?
6. `<service>.controller.ts` → `@MessagePattern()` — does it match exactly what gateway sends?
7. Gateway service → is `MicroserviceErrorHandler` silently swallowing the real error?

Service → Node group mapping:

| Service   | Group  | Default port |
| --------- | ------ | ------------ |
| gateway   | Node A | 3000         |
| orders    | Node A | 3001         |
| inventory | Node B | 3002         |
| user      | Node A | 3003         |
| rewards   | Node B | 3004         |
| payments  | Node B | 3005         |
| product   | Node A | 3006         |

---

### Step 3 — Gateway layer

- Read gateway service method → confirm `timeout(10000)` and `MicroserviceErrorHandler` are present
- Compare pattern constant: gateway `.send(PATTERN, ...)` vs microservice `@MessagePattern(PATTERN)` — must be the same import from `libs/constant/`
- Call `GET /api/gateway/health` — which services report unhealthy?

---

### Step 4 — RabbitMQ event not processed

- Compare `this.rmqClient.emit(EVENT.X, payload)` vs `@EventPattern(EVENT.X)` — same constant from same file?
- Is the consuming service in Node B? Is Node B running (`npm run start:nodeB`)?
- Is `this.rmqService.ack(context)` present in the handler? Missing ack = message requeued forever
- Check RabbitMQ management UI: `http://localhost:15672` (guest/guest) — queue binding correct?

---

### Step 5 — Frontend fetch failing

Read in this order:

1. `frontend/src/api/index.ts` → is `credentials: 'include'` on the base `request()` function?
2. Find the relevant hook in `frontend/src/hooks/` → is `queryFn` calling the right api method?
3. `frontend/.env` → is `VITE_API_URL` pointing to `http://localhost:3000/api`?
4. Gateway CORS config → does it allow `http://localhost:5173` with `credentials: true`?

---

### Step 6 — Auth / 401

- Is the route marked `@Public()`? If it should be public, add the decorator from `common/decorators/public.decorator.ts`
- Is `JwtAuthGuard` applied globally in `gateway.module.ts`?
- Is `credentials: 'include'` on every frontend fetch request?
- Is cookie being set? (only verifiable by user in DevTools → Application → Cookies)

---

### Step 7 — Database

```bash
docker-compose ps
docker-compose logs db --tail=20
```

Then check:

- Entity column names vs actual table columns — snake_case mismatch?
- Has migration SQL in `api/database/*.sql` been applied to the DB?
- DB routing: Orders/Products → MySQL. Inventory → PostgreSQL. Never cross-inject modules.
- TypeORM sync issue? Compare entity field `name:` value with actual column name in DB (psql / mysql CLI)

---

## Fix Format — output before closing every debug session

```
ROOT CAUSE: <one sentence>
EVIDENCE:   <file:line or command output that proves it>
CHANGED:    <list of files modified>
VERIFIED:   tsc ✓ | port ✓ | (manual test needed: <describe what>)
```
