# /review — Code Review Command

Use this command to review staged changes or a specific file/folder before merging.

## How to invoke

```
/review                    # reviews all uncommitted changes
/review <file-or-folder>   # reviews a specific path
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
- [ ] Every `ClientProxy.send()` call has `.pipe(timeout(10000))`
- [ ] Every gateway method uses `MicroserviceErrorHandler`
- [ ] Every gateway DTO field has `@ApiProperty()`
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
- [ ] No secrets or credentials hardcoded

### General
- [ ] No unnecessary refactors outside the task scope
- [ ] No orphaned files (imports cleaned up)
- [ ] Follows existing folder structure for the service/feature