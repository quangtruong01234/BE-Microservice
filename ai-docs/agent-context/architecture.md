# Architecture

## Tech Stack

- **Backend**: NestJS monorepo (TypeScript strict)
- **Frontend**: React 19 + Vite (plain JavaScript)
- **Sync Transport**: TCP via NestJS `ClientProxy.send()` + `firstValueFrom()`
- **Async Transport**: RabbitMQ via `ClientProxy.emit()` / `@EventPattern()`
- **Node A DB**: Aiven MySQL 8 (orders, user, product, social, notification, chat)
- **Node B DB**: Aiven PostgreSQL (inventory, payments, rewards)
- **Cache/Broker**: Redis + RabbitMQ via Docker (`@app/cached`, `@app/common`)
- **API Docs**: Swagger at `http://localhost:3000/doc`

## Service Map

See the active agent entry point (`AGENTS.md` or `.claude/CLAUDE.md`) for the service list and ports.

## Shared Libraries

- **`@app/common`** (`api/libs/common/`): RabbitMQ modules and shared constants/helpers.
- **`@app/cached`** (`api/libs/cached/`): Redis caching module.
- **`@app/database`** (`api/libs/database/`): shared TypeORM MySQL/PostgreSQL modules and synchronize safety helper.
- **`@app/constant`** (`api/libs/constant/`): port numbers, service names, and message pattern constants.

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

- **Gateway is the only HTTP-facing service**: all other services are TCP-only and unreachable from outside.
- **HttpOnly cookies for auth**: JWT never touches localStorage; all frontend requests use `credentials: "include"`.
- **Constants-first**: every message pattern, queue name, and port number lives in `@app/constant` or `@app/common/src/constants/`.
- **Node grouping**: Node A runs gateway + orders + user + product + social + notification + chat. Node B runs inventory + payments + rewards.
- **Production schema control**: production must use explicit SQL migrations, not TypeORM `synchronize:true`; current migration runner is incremental-only and does not bootstrap an empty Aiven database.

## Run Commands

```bash
# Backend
npm run start:nodeA      # gateway + orders + user + product + social + notification + chat
npm run start:nodeB      # inventory + payments + rewards

# Frontend
npm run dev              # http://localhost:5173

# Infrastructure
docker-compose up -d     # Redis :6379, RabbitMQ :5672/:15672
```
