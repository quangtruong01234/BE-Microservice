---
name: perf-audit
description: Perform a read-only TryBuy backend performance audit with concrete findings, side effects, mitigations, and verification. Use for endpoint, service, query, cache, N+1, index, or latency audits.
---

# $perf-audit — Performance Audit Skill

Use this command to scan the TryBuy backend for slow / wasteful API paths,
propose fixes, and — for every fix — predict its side effects and give a
mitigation. This command is **read-only**: it reports, it does NOT implement.
Implement findings afterwards via `$feature`, `$refactor`, or a direct edit.

## How to invoke

```
$perf-audit                 # audit all HTTP endpoints in the gateway
$perf-audit <path>          # audit a single endpoint / service / file
$perf-audit order           # audit only the orders domain
```

---

## Scope & rules

- Read code + entities + gateway services only. Do NOT edit, do NOT run migrations.
- One finding = one concrete location (`file:line`) + one measurable impact.
- Never propose a fix without filling **Side-effect** and **Mitigation** (see output format). A perf fix that silently changes behaviour is a bug, not a fix.
- Cross-check `ai-docs/agent-context/database.md` for indexes/relations and `ai-docs/agent-context/api.md` for current response shape **before** proposing any change that touches them.
- Do NOT recommend adding a dependency (`npm install` is denied in this repo) — only patterns/queries/indexes already supported by the stack.

---

## Known performance hotspots — read FIRST

If `<path>` matches one of these, start here instead of a blind scan. These are
the high-probability suspects given the current architecture (verify before reporting):

1. **Cross-DB N+1: product (MySQL) ↔ inventory (PostgreSQL).** `GET /api/products/with-inventory/all` and `POST /api/products/with-inventory/multiple` must use the batch TCP pattern `inventory.get_by_product_ids` — NOT one `inventory.find_by_product_id` per product. A per-item loop = N TCP round-trips.
2. **Unpaginated list endpoints.** `GET /api/inventory/`, `GET /api/products/brands`, `GET /api/products/categories`, `GET /api/user/all` return unbounded rows. Slow + large payload as data grows.
3. **Social feed N+1.** `getPosts` / `getPostsByUser` read `likeCount` from Redis per post. Per-post `GET` = N Redis round-trips → should be one `MGET`/pipeline.
4. **ManyToMany over-fetch.** Product↔Category junction (`product_categories`): `findAll` with `relations: ['categories']` can produce a cartesian row blow-up and N+1 hydration on a paginated list.
5. **Reply tree depth.** `getReplies` uses `findDescendantsTree` (recursive, depth 5). Expensive per post at scale; check it is not called inside `getPosts`.
6. **Sequential gateway TCP calls.** Independent `.send()` calls awaited one-by-one instead of `Promise.all` (e.g. admin orders merging buyer info — confirm it is parallel).
7. **Missing indexes on filtered columns.** product search (`name` LIKE / `sku`), `categoryId`/`brandId` filters, `orders.user_id`, `payments.app_trans_id` + `transaction_id` lookups, `inventory.productId`/`sku`.

---

## Audit sequence

Run every category relevant to `<path>`. For each, locate the real code and confirm before reporting.

### A — N+1 over TCP (gateway → microservice)

- Look for `.send(...)` inside a `for` / `map` / `forEach` in any gateway service.
- Fix direction: add/reuse a batch message pattern (`*.get_by_..._ids`) and one call with an array.

### B — N+1 over DB (TypeORM, inside a service)

- `findOne` / `findByProductId` called in a loop; missing `relations` causing lazy re-query.
- Fix direction: `findBy({ id: In(ids) })` or `leftJoinAndSelect`; for ManyToMany prefer a **split query** (load ids, then load relations) to avoid cartesian duplication.

### C — Missing pagination

- Any `find()` / `findAll()` with no `take`/`skip` behind an HTTP GET.
- Fix direction: add `page`/`limit` query DTO + `findAndCount` + `PaginatedResponse.of()` from `@app/common`.

### D — Missing / wrong indexes

