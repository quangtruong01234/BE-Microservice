import { ReadPacket, RmqContext, ServerRMQ } from "@nestjs/microservices";

/**
 * Every exchange here is a FANOUT, so a consumer queue receives every event
 * published to its exchange — including patterns it has no handler for (e.g.
 * `order_canceled` reaches PAYMENTS_SERVICE and REWARDS_SERVICE). Stock
 * ServerRMQ rejects those with nack(requeue=false), and the broker's
 * dead-letter policy (RMQ-DLQ-01) would route each one into the DLQ, burying
 * real failures under routine traffic. An event this queue does not handle is
 * "not for me", not a failure: ack it. The message is dropped exactly as
 * before, it just no longer dead-letters.
 */
export class AckUnhandledServerRMQ extends ServerRMQ {
  override async handleEvent(
    pattern: string,
    packet: ReadPacket,
    context: RmqContext,
  ): Promise<unknown> {
    if (!this.noAck && !this.getHandlerByPattern(pattern)) {
      const channel = context.getChannelRef() as {
        ack: (msg: unknown) => void;
      };
      channel.ack(context.getMessage());
      return undefined;
    }
    return super.handleEvent(pattern, packet, context);
  }
}
