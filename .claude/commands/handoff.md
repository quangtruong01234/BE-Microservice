# /handoff — Frontend Handoff Command

Use this command after a backend task is DONE to write the FE-facing contract
entry required by the Definition of Done, without re-deriving the routing rules
each time.

## How to invoke

```
/handoff                       # evaluate the current task's diff and write the entry
/handoff <short description>   # write an entry for the described change
```

## Step 1 — decide if a handoff entry is needed at all

An entry is needed only when the finished task has a frontend-facing
consequence: new/changed endpoint, request/response field, status code,
RabbitMQ/WS event, or a behavior the FE was mitigating client-side.
Internal-only work (refactor, perf with identical contract, docs, tests) →
report "no FE impact" and stop.

## Step 2 — route to the correct file (never mix the two)

Both files live at the `MCR/` workspace root, OUTSIDE both git repos —
**never copy them into the repo or commit them.**

| Change consumed by | File |
|---|---|
| TryBuy storefront (`../frontend`, React+Vite :5173 — catalog, cart, orders, checkout, payments, chat, social, notifications) | `../.agent-local/frontend-handoff.md` |
| GHN Shipping console (`../web-flow-GHN`, Next.js :3013 — shipping auth/roles, `GET/POST /api/order/admin/ghn/*`, GHN sync/history) | `../.agent-local/frontend-handoff-ghn.md` |

If a change genuinely affects both, write a TAILORED entry in each file.

## Step 3 — close a real thread, don't invent one

Before writing, read the matching FE backlog (storefront:
`../frontend/.ai/agent-handoff/snapshot.md`) and look for the FE-waiting item
this change closes (e.g. `P1-06`, `P2-02`). Reuse that id; use `NEW` only when
nothing matches.

## Step 4 — write the entry

Append at the top of the **Open** section of the chosen file, using its
template (contract-first — enough for FE to integrate without reading backend
code):

```
### <FE-item-id or NEW> · <short title> — <YYYY-MM-DD>
- **What changed:** <one line: add / fix / update + scope>
- **Endpoint / event:** `<METHOD> /api/...` or `<EVENT_NAME>`
- **Contract:** request `{...}` → response `{...}`; status codes `200/400/409/...`
- **FE action needed:** <integrate field X / drop mitigation Y / no change, FYI>
- **Backend ref:** <commit / file:line or CHANGELOG entry>
```

Contract rules to respect in the entry:
- Converted domains expose ONLY public ids (`ord_`, `usr_`, `prod_`, `conv_`,
  `msg_`, `addr_`, `ntf_`, `rr_`, `post_`, `cmt_` + 16 base62) — document id
  fields as strings; numeric ids on those params → 400.
- Response fields are camelCase; paginated lists use the standard
  `PaginatedResponse` shape (`data`, `total`, `page`, `limit`, `totalPages`,
  `hasNext`).
- Mark BREAKING clearly in the title when FE code must change to keep working.

## Step 5 — report

Final summary states: which file(s) got the entry, the item id used, and
whether it was BREAKING / additive / FYI. Never paste credentials or tokens
into a handoff entry.
