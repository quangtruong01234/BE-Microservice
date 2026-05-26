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
3. Plan implementation checklist based on findings
4. Implement without asking user for info that can be found in code

---

## Implementation checklist I will follow

- [ ] Search `libs/` for existing utilities before creating new ones
- [ ] Add message pattern constant to `@app/constant`
- [ ] Create/extend entity + migration SQL if needed
- [ ] Implement service method in the target microservice
- [ ] Add `@MessagePattern()` handler in the microservice controller
- [ ] Add gateway service method (with `MicroserviceErrorHandler` + `timeout(10000)`)
- [ ] Add gateway HTTP endpoint + DTO with `@ApiProperty()`
- [ ] Update `shared/services/api.js` in frontend
- [ ] Add or update component/hook in the correct feature folder
- [ ] Declare the new endpoint's auth zone in `context/api.md` (Public / Cookie / Admin) before implementing the guard
- [ ] Run `tsc --noEmit` — zero errors before done

---

## After implementing
- Run `code-reviewer` agent to verify against project conventions
- Run `tsc --noEmit` — zero errors before done
- Report: files changed, endpoints added, patterns registered
