---
name: review
description: Review TryBuy changes against TypeScript, gateway, microservice, security, and project constraints. Use when the user asks for code review or pre-merge validation.
---

# $review — Code Review Skill

Use this command to review staged changes or a specific file/folder before merging.

## How to invoke

```
$review                    # reviews all uncommitted changes
$review <file-or-folder>   # reviews a specific path
```

---

## Review checklist

### TypeScript
- [ ] No `any` types (except legitimate generic bounds)
- [ ] No `!` non-null assertions outside TypeORM entity files
- [ ] All methods have explicit return types
- [ ] No `require()` — ES module `import` only
- [ ] `tsc --noEmit` passes with zero errors

### Backend: Gateway
- [ ] Every `ClientProxy.send()` call has `.pipe(timeout(TCP_TIMEOUT_MS.READ | .WRITE))`
  — never a literal; `READ` for pure reads, `WRITE` for mutations and external-API legs
- [ ] Every gateway method uses `MicroserviceErrorHandler`
- [ ] Every gateway DTO field has `@ApiProperty()`
- [ ] No internal numeric id for a converted domain leaves an HTTP or WebSocket
      boundary; route/DTO references and nested response FKs use the matching
      opaque public id (`ord_`, `usr_`, `prod_`, `post_`, etc.)
- [ ] No hardcoded message pattern strings — uses constants from `@app/constant`

### Backend: Microservices
- [ ] New message patterns added to `api/libs/constant/src/message-pattern.constant.ts`
- [ ] New queue names added to `api/libs/common/src/constants/queues.ts`
- [ ] New event names added to `api/libs/common/src/constants/event.ts`
- [ ] TypeORM entities use `!` only on decorated columns
- [ ] No duplicate service/entity/helper that already exists in `libs/`

### Security
- [ ] No JWT in `localStorage` / `sessionStorage` / `Authorization` header
- [ ] All frontend fetch calls use `credentials: 'include'`
- [ ] Auth guards present on protected gateway endpoints
- [ ] No new `@Get()` / `@Head()` route calls a mutating service method
- [ ] No secrets or credentials hardcoded

### General
- [ ] No unnecessary refactors outside the task scope
- [ ] No orphaned files (imports cleaned up)
- [ ] Follows existing folder structure for the service/feature

---

## Report format

Same format as the Claude Code `code-reviewer` agent
(`.claude/agents/code-reviewer.md`), so a report from either tool can be pasted
as the top comment of a PR.

- **Scale to the diff.** A one-line fix gets a one-line report; do not
  manufacture observations.
- **Banner first**, one line:
  `✅ OK` | `⚠️ OK WITH COMMENTS` | `❌ BAD` followed by
  `— <n> Blocker · <n> Important · <n> Suggestion`.
  `❌ BAD` ⇔ at least one Blocker; `⚠️` ⇔ no Blocker, at least one Important.
- **Each finding** has `File:` (path:line), `Rule:` and `Detail:`. `Rule:` names
  where the rule is written: an `AGENTS.md` section, an
  `ai-docs/agent-context/*.md` heading, a `docs/AGENT-WORKFLOW.md` section, an
  eslint rule id, a `check:conventions` invariant, a `known-behaviors.md` id — or
  `defect` for a real bug, with the concrete failing input in `Detail:`. A
  finding that cannot be traced to one of these is dropped.
- **Verification notes**: suspicious hunks that were checked and are fine, one
  line each with the reason. Omit when empty.
- **Verdict** on its own line: `PASS — OK to run tests` or
  `BLOCKED — fix <n> blockers first` (list them).
