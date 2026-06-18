---
name: refactor
description: Perform a constrained TryBuy refactor while preserving specified behavior and contracts. Use when the user asks to refactor, extract duplicated logic, or improve structure without changing public behavior.
---

Inspect the target first, implement the smallest behavior-preserving change, then run relevant formatting, lint, type-check, and tests.

# Prompt Template: Refactor

Copy and fill in this template when requesting a refactor.

---

## Refactor: [Name]

**One-line goal:**
[What problem does this solve? e.g. "Extract duplicated TCP call logic into a shared utility"]

---

### Target

**File(s) to change:**
```
api/apps/[service]/src/[file.ts]
```

**Current behavior / structure:**
[Describe what the code does now]

**Desired behavior / structure:**
[Describe what it should look like after]

---

### Constraints

**Must NOT change:**
- [ ] Public API / HTTP endpoints (no route changes)
- [ ] Message pattern names (TCP contracts)
- [ ] Entity field names (DB schema)
- [ ] RabbitMQ event names
- [ ] [Other: ___]

**Must preserve:**
- [ ] All existing tests passing
- [ ] `tsc --noEmit` zero errors
- [ ] Swagger docs unchanged

---

### Guidance

**Is there an existing pattern in `libs/` to reuse?**
[Yes / No — if yes, describe it]

**Scope limit:**
Only touch files listed above. Do not refactor neighboring code that isn't broken.

**Acceptable diff size:**
[ ] Small (< 50 lines changed)
[ ] Medium (50–200 lines)
[ ] Large (200+ lines, confirm before proceeding)
