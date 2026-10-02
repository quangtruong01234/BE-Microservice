import { RmqContext } from "@nestjs/microservices";
import { AckUnhandledServerRMQ } from "./ack-unhandled-server-rmq";

describe("AckUnhandledServerRMQ (RMQ-DLQ-01)", () => {
  const message = { content: Buffer.from("{}"), fields: {}, properties: {} };

  function buildContext(): {
    context: RmqContext;
    channel: Record<"ack" | "nack", jest.Mock>;
  } {
    const channel = { ack: jest.fn(), nack: jest.fn() };
    const context = new RmqContext([message, channel, "order_canceled"]);
    return { context, channel };
  }

  function buildServer(noAck = false): AckUnhandledServerRMQ {
    const server = new AckUnhandledServerRMQ({
      urls: ["amqp://localhost"],
      queue: "PAYMENTS_SERVICE",
      noAck,
    });
    // handleEvent on the stock server nacks through `this.channel`.
    Object.assign(server, { channel: buildContext().channel });
    return server;
  }

  it("acks — never rejects — a fanout event this queue has no handler for", async () => {
    const server = buildServer();
    const { context, channel } = buildContext();
    const ownChannel = (server as unknown as { channel: { nack: jest.Mock } })
      .channel;

    await server.handleEvent(
      "order_canceled",
      { pattern: "order_canceled", data: { orderId: 1 } },
      context,
    );

    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(ownChannel.nack).not.toHaveBeenCalled();
  });

  it("still dispatches an event it does handle to the handler", async () => {
    const server = buildServer();
    const handler = Object.assign(jest.fn().mockResolvedValue(undefined), {
      isEventHandler: true,
    });
    server.addHandler("payment_completed", handler, true);
    const { context, channel } = buildContext();

    await server.handleEvent(
      "payment_completed",
      { pattern: "payment_completed", data: { orderId: 1 } },
      context,
    );

    expect(handler).toHaveBeenCalledWith({ orderId: 1 }, context);
    // Acking is the handler's own job; the server must not ack for it.
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it("leaves a noAck queue alone — the broker already acked it", async () => {
    const server = buildServer(true);
    const { context, channel } = buildContext();

    await server.handleEvent(
      "order_canceled",
      { pattern: "order_canceled", data: {} },
      context,
    );

    expect(channel.ack).not.toHaveBeenCalled();
  });
});
