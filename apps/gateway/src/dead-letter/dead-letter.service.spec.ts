import { ServiceUnavailableException } from "@nestjs/common";
import type * as amqp from "amqplib";
import { QUEUES } from "@app/common/constants/queues";
import {
  DEAD_LETTER_CAP_POLICY,
  DEAD_LETTER_POLICY,
  DeadLetterService,
} from "./dead-letter.service";

interface FakeMessage {
  content: Buffer;
  properties: { headers?: Record<string, unknown>; contentType?: string };
}

function buildMessage(
  body: unknown,
  headers: Record<string, unknown> = {},
): FakeMessage {
  return {
    content: Buffer.from(JSON.stringify(body)),
    properties: { headers, contentType: "application/json" },
  };
}

function deathFrom(queue: string): Record<string, unknown> {
  return {
    "x-death": [
      {
        queue,
        exchange: "product.fanout",
        reason: "rejected",
        count: 2,
        time: { "!": "timestamp", value: 1_790_000_000 },
      },
    ],
    "x-first-death-queue": queue,
    "x-first-death-reason": "rejected",
    "trace-id": "abc",
  };
}

/** A broker whose DLQ holds `pending` and whose other queues are `existingQueues`. */
interface FakeBroker {
  queue: FakeMessage[];
  channel: Record<
    | "assertQueue"
    | "get"
    | "publish"
    | "waitForConfirms"
    | "ack"
    | "nack"
    | "nackAll"
    | "close",
    jest.Mock
  >;
  probeChannel: Record<"on" | "close" | "checkQueue", jest.Mock>;
  connection: Record<
    "on" | "close" | "createChannel" | "createConfirmChannel",
    jest.Mock
  >;
}

