# Metrics

Every number quoted in `README.md` comes from here, and everything here is
either produced by a script in this repo or copied from a raw result file that
is committed alongside it. Nothing is hand-counted.

```bash
bash scripts/metrics.sh          # code + API surface (fast, no side effects)
bash scripts/metrics.sh --tests  # also runs the unit suite and counts it
bash scripts/metrics.sh --loc    # also runs `npx cloc`
bash scripts/metrics.sh --all    # everything (~2 min)
npm run metrics:prod -- --from <UTC> --to <UTC>   # real prod traffic, from Grafana
```

---

## Code and API surface

Commit `1ddcb97` (2026-10-06) · measured 2026-10-06 · `bash scripts/metrics.sh --all`

| Metric | Value | How it is counted |
|---|---:|---|
| Microservices | 10 | `apps/*/` directories |
| Shared libraries | 4 | `libs/*/` directories |
| HTTP routes (gateway) | 170 | `@Get/@Post/@Put/@Patch/@Delete` sites in `apps/gateway/src` |
| Gateway controllers | 21 | `*.controller.ts` in `apps/gateway/src` |
| TCP message patterns | 174 | `@MessagePattern(` sites in `apps/` |
| RabbitMQ event handlers | 22 | `@EventPattern(` sites in `apps/` |
| TypeORM entities | 36 | `*.entity.ts` in `apps/` + `libs/` |
| SQL migrations | 16 | `database/migrations/**/*.sql` |
| Test suites (spec files) | 82 | `*.spec.ts` in `apps/` + `libs/` |
| Documented behaviours | 77 | `kb:` anchors in `ai-docs/agent-context/known-behaviors.md` |

The gateway is the only HTTP-facing process, which is why the route count is
scoped to it — the other nine services are unreachable from outside the VPC and
expose transport handlers only.

## Tests

`npx jest --silent --json`, same commit:

| Metric | Value |
|---|---:|
| Suites passed | 83 / 83 |
| Tests passed | 849 / 849 (100%) |
| Tests failed | 0 |

Jest runs one suite more than the spec-file count above: that count covers
`apps/` + `libs/` only. The extra one is `test/utils/test-utils.spec.ts`, which tests the
shared mock factories themselves.

**These are unit tests only.** There is no end-to-end suite: a real one needs a
live Redis + RabbitMQ + two Aiven databases inside CI, and this project is
deliberately free-tier-only. Seven empty `app.e2e-spec.ts` scaffolds were
deleted in 2026-09 precisely so the suite would stop implying coverage it did
not have. Endpoints are verified by scripted `curl` runs against a running
stack instead, and the result of each is recorded in
`ai-docs/agent-handoff/CHANGELOG.md`.

## Lines of code

`npx cloc apps libs database scripts`, excluding `*.spec.ts`, `node_modules`,
`dist`, and `coverage`:

| Language | Files | Code |
|---|---:|---:|
| TypeScript | 327 | 40,450 |
| JavaScript | 6 | 1,951 |
| SQL | 18 | 1,068 |
| **Total** | **351** | **43,469** |

---

## Throughput

Measured **on the production EC2** (2 vCPU, 7.7 GB) on 2026-09-21, against the
deployed build at `2beea58`. Runner: `node scripts/load/baseline.mjs`
(autocannon). It refuses to be quoted casually — the script header records every
official run, newest first, and the raw autocannon JSON for each is committed
under `scripts/load/results/`.

> These numbers are **conservative**. autocannon ran on the same 2-vCPU box as
> all ten services, Redis and RabbitMQ, so the load generator and the system
> under test competed for the same two cores. A generator on separate hardware
> would report higher.

Conditions: deployed prod build under pm2 (**not** `nest --watch`), requests
aimed at `127.0.0.1:3000` to bypass the nginx per-IP caps (`limit_req 30r/s`,
`limit_conn 32`) which otherwise measure nginx rather than the API,
`RATE_LIMIT_DEFAULT_LIMIT` temporarily raised and restored afterwards, Aiven
free-tier databases in a remote region, **500 concurrent connections and 30 s
per scenario**.

| Scenario | Route | req/s | p50 | p95 | p99 | Errors |
|---|---|---:|---:|---:|---:|---|
| Anonymous product list | `GET /api/products?page=1&limit=20` | **1,228** | 292 ms | 1,831 ms | 3,138 ms | 0.34% timeouts |
| Anonymous product detail | `GET /api/products/:id` | **2,867** | 143 ms | 281 ms | 1,573 ms | 0 |
| Authenticated cart read | `GET /api/cart` | **420** | 1,156 ms | 1,570 ms | 1,627 ms | 0 |
| Authenticated order list | `GET /api/order/user/:id` | **200** | 2,252 ms | 3,908 ms | 3,984 ms | 0 |
| Checkout (contract probe) | `POST /api/order` | — | — | — | — | `201` |

