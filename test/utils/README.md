# test/utils — shared mock factories

Import from `@app/testing` (declared in `tsconfig.json` `paths` and in the jest
`moduleNameMapper` in `package.json`). Never reach this folder with a relative
`../../../test/...` import — eslint bans it.

The folder is excluded from `tsconfig.build.json`, so nothing here ships in
`dist/`. `test-utils.spec.ts` is the suite that proves the factories and the
alias still work: `npx jest test/utils`.

Existing specs hand-roll the same objects (`{ send: jest.fn() }`, a repository
literal per spec). Use the factories in **new and touched** specs; do not sweep
the old ones for the sake of it.

## `createTcpClientMock()` — a `ClientProxy`

```typescript
import { createTcpClientMock } from "@app/testing";
import { ORDER_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";

const ordersTcp = createTcpClientMock();
ordersTcp.replyTo(ORDER_MESSAGE_PATTERN.GET_ORDER_BY_ID, { id: 97, userId: 17 });
ordersTcp.failOn(ORDER_MESSAGE_PATTERN.CANCEL_ORDER, new Error("socket closed"));

const service = new OrderService(ordersTcp.client /* , ... */);

expect(ordersTcp.send).toHaveBeenCalledWith(ORDER_MESSAGE_PATTERN.GET_ORDER_BY_ID, 97);
```

An unrouted pattern answers `of(null)`. Patterns are compared by shape, so a
bare-string route does **not** answer a `{ cmd: ... }` send — the same mismatch
the real transport would miss (conventions.md, TCP bug #1).

## `createRmqContextMock(pattern?, payload?)` — an `RmqContext`

```typescript
import { createRmqContextMock } from "@app/testing";

const { context, channel, message } = createRmqContextMock("order_created");

await controller.handleOrderCreated(payload, context);

expect(channel.ack).toHaveBeenCalledWith(message);                // processed
expect(channel.nack).toHaveBeenCalledWith(message, false, true);  // requeue
expect(channel.nack).toHaveBeenCalledWith(message, false, false); // dead-letter
```

Works whether the consumer acks through `RmqService.ack(context)` or through
`context.getChannelRef()` directly.

## `createRepositoryMock<T>()` — a TypeORM `Repository<T>`

```typescript
import { getRepositoryToken } from "@nestjs/typeorm";
import { createRepositoryMock } from "@app/testing";

const userRepo = createRepositoryMock<User>();
userRepo.findOne.mockResolvedValue(persistedUser);

providers: [{ provide: getRepositoryToken(User), useValue: userRepo.asRepository() }];

expect(userRepo.save).not.toHaveBeenCalled();
```

Defaults are "nothing there": `findOne` → `null`, `find` → `[]`,
`findAndCount` → `[[], 0]`. `create` echoes, `save` resolves its input.
`createQueryBuilder()` returns one shared chainable builder whose terminal
calls (`getOne`, `getMany`, `getManyAndCount`, `getRawMany`, `execute`) are
mocks: `userRepo.createQueryBuilder().getMany.mockResolvedValue([...])`.

## `createConfigMock(values?)` — a `ConfigService`

```typescript
import { createConfigMock } from "@app/testing";

const config = createConfigMock({ GHN_API_URL: "https://ghn.test", GHN_TOKEN: "t" });
const service = new SomeService(config.configService);

config.setValue("GHN_DEMO_ENDPOINTS_ENABLED", "false");
```

Backed by a plain object, never `process.env` — a spec cannot read a real
secret from a developer's `.env`. `get(key, default)` and `getOrThrow(key)`
behave like the real ones for a missing key.

## Rules for tests that use these

The `test-guard` agent (`.claude/agents/test-guard.md`) is the full procedure.
The short version:

- Run the file you are working on — `npx jest <path>` — not the whole suite.
- Every new test must be seen **red** once before it goes green.
- A test that guards a spec criterion carries its id in the name:
  `it("[TC-2] rejects a blank q with 400", ...)`.
- No real credentials, tokens, or the production hostname in fixtures.
