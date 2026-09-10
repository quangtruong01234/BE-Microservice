# Conventions

## TypeScript Rules

These were prose here until 2026-09-10. They are now enforced by the compiler
and eslint, so they fail in CI instead of in review. **Do not re-document them
below** — a rule a machine checks does not belong in a file an agent has to read
and remember:

| Rule | Enforced by |
|---|---|
| No `any` | `@typescript-eslint/no-explicit-any` (error) |
| No `!` non-null assertion — entity files exempt | `@typescript-eslint/no-non-null-assertion` + a `files:` override for `**/entity/**` |
| Typed catch blocks — `catch (err: unknown)`, narrow before use | `useUnknownInCatchVariables` |
| No implicit `any` from an untyped param | `noImplicitAny` |
| Required DTO properties need `declare` | `strictPropertyInitialization` |
| ES modules only — never `require()` | `@typescript-eslint/no-require-imports` (error) |
| Explicit return types on methods | `@typescript-eslint/explicit-function-return-type` — **warn**, not error: 144 pre-existing violations as of 2026-09-10. New code must not add more. |

What is still yours to judge, because no linter can:

- **DTO as source of truth** — never take a raw `object` or `Record<string, any>` where a DTO already exists.
- **Narrow, don't cast away.** The fix for a `no-explicit-any` or an `unknown` error is `instanceof` narrowing or a local interface cast. `as any` and `// eslint-disable-next-line` are not fixes; they move the failure to runtime.
- Verify with `npx tsc --noEmit`, `npm run lint:check`, and `npm run check:conventions` (the TCP invariants at the bottom of this file).

## Naming Rules

- Use meaningful names that describe the value's purpose.
- Avoid vague names like `a`, `b`, `data`, `result`, `temp`, `value`, `obj`, `arr`, or `list` unless the scope is very small or the project convention requires that shape.
- Use `camelCase` for variables, functions, DTO properties, entity properties, payload fields, and response fields.
- Use `PascalCase` for classes, DTO classes, TypeScript types, and interfaces.
- Use `UPPER_SNAKE_CASE` only for module-level constants.
- Boolean variables and fields should start with `is`, `has`, `can`, `should`, `will`, or `needs`.
- Arrays should use plural names, for example `orders`, `shipments`, `selectedItems`, or `skuItems`.
- `Map`/record objects should include the key relationship, for example `orderById`, `statusLabelMap`, `permissionsByRole`, or `inventoryByProductId`.
- Functions should start with a verb, for example `fetchOrders`, `createShipment`, `calculateShippingFee`, or `formatCurrency`.
- API payloads and responses should be named clearly in internal code, for example `loginPayload`, `loginResponse`, or `createShipmentPayload`.
- Include units in variable names when relevant, for example `timeoutMs`, `priceVnd`, `weightGram`, or `retryCount`.
- Use domain terms consistently. Prefer existing TryBuy terms such as `order`, `shipment`, `trackingCode`, `ghnStatus`, `logisticsOperator`, and `shippingFee`.
- Apply these rules to new code and touched internal code. Do not rename existing public API fields, TCP/RabbitMQ contracts, database entity fields, or documented response envelope keys solely for naming cleanup.
- Exceptions: keep documented framework/project shapes such as `PaginatedResponse.data`, error response `data`, response envelopes, and `@Payload() data`. Do not rename contract fields such as `skuList`, `success`, `available`, `valid`, `reported`, or `liked` without an explicit migration/backward-compatibility plan.

## Backend: NestJS Service Structure

Each microservice follows this folder layout:
```
apps/<service>/src/
├── <service>.module.ts
├── <service>.controller.ts   # @MessagePattern() or @EventPattern() handlers
├── <service>.service.ts      # business logic
├── <service>.main.ts
├── entity/
│   └── <name>.entity.ts
└── dto/
    └── <name>.dto.ts
```

## Backend: Gateway Rules

Gateway is the only HTTP-facing service. Every gateway service method must:
1. Use `MicroserviceErrorHandler` for error handling
2. Apply `.pipe(timeout(10000))` on every TCP call
3. Include `@ApiProperty()` on every DTO field (Swagger)

