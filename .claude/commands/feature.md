# /feature — New Feature Command

Use this command to implement a new feature end-to-end in TryBuy.

## How to invoke

```
/feature <short description>
```

Example: `/feature add product reviews`

---

## What I will do before implementing

1. Run `researcher` agent to locate existing patterns, entities, constants
2. Identify affected microservices from the feature description
3. Plan it — the size decides the form (`docs/AGENT-WORKFLOW.md` §6):
   - **More than two services, or a migration** → run the `planner` agent. It
     writes the spec to `ai-docs/specs/<KEY>/` (requirements, design, tasks,
     tests — see `ai-docs/specs/README.md`) and prints a one-screen summary.
     Resolve its risk flags, set `status=approved` in `design.md`, then work
     `tasks.md` phase by phase.
   - **Anything smaller** → no spec; use the inline checklist below.
4. Implement without asking user for info that can be found in code

---

## Implementation checklist I will follow

- [ ] Search `libs/` for existing utilities before creating new ones
- [ ] Add message pattern constant to `@app/constant`
- [ ] Create/extend entity + migration SQL if needed
- [ ] Implement service method in the target microservice
- [ ] Add `@MessagePattern()` handler in the microservice controller
- [ ] Add gateway service method (with `MicroserviceErrorHandler` + `timeout(TCP_TIMEOUT_MS.READ|WRITE)`)
- [ ] Add gateway HTTP endpoint + DTO with `@ApiProperty()` (converted domains: accept/return public ids `ord_`/`usr_`/`prod_`/... — never numeric ids on HTTP)
- [ ] Declare the new endpoint's auth zone in `ai-docs/agent-context/api.md` (Public / Cookie / Admin) before implementing the guard
- [ ] If the change is frontend-facing: write the FE handoff entry per `docs/AGENT-WORKFLOW.md` §5 or `/handoff` (storefront vs GHN console file)
- [ ] Run `tsc --noEmit` — zero errors before done

---

## After implementing
- Run `test-guard` agent on the touched service(s) — red → green, scoped `npx jest <path>`
- Then run `code-reviewer` agent to verify against project conventions
- If a spec exists: tick `tasks.md`, record each `[TC-n]` status in `tests.md`, and on ship set the `design.md` anchor to `status=done`
- Run `tsc --noEmit` — zero errors before done
- Report: files changed, endpoints added, patterns registered
