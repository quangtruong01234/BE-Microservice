import { Channel } from "amqplib";

/**
 * Whether the direct publisher handle is actually connected to the broker.
 *
 * `RmqModule.registerDirectPublisher()` hands out a self-healing proxy, not a
 * raw channel: while RabbitMQ is down the proxy stays truthy, answers
 * `publish()` with a no-op returning `false`, and reports `undefined` for every
 * other property. So a plain `if (this.fanoutChannel)` guard passes during an
 * outage and the event is dropped without a trace — `connection` is the only
 * honest liveness signal (OUTBOX-SCOPE-01).
 *
 * Use it in every publish guard alongside the null check that covers the
 * factory returning `null` when the broker was already down at startup.
 */
export function isRmqPublisherLive(
  channel: Channel | null | undefined,
): boolean {
  const connection: unknown = channel?.connection;
  return connection !== undefined && connection !== null;
}