```typescript
// Correct gateway pattern
async getProduct(id: string): Promise<ProductResponseDto> {
  return this.errorHandler.handleResponse(
    this.client.send(PRODUCT_MESSAGE_PATTERN.FIND_BY_ID, id).pipe(timeout(10000))
  );
}
```

## Backend: Message Patterns & Constants

- All TCP message patterns → `api/libs/constant/src/message-pattern.constant.ts` or `message-pattern-inventory.constant.ts`
- All RabbitMQ queue names → `api/libs/common/src/constants/queues.ts`
- All RabbitMQ event names → `api/libs/common/src/constants/event.ts`
- All port numbers → `api/libs/constant/src/port-tcp.constant.ts`
- **Never hardcode** pattern strings or port numbers inline

## Backend: RabbitMQ @EventPattern — Payload Unwrapping

NestJS automatically unwraps the RabbitMQ envelope before `@Payload()` receives it. Fields are accessed **directly** from `data` — never through `data.data`. This was the root cause of a real bug (Task 8 follow-up).

```typescript
// ✅ Correct — access fields directly
@EventPattern(EVENT.ORDER_CREATED_EVENT)
async handleOrderCreated(@Payload() data: OrderCreatedEvent): Promise<void> {
  const orderId = data.orderId;       // ✅
  const productId = data.productId;   // ✅
}

// ❌ Wrong — data.data does not exist, always undefined
async handleOrderCreated(@Payload() data: unknown): Promise<void> {
  const orderId = (data as any).data.orderId; // ❌ undefined bug
}
```

## Backend: TypeORM Entity Rules

TypeORM hydrates properties at runtime, not in the constructor, so every
decorated column takes `!` (definite assignment assertion). This is the one
exception to the no-`!` rule, and eslint encodes it as a `files:` override for
`**/entity/**` — you do not have to remember it. Omitting `!` is a compiler
error (`strictPropertyInitialization`), so that half is self-enforcing too.
Computed getters need no `!`.

What the compiler will NOT catch, and what actually causes runtime bugs:

```typescript
// ❌ `?` on a nullable column hides the null from every caller
@Column({ nullable: true })
avatar?: string;

// ✅ declare the null — callers are then forced to handle it
@Column({ nullable: true })
avatar!: string | null;

// ❌ an initializer is overwritten by TypeORM hydration, so it lies about the default
@Column({ nullable: true })
avatar: string | null = null;
```

**Rule**: `nullable: true` ⇒ `!: T | null`, never `?: T`, never an initializer.

## Backend: DTOs

- Gateway DTOs: `class-validator` decorators + `@ApiProperty()` / `@ApiPropertyOptional()` on every field
- Microservice DTOs: `class-validator` only — no Swagger decorators
- Use `@IsOptional()` + `?` for partial update fields
- Query DTOs: provide defaults, use `@Type(() => Number)` for numeric query params
- Numeric bounds: `@Min(0)` for prices/stock, `@Min(1) @Max(100)` for pagination
- Update DTOs must use `PartialType` — never redeclare fields from the Create DTO:

```typescript
// ✅ Correct
import { PartialType } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';
export class UpdateProductDto extends PartialType(CreateProductDto) {}

// ❌ Wrong — do not redeclare all fields from CreateDto
```

**Required DTO property initialization:** `declare name: string`. Not
`name: string` (a `strictPropertyInitialization` error) and not `name!: string`
(`!` is reserved for entities — eslint errors outside `**/entity/**`). Both
wrong forms fail CI, so this is a reminder of the fix, not a rule to police.

**Gateway DTO file naming:**
- File name: `<domain>.dto.ts` — no suffixes like `-simple`, `-gateway`
- One DTO file per domain in the gateway
- ❌ `product-simple.dto.ts`, `product-gateway.dto.ts`
- ✅ `product.dto.ts`

## Backend: Response Shape

