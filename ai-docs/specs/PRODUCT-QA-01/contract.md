<!-- contract: id=PRODUCT-QA-01; status=draft -->
# PRODUCT-QA-01 — API contract

> The single source of truth for the HTTP surface of `PRODUCT-QA-01`. The
> backend implements it, the frontend types and mocks are copied from it, and
> the FE handoff entry points here instead of restating it. Rules:
> `docs/AGENT-WORKFLOW.md` §7 and `ai-docs/specs/README.md`.

## 1. Purpose

A signed-in shopper on a product page asks a free-text question ("does it fit a
15-inch laptop?") and gets a short answer grounded only in that product's own
listing, SKUs and reviews, with numbered citations. When the indexed text does
not support an answer, the backend says so (`abstained: true`) instead of
guessing.

## 2. Endpoints

| Method | Gateway path | Auth zone / role | Request DTO | Response | Status codes |
|---|---|---|---|---|---|
| `POST` | `/api/products/:id/ask` | Cookie (any signed-in role) | `AskProductQuestionDto` | `ProductAnswer` | `200`, `400`, `401`, `404`, `429`, `503` |

`:id` is the product public id (`prod_` + 16 alphanumerics), parsed like
`GET /api/products/:id`. The route is rate limited per user at **5 requests per
60 s** (the gateway `@RateLimit` guard).

Release class per surface (`docs/AGENT-WORKFLOW.md` §5): **B** — a new route
and one new additive `errorCode`; no existing response changes.

## 3. Field table

| Field | In | Type | Nullable | Example | Note |
|---|---|---|---|---|---|
| `id` | path | string | — | `"prod_8fK2mQ7aLp3xRt9Z"` | product public id; any other shape is a 400 |
| `question` | body | string, 3..300 chars after trim | no | `"Có vừa laptop 15 inch không?"` | required; whitespace-only is a 400; Vietnamese or English |
| `answer` | response | string | **yes** | `"Có. Ngăn chính chứa laptop tới 15.6 inch [1]."` | `null` exactly when `abstained` is `true`. May contain markers `[n]` that refer to `citations[].index` |
| `abstained` | response | boolean | no | `false` | `true` ⇒ the listing does not support an answer; show a "not enough information" state, not an error |
| `abstainReason` | response | `"NO_SOURCES"` \| `"LOW_CONFIDENCE"` | **yes** | `null` | `null` when `abstained` is `false`. `NO_SOURCES`: the product has no indexed text yet. `LOW_CONFIDENCE`: text exists but nothing relevant enough was found, or the model could not cite it |
| `citations` | response | `Citation[]` | no — `[]` when abstained | see §4 | every `[n]` in `answer` has a matching entry; ordered by `index` |
| `citations[].index` | response | integer 1.. | no | `1` | the `n` of `[n]` in `answer` |
| `citations[].source` | response | `"PRODUCT"` \| `"SKU"` \| `"REVIEW"` | no | `"PRODUCT"` | where the quoted text lives: name/description, a SKU variant, or a buyer review |
| `citations[].snippet` | response | string, ≤ 300 chars | no | `"Ngăn chính chống sốc, vừa laptop tới 15.6 inch."` | verbatim excerpt of the indexed text; may be cut with `…` |

Reviews are cited by text only — no author, no user id, no review id.

### Error codes

| Status | `errorCode` (from `libs/constant/error-code.constant.ts`) | When |
|---|---|---|
| `400` | — | `id` is not a product public id, or `question` is missing / not a string / shorter than 3 or longer than 300 after trim (class-validator message) |
| `401` | `UNAUTHENTICATED` | no or invalid session cookie |
| `404` | — | no product with that id, or the product is inactive |
| `429` | — | more than 5 questions from this user in 60 s (gateway rate limiter) |
| `503` | `ASSISTANT_UNAVAILABLE` (new) | the AI provider is over quota, failing, or too slow, or the assistant service is down. Retry later; the product page itself keeps working |

The error body is the standard envelope (`conventions.md` § Response Shape).

## 4. Examples

Request:

```http
POST /api/products/prod_8fK2mQ7aLp3xRt9Z/ask
Content-Type: application/json

{ "question": "Có vừa laptop 15 inch không?" }
```

Response `200` — answered:

```json
{
  "answer": "Có. Ngăn chính chứa vừa laptop tới 15.6 inch [1], và một người mua cho biết máy 15 inch của họ vừa khít [2].",
  "abstained": false,
  "abstainReason": null,
  "citations": [
    { "index": 1, "source": "PRODUCT", "snippet": "Ngăn chính chống sốc, vừa laptop tới 15.6 inch." },
    { "index": 2, "source": "REVIEW", "snippet": "Mình để laptop 15 inch vừa khít, khoá kéo vẫn đóng dễ." }
  ]
}
```

Response `200` — abstained:

```json
{
  "answer": null,
  "abstained": true,
  "abstainReason": "LOW_CONFIDENCE",
  "citations": []
}
```

Response `503`:

```json
{ "statusCode": 503, "status": "error", "error": "Service Unavailable", "message": "The product assistant is busy, please try again later", "errorCode": "ASSISTANT_UNAVAILABLE", "data": null }
```

Response `429`:

```json
{ "statusCode": 429, "status": "error", "error": "Too Many Requests", "message": "Too many requests", "data": null }
```

## 5. Mock guidance for the frontend

- Fields that may be `null` in real data: `answer` and `abstainReason`, always
  together with the value of `abstained`. `citations` is never `null`.
- An answer can have zero `[n]` markers only when `abstained` is `true`; an
  answered response always carries at least one citation.
- Latency is LLM-bound: typically 1–4 s, up to ~10 s before the backend gives
  up with a `503`. Show a pending state and disable re-submit while in flight.
- The answer language follows the question's language.
- States worth a fixture: answered with 2 citations (one `REVIEW`), abstained
  `LOW_CONFIDENCE`, abstained `NO_SOURCES`, `400` question too short, `429`,
  `503 ASSISTANT_UNAVAILABLE`.
- Signed-out users: hide the box or send them to login; the route is a `401`.

## 6. Change log

- `2026-10-07` draft.
