import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from "@nestjs/common";
import * as amqp from "amqplib";
import { QUEUES } from "@app/common/constants/queues";
import {
  DeadLetterMessageDto,
  DeadLetterPeekResponseDto,
  DeadLetterReplayResponseDto,
} from "./dead-letter.dto";

interface RabbitMqConfig {
  host: string;
  port: string;
  user: string;
  pass: string;
  vhost: string;
  managementPort: string;
}

interface XDeathEntry {
  queue?: unknown;
  exchange?: unknown;
  reason?: unknown;
  count?: unknown;
  time?: unknown;
}

/** Name of the broker policy that routes every rejected message to the DLQ. */
export const DEAD_LETTER_POLICY = "trybuy-dead-letter";
/** Caps the DLQ itself so a poison flood cannot fill the broker's disk. */
export const DEAD_LETTER_CAP_POLICY = "trybuy-dead-letter-cap";
export const DEAD_LETTER_MAX_LENGTH = 10_000;

/**
 * Headers the broker owns. They are dropped on replay so the replayed copy
 * starts a clean death history in its source queue.
 */
const BROKER_DEATH_HEADERS = [
  "x-death",
  "x-first-death-queue",
  "x-first-death-reason",
  "x-first-death-exchange",
  "x-last-death-queue",
  "x-last-death-reason",
  "x-last-death-exchange",
];
const REPLAY_COUNT_HEADER = "x-replay-count";

/**
 * RMQ-DLQ-01. A consumer that gives up on a message calls
 * `nack(requeue=false)`, and before this the broker simply deleted it.
 *
 * Dead-lettering is attached with a broker POLICY rather than queue arguments:
 * every service asserts its queue with `{ durable: true }` only, and asserting
 * an existing durable queue with a new `x-dead-letter-exchange` argument is a
 * PRECONDITION_FAILED channel error at boot. A policy applies to the queues
 * that already exist, needs no redeploy of the consumers, and also catches the
 * messages NestJS itself rejects (unparseable body, no matching handler).
 */