**Across all four scenarios: zero non-2xx, zero 5xx, zero 429.** 141,430
responses, every one of them a 200. The only failures anywhere were 125
client-side timeouts on the list scenario.

The shape of that table is the architecture showing through. The two cached
anonymous reads run an order of magnitude faster than the two authenticated
ones, because a cache hit is a single local Redis `GET` while an authenticated
read still crosses TCP into a service and out to Aiven in another region. The
order list is the slowest because it is the heaviest join and the least
cacheable — it is per-user by definition.

### What moved the numbers

Three changes, measured one at a time, each with its own committed result file:

| Change | Anon list ceiling |
|---|---|
| Baseline (`MYSQL_POOL_SIZE=10` everywhere) | 40 req/s |
| **Per-service DB pool budget** — MySQL 68 conns and PostgreSQL 12 conns, both under the free-tier caps (76 / 20) | 61 req/s |
| **Gateway full-response Redis micro-cache**, 10 s TTL, on the two user-invariant public reads | **798 req/s** |

(Those three were measured on a 12-core dev box, which is why the ceiling there
reads 798 while production reports 1,228 — the dev box was running the load
generator, all thirteen Node processes, Redis and Docker at once. The useful
figure is the ratio between the rows, not the absolute value of any one of
them.)

The pool budget mattered because a flat `MYSQL_POOL_SIZE=50` across six MySQL
services blew past the 76-connection cap and turned ~35% of responses into
`500 Too many connections`. Fixing it removed the 500s but only moved
throughput 40 → 61 req/s, because the real binding leg was elsewhere: every
product-list request did an uncached user-enrichment TCP call into a 16-connection
MySQL pool — about 64 req/s of theoretical headroom, which is exactly where it
plateaued. Caching the final exposed payload collapses product TCP + user TCP +
serialization into one local Redis `GET`, and the ceiling moves by 13×.

Two limits are worth stating plainly rather than optimising away:

- **Free-tier Aiven allows ~76 MySQL connections at ~250 ms round trip, so
  ~300 req/s total across all services is a structural wall.** Bigger pools
  cannot cross it. Only caching can, which is why SCALE-04 exists.
- **Cached reads are bound by the single gateway Node process**, not the
  database. Running the gateway as a pm2 cluster (`GATEWAY_INSTANCES=4`) is
  implemented and correct — 4 workers, 0 restarts, 0 non-2xx, 8/8 WebSocket
  connects across workers via the Redis adapter — but it measured *slower* on
  the dev box, where the load generator competed for the same 12 cores. It
  ships env-gated and defaults to 1. Production has 2 vCPU and currently runs
  ten services on them, so a cluster there is unlikely to pay either; the
  measurement is owed before anyone raises it.

## Reproducing the throughput run

Run it **on the target host**, aimed at the loopback. Driving it from a laptop
measures nginx's per-IP `limit_req 30r/s` and `limit_conn 32`, not the API.

```bash
# 1. Prod-like target (not `nest --watch` — the watcher alone costs ~40% of it)
npm run build
pm2 start ecosystem.config.js

# 2. Raise the rate limit on the gateway, or you will measure the rate limiter.
#    Back it up first, and put it back afterwards — this weakens a live defence.
cp local/nodeA/.env local/nodeA/.env.bak
sed -i 's/^RATE_LIMIT_DEFAULT_LIMIT=.*/RATE_LIMIT_DEFAULT_LIMIT=2000000/' local/nodeA/.env
pm2 restart gateway --update-env

# 3. Credentials come from the untracked account file, never from source
export LOAD_USER=... LOAD_PASS=...     # see ../.agent-local/test-accounts.md

# 4. Run
npm i --no-save autocannon
PATH="$PWD/node_modules/.bin:$PATH" node scripts/load/baseline.mjs \
  --profile 500 --base http://127.0.0.1:3000

# 5. RESTORE — verify the value, do not trust the restore silently
cp local/nodeA/.env.bak local/nodeA/.env
pm2 restart gateway --update-env
grep '^RATE_LIMIT_DEFAULT_LIMIT' local/nodeA/.env    # must read 300
```

Step 5 is not optional and its verification is not decoration. On the
2026-09-21 run an `EXIT` trap that was supposed to restore the limit did not
fire, and production sat with rate limiting effectively disabled until a
follow-up check caught it. Worse, the second attempt "restored" from a backup
that had itself been taken after the edit, so the backup carried the raised
value and the restore silently changed nothing. **Read the value back; do not
infer it from the fact that a restore command ran.**

