<!-- contract: id=<KEY>; status=draft -->
# <KEY> — API contract

> Copy to `ai-docs/specs/<KEY>/contract.md`. The anchor above must stay the
> first line; `status` moves `draft` → `agreed` → `implemented`. English only.
>
> This file is the single source of truth for the HTTP surface of `<KEY>`.
> The backend implements it, the frontend types and mocks are copied from it,
> and the FE handoff entry points here instead of restating it.
> Rules: `docs/AGENT-WORKFLOW.md` §7 (two-session mode) and
> `ai-docs/specs/README.md`.

## 1. Purpose

<Two lines: who calls this, and what they get that they cannot get today.>

## 2. Endpoints

| Method | Gateway path | Auth zone / role | Request DTO | Response | Status codes |
|---|---|---|---|---|---|
| `GET` | `/api/<route>` | Public / Cookie / Admin (`api.md` § Auth Zones) | `<QueryDto>` | `PaginatedResponse<<Item>>` | `200`, `400`, `401`, `404` |

Release class per surface (`docs/AGENT-WORKFLOW.md` §5): <A / B / C — one line each>.

## 3. Field table

Request and response, one row per field. Converted domains expose only public
ids (`ord_`, `usr_`, `prod_`, … — `api.md`), typed `string`. A collection is
never `null` (`conventions.md` § Data-Shape Hygiene rule 1); a field that can be
absent is nullable from its first release (rule 2).

| Field | In | Type | Nullable | Example | Note |
|---|---|---|---|---|---|
| `id` | response | string | no | `"ord_3kT9…"` | public id |
| `page` | query | integer 1.. | — | `1` | default 1 |

### Error codes

| Status | `errorCode` (from `libs/constant/error-code.constant.ts`) | When |
|---|---|---|
| `400` | — | bad input (class-validator message) |
| `409` | `<CODE>` | <condition> |

The error body is the standard envelope (`conventions.md` § Response Shape).

## 4. Examples

Request:

```http
GET /api/<route>?page=1&limit=20
```

Response `200`:

```json
{
  "data": [],
  "total": 0,
  "page": 1,
  "limit": 20,
  "totalPages": 1,
  "hasNext": false
}
```

Response `4xx`:

```json
{ "statusCode": 409, "status": "error", "error": "Conflict", "message": "...", "errorCode": "<CODE>", "data": null }
```

## 5. Mock guidance for the frontend

- Fields that may be empty / `null` in real data: <list>.
- Pagination defaults: `page=1`, `limit=<n>`, max `<n>`.
- States worth a fixture: empty list, one item, the `4xx` above.

## 6. Change log

- `<YYYY-MM-DD>` draft.