Paginated list — dùng `PaginatedResponse.of()` từ `@app/common`. Không dùng key `items` — chuẩn là `data`. Không tự tính `totalPages` — dùng factory.

```typescript
// Shape
{ data: T[], total: number, page: number, limit: number, totalPages: number, hasNext: boolean }
// totalPages = Math.ceil(total / limit) || 1
// hasNext    = page < totalPages

// Usage trong service
import { PaginatedResponse } from '@app/common';
return PaginatedResponse.of(data, total, page, limit);
```

Error (from `HttpExceptionFilter`):

```json
{
  "statusCode": 404,
  "status": "error",
  "error": "Not Found",
  "message": "...",
  "data": null,
  "timestamp": "...",
  "path": "...",
  "method": "..."
}
```

## Backend: Data-Shape Hygiene (SHAPE-01 — 4 luật ở biên response/request)

FE runs on a typed contract; a field that arrives `null` where the contract says
"collection", or a 500 where a 400 belongs, is a *class* of bug that has already
whitened pages in this project. These four rules exist so the next endpoint does
not re-create it. Full rationale + the cases that were declined:
`ai-docs/agent-context/known-behaviors.md` → SHAPE-01.

**1. A field the contract declares as a COLLECTION is never `null`.**
Empty array ⇒ `[]`. If a read has "no row yet", answer with the empty shape, not
`null` — a user always conceptually has a cart / a wishlist / a list of orders.
```typescript
// ❌ Wrong — the caller's `data.items.length` is a TypeError
return this.cartRepository.findOne({ where: { userId }, relations: ["items"] });
// ✅ Correct — SAME KEY SET as the real row, nulls where there is no value yet
return cart ?? { id: null, userId, createdAt: null, updatedAt: null, items: [] };
```
The empty shape must declare **every key the populated shape has**, or you have
shipped one endpoint with two shapes — which is exactly what rule 2 bans. And
the guard belongs on every path that can return the entity, not just the read:
`findOne(...) as Promise<Cart>` after a write is a cast, not a guarantee, and a
concurrent delete turns it back into `data: null`.
Deliberately NOT extended to objects: a missing single relation stays `null`
(`inventory: null`, `brand: null`, `author: null`). `{}` is worse — it makes
"absent" indistinguishable from "present but blank", and `{}.name` is
`undefined`, which renders empty instead of tripping the caller's guard.

**2. `required` never means `null`; nullable is declared up front and forever.**
A response field is part of the contract the moment it ships:
- Renaming, removing, or re-typing one (number ⇔ string id included) is release
  class **C** — open a `../.agent-local/release-gate.md` hold, never ship ahead
  of the FE. Adding an optional field is class B.
- A field that CAN be absent must be nullable from its first release
  (`imageUrls: string[] | null`), never "non-null that sometimes isn't".
  Retrofitting nullability later is the same breaking change as removing it.

**3. Bad input is a 4xx with a message — never a 500.**
A 500 tells the caller "the backend is broken" and carries nothing to attach to
a form field. The recurring trap is `@IsOptional()`, which skips every other
validator on `undefined` **and on `null`**, so an explicit `null` reaches the
service and dies at `.toFixed()` / the NOT NULL column.
```typescript
// Field maps to a NULLABLE column — `null` means "clear it"
@IsOptional() @IsString() sellerNotes?: string | null;
// Field maps to a NOT NULL column — `null` is a client mistake ⇒ 400
@IsOptionalNotNull() @IsInt() @Min(0) availableStock?: number;
```
`IsOptionalNotNull` lives at
`apps/gateway/src/common/validators/is-optional-not-null.validator.ts`.
**Rule of thumb: check the column before you pick the decorator.** Nullable ⇒
`@IsOptional()`; NOT NULL ⇒ `@IsOptionalNotNull()`. Applies to new/touched DTO
fields — do NOT sweep this across DTOs where `null` is currently tolerated and
answers 200, because tightening a passing call into a 400 is class C.