@Injectable()
export class DeadLetterService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DeadLetterService.name);
  private readonly connectTimeoutMs = 3000;
  private readonly managementTimeoutMs = 3000;

  onApplicationBootstrap(): void {
    // Fire-and-forget: the gateway serves HTTP whether or not the broker is
    // up, so a slow or absent broker must never delay or fail startup.
    void this.applyDeadLetterPolicy();
  }

  /**
   * Idempotent — several gateway instances booting at once all PUT the same
   * definition. Fail-open: without the policy the system behaves exactly as it
   * did before this feature, so a failure is a warning, not a crash.
   */
  async applyDeadLetterPolicy(): Promise<boolean> {
    const config = this.readConfig();
    if (!config) {
      this.logger.warn(
        "RabbitMQ env incomplete — dead-letter policy not applied",
      );
      return false;
    }

    let connection: amqp.ChannelModel | null = null;
    try {
      connection = await this.connect(config);
      const channel = await connection.createChannel();
      await channel.assertQueue(QUEUES.DEAD_LETTER, { durable: true });

      await this.putPolicy(config, DEAD_LETTER_POLICY, {
        // Every queue except the DLQ itself (a message it rejects would loop
        // back into it) and broker-internal `amq.*` queues.
        pattern: `^(?!${this.escapeRegex(QUEUES.DEAD_LETTER)}$)(?!amq\\.).*`,
        definition: {
          "dead-letter-exchange": "",
          "dead-letter-routing-key": QUEUES.DEAD_LETTER,
        },
        priority: 0,
        "apply-to": "queues",
      });
      await this.putPolicy(config, DEAD_LETTER_CAP_POLICY, {
        pattern: `^${this.escapeRegex(QUEUES.DEAD_LETTER)}$`,
        definition: {
          "max-length": DEAD_LETTER_MAX_LENGTH,
          overflow: "drop-head",
        },
        priority: 1,
        "apply-to": "queues",
      });

      this.logger.log(
        `Dead-letter policy applied — rejected messages go to ${QUEUES.DEAD_LETTER}`,
      );
      return true;
    } catch (err: unknown) {
      this.logger.warn(
        `Dead-letter policy not applied (rejected messages are still dropped): ${this.describeError(err)}`,
      );
      return false;
    } finally {
      if (connection) {
        await this.closeQuietly(connection);
      }
    }
  }

  async peek(limit: number): Promise<DeadLetterPeekResponseDto> {
    const connection = await this.openOrFail();
    try {
      const channel = await connection.createChannel();
      const { messageCount } = await channel.assertQueue(QUEUES.DEAD_LETTER, {
        durable: true,
      });

      const messages: DeadLetterMessageDto[] = [];
      for (let index = 0; index < limit; index++) {
        const message = await channel.get(QUEUES.DEAD_LETTER, {
          noAck: false,
        });
        if (!message) {
          break;
        }
        messages.push(this.describeMessage(message));
      }

      // Everything read stays unacked on this channel; hand it all back so a
      // peek never consumes. Requeued messages keep their queue position.
      channel.nackAll(true);

      return { queue: QUEUES.DEAD_LETTER, total: messageCount, messages };
    } finally {
      await this.closeQuietly(connection);
    }
  }

  async replay(count: number): Promise<DeadLetterReplayResponseDto> {
    const config = this.readConfigOrFail();
    const connection = await this.openOrFail(config);
    try {
      const channel = await connection.createConfirmChannel();
      const { messageCount } = await channel.assertQueue(QUEUES.DEAD_LETTER, {
        durable: true,
      });

      const queueExistsByName = new Map<string, boolean>();
      const skippedMessages: amqp.GetMessage[] = [];
      let replayed = 0;

      // Bounded by the depth at call time: a consumer that rejects the
      // replayed copy again dead-letters it straight back to the tail, and an
      // unbounded loop would fetch and replay that same message again.
      const budget = Math.min(count, messageCount);
      for (let index = 0; index < budget; index++) {
        const message = await channel.get(QUEUES.DEAD_LETTER, {
          noAck: false,
        });
        if (!message) {
          break;
        }

        const targetQueue = this.readSourceQueue(message);
        const canReplay =
          targetQueue !== null &&
          (await this.queueExists(connection, targetQueue, queueExistsByName));

        if (!canReplay || targetQueue === null) {
          skippedMessages.push(message);
          continue;
        }

        // The default exchange routes by queue name, so ONLY the consumer
        // that rejected the message sees it again — replaying through the
        // original fanout would re-deliver it to every sibling consumer.
        channel.publish(
          "",
          targetQueue,
          message.content,
          this.buildReplayProperties(message),
        );
        await channel.waitForConfirms();
        channel.ack(message);
        replayed++;
      }

      for (const message of skippedMessages) {
        channel.nack(message, false, true);
      }

      if (skippedMessages.length > 0) {
        this.logger.warn(
          `Dead-letter replay skipped ${skippedMessages.length} message(s) with an unknown or missing source queue`,
        );
      }
      this.logger.log(`Dead-letter replay republished ${replayed} message(s)`);

      // Close the channel BEFORE the connection. Connection.Close travels on
      // channel 0 and can overtake the last ack still buffered here — the
      // broker then requeues a message that was already republished, which
      // duplicates it. Channel close-ok is only sent after prior frames.
      await channel.close().catch((err: unknown) => {
        this.logger.warn(
          `Dead-letter replay channel did not close cleanly; the last replayed message may be duplicated: ${this.describeError(err)}`,
        );
      });

      return {
        replayed,
        skipped: skippedMessages.length,
        remaining: Math.max(messageCount - replayed, 0),
      };
    } finally {
      await this.closeQuietly(connection);
    }
  }

  /** Overridable seam for the unit test. */
  protected async connect(config: RabbitMqConfig): Promise<amqp.ChannelModel> {
    const vhost = encodeURIComponent(config.vhost);
    const url = `amqp://${encodeURIComponent(config.user)}:${encodeURIComponent(config.pass)}@${config.host}:${config.port}/${vhost}?heartbeat=30`;
    const connection = await amqp.connect(url, {
      timeout: this.connectTimeoutMs,
    });
    // An unhandled 'error' on an amqplib connection crashes the process.
    connection.on("error", (err: unknown) => {
      this.logger.warn(`Dead-letter AMQP connection error: ${String(err)}`);
    });
    return connection;
  }

  private async putPolicy(
    config: RabbitMqConfig,
    name: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    const managementHost = process.env.RABBITMQ_MANAGEMENT_HOST ?? config.host;
    const url = `http://${managementHost}:${config.managementPort}/api/policies/${encodeURIComponent(config.vhost)}/${encodeURIComponent(name)}`;
    const credentials = Buffer.from(`${config.user}:${config.pass}`).toString(
      "base64",
    );

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        authorization: `Basic ${credentials}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.managementTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(
        `management API answered ${response.status} for policy ${name}`,
      );
    }
  }

  /**
   * A missing queue answers `checkQueue` with a 404 channel error, which
   * closes the channel — so each probe gets its own throwaway channel.
   */
  private async queueExists(
    connection: amqp.ChannelModel,
    queue: string,
    queueExistsByName: Map<string, boolean>,
  ): Promise<boolean> {
    const known = queueExistsByName.get(queue);
    if (known !== undefined) {
      return known;
    }

    const probeChannel = await connection.createChannel();
    probeChannel.on("error", () => undefined);
    let exists = false;
    try {
      await probeChannel.checkQueue(queue);
      exists = true;
      await probeChannel.close().catch(() => undefined);
    } catch {
      exists = false;
    }

    queueExistsByName.set(queue, exists);
    return exists;
  }

  private buildReplayProperties(
    message: amqp.GetMessage,
  ): amqp.Options.Publish {
    const { properties } = message;
    const headers: Record<string, unknown> = {
      ...(properties.headers ?? {}),
    };
    for (const header of BROKER_DEATH_HEADERS) {
      delete headers[header];
    }
    headers[REPLAY_COUNT_HEADER] = this.readReplayCount(message) + 1;
    headers["x-replayed-at"] = new Date().toISOString();

    return {
      persistent: true,
      headers,
      contentType: this.optionalString(properties.contentType),
      contentEncoding: this.optionalString(properties.contentEncoding),
      correlationId: this.optionalString(properties.correlationId),
      messageId: this.optionalString(properties.messageId),
      type: this.optionalString(properties.type),
      appId: this.optionalString(properties.appId),
    };
  }

  private describeMessage(message: amqp.GetMessage): DeadLetterMessageDto {
    const death = this.readLatestDeath(message);
    const { pattern, payload } = this.parseBody(message.content);

    return {
      sourceQueue: this.readSourceQueue(message),
      sourceExchange:
        typeof death?.exchange === "string" ? death.exchange : null,
      reason: typeof death?.reason === "string" ? death.reason : null,
      deathCount: typeof death?.count === "number" ? death.count : 0,
      firstDeathAt: this.readDeathTime(death?.time),
      replayCount: this.readReplayCount(message),
      pattern,
      payload,
    };
  }

  private readLatestDeath(message: amqp.GetMessage): XDeathEntry | null {
    const headers = message.properties.headers;
    const deaths = headers?.["x-death"];
    if (!Array.isArray(deaths) || deaths.length === 0) {
      return null;
    }
    // The broker keeps the most recent death first.
    const latest: unknown = deaths[0];
    return typeof latest === "object" && latest !== null ? latest : null;
  }

  private readSourceQueue(message: amqp.GetMessage): string | null {
    const death = this.readLatestDeath(message);
    if (typeof death?.queue === "string") {
      return death.queue;
    }
    const headers = message.properties.headers;
    const firstDeathQueue = headers?.["x-first-death-queue"];
    return typeof firstDeathQueue === "string" ? firstDeathQueue : null;
  }

  private readReplayCount(message: amqp.GetMessage): number {
    const headers = message.properties.headers;
    const replayCount: unknown = headers?.[REPLAY_COUNT_HEADER];
    return typeof replayCount === "number" ? replayCount : 0;
  }

  /** amqplib decodes an AMQP timestamp as `{ "!": "timestamp", value }` in seconds. */
  private readDeathTime(time: unknown): string | null {
    let seconds: number | null = null;
    if (typeof time === "number") {
      seconds = time;
    } else if (typeof time === "object" && time !== null && "value" in time) {
      const value = time.value;
      seconds = typeof value === "number" ? value : null;
    }
    return seconds === null ? null : new Date(seconds * 1000).toISOString();
  }

  private parseBody(content: Buffer): {
    pattern: string | null;
    payload: unknown;
  } {
    const raw = content.toString("utf8");
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null && "data" in parsed) {
        const envelope = parsed as { pattern?: unknown; data: unknown };
        return {
          pattern:
            typeof envelope.pattern === "string" ? envelope.pattern : null,
          payload: envelope.data,
        };
      }
      return { pattern: null, payload: parsed };
    } catch {
      return { pattern: null, payload: raw };
    }
  }

  private async openOrFail(
    config: RabbitMqConfig = this.readConfigOrFail(),
  ): Promise<amqp.ChannelModel> {
    try {
      return await this.connect(config);
    } catch (err: unknown) {
      this.logger.warn(
        `Dead-letter broker unreachable: ${this.describeError(err)}`,
      );
      throw new ServiceUnavailableException("Message broker is unavailable");
    }
  }

  private readConfigOrFail(): RabbitMqConfig {
    const config = this.readConfig();
    if (!config) {
      throw new ServiceUnavailableException("Message broker is not configured");
    }
    return config;
  }

  private readConfig(): RabbitMqConfig | null {
    const host = process.env.RABBITMQ_HOST;
    const port = process.env.RABBITMQ_PORT;
    const user = process.env.RABBITMQ_USER;
    const pass = process.env.RABBITMQ_PASS;
    if (!host || !port || !user || !pass) {
      return null;
    }
    return {
      host,
      port,
      user,
      pass,
      vhost: process.env.RABBITMQ_VHOST ?? "/",
      managementPort: process.env.RABBITMQ_MANAGEMENT_PORT ?? "15672",
    };
  }

  private async closeQuietly(connection: amqp.ChannelModel): Promise<void> {
    connection.on("error", () => undefined);
    await connection.close().catch(() => undefined);
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private describeError(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
