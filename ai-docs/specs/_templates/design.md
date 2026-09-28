<!-- spec: id=<KEY>; files=<a.ts,b.ts>; keys=<a,b,c>; status=draft -->
# <KEY> — Design

> Copy to `ai-docs/specs/<KEY>/design.md`. The anchor above must stay the first
> line. English only.

## Existing behaviour inventory

What the code does **today** in the area this change touches, read from source
(not from docs — where they disagree, source wins and the mismatch is noted
here). This table is what stops a design from silently breaking a behaviour
nobody remembered.

| Behaviour | Where (file:line) | Kept / changed / removed | Why |
|---|---|---|---|
| <e.g. `GET /api/order/:id` returns `image` only> | `apps/gateway/src/...:42` | kept | ORDER-SHAPE-01 |

## Affected services

| Service | Node / DB | What changes |
|---|---|---|
| gateway | A / — | <route, DTO> |
| <service> | A MySQL / B PostgreSQL | <handler, entity> |

## Transport

- **New TCP message patterns** (`libs/constant/src/`): <constant names, shape
  `P` vs `{ cmd: P }` matching the service's existing handlers>
- **New RabbitMQ events** (`libs/common/src/constants/event.ts`): <names,
  payload, requeue policy, idempotency key>
- **Timeouts**: <which calls are `TCP_TIMEOUT_MS.READ` vs `.WRITE`>

## Data

<Entities, columns, indexes. `nullable: true` ⇒ `!: T | null`. Migration file
name under `database/migrations/nodeA|nodeB/` + manifest entry, guarded and
idempotent. Never touch `database/prod-baseline-20260717/`.>

## Response shape

<The exact JSON of each new/changed response. Collections are never `null`;
a missing single relation is `null`, not `{}` (conventions.md § Data-Shape
Hygiene). Public ids on HTTP for converted domains.>

## Failure modes

| Failure | Behaviour | Status |
|---|---|---|
| downstream service down | <fail open / fail closed> | <502 / 200 degraded> |
| bad input | <validation> | 400 |

## Alternatives considered

- <option> — rejected because <reason>.
