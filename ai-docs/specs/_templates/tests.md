# <KEY> — Tests

> Copy to `ai-docs/specs/<KEY>/tests.md`. Every [AC-n] in `requirements.md` has
> at least one [TC-n] here, and every test in code carries its [TC-n] id in its
> name. English only.

## Unit tests

Run scoped — `npx jest <path>` — never the whole suite while iterating. Shared
mock factories live in `test/utils/` (see its README).

| Id | Covers | File | Case | Status |
|---|---|---|---|---|
| [TC-1] | [AC-1] | `apps/<service>/src/<name>.spec.ts` | `[TC-1] <behaviour in one sentence>` | ⏳ / ✅ |
| [TC-2] | [AC-2] | `apps/<service>/src/<name>.spec.ts` | `[TC-2] rejects <bad input> with 400` | ⏳ / ✅ |

Each test was seen **red** before it went green (break the code or the
assertion once, watch it fail, restore). A test that never failed proves
nothing.

## Runtime checks (self-test)

Run by the agent per `docs/AGENT-WORKFLOW.md` §3; role only, never credentials.

| Id | Covers | Request | Role | Expected |
|---|---|---|---|---|
| [TC-3] | [AC-1] | `POST /api/<route>` `{...}` | user / shop / admin | `201`, `data.id` starts with `<prefix>_` |

## Legs not covered here

<Anything neither a unit test nor the self-test reaches (cron, RMQ consumer,
external API). Each becomes a `⏳ PENDING RUNTIME TEST (<KEY>)` note in
`snapshot.md` Known Issues with exact steps, or "none".>