**4. A batch READ is partial-tolerant; a batch WRITE is all-or-nothing.**
- **Read** (`POST /products/with-inventory/multiple`, any `*.findByIds`): an id
  that no longer resolves is SKIPPED, and the caller reads absence as "deleted".
  One stale id must never 404 the whole response — that leaves the client with a
  blank page instead of the rows that do exist. Resolve the batch with one `IN`
  query, not one query per id.
- **Write**: reject the whole batch with a 400 naming the offending ids. Partial
  success on a write is worse than a clean failure — the caller cannot tell what
  landed and retrying double-applies the half that did.

## Backend: Authentication

- All routes are JWT-protected by default via global `JwtAuthGuard`
- Mark public endpoints with `@Public()` from `common/decorators/public.decorator.ts`
- User payload available as `req.user` after guard

## Backend: Logging & Error Handling

- `console.log()` is an eslint error outside `apps/*/src/main.ts` (the startup
  banner runs before a Logger context means anything). Use NestJS `Logger`:

```typescript
private readonly logger = new Logger(ServiceName.name);
this.logger.log('message');
this.logger.error('message', error.stack);
```

- Throw errors using NestJS built-in exceptions:

```typescript
throw new InternalServerErrorException('message');
throw new NotFoundException('resource not found');
```

- Use `MicroserviceErrorHandler.handleError(error, operation, serviceName)` in all gateway services
- Never expose raw DB errors, stack traces, or internal paths to the HTTP response body

## General Rules

- Search `libs/` before adding any utility, constant, config, or helper — it likely already exists
- Prefer extending existing modules over creating new ones
- No unnecessary refactors unless explicitly requested
- Minimal diff — do not reformat or rename things outside the task scope

---

## Common TCP Bugs (đã gặp, phải tránh)

> Bugs 1 and 2 below are checked mechanically by
> `npm run check:conventions` (`scripts/check-conventions.mjs`), which also runs
> in CI. They are kept here for the *why*, not as something to verify by hand.

### 1. @MessagePattern và .send() phải CÙNG SHAPE ở cả 2 phía
`.send(PATTERN, data)` chỉ match `@MessagePattern(PATTERN)`, và
`.send({ cmd: PATTERN }, data)` chỉ match `@MessagePattern({ cmd: PATTERN })`.
Cả hai shape đều hợp lệ — sai là khi 2 phía **không thống nhất**.

Mismatch không phải lỗi cú pháp, cũng không phải lỗi type: TCP server trả
"no matching handler" lúc runtime → gateway 500.

Thực tế trong repo (2026-09-10): `apps/user` dùng `{ cmd: ... }` trên cả 17
handler và gateway `.send({ cmd: ... })` khớp theo — chạy đúng. Các service còn
lại dùng bare string ở cả 2 phía. **Đừng "sửa" một phía cho hợp với tài liệu** —
đổi 1 phía là làm hỏng route đang chạy. Muốn đổi thì đổi cả 2 phía cùng lúc.

### 2. HttpToRpcExceptionFilter — bắt buộc trên mọi microservice controller
Mọi `@Controller` trong microservice phải có `@UseFilters(HttpToRpcExceptionFilter)`
(dạng class hoặc `new ...()` đều được), HOẶC app đó đăng ký global
`AllRpcExceptionFilter` trong `main.ts`.
Nếu thiếu: `ForbiddenException`/`BadRequestException` bị NestJS swallow → gateway
nhận 500/502 thay vì 403/400.
Filter nằm tại: `libs/common/src/filters/http-to-rpc-exception.filter.ts`.
Gateway là HTTP-facing nên dùng `HttpExceptionFilter` thay thế.

### 3. DECIMAL column từ TypeORM trả về string
TypeORM serialize DECIMAL/NUMERIC columns thành string (`"222.00"`), không phải number.
Khi truyền sang external API expecting number: `Math.round(Number(value ?? 0))`.
Áp dụng cho: `cod_amount`, `price`, `total`, bất kỳ DECIMAL column nào.

### 4. @Payload() trong RabbitMQ @EventPattern — không unwrap data.data
NestJS strips packet envelope trước khi deliver.
❌ Sai: `data.data.orderId`
✅ Đúng: `data.orderId`

