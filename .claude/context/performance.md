# Performance — Always-On Rules

These rules apply whenever code is **added or edited**, not only during `/perf-audit`.
Goal: write performant code by default so an audit finds little to fix.
A change that improves perf but silently alters behaviour is a bug — see "Regression discipline" below.

## Complexity budget

- No hidden N+1. Any I/O call (TCP `.send()`, TypeORM query, Redis get) inside a `for` / `map` / `forEach` is a 🔴 smell — batch it.
- Think in terms of "calls per request", not "calls per item". One request should make a bounded number of round-trips regardless of list size.
- Nested loops over data that scales (orders, products, comments) → flag and rework before committing.
- Prefer set/`Map` lookups over `.find()` inside a loop (O(1) vs O(n²)).

## TCP calls (gateway → microservice)

- Never loop `.send()` per item. Use the batch message pattern with an array.
  ```typescript
  // ❌ N round-trips
  for (const id of productIds) {
    await firstValueFrom(
      this.client.send(INVENTORY_MESSAGE_PATTERNS.FIND_BY_PRODUCT_ID, id),
    );
  }
  // ✅ one round-trip
  await firstValueFrom(
    this.client
      .send(INVENTORY_MESSAGE_PATTERNS.GET_BY_PRODUCT_IDS, productIds)
      .pipe(timeout(10000)),
  );
  ```
- Independent calls (no data dependency) run in parallel via `Promise.all` — never await them one-by-one.
  ```typescript
  const [orders, buyers] = await Promise.all([fetchOrders(), fetchBuyers(ids)]);
  ```
- If one upstream may fail but partial result is acceptable → `Promise.allSettled`. Keep `timeout(10000)` on every call regardless.
- If you need a batch pattern that does not exist yet → add it to `libs/constant/` + a `@MessagePattern` handler; do NOT fall back to a loop.

## Database (TypeORM)

- **Pagination is the default for list endpoints.** Any HTTP GET that returns a collection must use `findAndCount` + `skip`/`take` and return via `PaginatedResponse.of(data, total, page, limit)` from `@app/common`. Never return an unbounded `find()`.
- Fetch many by id with `In()`, not a loop:
  ```typescript
  // ✅
  await this.repo.findBy({ id: In(ids) });
  ```
- Eager `relations` only when the response needs them. On paginated lists, prefer a **split query** for ManyToMany (`product_categories`) to avoid cartesian row duplication and N+1 hydration.
- Select only the columns the response uses on hot/list paths — avoid loading full nested trees just to drop them.
- **Index awareness**: any column used in `WHERE` / `ORDER BY` / `LIKE` on a hot path must be indexed. If it is not (check `context/database.md`), the change is incomplete — note that an index migration is needed. PostgreSQL: `CREATE INDEX CONCURRENTLY`. MySQL: `ALTER TABLE ... ALGORITHM=INPLACE, LOCK=NONE`.
- Recursive trees (`findDescendantsTree`, depth-limited) must never be called inside a list loop. Load tree only on a detail/expand request.

## Caching (`@app/cached` / Redis)

- Cache-aside for read-heavy, rarely-changing data (product detail, brand list, category list, payment options).
- **Every cache add ships with its invalidation.** Add the matching `DEL key` in the create/update/delete path in the same change — a cache without invalidation is a stale-data bug.
- Batch Redis reads with `MGET` / pipeline — do not loop `GET` per item (social feed `likeCount` is the canonical trap).
- Guard against stampede on expensive recomputes (single-flight / short TTL) where relevant.

## Payload size

- Do not return decorative/internal fields the client never reads.
- DECIMAL columns serialize as string — cast with `Math.round(Number(v ?? 0))` only where a number is required; do not map large arrays needlessly.

## RabbitMQ consumers

- Keep `@EventPattern` handlers lean — heavy synchronous work before `ack(context)` backs up the queue.
- At-least-once delivery: handlers must be idempotent (re-processing the same event must not double-write). Only then is it safe to ack early.
- Follow the requeue policy in `CLAUDE.md` (DB error → requeue; not-found / unprocessable → no-requeue).

## Regression discipline

When a change is made for performance, state in the commit / report what it might affect and how it is neutralised:

- **Pagination added** → response shape changes `T[]` → `{ data, total, ... }`. Breaking for frontend — grep `frontend/src` callers first.
- **Cache added** → invalidation added in the same diff (named key).
- **Index added** → built with `CONCURRENTLY` / `LOCK=NONE`; confirmed used via `EXPLAIN`.
- **Batch / `Promise.all`** → partial-failure behaviour defined (which ids missing? `allSettled`?).
- **Column-limited query** → confirmed no API/FE consumer depends on dropped fields.

No perf change merges without knowing what it could break.

## Definition of done (performance addendum)

On top of the standard DoD in `CLAUDE.md`:

- No new I/O call inside a loop introduced.
- New list endpoint is paginated.
- New filter/sort column on a hot path is indexed (or an index migration is flagged).
- New cache entry has matching invalidation.

> For a full sweep of existing endpoints, run `/perf-audit`. This file is for keeping new code clean as it is written.
