# Metrics

Every number quoted in `README.md` comes from here, and everything here is
either produced by a script in this repo or copied from a raw result file that
is committed alongside it. Nothing is hand-counted.

```bash
bash scripts/metrics.sh          # code + API surface (fast, no side effects)
bash scripts/metrics.sh --tests  # also runs the unit suite and counts it
bash scripts/metrics.sh --loc    # also runs `npx cloc`
bash scripts/metrics.sh --all    # everything (~2 min)
```

---

## Code and API surface

Commit `0364eeb` (2026-09-16) · measured 2026-09-21 · `bash scripts/metrics.sh --all`

| Metric | Value | How it is counted |
|---|---:|---|
| Microservices | 10 | `apps/*/` directories |
| Shared libraries | 4 | `libs/*/` directories |
| HTTP routes (gateway) | 155 | `@Get/@Post/@Put/@Patch/@Delete` sites in `apps/gateway/src` |
| Gateway controllers | 20 | `*.controller.ts` in `apps/gateway/src` |
| TCP message patterns | 153 | `@MessagePattern(` sites in `apps/` |
| RabbitMQ event handlers | 22 | `@EventPattern(` sites in `apps/` |
| TypeORM entities | 34 | `*.entity.ts` in `apps/` + `libs/` |
| SQL migrations | 8 | `database/migrations/**/*.sql` |
| Test suites (spec files) | 47 | `*.spec.ts` in `apps/` + `libs/` |
| Documented behaviours | 58 | `kb:` anchors in `ai-docs/agent-context/known-behaviors.md` |

The gateway is the only HTTP-facing process, which is why the route count is
scoped to it — the other nine services are unreachable from outside the VPC and
expose transport handlers only.

## Tests

`npx jest --silent --json`, same commit:

| Metric | Value |
|---|---:|
| Suites passed | 47 / 47 |
| Tests passed | 500 / 500 (100%) |
| Tests failed | 0 |

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
| TypeScript | 309 | 35,145 |
| JavaScript | 6 | 1,951 |
| SQL | 10 | 782 |
| **Total** | **325** | **37,878** |

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
