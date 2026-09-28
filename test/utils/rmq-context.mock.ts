import { RmqContext } from "@nestjs/microservices";

export interface RmqChannelMock {
  ack: jest.Mock<void, [unknown]>;
  nack: jest.Mock<void, [unknown, boolean?, boolean?]>;
}

export interface RmqContextMock {
  /** Pass as the `@Ctx()` argument of an `@EventPattern` handler. */
  context: RmqContext;
  channel: RmqChannelMock;
  /** The raw message `getMessage()` returns — assert `ack`/`nack` got this. */
  message: { content: Buffer; fields: { deliveryTag: number } };
}

/**
 * An `RmqContext` whose channel records `ack` / `nack`, so a consumer spec can
 * assert the requeue policy:
 *
 *   expect(channel.nack).toHaveBeenCalledWith(message, false, true);  // requeue
 *   expect(channel.nack).toHaveBeenCalledWith(message, false, false); // dead-letter
 *
 * `RmqService.ack(context)` reads the same channel, so it works whether the
 * code under test acks through `RmqService` or through the channel directly.
 */
export function createRmqContextMock(
  pattern = "test_pattern",
  payload: unknown = {},
): RmqContextMock {
  const channel: RmqChannelMock = {
    ack: jest.fn<void, [unknown]>(),
    nack: jest.fn<void, [unknown, boolean?, boolean?]>(),
  };
  const message = {
    content: Buffer.from(JSON.stringify({ pattern, data: payload })),
    fields: { deliveryTag: 1 },
  };
  const context = {
    getChannelRef: (): RmqChannelMock => channel,
    getMessage: (): typeof message => message,
    getPattern: (): string => pattern,
    getArgs: (): unknown[] => [message, channel, pattern],
    getArgByIndex: (index: number): unknown =>
      [message, channel, pattern][index],
  } as unknown as RmqContext;

  return { context, channel, message };
}