### 5. @MessagePattern handlers — luôn return giá trị, không bao giờ return void
NestJS TCP transport không gửi response khi handler trả về `void`/`undefined`.
Gateway dùng `firstValueFrom()` → throws "no elements in sequence" → HTTP 502.
❌ Sai: handler không có return statement (void)
✅ Đúng: return kiểu dữ liệu thật, hoặc `return null` cho side-effect-only handlers

```typescript
// ✅ Correct
async updateItem(@Payload() payload: { cartItemId: number; quantity: number }): Promise<null> {
  await this.cartService.updateItem(payload.cartItemId, payload.quantity);
  return null;
}
```

### 6. registerDirectPublisher() — useFactory must not throw on RabbitMQ unavailable
If amqplib connection fails at startup, useFactory must catch and return null
instead of throwing. A thrown error crashes NestJS DI → TCP handlers never
register → gateway EmptyError → 502.

✅ Fix pattern:
```typescript
useFactory: async (): Promise<Channel | null> => {
  try {
    const conn = await amqp.connect(url);
    return await conn.createChannel();
  } catch (err) {
    logger.warn('RabbitMQ channel unavailable at startup — fanout disabled');
    return null;
  }
}
```

All callers that inject this channel must null-check before publish():
```typescript
if (!this.fanoutChannel) {
  this.logger.warn('Fanout channel unavailable — skipping emit');
  return;
}
this.fanoutChannel.publish(...);
```

Applies to any service using registerDirectPublisher():
currently social service and product service.

## TypeORM Entity Gotchas

### 6. JSON stored as VARCHAR → use @AfterLoad() to auto-parse
TypeORM does not automatically parse JSON strings into objects/arrays when loading from a `varchar` column. Use `@AfterLoad()` to parse on hydration:

```typescript
@AfterLoad()
parseTierIdx(): void {
  if (typeof this.tierIdx === 'string') {
    this.tierIdx = JSON.parse(this.tierIdx) as number[];
  }
}
```

**Caveat**: `@AfterLoad()` does NOT trigger after `manager.save()` inside a transaction. If you need the parsed value immediately after saving, parse manually:

```typescript
const saved = await manager.save(ProductSku, sku);
if (typeof saved.tierIdx === 'string') {
  saved.tierIdx = JSON.parse(saved.tierIdx) as number[];
}
```

Apply this pattern to any JSON/array data stored in a `varchar` column.

### 7. @AfterLoad() result travels over TCP as parsed type — re-stringify before VARCHAR save
`@AfterLoad()` runs on the **sending** service before the TCP response is serialized. The caller receives the already-parsed value (e.g. `number[]`), not the raw string. If that value is then saved to a `VARCHAR` column or forwarded in another TCP payload, the `mysql2` driver will misinterpret a JS array as an IN-clause parameter list → SQL error → 502.

Always guard with:
```typescript
skuTierIdx = Array.isArray(sku.tierIdx)
  ? JSON.stringify(sku.tierIdx)
  : sku.tierIdx;
```

Applies to any entity field that uses `@AfterLoad()` to parse JSON from a `varchar` column (e.g. `ProductSku.tierIdx`).

### 8. fanoutChannel.publish() — NestJS requires pattern field in envelope
When emitting RabbitMQ fanout events via a raw amqplib channel, the JSON payload must include a `pattern` field for `@EventPattern` routing to work.

❌ Sai:
```typescript
fanoutChannel.publish(exchange, '', Buffer.from(JSON.stringify({ data: payload })));
```

✅ Đúng:
```typescript
fanoutChannel.publish(exchange, '', Buffer.from(JSON.stringify({
  pattern: EVENT.BRAND_REVIEWED_EVENT,
  data: payload,
})));
```

Without `pattern`, the consumer receives the message but cannot match any `@EventPattern` handler and silently drops it — no error logged, no nack, no dead-letter. Applies to any service using direct `amqplib` `channel.publish()` instead of `ClientProxy.emit()`.
