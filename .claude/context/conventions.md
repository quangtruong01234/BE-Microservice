# Conventions

## TypeScript Rules

- **No `any`** — use proper types or generics everywhere
- **No `!` non-null assertion** — except inside TypeORM entity files (where column decorators guarantee initialization)
- **Explicit return types** on all methods — `async createOrder(dto: CreateOrderDto): Promise<Order>`
- **ES modules only** — never use `require()`; always `import`
- Run `tsc --noEmit` after every change; never mark a task done with TS errors

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

Paginated list:

```typescript
{ items: T[], total: number, page: number, limit: number }
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
Tech debt hiện tại: payments, inventory, rewards, product controllers chưa có filter này.

### 3. DECIMAL column từ TypeORM trả về string
TypeORM serialize DECIMAL/NUMERIC columns thành string (`"222.00"`), không phải number.
Khi truyền sang external API expecting number: `Math.round(Number(value ?? 0))`.
Áp dụng cho: `cod_amount`, `price`, `total`, bất kỳ DECIMAL column nào.

### 4. @Payload() trong RabbitMQ @EventPattern — không unwrap data.data
NestJS strips packet envelope trước khi deliver.
❌ Sai: `data.data.orderId`
✅ Đúng: `data.orderId`
