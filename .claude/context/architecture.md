# Architecture

## Tech Stack

- **Backend**: NestJS monorepo (TypeScript strict)
- **Frontend**: React 19 + Vite (plain JavaScript)
- **Sync Transport**: TCP via NestJS `ClientProxy.send()` + `firstValueFrom()`
- **Async Transport**: RabbitMQ via `ClientProxy.emit()` / `@EventPattern()`
- **Primary DB**: MySQL 8 (orders, products, users, payments, rewards)
- **Secondary DB**: PostgreSQL (inventory)
- **Cache**: Redis (`@app/cached`)
- **API Docs**: Swagger at `http://localhost:3000/doc`

## Service Map

See CLAUDE.md Service Map & Scripts for service list and ports.

## Shared Libraries

- **`@app/common`** (`api/libs/common/`): MySQL/PostgreSQL/RabbitMQ modules; message pattern + event constants
- **`@app/cached`** (`api/libs/cached/`): Redis caching module
- **`@app/database`** (`api/libs/database/`): DB health utilities
- **`@app/constant`** (`api/libs/constant/`): Port numbers, service name strings, message pattern enums

## Communication Patterns

### Sync (TCP RPC)

```typescript
const result = await firstValueFrom(
  this.client
    .send(PRODUCT_MESSAGE_PATTERN.FIND_ALL, payload)
    .pipe(timeout(10000)),
);
```

### Async (RabbitMQ Event)

```typescript
// Emitter (Orders service)
this.client.emit(EVENT.ORDER_CREATED_EVENT, orderPayload);

// Listener (Inventory / Payments / Rewards)
@EventPattern(EVENT.ORDER_CREATED_EVENT)
async handleOrderCreated(data: OrderCreatedEvent): Promise<void> { ... }
```

## Key Design Decisions

- **Gateway is the only HTTP-facing service** — all other services are TCP-only and unreachable from outside.
- **HttpOnly cookies for auth** — JWT never touches localStorage; all frontend requests use `credentials: 'include'`.
- **Constants-first** — every message pattern, queue name, port number lives in `@app/constant` or `@app/common/src/constants/`; never hardcode strings inline.
- **Node grouping** — Node A runs gateway + orders + user + product (MySQL); Node B runs inventory + payments + rewards (PostgreSQL + async).

## Run Commands

```bash
# Backend
npm run start:nodeA      # gateway + orders + user + product
npm run start:nodeB      # inventory + payments + rewards

# Frontend
npm run dev              # http://localhost:5173

# Infrastructure
docker-compose up -d     # MySQL :3306, PostgreSQL :5432
```
