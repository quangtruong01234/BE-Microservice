# Conventions

## TypeScript Rules

- **No `any`** — use proper types or generics everywhere. When the shape is unknown (e.g. external callbacks), use `unknown` then narrow with a local interface cast — never `any` in method signatures or interface params:

  ```typescript
  // ❌ Wrong
  verifyCallback(payload: any): Promise<...>
  // ✅ Correct
  interface CallbackPayload { data: string; mac: string }
  verifyCallback(payload: unknown): Promise<...> {
    const p = payload as CallbackPayload;
  }
  ```

- **No `!` non-null assertion** — except inside TypeORM entity files (where column decorators guarantee initialization); use optional chaining (`?.`) or an explicit null check instead
- **Explicit return types** on all methods — `async createOrder(dto: CreateOrderDto): Promise<Order>`
- **Typed catch blocks** — `catch (error: unknown)`, then narrow with `instanceof` before accessing properties:

  ```typescript
  catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
  }
  ```

- **No implicit `any` from untyped params** — always type function parameters explicitly
- **DTO as source of truth** — never use raw `object` or `Record<string, any>` when a DTO exists
- **ES modules only** — never use `require()`; always `import`
- Run `tsc --noEmit` after every change; never mark a task done with TS errors

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

TypeORM hydrates properties at runtime, not in the constructor. Use `!` (definite assignment assertion) on every decorated column so TypeScript's `strictPropertyInitialization` does not error.

| Column config | Correct | Wrong |
|---|---|---|
| `nullable: false` | `name!: string` | `name: string` (TS error) |
| `nullable: true` | `name!: string \| null` | `name?: string` (hides null) |
| `@PrimaryGeneratedColumn` | `id!: number` | `id: number` (TS error) |
| `@CreateDateColumn` | `createdAt!: Date` | `createdAt: Date` (TS error) |

```typescript
// ✅ Correct
@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ nullable: false })
  name!: string;

  @Column({ nullable: true })
  avatar!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

// ❌ Wrong — missing ! causes TS error
@Column({ nullable: false })
name: string;

// ❌ Wrong — ? hides null, causes runtime bugs
@Column({ nullable: true })
avatar?: string;

// ❌ Wrong — initializer bypasses TypeORM hydration
@Column({ nullable: true })
avatar: string | null = null;
```

**Rule**: `!` in entity files is definite assignment assertion — TypeORM assigns at runtime. This is the one exception to the "no `!`" rule. Computed properties (getters) do not need `!`.

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

**Required DTO property initialization:**
- Use `declare` for required properties in DTO classes to avoid `strictPropertyInitialization` errors
- ❌ `name: string` (TS error under strict mode)
- ❌ `name!: string` (violates no-`!` rule — `!` is reserved for TypeORM entities)
- ✅ `declare name: string`

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

## Backend: Authentication

- All routes are JWT-protected by default via global `JwtAuthGuard`
- Mark public endpoints with `@Public()` from `common/decorators/public.decorator.ts`
- User payload available as `req.user` after guard

## Backend: Logging & Error Handling

- `console.log()` is banned in production code — use NestJS `Logger` instead:

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

### 1. @MessagePattern — dùng string, không dùng { cmd: } wrapper
❌ Sai: `@MessagePattern({ cmd: ORDER_MESSAGE_PATTERN.GET_ORDER_INVOICE })`
✅ Đúng: `@MessagePattern(ORDER_MESSAGE_PATTERN.GET_ORDER_INVOICE)`

Gateway gọi `.send(PATTERN_STRING, data)` → chỉ match với `@MessagePattern(string)`.
`{ cmd: }` wrapper gây mismatch → TCP server trả "no matching handler" ngay lập tức → gateway 500.
Kiểm tra cả 2 phía (controller + gateway send) mỗi khi tạo TCP handler mới.

### 2. HttpToRpcExceptionFilter — bắt buộc trên mọi microservice controller
Mọi `@Controller` trong microservice phải có `@UseFilters(new HttpToRpcExceptionFilter())`.
Nếu thiếu: `ForbiddenException`/`BadRequestException` bị NestJS swallow → gateway nhận 500/502 thay vì 403/400.
Filter nằm tại: `libs/common/src/filters/http-to-rpc-exception.filter.ts`
Coverage (2026-06-28): payments, inventory, rewards, product, notification controllers all have the filter; user is covered by its global `AllRpcExceptionFilter`. Gateway is HTTP-facing and uses `HttpExceptionFilter` instead. No remaining gap.

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