- Map each WHERE / ORDER BY / LIKE column on hot paths to `ai-docs/agent-context/database.md`; flag columns with no index.
- Fix direction: index migration in `database/*.sql`. **PostgreSQL** (inventory/payments/rewards): `CREATE INDEX CONCURRENTLY`. **MySQL** (orders/user/product): `ALTER TABLE ... ALGORITHM=INPLACE, LOCK=NONE`.

### E — Sequential awaits that should be parallel

- ≥2 independent awaited TCP/DB calls with no data dependency.
- Fix direction: `Promise.all` (or `allSettled` if partial success is acceptable).

### F — Caching gaps (Redis / `@app/cached`)

- Hot read-heavy, rarely-changing data fetched fresh every time (product detail, brand list, category list, payment options).
- Fix direction: cache-aside via `@app/cached`. **Must** add invalidation (`DEL`) on the matching create/update/delete.

### G — Oversized payloads / heavy serialization

- Eager `relations` loading full nested objects on list endpoints; DECIMAL columns; recursive trees on list paths.
- Fix direction: select only needed columns; lazy-load detail; cap tree depth.

### H — RabbitMQ consumer latency

- Heavy work before `ack(context)` in an `@EventPattern` handler → queue backs up.
- Fix direction: keep handler lean; ensure idempotency (at-least-once delivery) before acking early.

### I — Timeout tuning

- `timeout(10000)` everywhere ties up gateway on slow upstream. Flag endpoints where 10s is unrealistically high for the operation.

---

## Severity rubric

- 🔴 **Critical** — N+1 or unbounded query on a high-traffic path; latency scales linearly with data.
- 🟡 **Important** — fixed extra cost on every call (missing cache, sequential awaits, missing index on a filtered column).
- 🟢 **Minor** — small payload bloat, over-eager relation, suboptimal but bounded.

---

## Output format

For **every** finding, output exactly this block — all six fields required:

```
🔴 [Critical] <short title>
   Location:   apps/<service>/src/<file>.ts:NN  (or gateway path)
   Impact:     <why slow + how it scales, e.g. "N TCP calls per request, N = #items in cart">
   Fix:        <concrete change: pattern / query / index>
   Side-effect:<what this fix might break or change — response shape, stale data,
               write slowdown, lock during migration, error semantics, contract change>
   Mitigation: <how to neutralise the side-effect — FE check, cache invalidation,
               CONCURRENTLY, allSettled, version the endpoint, etc.>
   Verify:     <how to confirm the fix helped: query count, EXPLAIN, response time, payload size>
```

### Side-effect checklist (consult per fix type)

- **Pagination added** → response changes from `T[]` to `{ data, total, page, limit, ... }`. **Breaking for FE.** Mitigation: grep `frontend/src` callers first; keep shape consistent with `PaginatedResponse`.
- **Cache added** → stale reads after writes. Mitigation: invalidate the exact key on every create/update/delete; guard against cache stampede.
- **Index added** → slower writes + table/index build cost. Mitigation: `CONCURRENTLY` (PG) / `LOCK=NONE` (MySQL); build off-peak; confirm it is actually used via `EXPLAIN`.
- **Batch TCP** → requires the batch `@MessagePattern` to exist on the microservice; partial failure differs from per-item. Mitigation: confirm handler exists; define behaviour when one id is missing.
- **`Promise.all`** → one rejection fails the whole batch. Mitigation: `allSettled` if partial result is acceptable; keep per-call `timeout`.
- **Split / column-limited query** → fewer fields returned. Mitigation: confirm no consumer depends on the dropped fields (API + FE).
- **Ack-early in RabbitMQ** → message lost if processing fails after ack. Mitigation: idempotent handler + only ack after the critical write.

---

## Verdict — end every audit with

```
SUMMARY: <n critical / n important / n minor>
TOP FIX: <the single highest-impact, lowest-risk change to do first>
HANDOFF: implement via $feature or $refactor — do NOT implement here.
         If a fix needs migration + entity + service together → spawn the `planner` custom agent first.
```

> A finding is only actionable when its Side-effect and Mitigation are filled in.
> No fix ships without knowing what it might break.
