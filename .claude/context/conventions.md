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

```typescript
@Entity()
export class Product {
  @PrimaryGeneratedColumn()
  id!: number;              // ! allowed here (TypeORM guarantees)

  @Column()
  name!: string;

  @ManyToOne(() => Brand, brand => brand.products)
  brand!: Brand;
}
```

- Use `!` for TypeORM-decorated properties
- Computed properties (getters) do not need `!`

## Backend: DTOs

- Gateway DTOs: use `class-validator` decorators + `@ApiProperty()` on every field
- Microservice DTOs: `class-validator` only (no Swagger needed)
- Use `@IsOptional()` + `?` for partial update fields
- Update DTOs must use `PartialType` — never redeclare fields from the Create DTO:

```typescript
// ✅ Correct
import { PartialType } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';
export class UpdateProductDto extends PartialType(CreateProductDto) {}

// ❌ Wrong — do not redeclare all fields from CreateDto
```

## Logging Rules

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

## General Rules

- Search `libs/` before adding any utility, constant, config, or helper — it likely already exists
- Prefer extending existing modules over creating new ones
- No unnecessary refactors unless explicitly requested
- Minimal diff — do not reformat or rename things outside the task scope
