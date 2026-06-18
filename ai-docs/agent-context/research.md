# Research Checklist — Pre-Implementation

Run this checklist before implementing any feature that touches more than 1 service.

## 1. Message Pattern Constants

```bash
grep -r "feature-keyword" libs/constant/src/
```

Does a message pattern for this feature already exist in `libs/constant/src/`? If yes, reuse it — do not add a duplicate.

## 2. Queue / Exchange Names

```bash
grep -r "feature-keyword" libs/common/src/constants/
```

Check `queues.ts` and `event.ts`. Queue name and event constant must be declared here before use — never hardcode inline.

## 3. Existing Entities

```bash
ls apps/*/src/entity/
```

Does the required entity already exist in any service? Check all `apps/*/src/entity/` before creating a new one. Note which service owns it — cross-service entity sharing is not allowed; use TCP/RabbitMQ instead.

## 4. TCP Port Conflicts

Open `libs/constant/src/port-tcp.constant.ts`. Any new TCP port must not conflict with:

| Service    | Port |
|------------|------|
| gateway    | 3000 |
| orders     | 3001 |
| inventory  | 3002 |
| user       | 3003 |
| rewards    | 3004 |
| payments   | 3005 |
| product    | 3006 |

## 5. Transport Type

| Use TCP (sync) when | Use RabbitMQ (async) when |
|---|---|
| Gateway needs a response to return to HTTP client | Event fan-out to multiple listeners |
| Caller must wait for result | Fire-and-forget after order created |
| Examples: getProduct, createOrder | Examples: order_created → inventory + payments + rewards |

## 6. Service Owner

| Domain | Service | Node Group |
|---|---|---|
| Auth, login, profile, RBAC | `user` | Node A |
| Product, brand, category | `product` | Node A |
| Order creation, order query | `orders` | Node A |
| Stock management | `inventory` | Node B |
| Payment processing | `payments` | Node B |
| Loyalty points | `rewards` | Node B |
| HTTP facade, Swagger, guards | `gateway` | Node A |

New logic belongs in the service that owns the domain — do not add business logic to gateway.

## 7. Existing Tests & REST Files

```bash
# Find related REST files
ls api/rest/

# Find related spec files
find apps/ -name "*.spec.ts" | grep feature-keyword
```

Before modifying code, read these files to understand:
- Which scenarios are currently passing
- Current request/response shape
- Edge cases already covered by tests

Do not change behavior that is passing tests without a clear reason.
