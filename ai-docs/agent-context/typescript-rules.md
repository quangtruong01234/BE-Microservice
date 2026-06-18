# TypeScript Rules — Strict (follow always)

- **No `any`**: never use `any` type — use `unknown` then narrow, or define a proper interface
- **No `any` in method signatures or interface params** — use `unknown` then cast, or define a local interface to narrow the type.
  ```typescript
  // ❌ Wrong
  verifyCallback(payload: any): Promise<...>
  // ✅ Correct
  interface CallbackPayload { data: string; mac: string }
  verifyCallback(payload: unknown): Promise<...> {
    const p = payload as CallbackPayload;
  }
  ```
- **No non-null assertion** (`!`): use optional chaining (`?.`) or explicit null check instead — **exception: TypeORM entity properties** (see TypeORM Entity Property Rules in `backend.md`)
- **Return types required**: all service and controller methods must have explicit return type annotation
- **Typed catch blocks**: catch blocks use `error: unknown`, then check with `instanceof` before accessing properties
- **No implicit `any` from untyped params**: always type function parameters explicitly
- **DTO as source of truth**: never use raw `object` or `Record<string, any>` when a DTO exists

```typescript
// ❌ Wrong
async getUser(id: any) { ... }
catch (error) { console.log(error.message) }

// ✅ Correct
async getUser(id: string): Promise<UserDto> { ... }
catch (error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown error';
}
```
