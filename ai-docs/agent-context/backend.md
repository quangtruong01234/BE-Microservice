# Backend Conventions

## File Naming

- Controller: `*.controller.ts` — `product.controller.ts`
- Service: `*.service.ts` — `product.service.ts`
- Module: `*.module.ts` — `product.module.ts`
- Entity: `entity/*.entity.ts` — `entity/product.entity.ts`
- DTO: `dto/create-*.dto.ts` — `dto/create-product.dto.ts`
- Guard: `guards/*.guard.ts` — `guards/jwt-auth.guard.ts`
- Constants: `libs/constant/*.constant.ts` — `port-tcp.constant.ts`

## Folder Structure per Microservice

```
api/apps/<service>/src/
├── main.ts
├── <service>.module.ts
├── <service>.controller.ts   # TCP @MessagePattern handlers
├── <service>.service.ts      # Business logic + TypeORM
├── entity/
│   └── <name>.entity.ts
└── dto/
    ├── create-<name>.dto.ts
    └── update-<name>.dto.ts
```

Gateway additionally has `common/` (guards, filters, decorators, interceptors) and per-domain subfolders (`product/`, `inventory/`, etc.) each with controller + service + module + dto.

## Adding a New Gateway Route

1. Add message pattern constant to `libs/constant/`
2. Create DTO in `apps/gateway/src/<domain>/dto/` with `@ApiProperty` decorators
3. Add method to gateway domain service — use TCP call pattern below
4. Add decorated endpoint to gateway domain controller
5. Register domain module in `gateway.module.ts` imports

## TCP Service Call Pattern

```typescript
async someOperation(dto: SomeDto): Promise<ResponseType> {
  try {
    return await firstValueFrom(
      this.client
        .send(SOME_MESSAGE_PATTERNS.OPERATION, dto)
        .pipe(timeout(10000), catchError((e) => throwError(() => e)))
    );
  } catch (error) {
    MicroserviceErrorHandler.handleError(error, 'someOperation', 'Some Service');
  }
}
```

Always `timeout(10000)`. Always catch via `MicroserviceErrorHandler`. Always annotate return type.

## RabbitMQ Event Pattern

Emit:

```typescript
this.rmqClient.emit(EVENT.ORDER_CREATED_EVENT, payload);
```

Handle:

```typescript
@EventPattern(EVENT.ORDER_CREATED_EVENT)
async handleOrderCreated(
  @Payload() data: OrderCreatedEvent,
  @Ctx() context: RmqContext
): Promise<void> {
  try {
    // business logic
    this.rmqService.ack(context);
  } catch (err) {
    this.logger.error(err);
    this.rmqService.nack(context, false, true);
  }
}
```

## TypeORM Entity Conventions

- `@PrimaryGeneratedColumn()` (int) for IDs — default for all entities
- **Exception**: `@PrimaryGeneratedColumn('increment', { type: 'bigint' })` only for `orders`, `order_items`, `payments` (high-volume transaction tables). FK columns pointing to these tables (`order_id` in `order_items` and `payments`) must also be `bigint`.
- Column names: snake_case (`name: 'created_at'`), properties: camelCase
- `@CreateDateColumn` / `@UpdateDateColumn` on every entity
- Store both raw FK column (`brandId`) and the relation object (`brand`)
- `onDelete: 'SET NULL'` for optional relations, `'RESTRICT'` for required

## API Testing

- HTTP request test files are located in `api/rest`
- Prefer reusing existing `.http` files for API validation
- Execute requests sequentially when testing flows
- Check authentication tokens before running protected APIs
