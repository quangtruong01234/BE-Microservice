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

> ⚠️ **Measured on a development machine, not on the production EC2.** The
> figures below are real and reproducible, but the hardware is a 12-core dev box
> running the load generator, all 13 Node processes, Redis and Docker at once.
> A production re-measurement is owed; until it exists, do not quote these as
> "production capacity".

Runner: `node scripts/load/baseline.mjs` (autocannon). It refuses to be quoted
casually — the script header records every official run, newest first, and the
raw autocannon JSON for each is committed under `scripts/load/results/`.

Conditions for the run below: prod build (`npm run build` + pm2 via
`ecosystem.config.js`, **not** `nest --watch`), `RATE_LIMIT_DEFAULT_LIMIT`
raised so the test measures the API and not the rate limiter, Aiven free-tier
databases in a remote region (~250 ms round trip), 20 s per probe.

### Anonymous product list — `GET /api/products?page=1&limit=20`

| Connections | req/s | p50 | p99 | Errors |
|---:|---:|---:|---:|---|
| 50 | 798 | 51 ms | 84 ms | 0 |
| 100 | 790 | 103 ms | 1,859 ms | 0 |
| 200 | 679 | 213 ms | 4,695 ms | 0 |
| 500 | 757 | 517 ms | 6,291 ms | ~3.6% timeouts, 0 non-2xx |

### Anonymous product detail — `GET /api/products/:id`

| Connections | req/s | p50 | p99 | Errors |
|---:|---:|---:|---:|---|
| 50 | 1,692 | 25 ms | 45 ms | 0 |

### What moved the numbers

Three changes, measured one at a time, each with its own committed result file:

| Change | Anon list ceiling |
|---|---|
| Baseline (`MYSQL_POOL_SIZE=10` everywhere) | 40 req/s |
| **Per-service DB pool budget** — MySQL 68 conns and PostgreSQL 12 conns, both under the free-tier caps (76 / 20) | 61 req/s |
| **Gateway full-response Redis micro-cache**, 10 s TTL, on the two user-invariant public reads | **798 req/s** |

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
- **Cached reads are now bound by the single gateway Node process**, not the
  database. Running the gateway as a pm2 cluster (`GATEWAY_INSTANCES=4`) is
  implemented and correct — 4 workers, 0 restarts, 0 non-2xx, 8/8 WebSocket
  connects across workers via the Redis adapter — but it measured *slower* on
  the dev box, where the load generator competes for the same 12 cores. It
  ships env-gated and defaults to 1. Re-measure on the target host before
  raising it.

## Reproducing the throughput run

```bash
# 1. Prod-like target (not `nest --watch` — the watcher alone costs ~40% of it)
npm run build
pm2 start ecosystem.config.js

# 2. Raise the rate limit on the gateway, or you will measure the rate limiter
#    RATE_LIMIT_DEFAULT_LIMIT=1000000 in local/nodeA/.env

# 3. Credentials come from the untracked account file, never from source
export LOAD_USER=... LOAD_PASS=...     # see ../.agent-local/test-accounts.md

# 4. Run
npm i -g autocannon
node scripts/load/baseline.mjs --profile 500
```

`--write` additionally exercises the checkout path and creates real orders; the
stale-reservation sweeper cancels them within 24 h. Without it, checkout fires
exactly one request to validate the contract.
