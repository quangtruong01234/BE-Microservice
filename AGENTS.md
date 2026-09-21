# AGENTS.md — TryBuy backend

How work is done in this repository. Written for an AI coding agent, but it is
the same contract a new human contributor works under: read the code before
assuming, keep the diff small, and do not call something done that the compiler
or the tests disagree with.

- **What the system is and why** → [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **How to run it** → [`README.md`](README.md)
- **The long version of this file** — context loading, the knowledge base,
  self-test and review protocols → [`docs/AGENT-WORKFLOW.md`](docs/AGENT-WORKFLOW.md)
- **Domain specs and decision records** → `ai-docs/agent-context/`

## The repository

A NestJS monorepo: applications under `apps/`, shared libraries under `libs/`.
Two process groups, `npm run start:nodeA` and `npm run start:nodeB`, split by
which database their services own.

Before assuming anything about service boundaries, ports, database ownership or
transports, read the source: `apps/`, `libs/`, `package.json`, `nest-cli.json`,
and the shared constants in `libs/constant` and `libs/common/src/constants`.
Service counts in documentation go stale. **Where documentation and source
disagree, source wins — and the mismatch gets reported, not silently followed.**

## Non-negotiables

- **Be self-sufficient.** Run the commands yourself. Blocked by missing
  credentials, a service that is down, or an approval policy? Report the
  blocker with evidence and the exact next action — do not hand the user a list
  of commands to run.
- **Do not stop at the first failure.** Try the alternative immediately.
- **Do not describe a problem and wait.** Gather evidence and fix it.
- **Search before creating.** Check `libs/` before adding any service, util,
  helper, constant or DTO. Extending an existing module beats adding one.
- **Keep the diff minimal.** No refactors that were not asked for.
- **Format what you touch.** After editing a `.ts` file:
  `npx prettier --write <path> && npx eslint --fix <path>`.
- **Write in English** — code comments, documentation and commit messages —
  regardless of the language of the conversation.
- **Never commit a secret, a credential, or the production hostname.** Test
  accounts live in `../.agent-local/test-accounts.md`, outside the repository by
  design. Committed files use the `<PROD_API_DOMAIN>` placeholder.

## Code rules

**Transport and boundaries**

- Every gateway TCP call needs `.pipe(timeout(TCP_TIMEOUT_MS.READ | .WRITE))`
  and `MicroserviceErrorHandler`. Every gateway DTO field needs `@ApiProperty()`.
- Message patterns, queue names and ports live in `@app/constant` or
  `@app/common/src/constants/`. Never inline a pattern string or a port number.
- A `@MessagePattern` handler always returns a value — `null` for side-effect
  handlers. Returning `void` means NestJS sends no TCP response at all, and the
  gateway turns that into a 502.
- `.send(P, data)` matches only `@MessagePattern(P)`, and `.send({ cmd: P })`
  only `@MessagePattern({ cmd: P })`. Both shapes are valid; mixing them is a
  runtime "no matching handler", not a compile error. Change both sides or
  neither.
- Every microservice controller carries `@UseFilters(HttpToRpcExceptionFilter)`,
  or its `main.ts` registers the global RPC filter. Without it a
  `ForbiddenException` reaches the gateway as a 500.

**Data**

- TypeORM entities: `!` on every decorated column. A `nullable: true` column is
  declared `!: T | null` — never `?: T`, never with an initializer.
- Repositories are never cross-injected across database ownership. Follow the
  actual entity ownership in source: the MySQL group (orders, user, product,
  social, notification, chat) and the PostgreSQL group (inventory, payments,
  rewards) do not share repositories.
- Responses to the frontend are camelCase. A snake_case column maps through
  `@Column({ name: 'snake_case' })` with a camelCase property.
- DECIMAL columns come back from TypeORM as strings. Coerce before arithmetic or
  before sending to an external API: `Math.round(Number(value ?? 0))`.

**TypeScript**

- ES modules only — never `require()`.
- Path aliases only; no relative import deeper than `../../`. `@app/constant`,
  `@app/common`, `@app/cached`, `@app/database`. An alias missing from
  `tsconfig` gets reported, not worked around with a relative path.
- Prefer lodash per-method imports (`import groupBy from 'lodash/groupBy'`) over
  hand-rolled data manipulation, unless it is trivially a one-liner or sits in a
  hot consumer path.

**RabbitMQ consumers**

Every `@EventPattern` handler wraps its business logic:

```typescript
try {
  // business logic
  this.rmqService.ack(context);
} catch (err) {
  logger.error(err);
  // transient (timeout, service down) → requeue
  this.rmqService.nack(context, false, true);
  // corrupt or unprocessable → no requeue → dead-letter queue
  // this.rmqService.nack(context, false, false);
}
```

Requeue policy: `payment_completed` requeues on a database error but not when
the `order_id` does not exist; `order_created` requeues when the payment service
is not ready.

`@Payload()` receives the **unwrapped** envelope — `data.orderId`, never
`data.data.orderId`.

## Validating a change

```bash
npx tsc --noEmit            # zero errors, always
npm run check:conventions   # invariants eslint cannot express
npm run lint
npm test
npm run build
```

`npm run lint` may autofix — review the diff afterwards. Do not chain multiple
`curl` calls in one shell invocation; they hang.

## Definition of done

- `npx tsc --noEmit` is clean. A task is never done with type errors.
- Linter and formatter diffs have been reviewed.
- An endpoint change has been **runtime tested by you** — status code and key
  response fields asserted. A bug fix has been verified to no longer reproduce.
- A change to transport, auth, payments, RabbitMQ or startup has had its runtime
  flow exercised, not just its types checked.
- The change-impact review in [`docs/AGENT-WORKFLOW.md`](docs/AGENT-WORKFLOW.md)
  §4 has been done: the legs the happy-path test never reached are the ones that
  break in production.
- `ai-docs/agent-handoff/snapshot.md` still holds only live state; the
  completed-work summary went to `CHANGELOG.md`.
- Any frontend-facing consequence has been written to the correct handoff file,
  and the change has been classified A / B / C against the release gate — see
  [`docs/AGENT-WORKFLOW.md`](docs/AGENT-WORKFLOW.md) §5.

Documentation-only changes need none of the runtime steps.