`--write` additionally exercises the checkout path under load and creates real
orders. Without it, checkout still fires **exactly one** request to validate the
contract — which on a production target means one real order in the production
database. Expect it, and clean it up.

---

## Production traffic (Grafana)

Real requests served by the production gateway, read back from Grafana Cloud,
which scrapes the gateway's `/metrics` every 60 s. Window
**2026-10-07 18:50 → 2026-10-08 12:10 UTC**. That covers the frontend team's
all-route functional test on prod, in two sessions: 10-07 18:55–19:59 and
10-08 09:10–12:04. The window spans builds `96e87ca` and then `a5c4448` (Deploy
run 37770061942, 11:29 UTC), and three gateway boots.

```bash
npm run metrics:prod -- --from 2026-10-07T18:50:00Z --to 2026-10-08T12:10:00Z
```

| Metric | Value |
|---|---:|
| Requests served (probes excluded) | **1,944** |
| Distinct routes exercised (method + route) | **123** of 170 |
| 2xx | 1,843 (94.80%) |
| 4xx | 101 (5.20%) |
| **5xx** | **0** |
| Latency p50 / p95 / p99 (all routes) | **66 ms / 423 ms / 1.16 s** |
| Busiest minute | 70 req |
| Gateway RSS, max | 151 MiB |
| Gateway CPU, mean / max (cores) | 0.008 / 0.015 |
| Event-loop lag p99, max | 12 ms |
| Probe requests excluded (`/health`, `/live`, `/ready`) | 197 |

Status codes: `200` 1,726 · `201` 114 · `204` 3 · `400` 11 · `401` 47 ·
`403` 6 · `404` 36 · `409` 1. The 4xx come from the test exercising guards and
validation:

- `401`: a wrong password on `POST /api/user/login`, and `GET /api/user/me`
  while logged out.
- `403`: admin-only lists, and another user's order.
- `404`: 28 unmatched paths, plus a few ids that no longer exist.
- `400`: validation rejects.
- `409`: one add-to-cart that went over stock.

There is no 5xx anywhere in the window.

Busiest and slowest routes (slowest = at least 5 requests, ranked by p95):

| Busiest | Requests | p95 |
|---|---:|---:|
| `GET /api/user/me` | 200 | 49 ms |
| `GET /api/cart` | 166 | 96 ms |
| `GET /api/notifications` | 157 | 205 ms |
| `GET /api/chat/conversations` | 154 | 98 ms |
| `GET /api/notifications/unread-count` | 148 | 85 ms |

| Slowest | Requests | p50 | p95 |
|---|---:|---:|---:|
| `POST /api/user/forgot-password` | 6 | 3.13 s | 4.81 s |
| `POST /api/order/shipping-fee` | 11 | 1.15 s | 3.62 s |
| `POST /api/order` | 6 | 1.38 s | 2.39 s |
| `POST /api/products/risk/duplicate-check` | 5 | 875 ms | 2.31 s |
| `GET /api/order/:id/payment-url` | 5 | 313 ms | 2.13 s |

The slow tail is made of routes that wait on an outside system: GHN quotes the
shipping fee and creates the waybill at checkout, and forgot-password sends
mail. The session reads that every storefront page fires (`/me`, cart,
notifications, chat) stay under 210 ms at p95.

**Read these numbers for what they are:**

- **Functional test traffic, not a load test.** Peak was 70 requests in one
  minute and at most one request in flight at a time. For capacity, see
  [Throughput](#throughput) above.
- **Gateway only, one process.** Time spent inside each microservice is part of
  the gateway's latency, not reported separately.
- **The percentiles are approximate.** They are interpolated from histogram
  buckets that run from 10 ms to 10 s. A route with only a few samples has a
  p99 that is really its slowest request, so the per-route p99 column is left
  out.
- **Counts come from raw samples, not `increase()`.** The box is stopped every
  night, so most series start inside the window, and `increase()` drops each
  series' first sample. Over the 10-08 session (09:05–12:10), the
  dashboard-style `increase()` gives 1,307 requests where the sample replay
  gives 1,453. The replay matches an independent per-minute recount, and its
  p50 and p95 (67 ms, 440 ms) agree with the dashboard's (65 ms, 410 ms). A
  counter restart is
  detected per scrape step from `process_start_time_seconds`. Before that fix,
  the first step after the 11:29 deploy still held the old process's total,
  and the script counted the whole earlier run twice (2,802 instead of 1,453).