function buildBroker(
  pending: FakeMessage[],
  existingQueues: string[],
): FakeBroker {
  const queue = [...pending];
  let isReplaying = false;
  const channel = {
    assertQueue: jest.fn().mockResolvedValue({ messageCount: pending.length }),
    get: jest.fn(() => Promise.resolve(queue.shift() ?? false)),
    publish: jest.fn().mockReturnValue(true),
    waitForConfirms: jest.fn().mockResolvedValue(undefined),
    ack: jest.fn(),
    nack: jest.fn(),
    nackAll: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const probeChannel = {
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
    checkQueue: jest.fn((name: string) =>
      existingQueues.includes(name)
        ? Promise.resolve({ queue: name })
        : Promise.reject(new Error(`NOT_FOUND - no queue '${name}'`)),
    ),
  };
  const connection = {
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
    // peek and the policy use one plain channel; replay uses a confirm
    // channel and opens plain ones only to probe source queues.
    createChannel: jest.fn(() =>
      Promise.resolve(isReplaying ? probeChannel : channel),
    ),
    createConfirmChannel: jest.fn(() => {
      isReplaying = true;
      return Promise.resolve(channel);
    }),
  };
  return { queue, channel, probeChannel, connection };
}

class TestDeadLetterService extends DeadLetterService {
  connection: unknown = null;
  connectError: Error | null = null;

  protected override connect(): Promise<amqp.ChannelModel> {
    if (this.connectError) {
      return Promise.reject(this.connectError);
    }
    return Promise.resolve(this.connection as amqp.ChannelModel);
  }
}

describe("DeadLetterService (RMQ-DLQ-01)", () => {
  const savedEnv = { ...process.env };
  let service: TestDeadLetterService;

  beforeEach(() => {
    process.env.RABBITMQ_HOST = "127.0.0.1";
    process.env.RABBITMQ_PORT = "5672";
    process.env.RABBITMQ_USER = "guest";
    process.env.RABBITMQ_PASS = "guest";
    process.env.RABBITMQ_VHOST = "rabbit-trybuy";
    delete process.env.RABBITMQ_MANAGEMENT_PORT;
    delete process.env.RABBITMQ_MANAGEMENT_HOST;
    service = new TestDeadLetterService();
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    jest.restoreAllMocks();
  });

  describe("replay", () => {
    it("republishes to the rejecting queue only, via the default exchange", async () => {
      const message = buildMessage(
        { pattern: "product_deleted", data: { productId: 7 } },
        deathFrom("INVENTORY_PRODUCT_SERVICE"),
      );
      const broker = buildBroker([message], ["INVENTORY_PRODUCT_SERVICE"]);
      service.connection = broker.connection;

      const result = await service.replay(5);

      expect(result).toEqual({ replayed: 1, skipped: 0, remaining: 0 });
      expect(broker.channel.publish).toHaveBeenCalledTimes(1);
      const [exchange, routingKey, content, options] = broker.channel.publish
        .mock.calls[0] as [string, string, Buffer, amqp.Options.Publish];
      expect(exchange).toBe("");
      expect(routingKey).toBe("INVENTORY_PRODUCT_SERVICE");
      expect(content).toBe(message.content);
      expect(options.persistent).toBe(true);
      expect(options.headers).toMatchObject({
        "trace-id": "abc",
        "x-replay-count": 1,
      });
      expect(options.headers).not.toHaveProperty("x-death");
      expect(options.headers).not.toHaveProperty("x-first-death-queue");
      // Ack only after the broker confirmed the republish.
      expect(broker.channel.waitForConfirms).toHaveBeenCalledTimes(1);
      expect(broker.channel.ack).toHaveBeenCalledWith(message);
      // The channel is closed (close-ok awaited) BEFORE the connection:
      // Connection.Close travels on channel 0 and can overtake an ack still
      // buffered on the confirm channel, which requeues the original.
      const [channelClosedAt] = broker.channel.close.mock.invocationCallOrder;
      const [connectionClosedAt] =
        broker.connection.close.mock.invocationCallOrder;
      expect(channelClosedAt).toBeLessThan(connectionClosedAt);
    });

    it("keeps a message whose source queue is gone or unknown in the DLQ", async () => {
      const orphan = buildMessage({ data: 1 }, deathFrom("deleted_queue"));
      const noHistory = buildMessage({ data: 2 });
      const good = buildMessage({ data: 3 }, deathFrom("orders_rpc_queue"));
      const broker = buildBroker(
        [orphan, noHistory, good],
        ["orders_rpc_queue"],
      );
      service.connection = broker.connection;

      const result = await service.replay(10);

      expect(result).toEqual({ replayed: 1, skipped: 2, remaining: 2 });
      expect(broker.channel.publish).toHaveBeenCalledTimes(1);
      expect(broker.channel.nack).toHaveBeenCalledWith(orphan, false, true);
      expect(broker.channel.nack).toHaveBeenCalledWith(noHistory, false, true);
      expect(broker.channel.ack).toHaveBeenCalledWith(good);
    });

    it("never replays a message twice when the consumer rejects it again at once", async () => {
      const poison = buildMessage(
        { pattern: "product_deleted", data: { productId: 7 } },
        deathFrom("INVENTORY_PRODUCT_SERVICE"),
      );
      const broker = buildBroker([poison], ["INVENTORY_PRODUCT_SERVICE"]);
      // The consumer nacks the replayed copy immediately, so the broker
      // dead-letters it straight back while the replay loop is still running.
      broker.channel.publish.mockImplementation(() => {
        broker.queue.push(poison);
        return true;
      });
      service.connection = broker.connection;

      const result = await service.replay(5);

      expect(result.replayed).toBe(1);
      expect(broker.channel.publish).toHaveBeenCalledTimes(1);
      expect(broker.channel.get).toHaveBeenCalledTimes(1);
    });

    it("answers 503 when the broker is unreachable", async () => {
      service.connectError = new Error("ECONNREFUSED");

      await expect(service.replay(1)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe("peek", () => {
    it("describes messages and hands every one of them back", async () => {
      const broker = buildBroker(
        [
          buildMessage(
            { pattern: "product_deleted", data: { productId: 7 } },
            { ...deathFrom("INVENTORY_PRODUCT_SERVICE"), "x-replay-count": 3 },
          ),
        ],
        [],
      );
      service.connection = broker.connection;

      const result = await service.peek(20);

      expect(result.queue).toBe(QUEUES.DEAD_LETTER);
      expect(result.total).toBe(1);
      expect(result.messages).toEqual([
        {
          sourceQueue: "INVENTORY_PRODUCT_SERVICE",
          sourceExchange: "product.fanout",
          reason: "rejected",
          deathCount: 2,
          firstDeathAt: new Date(1_790_000_000 * 1000).toISOString(),
          replayCount: 3,
          pattern: "product_deleted",
          payload: { productId: 7 },
        },
      ]);
      expect(broker.channel.nackAll).toHaveBeenCalledWith(true);
      expect(broker.channel.ack).not.toHaveBeenCalled();
    });
  });

  describe("applyDeadLetterPolicy", () => {
    it("PUTs a policy that dead-letters every queue except the DLQ itself", async () => {
      const broker = buildBroker([], []);
      service.connection = broker.connection;
      const fetchSpy = jest
        .spyOn(global, "fetch")
        .mockResolvedValue(new Response(null, { status: 204 }));

      await expect(service.applyDeadLetterPolicy()).resolves.toBe(true);

      expect(broker.channel.assertQueue).toHaveBeenCalledWith(
        QUEUES.DEAD_LETTER,
        { durable: true },
      );
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        `http://127.0.0.1:15672/api/policies/rabbit-trybuy/${DEAD_LETTER_POLICY}`,
      );
      expect(init.method).toBe("PUT");
      const policy = JSON.parse(init.body as string) as {
        pattern: string;
        definition: Record<string, unknown>;
      };
      const matches = new RegExp(policy.pattern);
      expect(matches.test("INVENTORY_PRODUCT_SERVICE")).toBe(true);
      expect(matches.test(QUEUES.DEAD_LETTER)).toBe(false);
      expect(matches.test("amq.gen-abc")).toBe(false);
      expect(policy.definition).toEqual({
        "dead-letter-exchange": "",
        "dead-letter-routing-key": QUEUES.DEAD_LETTER,
      });
      expect(fetchSpy.mock.calls[1]?.[0]).toContain(DEAD_LETTER_CAP_POLICY);
    });

    it("fails open when the management API is unreachable", async () => {
      const broker = buildBroker([], []);
      service.connection = broker.connection;
      jest.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(service.applyDeadLetterPolicy()).resolves.toBe(false);
      expect(broker.connection.close).toHaveBeenCalled();
    });

    it("fails open when the management API refuses the policy", async () => {
      service.connection = buildBroker([], []).connection;
      jest
        .spyOn(global, "fetch")
        .mockResolvedValue(new Response(null, { status: 401 }));

      await expect(service.applyDeadLetterPolicy()).resolves.toBe(false);
    });
  });
});
